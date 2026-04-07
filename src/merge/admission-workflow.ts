/**
 * Candidate admission workflow — full admission path with dispatch state
 * transition and SSE event emission.
 *
 * SPECv2 §6.1 and §12.4:
 *   - `implemented` → `queued_for_merge` transition must update dispatch state
 *   - queue items carry full context for Olympus display
 *   - events emitted for live queue state updates
 *
 * This module wires together:
 *   - dispatch-state transitionStage() for implemented → queued_for_merge
 *   - merge-queue-store admitCandidate() for queue persistence
 *   - event-bus publish() for merge.queue_state SSE events
 */

import type { DispatchRecord, DispatchState } from "../core/dispatch-state.js";
import { transitionStage } from "../core/stage-transition.js";
import type { MergeQueueState } from "./merge-queue-store.js";
import { admitCandidate, isEligibleForEnqueue } from "./enqueue-candidate.js";
import { isInQueue, isTerminalStatus } from "./merge-queue-store.js";
import type { LiveEventPublisher, AegisLiveEvent } from "../events/event-bus.js";
import { DispatchStage } from "../core/stage-transition.js";

/** Input for the full admission workflow. */
export interface AdmissionWorkflowInput {
  /** The dispatch record for the issue being admitted. */
  dispatchRecord: DispatchRecord;

  /** The candidate branch name created by Titan's labor. */
  candidateBranch: string;

  /** The target branch for merge (typically "main"). */
  targetBranch: string;

  /** Optional handoff artifact reference from Titan. */
  handoffArtifactRef?: string | null;
}

/** Result of a successful admission workflow run. */
export interface AdmissionResult {
  /** The updated dispatch state with the issue transitioned to queued_for_merge. */
  dispatchState: DispatchState;

  /** The updated merge queue state with the new candidate admitted. */
  queueState: MergeQueueState;

  /** The SSE event emitted for this admission. */
  emittedEvent: AegisLiveEvent;
}

/**
 * Run the full candidate admission workflow.
 *
 * This is the orchestrator-facing entry point that performs all steps:
 *
 * 1. Validates the dispatch record is eligible (stage === implemented, not already queued)
 * 2. Admits the candidate to the merge queue (FIFO tail position)
 * 3. Transitions dispatch state: implemented → queued_for_merge
 * 4. Emits a merge.queue_state SSE event for Olympus visibility
 *
 * The state transformations (steps 2-3) are pure — new objects are returned
 * without mutating inputs. The SSE event emission (step 4) is a side effect.
 *
 * @param dispatchState - Current dispatch state.
 * @param queueState - Current merge queue state.
 * @param eventPublisher - The live event publisher for SSE emission.
 * @param input - The admission input with candidate details.
 * @returns The updated states and emitted event.
 * @throws Error if the candidate is not eligible for admission.
 */
export function runAdmissionWorkflow(
  dispatchState: DispatchState,
  queueState: MergeQueueState,
  eventPublisher: LiveEventPublisher,
  input: AdmissionWorkflowInput,
): AdmissionResult {
  const { dispatchRecord, candidateBranch, targetBranch, handoffArtifactRef } = input;
  const issueId = dispatchRecord.issueId;

  // Step 1: Validate eligibility
  const alreadyInQueue = isInQueue(queueState, issueId);
  if (!isEligibleForEnqueue(dispatchRecord, alreadyInQueue)) {
    throw new Error(
      `runAdmissionWorkflow: issue ${issueId} is not eligible for merge queue admission ` +
        `(stage: ${dispatchRecord.stage}, already queued: ${alreadyInQueue})`,
    );
  }

  // Step 2: Admit candidate to the merge queue
  const newQueueState = admitCandidate(queueState, {
    issueId,
    candidateBranch,
    targetBranch,
    sourceStage: dispatchRecord.stage,
    sessionProvenanceId: dispatchRecord.sessionProvenanceId,
    handoffArtifactRef: handoffArtifactRef ?? null,
  });

  // Step 3: Transition dispatch state: implemented → queued_for_merge
  const updatedRecord = transitionStage(dispatchRecord, DispatchStage.QueuedForMerge);
  const newDispatchState: DispatchState = {
    schemaVersion: dispatchState.schemaVersion,
    records: {
      ...dispatchState.records,
      [issueId]: updatedRecord,
    },
  };

  // Step 4: Emit merge.queue_state SSE event for Olympus
  const admittedItem = newQueueState.items.find((item) => item.issueId === issueId)!;
  const event: AegisLiveEvent = {
    id: crypto.randomUUID(),
    type: "merge.queue_state",
    timestamp: new Date().toISOString(),
    sequence: newQueueState.items.length,
    payload: {
      issueId,
      status: "queued",
      attemptCount: admittedItem.attemptCount,
      errorDetail: null,
    },
  };

  eventPublisher.publish(event);

  return {
    dispatchState: newDispatchState,
    queueState: newQueueState,
    emittedEvent: event,
  };
}

/**
 * Compute the queue depth (number of non-terminal items).
 *
 * This is a convenience export of the calculation used by Olympus for
 * monitoring dashboards.
 *
 * @param state - Current merge queue state.
 * @returns Number of non-terminal items.
 */
export function computeQueueDepth(state: MergeQueueState): number {
  return state.items.filter(
    (item) => !isTerminalStatus(item.status),
  ).length;
}

/**
 * Compute the waiting queue depth (items that are purely queued, not active).
 *
 * @param state - Current merge queue state.
 * @returns Number of items with status === "queued".
 */
export function computeWaitingDepth(state: MergeQueueState): number {
  return state.items.filter((item) => item.status === "queued").length;
}
