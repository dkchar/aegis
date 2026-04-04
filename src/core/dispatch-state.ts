/**
 * Dispatch state model — orchestration truth for each tracked issue.
 *
 * SPECv2 §4.2 and §6: `.aegis/dispatch-state.json` is authoritative for:
 *   - current stage of each tracked issue
 *   - currently running agent assignment
 *   - Oracle assessment reference
 *   - Sentinel verdict reference
 *   - failure counters and cooldown windows
 *   - cumulative spend where exact dollar pricing is available
 *   - session-local provenance about which issues were dispatched by this instance
 *
 * Lane B (aegis-fjm.5.3) will fill in the load/save/reconcile implementations.
 */

import type { DispatchStage } from "./stage-transition.js";

// ---------------------------------------------------------------------------
// Agent assignment
// ---------------------------------------------------------------------------

/** Identifies which caste is currently running for an issue. */
export type AgentCaste = "oracle" | "titan" | "sentinel" | "janus";

/** A running agent assignment attached to a DispatchRecord. */
export interface AgentAssignment {
  /** Caste of the running agent. */
  caste: AgentCaste;
  /** Runtime session identifier (e.g. Pi session ID). */
  sessionId: string;
  /** ISO-8601 timestamp when this assignment was created. */
  startedAt: string;
}

// ---------------------------------------------------------------------------
// DispatchRecord — per-issue orchestration truth
// ---------------------------------------------------------------------------

/**
 * The full orchestration record for a single issue.
 *
 * One record per tracked issue, serialised into `.aegis/dispatch-state.json`
 * under the key `records[issueId]`.
 */
export interface DispatchRecord {
  /** The Beads issue identifier (e.g. "aegis-fjm.5"). */
  issueId: string;

  /** Current stage in the canonical pipeline. */
  stage: DispatchStage;

  /**
   * Currently running agent assignment.
   * Null when no agent is actively executing work for this issue.
   */
  runningAgent: AgentAssignment | null;

  /**
   * Reference to the Oracle assessment artifact (e.g. a file path or Beads
   * issue ID). Null until Oracle completes.
   */
  oracleAssessmentRef: string | null;

  /**
   * Reference to the Sentinel verdict artifact.
   * Null until Sentinel completes.
   */
  sentinelVerdictRef: string | null;

  /**
   * Total agent failure count for this issue across all attempts.
   * Reset only by explicit operator intervention.
   */
  failureCount: number;

  /**
   * Number of consecutive agent failures in the current ten-minute window.
   * Three consecutive failures trigger cooldown (SPECv2 §6.4).
   */
  consecutiveFailures: number;

  /**
   * ISO-8601 timestamp until which re-dispatch is suppressed by cooldown.
   * Null when no active cooldown.
   */
  cooldownUntil: string | null;

  /**
   * Cumulative spend in USD for this issue, when exact pricing is available.
   * Null when the runtime does not expose exact cost (SPECv2 §4.2).
   */
  cumulativeSpendUsd: number | null;

  /**
   * Opaque identifier for the Aegis process session that created or last
   * claimed this record.  Used for reconciliation after restart.
   */
  sessionProvenanceId: string;

  /** ISO-8601 timestamp of the last modification to this record. */
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// DispatchState — top-level file shape
// ---------------------------------------------------------------------------

/**
 * The full contents of `.aegis/dispatch-state.json`.
 *
 * `records` is a map from issue ID to its DispatchRecord.
 * `schemaVersion` allows forward-compatible migrations.
 */
export interface DispatchState {
  schemaVersion: 1;
  records: Record<string, DispatchRecord>;
}

// ---------------------------------------------------------------------------
// Load / save stubs — Lane B (aegis-fjm.5.3) implements these
// ---------------------------------------------------------------------------

/**
 * Load the dispatch state from disk.
 *
 * @param projectRoot - Absolute path to the project root (where `.aegis/` lives).
 * @returns The persisted DispatchState.
 * @throws If the file is missing or malformed.
 */
export function loadDispatchState(_projectRoot: string): DispatchState {
  throw new Error(
    "loadDispatchState: not implemented — Lane B (aegis-fjm.5.3) will implement this",
  );
}

/**
 * Atomically persist the dispatch state to disk.
 *
 * @param projectRoot - Absolute path to the project root.
 * @param state - The state to write.
 */
export function saveDispatchState(
  _projectRoot: string,
  _state: DispatchState,
): void {
  throw new Error(
    "saveDispatchState: not implemented — Lane B (aegis-fjm.5.3) will implement this",
  );
}

/**
 * Reconcile the dispatch state after a restart.
 *
 * Scans all records for in-progress stages whose agent sessions may have died
 * during a previous process lifetime, and applies the configured recovery
 * policy (e.g. keep the stage, mark agent assignment null, allow re-dispatch).
 *
 * @param state - The state loaded from disk.
 * @param liveSessionId - The current process session identifier.
 * @returns A reconciled copy of the state.
 */
export function reconcileDispatchState(
  _state: DispatchState,
  _liveSessionId: string,
): DispatchState {
  throw new Error(
    "reconcileDispatchState: not implemented — Lane B (aegis-fjm.5.3) will implement this",
  );
}

/**
 * Return an empty, valid DispatchState for first-run initialisation.
 */
export function emptyDispatchState(): DispatchState {
  return {
    schemaVersion: 1,
    records: {},
  };
}
