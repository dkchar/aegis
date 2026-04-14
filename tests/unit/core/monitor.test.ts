import { describe, expect, it, vi } from "vitest";

import { monitorActiveWork } from "../../../src/core/monitor.js";
import type { DispatchState } from "../../../src/core/dispatch-state.js";
import type { AgentRuntime } from "../../../src/runtime/agent-runtime.js";

const runningState: DispatchState = {
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

describe("monitorActiveWork", () => {
  it("flags long-running work for kill once the kill threshold expires", async () => {
    const terminate = vi.fn(async () => ({
      sessionId: "session-1",
      status: "failed" as const,
      finishedAt: "2026-04-14T12:00:00.000Z",
      error: "killed by monitor",
    }));
    const runtime: AgentRuntime = {
      async launch() {
        throw new Error("unused");
      },
      async readSession() {
        return {
          sessionId: "session-1",
          status: "running",
        };
      },
      terminate,
    };

    const result = await monitorActiveWork({
      dispatchState: runningState,
      runtime,
      thresholds: {
        stuck_warning_seconds: 90,
        stuck_kill_seconds: 150,
      },
      root: "C:/repo",
      now: "2026-04-14T12:00:00.000Z",
    });

    expect(result.killList).toEqual(["ISSUE-1"]);
    expect(result.readyToReap).toEqual(["ISSUE-1"]);
    expect(terminate).toHaveBeenCalledWith(
      "C:/repo",
      "session-1",
      "Exceeded stuck kill threshold.",
    );
  });

  it("marks succeeded sessions as ready for reap", async () => {
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
        throw new Error("unused");
      },
    };

    const result = await monitorActiveWork({
      dispatchState: runningState,
      runtime,
      thresholds: {
        stuck_warning_seconds: 90,
        stuck_kill_seconds: 150,
      },
      root: "C:/repo",
      now: "2026-04-14T12:00:00.000Z",
    });

    expect(result.killList).toEqual([]);
    expect(result.readyToReap).toEqual(["ISSUE-1"]);
  });
});
