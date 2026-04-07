/**
 * Merge events — event types for merge queue state changes.
 *
 * SPECv2 §12.9 and §13:
 *   - merge outcomes are surfaced as queue events
 *   - Beads message types when messaging is enabled
 *   - SSE events for Olympus live state
 *
 * This module extends the live event system with merge-specific event types.
 */

import type { QueueItemStatus } from "../merge/merge-queue-store.js";

// ---------------------------------------------------------------------------
// Merge event types
// ---------------------------------------------------------------------------

export const MERGE_EVENT_TYPES = [
  "merge.queue_state",
  "merge.outcome",
  "merge.conflict_detected",
  "merge.janus_escalation",
] as const;

export type MergeEventType = (typeof MERGE_EVENT_TYPES)[number];

/** Event payload for queue state changes. */
export interface MergeQueueStateEventPayload {
  /** The issue ID being processed. */
  issueId: string;

  /** The new status after processing. */
  status: QueueItemStatus;

  /** Current attempt count for this item. */
  attemptCount: number;

  /** Optional error detail if status indicates failure. */
  errorDetail?: string | null;
}

/** Event payload for merge outcomes. */
export interface MergeOutcomeEventPayload {
  /** The issue ID that completed merge processing. */
  issueId: string;

  /** The semantic outcome of the merge. */
  outcome:
    | "MERGE_READY"
    | "MERGED"
    | "MERGE_FAILED"
    | "REWORK_REQUEST"
    | "JANUS_REQUIRED"
    | "JANUS_RESOLVED"
    | "JANUS_FAILED"
    | "MANUAL_DECISION_REQUIRED";

  /** The candidate branch that was merged. */
  candidateBranch: string;

  /** The target branch. */
  targetBranch: string;

  /** Optional detail about the outcome. */
  detail?: string | null;
}

/** Event payload for conflict detection. */
export interface MergeConflictDetectedEventPayload {
  /** The issue ID with the conflict. */
  issueId: string;

  /** The candidate branch with conflicts. */
  candidateBranch: string;

  /** The target branch. */
  targetBranch: string;

  /** The conflict tier (SPECv2 §12.8). */
  conflictTier: 0 | 1 | 2 | 3;

  /** Whether labor was preserved. */
  laborPreserved: boolean;
}

/** Event payload for Janus escalation. */
export interface MergeJanusEscalationEventPayload {
  /** The issue ID requiring Janus. */
  issueId: string;

  /** The reason for escalation. */
  reason: "retry_threshold_reached" | "semantic_ambiguity" | "manual_override";

  /** Current attempt count. */
  attemptCount: number;

  /** Whether Janus is enabled in config. */
  janusEnabled: boolean;
}

/** Union type of all merge event payloads. */
export type MergeEventPayloadMap = {
  "merge.queue_state": MergeQueueStateEventPayload;
  "merge.outcome": MergeOutcomeEventPayload;
  "merge.conflict_detected": MergeConflictDetectedEventPayload;
  "merge.janus_escalation": MergeJanusEscalationEventPayload;
};

export type MergeEventPayload<TType extends MergeEventType = MergeEventType> =
  MergeEventPayloadMap[TType];

/**
 * Create a merge queue state event.
 *
 * @param issueId - The issue being processed.
 * @param status - The new status.
 * @param attemptCount - Current attempt count.
 * @param errorDetail - Optional error detail.
 * @returns The event payload.
 */
export function createMergeQueueStateEvent(
  issueId: string,
  status: QueueItemStatus,
  attemptCount: number,
  errorDetail?: string | null,
): MergeQueueStateEventPayload {
  return {
    issueId,
    status,
    attemptCount,
    errorDetail: errorDetail ?? null,
  };
}

/**
 * Create a merge outcome event.
 *
 * @param issueId - The issue that completed.
 * @param outcome - The semantic merge outcome.
 * @param candidateBranch - The branch that was merged.
 * @param targetBranch - The target branch.
 * @param detail - Optional detail.
 * @returns The event payload.
 */
export function createMergeOutcomeEvent(
  issueId: string,
  outcome: MergeOutcomeEventPayload["outcome"],
  candidateBranch: string,
  targetBranch: string,
  detail?: string | null,
): MergeOutcomeEventPayload {
  return {
    issueId,
    outcome,
    candidateBranch,
    targetBranch,
    detail: detail ?? null,
  };
}

/**
 * Create a merge conflict detected event.
 *
 * @param issueId - The issue with conflicts.
 * @param candidateBranch - The conflicting branch.
 * @param targetBranch - The target branch.
 * @param conflictTier - The conflict tier (0-3).
 * @param laborPreserved - Whether labor was preserved.
 * @returns The event payload.
 */
export function createMergeConflictEvent(
  issueId: string,
  candidateBranch: string,
  targetBranch: string,
  conflictTier: MergeConflictDetectedEventPayload["conflictTier"],
  laborPreserved: boolean,
): MergeConflictDetectedEventPayload {
  return {
    issueId,
    candidateBranch,
    targetBranch,
    conflictTier,
    laborPreserved,
  };
}

/**
 * Create a merge Janus escalation event.
 *
 * @param issueId - The issue requiring Janus.
 * @param reason - The escalation reason.
 * @param attemptCount - Current attempt count.
 * @param janusEnabled - Whether Janus is enabled.
 * @returns The event payload.
 */
export function createMergeJanusEscalationEvent(
  issueId: string,
  reason: MergeJanusEscalationEventPayload["reason"],
  attemptCount: number,
  janusEnabled: boolean,
): MergeJanusEscalationEventPayload {
  return {
    issueId,
    reason,
    attemptCount,
    janusEnabled,
  };
}
