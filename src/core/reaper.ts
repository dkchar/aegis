/**
 * S10 — Reaper module.
 *
 * The Reaper finalizes the outcome of a finished session.
 * SPECv2 §9.7.
 *
 * This module defines the interface, result types, and outcome verification
 * contracts.  Implementation (actual stage transitions, labors cleanup,
 * merge-queue writes) belongs in the lanes.
 */

import type { DispatchRecord } from "./dispatch-state.js";
import { DispatchStage } from "./stage-transition.js";
import type { AgentEvent } from "../runtime/agent-events.js";
import type { MonitorEvent } from "./monitor.js";

export type SessionEndReason =
  | "completed"
  | "aborted"
  | "error"
  | "budget_exceeded"
  | "stuck_killed"
  | "monitor_aborted";

export type ReaperOutcome =
  | "success"
  | "artifact_failure"
  | "monitor_termination"
  | "crash";

export interface ArtifactVerification {
  issueId: string;
  caste: string;
  passed: boolean;
  checks: ArtifactCheck[];
}

export interface ArtifactCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface LaborCleanupInstruction {
  issueId: string;
  removeWorktree: boolean;
  deleteBranch: boolean;
  reason: string;
}

export interface MergeCandidateInstruction {
  issueId: string;
  candidateBranch: string;
  targetBranch: string;
  handoffArtifactPath: string;
}

export interface ReaperResult {
  issueId: string;
  outcome: ReaperOutcome;
  endReason: SessionEndReason;
  nextStage: DispatchStage;
  artifacts: ArtifactVerification;
  incrementFailure: boolean;
  resetFailures: boolean;
  laborCleanup: LaborCleanupInstruction | null;
  mergeCandidate: MergeCandidateInstruction | null;
  monitorEvents: MonitorEvent[];
  /**
   * SPECv2 §9.7: "reclaim concurrency capacity".
   * True when the Reaper has freed a concurrency slot by finishing a session
   * (the runningAgent is cleared via updateRecordFromReaper).  The caller
   * should use this signal to update its own concurrency tracking.
   */
  reclaimConcurrency: boolean;
}

export interface Reaper {
  reap(
    issueId: string,
    caste: string,
    endReason: SessionEndReason,
    events: AgentEvent[],
    currentRecord: DispatchRecord,
  ): ReaperResult;
  verifyOracleArtifacts(issueId: string, events: AgentEvent[]): ArtifactVerification;
  verifyTitanArtifacts(issueId: string, events: AgentEvent[]): ArtifactVerification;
  verifySentinelArtifacts(issueId: string, events: AgentEvent[]): ArtifactVerification;
  verifyJanusArtifacts(issueId: string, events: AgentEvent[]): ArtifactVerification;
}

// ---------------------------------------------------------------------------
// Pure helper functions
// ---------------------------------------------------------------------------

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
    case "janus":
      // Janus success means the integration conflict was resolved;
      // return to queued_for_merge for a fresh mechanical pass (SPECv2 §12.6 step 8)
      return DispatchStage.QueuedForMerge;
    default:
      return DispatchStage.Failed;
  }
}

export function determineLaborCleanup(
  caste: string,
  outcome: ReaperOutcome,
  issueId: string,
): LaborCleanupInstruction | null {
  if (caste === "oracle" || caste === "sentinel") {
    return null;
  }

  if (caste === "janus") {
    // Janus works inside the preserved conflict labor or dedicated integration labor.
    // Always preserve for diagnostics regardless of outcome (SPECv2 §10.4).
    return {
      issueId,
      removeWorktree: false,
      deleteBranch: false,
      reason: outcome === "success"
        ? "janus_success_preserve_for_requeue"
        : "janus_failure_preserve_for_diagnostics",
    };
  }

  if (caste === "titan" && outcome === "success") {
    return {
      issueId,
      removeWorktree: false,
      deleteBranch: false,
      reason: "titan_success_preserve_for_merge_queue",
    };
  }

  if (caste === "titan") {
    return {
      issueId,
      removeWorktree: false,
      deleteBranch: false,
      reason: "titan_failure_preserve_for_diagnostics",
    };
  }

  return null;
}
