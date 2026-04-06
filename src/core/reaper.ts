/**
 * S10 contract seed — Reaper module.
 *
 * The Reaper finalizes the outcome of a finished session.
 * SPECv2 §9.7:
 *   - verify expected outputs exist
 *   - transition state to the next stage or `failed`
 *   - reset or increment failure counters
 *   - trigger Labor cleanup or preservation
 *   - queue merge candidates after Titan success
 *   - reclaim concurrency capacity
 *   - run Lethe pruning when appropriate
 *
 * Key rules (SPECv2 §9.7):
 *   - success requires artifact verification, not just process exit
 *   - failed sessions return issues to an actionable state
 *   - Titans do not mark work complete directly
 *   - merge work proceeds through the queue, not through implicit REAP merge
 *
 * This module defines the interface, result types, and outcome verification
 * contracts.  Implementation (actual stage transitions, labors cleanup,
 * merge-queue writes) belongs in the lanes.
 */

import type { DispatchRecord } from "./dispatch-state.js";
import { DispatchStage } from "./stage-transition.js";
import type { AgentEvent } from "../runtime/agent-events.js";
import type { MonitorEvent } from "./monitor.js";

// ---------------------------------------------------------------------------
// Session result types
// ---------------------------------------------------------------------------

/**
 * Why a session ended.  Derived from AgentEvent.session_ended.reason plus
 * monitor-side termination signals (e.g. stuck kill, budget abort).
 */
export type SessionEndReason =
  | "completed"
  | "aborted"
  | "error"
  | "budget_exceeded"
  | "stuck_killed"
  | "monitor_aborted";

/**
 * The outcome of reaping a finished session.
 * This drives the next stage transition and failure accounting.
 */
export type ReaperOutcome =
  /** Session completed successfully with valid artifacts. */
  | "success"
  /** Session completed but artifacts are missing or invalid. */
  | "artifact_failure"
  /** Session was terminated by the monitor (stuck, budget, etc.). */
  | "monitor_termination"
  /** Session crashed or hit an unrecoverable runtime error. */
  | "crash";

// ---------------------------------------------------------------------------
// Artifact verification
// ---------------------------------------------------------------------------

/**
 * Result of verifying that a session produced the expected artifacts.
 * Each caste has different artifact requirements (SPECv2 §10).
 */
export interface ArtifactVerification {
  /** Issue ID being verified. */
  issueId: string;
  /** Caste that produced the artifacts. */
  caste: string;
  /** Whether all required artifacts are present and valid. */
  passed: boolean;
  /** Details about what was checked and what failed. */
  checks: ArtifactCheck[];
}

/** A single artifact verification check. */
export interface ArtifactCheck {
  /** Name of the check (e.g. "oracle_assessment", "titan_handoff", "sentinel_verdict"). */
  name: string;
  /** Whether this specific check passed. */
  passed: boolean;
  /** Human-readable detail about what was found or missing. */
  detail: string;
}

// ---------------------------------------------------------------------------
// Labor cleanup instruction
// ---------------------------------------------------------------------------

/**
 * Instruction for what to do with a Labor after a session ends.
 * The Reaper decides; the labor module executes.
 */
export interface LaborCleanupInstruction {
  /** Issue ID whose labor to clean up. */
  issueId: string;
  /** Whether to remove the worktree directory. */
  removeWorktree: boolean;
  /** Whether to delete the git branch. */
  deleteBranch: boolean;
  /** Reason for this cleanup decision. */
  reason: string;
}

// ---------------------------------------------------------------------------
// Merge candidate instruction
// ---------------------------------------------------------------------------

/**
 * Instruction to enqueue a merge candidate after Titan success.
 * The Reaper produces this; the merge queue consumes it.
 */
export interface MergeCandidateInstruction {
  /** Originating issue ID. */
  issueId: string;
  /** Candidate branch name (e.g. "aegis/aegis-fjm.10"). */
  candidateBranch: string;
  /** Target branch to merge into (e.g. "main"). */
  targetBranch: string;
  /** Path to the Titan handoff artifact file. */
  handoffArtifactPath: string;
}

// ---------------------------------------------------------------------------
// Reaper result
// ---------------------------------------------------------------------------

/**
 * The full result of reaping one session.
 * Contains the outcome, next stage, failure accounting, and side-effect
 * instructions that the caller must execute.
 */
export interface ReaperResult {
  /** The issue ID that was reaped. */
  issueId: string;
  /** The determined outcome category. */
  outcome: ReaperOutcome;
  /** Why the session ended. */
  endReason: SessionEndReason;
  /** The next dispatch stage to transition to. */
  nextStage: DispatchStage;
  /** Artifact verification details. */
  artifacts: ArtifactVerification;
  /** Whether to increment the failure counter. */
  incrementFailure: boolean;
  /** Whether to reset the failure counter (successful completion). */
  resetFailures: boolean;
  /** Labor cleanup instruction, if applicable. */
  laborCleanup: LaborCleanupInstruction | null;
  /** Merge candidate instruction, if applicable (Titan success). */
  mergeCandidate: MergeCandidateInstruction | null;
  /** Any monitor events generated during reaping. */
  monitorEvents: MonitorEvent[];
}

