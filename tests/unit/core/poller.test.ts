import { describe, expect, it } from "vitest";

import { emptyDispatchState } from "../../../src/core/dispatch-state.js";
import { pollReadyWork } from "../../../src/core/poller.js";
import type { TrackerClient } from "../../../src/tracker/tracker.js";

function createTracker(readyIssueIds: string[]): TrackerClient {
  return {
    async listReadyIssues() {
      return readyIssueIds.map((issueId, index) => ({
        id: issueId,
        title: `Issue ${index + 1}`,
      }));
    },
  };
}

describe("pollReadyWork", () => {
  it("returns tracker ready work alongside dispatch-state activity counts", async () => {
    const snapshot = await pollReadyWork({
      dispatchState: emptyDispatchState(),
      tracker: createTracker(["ISSUE-1", "ISSUE-2"]),
    });

    expect(snapshot.readyIssues.map((issue) => issue.id)).toEqual([
      "ISSUE-1",
      "ISSUE-2",
    ]);
    expect(snapshot.activeAgentCount).toBe(0);
    expect(snapshot.activeIssueIds).toEqual([]);
  });

  it("reports active issue ids for running records", async () => {
    const snapshot = await pollReadyWork({
      dispatchState: {
        schemaVersion: 1,
        records: {
          "ISSUE-1": {
            issueId: "ISSUE-1",
            stage: "scouting",
            runningAgent: {
              caste: "oracle",
              sessionId: "session-1",
              startedAt: "2026-04-14T12:00:00.000Z",
            },
            oracleAssessmentRef: null,
            sentinelVerdictRef: null,
            fileScope: null,
            failureCount: 0,
            consecutiveFailures: 0,
            failureWindowStartMs: null,
            cooldownUntil: null,
            sessionProvenanceId: "daemon-1",
            updatedAt: "2026-04-14T12:00:00.000Z",
          },
        },
      },
      tracker: createTracker(["ISSUE-1", "ISSUE-2"]),
    });

    expect(snapshot.activeAgentCount).toBe(1);
    expect(snapshot.activeIssueIds).toEqual(["ISSUE-1"]);
  });
});
