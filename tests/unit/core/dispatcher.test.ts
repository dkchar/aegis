import { describe, expect, it } from "vitest";

import { emptyDispatchState } from "../../../src/core/dispatch-state.js";
import { dispatchReadyWork } from "../../../src/core/dispatcher.js";
import type { AgentRuntime } from "../../../src/runtime/agent-runtime.js";

function createRuntime(): AgentRuntime {
  return {
    async launch() {
      return {
        sessionId: "session-1",
        startedAt: "2026-04-14T12:00:00.000Z",
      };
    },
    async readSession() {
      return null;
    },
    async terminate() {
      return null;
    },
  };
}

describe("dispatchReadyWork", () => {
  it("marks oracle dispatch as running and records the returned session id", async () => {
    const result = await dispatchReadyWork({
      dispatchState: emptyDispatchState(),
      decisions: [
        {
          issueId: "ISSUE-1",
          title: "First",
          caste: "oracle",
          stage: "scouting",
        },
      ],
      runtime: createRuntime(),
      sessionProvenanceId: "daemon-1",
      root: "C:/repo",
      now: "2026-04-14T12:00:00.000Z",
    });

    expect(result.dispatched).toEqual(["ISSUE-1"]);
    expect(result.state.records["ISSUE-1"]).toMatchObject({
      issueId: "ISSUE-1",
      stage: "scouting",
      runningAgent: {
        caste: "oracle",
        sessionId: "session-1",
        startedAt: "2026-04-14T12:00:00.000Z",
      },
      sessionProvenanceId: "daemon-1",
    });
  });

  it("puts failed launches on cooldown so the same issue is not redispatched immediately", async () => {
    const result = await dispatchReadyWork({
      dispatchState: emptyDispatchState(),
      decisions: [
        {
          issueId: "ISSUE-1",
          title: "First",
          caste: "oracle",
          stage: "scouting",
        },
      ],
      runtime: {
        async launch() {
          throw new Error("phase e runtime missing");
        },
        async readSession() {
          return null;
        },
        async terminate() {
          return null;
        },
      },
      sessionProvenanceId: "daemon-1",
      root: "C:/repo",
      now: "2026-04-14T12:00:00.000Z",
    });

    expect(result.failed).toEqual(["ISSUE-1"]);
    expect(result.state.records["ISSUE-1"]?.stage).toBe("failed");
    expect(result.state.records["ISSUE-1"]?.cooldownUntil).toBeTruthy();
  });
});
