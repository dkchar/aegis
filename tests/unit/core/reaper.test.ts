import { describe, expect, it } from "vitest";

import { reapFinishedWork } from "../../../src/core/reaper.js";
import type { DispatchState } from "../../../src/core/dispatch-state.js";
import type { AgentRuntime } from "../../../src/runtime/agent-runtime.js";

function createRunningState(): DispatchState {
  return {
    schemaVersion: 1,
    records: {
      "ISSUE-1": {
        issueId: "ISSUE-1",
        stage: "scouting",
        runningAgent: {
          caste: "oracle",
          sessionId: "session-1",
          startedAt: "2026-04-14T11:55:00.000Z",
        },
        oracleAssessmentRef: null,
        sentinelVerdictRef: null,
        fileScope: null,
        failureCount: 0,
        consecutiveFailures: 0,
        failureWindowStartMs: null,
        cooldownUntil: null,
        sessionProvenanceId: "daemon-1",
        updatedAt: "2026-04-14T11:55:00.000Z",
      },
    },
  };
}

describe("reapFinishedWork", () => {
  it("moves successful phase-d oracle runs to the explicit phase_d_complete stage", async () => {
    const runtime: AgentRuntime = {
      async launch() {
        throw new Error("unused");
      },
      async readSession() {
        return {
          sessionId: "session-1",
          status: "succeeded",
          finishedAt: "2026-04-14T11:56:00.000Z",
        };
      },
      async terminate() {
        return null;
      },
    };

    const result = await reapFinishedWork({
      dispatchState: createRunningState(),
      runtime,
      issueIds: ["ISSUE-1"],
      root: "C:/repo",
      now: "2026-04-14T12:00:00.000Z",
    });

    expect(result.completed).toEqual(["ISSUE-1"]);
    expect(result.failed).toEqual([]);
    expect(result.state.records["ISSUE-1"]).toMatchObject({
      issueId: "ISSUE-1",
      stage: "phase_d_complete",
      runningAgent: null,
    });
  });

  it("marks failed sessions as failed and increments counters", async () => {
    const runtime: AgentRuntime = {
      async launch() {
        throw new Error("unused");
      },
      async readSession() {
        return {
          sessionId: "session-1",
          status: "failed",
          finishedAt: "2026-04-14T11:56:00.000Z",
          error: "runtime unavailable",
        };
      },
      async terminate() {
        return null;
      },
    };

    const result = await reapFinishedWork({
      dispatchState: createRunningState(),
      runtime,
      issueIds: ["ISSUE-1"],
      root: "C:/repo",
      now: "2026-04-14T12:00:00.000Z",
    });

    expect(result.completed).toEqual([]);
    expect(result.failed).toEqual(["ISSUE-1"]);
    expect(result.state.records["ISSUE-1"]).toMatchObject({
      issueId: "ISSUE-1",
      stage: "failed",
      runningAgent: null,
      failureCount: 1,
      consecutiveFailures: 1,
    });
  });
});
