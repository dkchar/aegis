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
 */

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { DispatchStage } from "./stage-transition.js";

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
// In-progress stage set — used by reconcileDispatchState
// ---------------------------------------------------------------------------

/**
 * Stages in which an agent is actively executing.
 *
 * Records in these stages may have a stale `runningAgent` after a crash and
 * must be reconciled on restart (SPECv2 §6.3).
 */
const IN_PROGRESS_STAGES: ReadonlySet<DispatchStage> = new Set<DispatchStage>([
  DispatchStage.Scouting,
  DispatchStage.Implementing,
  DispatchStage.Merging,
  DispatchStage.Reviewing,
  DispatchStage.ResolvingIntegration,
]);

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function aegisDir(projectRoot: string): string {
  return join(projectRoot, ".aegis");
}

function dispatchStatePath(projectRoot: string): string {
  return join(aegisDir(projectRoot), "dispatch-state.json");
}

function dispatchStateTmpPath(projectRoot: string): string {
  return join(aegisDir(projectRoot), "dispatch-state.json.tmp");
}

// ---------------------------------------------------------------------------
// Load / save / reconcile — Lane B (aegis-fjm.5.3)
// ---------------------------------------------------------------------------

/**
 * Load the dispatch state from disk.
 *
 * - Returns `emptyDispatchState()` when the file does not exist (first run).
 * - Throws with context when the file exists but is malformed or has an
 *   unexpected `schemaVersion`.
 *
 * @param projectRoot - Absolute path to the project root (where `.aegis/` lives).
 * @returns The persisted DispatchState.
 */
export function loadDispatchState(projectRoot: string): DispatchState {
  const filePath = dispatchStatePath(projectRoot);

  if (!existsSync(filePath)) {
    return emptyDispatchState();
  }

  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch (err) {
    throw new Error(
      `loadDispatchState: failed to read ${filePath}: ${(err as Error).message}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `loadDispatchState: malformed JSON in ${filePath}: ${(err as Error).message}`,
    );
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as Record<string, unknown>)["schemaVersion"] !== 1
  ) {
    throw new Error(
      `loadDispatchState: invalid or unsupported schemaVersion in ${filePath} ` +
        `(expected 1, got ${(parsed as Record<string, unknown>)?.["schemaVersion"]})`,
    );
  }

  const obj = parsed as Record<string, unknown>;
  if (typeof obj["records"] !== "object" || obj["records"] === null) {
    throw new Error(
      `loadDispatchState: missing or invalid 'records' field in ${filePath}`,
    );
  }

  return parsed as DispatchState;
}

/**
 * Atomically persist the dispatch state to disk.
 *
 * Uses write-to-tmp then rename so a mid-write crash cannot corrupt the
 * existing file.  The `.aegis` directory is created if it does not exist.
 *
 * @param projectRoot - Absolute path to the project root.
 * @param state - The state to write.
 */
export function saveDispatchState(projectRoot: string, state: DispatchState): void {
  const dir = aegisDir(projectRoot);
  mkdirSync(dir, { recursive: true });

  const tmpPath = dispatchStateTmpPath(projectRoot);
  const finalPath = dispatchStatePath(projectRoot);

  const json = JSON.stringify(state, null, 2);
  writeFileSync(tmpPath, json, "utf-8");
  renameSync(tmpPath, finalPath);
}

/**
 * Reconcile the dispatch state after a restart.
 *
 * Scans all records for in-progress stages.  For each record whose
 * `sessionProvenanceId` differs from `liveSessionId`, the `runningAgent` is
 * cleared to `null` so the orchestrator can re-dispatch.  The `stage` is
 * intentionally preserved (SPECv2 §6.3).
 *
 * Records in terminal or waiting stages (pending, scouted, implemented,
 * queued_for_merge, merged, complete, failed) are left entirely unchanged.
 *
 * @param state - The state loaded from disk.
 * @param liveSessionId - The current process session identifier.
 * @returns A reconciled **copy** of the state (original is never mutated).
 */
export function reconcileDispatchState(
  state: DispatchState,
  liveSessionId: string,
): DispatchState {
  const reconciledRecords: Record<string, DispatchRecord> = {};

  for (const [issueId, record] of Object.entries(state.records)) {
    if (
      IN_PROGRESS_STAGES.has(record.stage) &&
      record.sessionProvenanceId !== liveSessionId
    ) {
      reconciledRecords[issueId] = {
        ...record,
        runningAgent: null,
        sessionProvenanceId: liveSessionId,
        updatedAt: new Date().toISOString(),
      };
    } else {
      reconciledRecords[issueId] = { ...record };
    }
  }

  return {
    schemaVersion: state.schemaVersion,
    records: reconciledRecords,
  };
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
