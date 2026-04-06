/**
 * S9.4 — Work dispatcher.
 *
 * SPECv2 §9.4: takes triage decisions from the poller and dispatches them
 * to Titans via the spawner/runtime boundary.
 *
 * This module owns the dispatch decision flow only — it does not replace
 * the spawner (§9.5), the runtime (§8.2), or triage (§9.3). It wires them
 * together.
 *
 * Five-planes discipline (SPECv2 §2):
 *   - Dispatch state is read, updated via immutable transitions
 *   - Dispatch state is persisted atomically (tmp → rename)
 *   - No mutations of ScoutedIssue inputs or dispatch state records
 */

import type { ScoutedIssue } from "./triage.js";
import type { DispatchState, DispatchRecord } from "./dispatch-state.js";
import { attachFileScope, clearFileScope } from "./triage.js";
import type { SpawnResult } from "./spawner.js";

// ---------------------------------------------------------------------------
// Dispatch result
// ---------------------------------------------------------------------------

export interface DispatchResult {
  /** Issue IDs successfully dispatched. */
  dispatched: string[];
  /** Issues that failed to dispatch, with error details. */
  errors: { issueId: string; error: string }[];
  /** Updated dispatch state (all records, including successful dispatches). */
  updatedState: DispatchState;
  /** Spawn results for successful dispatches, keyed by issueId. */
  spawnResults: Record<string, SpawnResult>;
}

/**
 * Abstract spawner interface for the dispatcher.
 *
 * The dispatcher is decoupled from the concrete spawner implementation
 * so it can be tested with mocks.
 */
export interface TitanSpawner {
  spawnForTitan(issueId: string, record: DispatchRecord): Promise<SpawnResult>;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Dispatch scouted issues to Titans via the spawner.
 *
 * For each dispatchable ScoutedIssue:
 *   1. Attach file scope to the dispatch record
 *   2. Call spawner.spawnForTitan() to create worktree and spawn
 *   3. Update the dispatch state with the new record
 *
 * Failures are collected but do not abort the entire dispatch batch —
 * remaining issues continue to be dispatched.
 *
 * @param dispatchable - Scouted issues cleared by triage for Titan dispatch.
 * @param state - Current dispatch state (not mutated).
 * @param spawner - Abstract spawner that handles worktree creation and runtime spawning.
 * @returns DispatchResult with dispatched IDs, errors, and updated state.
 */
export async function dispatchScoutedIssues(
  dispatchable: ScoutedIssue[],
  state: DispatchState,
  spawner: TitanSpawner,
): Promise<DispatchResult> {
  const dispatched: string[] = [];
  const errors: { issueId: string; error: string }[] = [];
  const spawnResults: Record<string, SpawnResult> = {};

  // Build a mutable working copy of dispatch state records.
  const records: Record<string, DispatchRecord> = {
    ...state.records,
  };

  for (const scouted of dispatchable) {
    const { issueId, record, assessment } = scouted;
    const existingRecord = records[issueId];

    if (!existingRecord) {
      errors.push({ issueId, error: "No dispatch record found for issue" });
      continue;
    }

    try {
      // Step 1: Attach file scope from Oracle assessment.
      const fileScope = { issueId, files: [...assessment.files_affected] };
      const scopedRecord = attachFileScope(existingRecord, fileScope);
      records[issueId] = scopedRecord;

      // Step 2: Spawn Titan via the spawner.
      const spawnResult = await spawner.spawnForTitan(issueId, scopedRecord);

      // Step 3: Update the record with the spawn result.
      records[issueId] = spawnResult.updatedRecord;

      dispatched.push(issueId);
      spawnResults[issueId] = spawnResult;
    } catch (error) {
      const message = (error as Error).message;
      errors.push({ issueId, error: message });

      // Clear file scope on failure to release the scope.
      if (records[issueId]) {
        records[issueId] = clearFileScope(records[issueId]);
      }
    }
  }

  const updatedState: DispatchState = {
    schemaVersion: state.schemaVersion,
    records,
  };

  return { dispatched, errors, updatedState, spawnResults };
}