// ---------------------------------------------------------------------------
// Reaper interface
// ---------------------------------------------------------------------------

/**
 * The Reaper finalizes the outcome of a finished agent session.
 *
 * Responsibilities (SPECv2 §9.7):
 *   - verify that the session produced expected artifacts for its caste
 *   - determine the outcome (success, artifact_failure, monitor_termination, crash)
 *   - compute the next dispatch stage
 *   - produce side-effect instructions (labor cleanup, merge enqueue)
 *   - update failure counters appropriately
 *
 * The Reaper is pure decision logic.  Side effects (stage transitions,
 * file writes, branch deletion) are executed by the caller.
 */
export interface Reaper {
  /**
   * Reap a finished session and produce a ReaperResult.
   *
   * @param issueId - Beads issue ID.
   * @param caste - Agent caste that ran.
   * @param endReason - Why the session ended.
   * @param events - All AgentEvents collected during the session.
   * @param currentRecord - The current DispatchRecord for this issue.
   * @returns A ReaperResult with the outcome and side-effect instructions.
   */
  reap(
    issueId: string,
    caste: string,
    endReason: SessionEndReason,
    events: AgentEvent[],
    currentRecord: DispatchRecord,
  ): ReaperResult;

  /**
   * Verify artifacts for an Oracle session.
   * Checks that a valid OracleAssessment was produced.
   */
  verifyOracleArtifacts(
    issueId: string,
    events: AgentEvent[],
  ): ArtifactVerification;

  /**
   * Verify artifacts for a Titan session.
   * Checks that a handoff artifact exists with the required fields.
   */
  verifyTitanArtifacts(
    issueId: string,
    events: AgentEvent[],
  ): ArtifactVerification;

  /**
   * Verify artifacts for a Sentinel session.
   * Checks that a structured verdict was produced.
   */
  verifySentinelArtifacts(
    issueId: string,
    events: AgentEvent[],
  ): ArtifactVerification;
}

// ---------------------------------------------------------------------------
// Pure helper functions
// ---------------------------------------------------------------------------

/**
 * Determine the next dispatch stage based on caste, outcome, and current stage.
 *
 * Happy-path transitions (SPECv2 §6.1):
 *   - Oracle success: scouting → scouted
 *   - Titan success: implementing → implemented
 *   - Sentinel success (pass): reviewing → complete
 *   - Sentinel fail (fail verdict): reviewing → failed
 *   - Any failure: current stage → failed
 *
 * @param caste - The caste that ran.
 * @param outcome - The reaper outcome.
 * @param currentStage - The issue's current dispatch stage.
 * @param sentinelVerdict - For Sentinel only: "pass" or "fail".
 * @returns The next dispatch stage.
 */
export function computeNextStage(
  caste: string,
  outcome: ReaperOutcome,
  currentStage: DispatchStage,
  sentinelVerdict?: "pass" | "fail",
): DispatchStage {
  if (outcome !== "success") {
    return DispatchStage.Failed;
  }

  switch (caste) {
    case "oracle":
      return DispatchStage.Scouted;
    case "titan":
      return DispatchStage.Implemented;
    case "sentinel":
      return sentinelVerdict === "pass"
        ? DispatchStage.Complete
        : DispatchStage.Failed;
    default:
      return DispatchStage.Failed;
  }
}

/**
 * Determine the labor cleanup instruction for a finished session.
 *
 * SPECv2 §11.2:
 *   - successful merge → remove worktree and delete branch
 *   - conflict or failure → preserve labor and branch
 *   - Oracle/Sentinel → no labor to clean up
 *
 * @param caste - Agent caste that ran.
 * @param outcome - The reaper outcome.
 * @param issueId - Issue ID.
 * @returns LaborCleanupInstruction or null if no labor exists.
 */
export function determineLaborCleanup(
  caste: string,
  outcome: ReaperOutcome,
  issueId: string,
): LaborCleanupInstruction | null {
  // Oracle and Sentinel do not use Labors.
  if (caste === "oracle" || caste === "sentinel") {
    return null;
  }

  if (caste === "titan" && outcome === "success") {
    // Titan success: preserve the labor until the merge queue decides.
    // The merge queue will clean up after successful merge.
    return {
      issueId,
      removeWorktree: false,
      deleteBranch: false,
      reason: "titan_success_preserve_for_merge_queue",
    };
  }

  if (caste === "titan") {
    // Titan failure: preserve labor for diagnostics and potential rework.
    return {
      issueId,
      removeWorktree: false,
      deleteBranch: false,
      reason: "titan_failure_preserve_for_diagnostics",
    };
  }

  return null;
}
