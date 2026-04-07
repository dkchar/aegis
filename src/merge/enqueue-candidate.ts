/**
 * Enqueue candidate — admission semantics for the merge queue.
 *
 * SPECv2 §6.1 and §12.4:
 *   - `implemented` → `queued_for_merge` is the canonical transition
 *   - candidates are admitted with branch info, target branch, and provenance
 *   - duplicate admissions are rejected (idempotent admission)
 *   - queue position is assigned based on current queue depth
 */

import type { MergeQueueState, QueueItem } from "./merge-queue-store.js";
import type { DispatchRecord } from "../core/dispatch-state.js";
import { isInQueue } from "./merge-queue-store.js";
import { DispatchStage } from "../core/stage-transition.js";

/** Input for admitting a candidate to the merge queue. */
export interface EnqueueCandidateInput {
  /** The originating Beads issue ID. */
  issueId: string;

  /** The candidate branch name created by Titan's labor. */
  candidateBranch: string;

  /** The target branch for merge (typically "main"). */
  targetBranch: string;

  /** The dispatch stage this item came from (typically "implemented"). */
  sourceStage: string;

  /** Opaque session provenance ID from the dispatch record. */
  sessionProvenanceId: string;

  /** Optional handoff artifact reference from Titan. */
  handoffArtifactRef?: string | null;
}

/**
 * Validate that a dispatch record is eligible for merge queue admission.
 *
 * A record is eligible when:
 *   - its stage is `implemented`
 *   - it is not already in the queue
 *   - it has a valid issue ID
 *
 * @param record - The dispatch record to validate.
 * @param alreadyInQueue - Whether the issue is already queued.
 * @returns True if eligible for admission.
 */
export function isEligibleForEnqueue(
  record: DispatchRecord,
  alreadyInQueue: boolean,
): boolean {
  return (
    record.stage === DispatchStage.Implemented &&
    !alreadyInQueue &&
    record.issueId.trim().length > 0
  );
}

/**
 * Admit a candidate to the merge queue.
 *
 * This is a pure function that returns a **new** MergeQueueState with the
 * candidate added. It does NOT mutate the input state.
 *
 * Queue position is assigned as the current queue length (FIFO tail).
 *
 * @param state - Current queue state.
 * @param input - The candidate admission input.
 * @returns A new MergeQueueState with the candidate admitted.
 * @throws Error if the candidate is already in the queue.
 */
export function admitCandidate(
  state: MergeQueueState,
  input: EnqueueCandidateInput,
): MergeQueueState {
  // Check for duplicate admission using canonical isInQueue
  const alreadyExists = isInQueue(state, input.issueId);

  if (alreadyExists) {
    throw new Error(
      `admitCandidate: issue ${input.issueId} is already in the merge queue`,
    );
  }

  // Assign position at the end of the queue
  const activeItemCount = state.items.filter(
    (item) =>
      item.status !== "merged" && item.status !== "manual_decision_required",
  ).length;

  const now = new Date().toISOString();

  const newItem: QueueItem = {
    issueId: input.issueId,
    candidateBranch: input.candidateBranch,
    targetBranch: input.targetBranch,
    enqueuedAt: now,
    position: activeItemCount,
    status: "queued",
    attemptCount: 0,
    lastError: null,
    sourceStage: input.sourceStage,
    sessionProvenanceId: input.sessionProvenanceId,
    updatedAt: now,
  };

  return {
    schemaVersion: state.schemaVersion,
    items: [...state.items, newItem],
    processedCount: state.processedCount,
  };
}

/**
 * Remove a completed or failed item from the queue and renumber positions.
 *
 * This is a pure function that returns a **new** MergeQueueState.
 *
 * @param state - Current queue state.
 * @param issueId - The issue ID to remove.
 * @returns A new MergeQueueState with the item removed and positions renumbered.
 */
export function dequeueItem(
  state: MergeQueueState,
  issueId: string,
): MergeQueueState {
  const remaining = state.items
    .filter((item) => item.issueId !== issueId)
    .map((item, index) => ({
      ...item,
      position: index,
    }));

  return {
    schemaVersion: state.schemaVersion,
    items: remaining,
    processedCount: state.processedCount + 1,
  };
}
