/**
 * S10 contract seed — Recovery module.
 *
 * The Recovery module reconciles in-progress work on restart and handles
 * dead agents.  SPECv2 §6.3, §6.5, and §9.9 (restart recovery):
 *   - a restart must reconstruct active or incomplete work from disk
 *   - in-progress stages survive process death and are reconciled on restart
 *   - dispatch an Oracle, kill mid-run, restart → issue remains reconcilable
 *   - in-progress records with stale runningAgent are cleared for re-dispatch
 *
 * This is distinct from `reconcileDispatchState()` in dispatch-state.ts,
 * which only clears stale `runningAgent` fields.  The Recovery module
 * performs deeper reconciliation:
 *   - reconcile dead agents (sessions that are no longer alive)
 *   - reconcile orphaned Labors (worktrees whose process died)
 *   - reconcile incomplete merge queue items
 *   - produce a RecoveryReport for the operator and Olympus visibility
 *
 * This module defines the interface and reconciliation result types.
 * Implementation (actual git worktree inspection, process probing, etc.)
 * belongs in the lanes.
 */

import type { DispatchState, DispatchRecord } from "./dispatch-state.js";
import type { AgentCaste } from "./dispatch-state.js";

// ---------------------------------------------------------------------------
// Agent reconciliation
// ---------------------------------------------------------------------------

/** Status of a single agent session after recovery inspection. */
export type AgentRecoveryStatus =
  /** Session is still alive and responding. */
  | "alive"
  /** Session has terminated cleanly. */
  | "terminated_cleanly"
  /** Session process is dead but may have left usable artifacts. */
  | "dead_with_artifacts"
  /** Session process is dead with no usable artifacts. */
  | "dead_no_artifacts"
  /** Session cannot be located (session ID no longer valid). */
  | "not_found";

/**
 * Reconciliation result for a single active agent session.
 */
export interface AgentReconciliation {
  /** Issue ID the agent was working on. */
  issueId: string;
  /** Caste of the dead agent. */
  caste: AgentCaste;
  /** Session ID that was being tracked. */
  sessionId: string;
  /** Determined status after inspection. */
  status: AgentRecoveryStatus;
  /** Whether the dispatch record should transition to `failed`. */
  shouldFail: boolean;
  /** Whether the dispatch record can be re-dispatched as-is. */
  canRedispatch: boolean;
  /** Human-readable summary for the operator. */
  summary: string;
}

// ---------------------------------------------------------------------------
// Labor reconciliation
// ---------------------------------------------------------------------------

/** Status of a Labor directory after recovery inspection. */
export type LaborRecoveryStatus =
  /** Labor worktree and branch both exist and are intact. */
  | "intact"
  /** Worktree exists but the branch was already merged/deleted. */
  | "branch_gone"
  /** Branch exists but the worktree was removed. */
  | "worktree_gone"
  /** Neither worktree nor branch can be found. */
  | "lost"
  /** Labor was already cleaned up by a previous Reaper run. */
  | "already_cleaned";

/**
 * Reconciliation result for a single Labor.
 */
export interface LaborReconciliation {
  /** Issue ID the labor was for. */
  issueId: string;
  /** Expected worktree path. */
  worktreePath: string;
  /** Expected branch name. */
  branchName: string;
  /** Determined status after inspection. */
  status: LaborRecoveryStatus;
  /** Recommended action for the operator. */
  recommendedAction: string;
}

// ---------------------------------------------------------------------------
// Recovery report
// ---------------------------------------------------------------------------

/**
 * Full recovery report produced on restart.
 * This is persisted and surfaced to Olympus so the operator sees what
 * happened during recovery.
 */
export interface RecoveryReport {
  /** ISO-8601 timestamp when recovery ran. */
  timestamp: string;
  /** Session provenance ID of the new process. */
  newSessionId: string;
  /** Number of dispatch records that were reconciled. */
  recordsReconciled: number;
  /** Agent sessions that were inspected. */
  agentReconciliations: AgentReconciliation[];
  /** Labors that were inspected. */
  laborReconciliations: LaborReconciliation[];
  /** Whether any data loss was detected. */
  dataLossDetected: boolean;
  /** Summary for the operator. */
  summary: string;
}

