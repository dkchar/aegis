import path from "node:path";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";

import { monitorActiveWork } from "../../../src/core/monitor.js";
import type { DispatchState } from "../../../src/core/dispatch-state.js";
import type { AgentRuntime } from "../../../src/runtime/agent-runtime.js";
import { readPhaseLog } from "../../../src/core/phase-log.js";

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

const tempRoots: string[] = [];

function createTempRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "aegis-monitor-"));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("monitorActiveWork", () => {
  it("flags long-running work for kill once the kill threshold expires", async () => {
    const root = createTempRoot();
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
      root,
      now: "2026-04-14T12:00:00.000Z",
    });

    expect(result.killList).toEqual(["ISSUE-1"]);
    expect(result.readyToReap).toEqual(["ISSUE-1"]);
    expect(terminate).toHaveBeenCalledWith(
      root,
      "session-1",
      "Exceeded stuck kill threshold: no session activity for 300s.",
    );
  });

  it("keeps long sessions alive while they report activity", async () => {
    const root = createTempRoot();
    const terminate = vi.fn();
    const runtime: AgentRuntime = {
      async launch() {
        throw new Error("unused");
      },
      async readSession() {
        return {
          sessionId: "session-1",
          status: "running",
          lastActivityAt: "2026-04-14T11:59:30.000Z",
        };
      },
      terminate,
    };

    const result = await monitorActiveWork({
      dispatchState: runningState,
      runtime,
      thresholds: {
        stuck_warning_seconds: 20,
        stuck_kill_seconds: 150,
      },
      root,
      now: "2026-04-14T12:00:00.000Z",
    });

    // Five minutes old but active 30s ago: warned, not killed.
    expect(terminate).not.toHaveBeenCalled();
    expect(result.killList).toEqual([]);
    expect(result.warnings).toEqual(["ISSUE-1"]);
  });

  it("marks succeeded sessions as ready for reap", async () => {
    const root = createTempRoot();
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
      root,
      now: "2026-04-14T12:00:00.000Z",
    });

    expect(result.killList).toEqual([]);
    expect(result.readyToReap).toEqual(["ISSUE-1"]);
  });

  it("writes a monitor phase log even when there are no active sessions", async () => {
    const root = createTempRoot();
    const runtime: AgentRuntime = {
      async launch() {
        throw new Error("unused");
      },
      async readSession() {
        return null;
      },
      async terminate() {
        return null;
      },
    };

    const result = await monitorActiveWork({
      dispatchState: {
        schemaVersion: 1,
        records: {},
      },
      runtime,
      thresholds: {
        stuck_warning_seconds: 90,
        stuck_kill_seconds: 150,
      },
      root,
      now: "2026-04-14T12:00:00.000Z",
    });

    expect(result).toEqual({
      readyToReap: [],
      killList: [],
      warnings: [],
    });

    const summary = readPhaseLog(root).entries.find((entry) =>
      entry.phase === "monitor" && entry.issueId === "_all");
    expect(summary).toMatchObject({
      phase: "monitor",
      issueId: "_all",
    });
  });
});
