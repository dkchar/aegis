import {
  loadDispatchState,
  replaceDispatchRecord,
  saveDispatchState,
  type DispatchState,
} from "../core/dispatch-state.js";
import { assertDispatchRecordStage } from "../core/stage-invariants.js";
import {
  enqueueMergeCandidate,
  loadMergeQueueState,
  readTitanMergeCandidate,
  saveMergeQueueState,
  type MergeQueueState,
} from "./merge-state.js";

export interface AutoEnqueueMergeResult {
  enqueuedIssueIds: string[];
  dispatchState: DispatchState;
  mergeQueueState: MergeQueueState;
}

export function autoEnqueueImplementedIssuesForMerge(
  root: string,
  now = new Date().toISOString(),
): AutoEnqueueMergeResult {
  const dispatchState = loadDispatchState(root);
  let nextDispatchState = dispatchState;
  let mergeQueueState = loadMergeQueueState(root);
  const enqueuedIssueIds: string[] = [];

  for (const record of Object.values(dispatchState.records)) {
    if (record.stage !== "implemented") {
      continue;
    }
    assertDispatchRecordStage(record, "implemented");

    const candidate = readTitanMergeCandidate(root, record.titanHandoffRef!);
    const queued = enqueueMergeCandidate(mergeQueueState, {
      issueId: record.issueId,
      candidateBranch: candidate.candidate_branch,
      targetBranch: candidate.base_branch,
      laborPath: candidate.labor_path,
      now,
    });
    mergeQueueState = queued.state;
    nextDispatchState = replaceDispatchRecord(nextDispatchState, record.issueId, {
      ...record,
      stage: "queued_for_merge",
      updatedAt: now,
    });
    enqueuedIssueIds.push(record.issueId);
  }

  if (enqueuedIssueIds.length > 0) {
    saveMergeQueueState(root, mergeQueueState);
    saveDispatchState(root, nextDispatchState);
  }

  return {
    enqueuedIssueIds,
    dispatchState: nextDispatchState,
    mergeQueueState,
  };
}
