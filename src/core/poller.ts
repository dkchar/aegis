import type { DispatchState } from "./dispatch-state.js";
import type { TrackerClient, TrackerReadyIssue } from "../tracker/tracker.js";

export interface PollerInput {
  dispatchState: DispatchState;
  tracker: TrackerClient;
  root?: string;
}

export interface PollSnapshot {
  readyIssues: TrackerReadyIssue[];
  activeAgentCount: number;
  activeIssueIds: string[];
}

export async function pollReadyWork(input: PollerInput): Promise<PollSnapshot> {
  const readyIssues = await input.tracker.listReadyIssues(input.root);
  const activeIssueIds = Object.values(input.dispatchState.records)
    .filter((record) => record.runningAgent !== null)
    .map((record) => record.issueId);

  return {
    readyIssues,
    activeAgentCount: activeIssueIds.length,
    activeIssueIds,
  };
}
