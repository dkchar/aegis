import {
  loadDispatchState,
  type DispatchState,
} from "../core/dispatch-state.js";
import { assertDispatchRecordStage } from "../core/stage-invariants.js";
import {
  enqueueMergeCandidate,
  loadMergeQueueState,
  readTitanMergeCandidate,
  saveMergeQueueState,
  type MergeQueueItem,
  type MergeQueueState,
} from "./merge-state.js";

export interface AutoEnqueueMergeResult {
  /** Every `queued_for_merge` issue now present in the merge queue. */
  enqueuedIssueIds: string[];
  dispatchState: DispatchState;
  mergeQueueState: MergeQueueState;
}

/**
 * Only `queued_for_merge` records reach this check, so a `merging` item here
 * was stranded by an interrupted merge (the live executor holds the record in
 * `merging`). Treating it as current would deadlock the issue; requeue it.
 */
function isCurrentQueueEntry(
  item: MergeQueueItem | undefined,
  candidate: ReturnType<typeof readTitanMergeCandidate>,
) {
  if (!item) {
    return false;
  }
  return item.status === "queued"
    && item.candidateBranch === candidate.candidate_branch
    && item.targetBranch === candidate.base_branch
    && item.laborPath === candidate.labor_path;
}

/**
 * Ensures every Sentinel-passed (`queued_for_merge`) issue has a queued merge
 * item. Already-current entries are left untouched, so the queue file is only
 * rewritten when a candidate is new or changed.
 */
export function autoEnqueueImplementedIssuesForMerge(
  root: string,
  now = new Date().toISOString(),
): AutoEnqueueMergeResult {
  const dispatchState = loadDispatchState(root);
  let mergeQueueState = loadMergeQueueState(root);
  const enqueuedIssueIds: string[] = [];
  let changed = false;

  for (const record of Object.values(dispatchState.records)) {
    if (record.stage !== "queued_for_merge") {
      continue;
    }
    assertDispatchRecordStage(record, "queued_for_merge");

    const candidate = readTitanMergeCandidate(root, record.titanHandoffRef!);
    const existing = mergeQueueState.items.find((item) => item.issueId === record.issueId);
    enqueuedIssueIds.push(record.issueId);
    if (isCurrentQueueEntry(existing, candidate)) {
      continue;
    }

    mergeQueueState = enqueueMergeCandidate(mergeQueueState, {
      issueId: record.issueId,
      candidateBranch: candidate.candidate_branch,
      targetBranch: candidate.base_branch,
      laborPath: candidate.labor_path,
      now,
    }).state;
    changed = true;
  }

  if (changed) {
    saveMergeQueueState(root, mergeQueueState);
  }

  return {
    enqueuedIssueIds,
    dispatchState,
    mergeQueueState,
  };
}