// ---------------------------------------------------------------------------
// Recovery interface
// ---------------------------------------------------------------------------

/**
 * The Recovery module reconciles in-progress work on restart.
 *
 * Responsibilities:
 *   - inspect all in-progress dispatch records for stale agents
 *   - probe each tracked session to determine if it is still alive
 *   - inspect Labor worktrees and branches for orphaned state
 *   - reconcile merge queue items that were in-flight during crash
 *   - produce a RecoveryReport for operator visibility
 *
 * The recovery process must be idempotent — running it twice on the
 * same post-crash state produces the same result.
 */
export interface Recovery {
  /**
   * Run full recovery reconciliation against the current dispatch state.
   *
   * @param state - The dispatch state loaded from disk.
   * @param newSessionId - The session provenance ID of the new process.
   * @returns A RecoveryReport with all reconciliation results.
   */
  runRecovery(state: DispatchState, newSessionId: string): RecoveryReport;

  /**
   * Reconcile a single agent session.
   *
   * @param record - The dispatch record with a stale runningAgent.
   * @returns An AgentReconciliation describing the session's post-crash status.
   */
  reconcileAgent(record: DispatchRecord): AgentReconciliation;

  /**
   * Reconcile a single Labor.
   *
   * @param issueId - Issue ID the labor was for.
   * @param worktreePath - Expected absolute path to the worktree.
   * @param branchName - Expected git branch name.
   * @returns A LaborReconciliation describing the labor's post-crash status.
   */
  reconcileLabor(
    issueId: string,
    worktreePath: string,
    branchName: string,
  ): LaborReconciliation;
}

// ---------------------------------------------------------------------------
// Pure helper functions
// ---------------------------------------------------------------------------

/**
 * Identify all dispatch records that had a running agent at the time of crash.
 * These are the records that need agent reconciliation.
 *
 * @param state - The dispatch state loaded from disk.
 * @returns Array of records with non-null runningAgent.
 */
export function findInProgressRecords(
  state: DispatchState,
): DispatchRecord[] {
  return Object.values(state.records).filter(
    (record) => record.runningAgent !== null,
  );
}

/**
 * Compute a summary line for the recovery report.
 *
 * @param report - The completed RecoveryReport.
 * @returns A one-line summary string for operator display.
 */
export function summarizeRecovery(report: RecoveryReport): string {
  const parts: string[] = [];

  parts.push(`Reconciled ${report.recordsReconciled} record(s)`);

  const deadAgents = report.agentReconciliations.filter(
    (a) => a.status === "dead_no_artifacts" || a.status === "dead_with_artifacts",
  ).length;
  if (deadAgents > 0) {
    parts.push(`${deadAgents} dead agent session(s) found`);
  }

  const lostLabors = report.laborReconciliations.filter(
    (l) => l.status === "lost",
  ).length;
  if (lostLabors > 0) {
    parts.push(`${lostLabors} lost labor(s)`);
  }

  if (report.dataLossDetected) {
    parts.push("DATA LOSS DETECTED — review required");
  }

  return parts.join("; ");
}

/**
 * Determine whether a dispatch record can be safely re-dispatched after recovery.
 *
 * A record can be re-dispatched when:
 *   - the running agent is confirmed dead
 *   - the stage is still an in-progress stage (not terminal)
 *   - cooldown does not suppress it (checked separately by the dispatch loop)
 *
 * @param record - The reconciled dispatch record.
 * @returns `true` if the record is eligible for re-dispatch.
 */
export function canRedispatchAfterRecovery(record: DispatchRecord): boolean {
  if (record.runningAgent !== null) {
    // Agent is still thought to be running — not yet reconciled.
    return false;
  }

  const inProgressStages = new Set([
    "scouting",
    "implementing",
    "merging",
    "reviewing",
    "resolving_integration",
  ]);

  if (!inProgressStages.has(record.stage)) {
    return false;
  }

  // Cooldown suppression is checked separately by the dispatch loop.
  return true;
}
