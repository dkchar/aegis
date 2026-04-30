import path from "node:path";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

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

function createTitanRunningState(): DispatchState {
  return {
    schemaVersion: 1,
    records: {
      "ISSUE-2": {
        issueId: "ISSUE-2",
        stage: "implementing",
        runningAgent: {
          caste: "titan",
          sessionId: "session-2",
          startedAt: "2026-04-14T11:55:00.000Z",
        },
        oracleAssessmentRef: ".aegis/oracle/ISSUE-2.json",
        titanHandoffRef: null,
        titanClarificationRef: null,
        sentinelVerdictRef: null,
        janusArtifactRef: null,
        failureTranscriptRef: null,
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

function createSentinelRunningState(): DispatchState {
  return {
    schemaVersion: 1,
    records: {
      "ISSUE-9": {
        issueId: "ISSUE-9",
        stage: "reviewing",
        runningAgent: {
          caste: "sentinel",
          sessionId: "session-9",
          startedAt: "2026-04-24T09:55:00.000Z",
        },
        oracleAssessmentRef: ".aegis/oracle/ISSUE-9.json",
        titanHandoffRef: ".aegis/titan/ISSUE-9.json",
        titanClarificationRef: null,
        sentinelVerdictRef: null,
        janusArtifactRef: null,
        failureTranscriptRef: null,
        fileScope: null,
        failureCount: 0,
        consecutiveFailures: 0,
        failureWindowStartMs: null,
        cooldownUntil: null,
        sessionProvenanceId: "daemon-1",
        updatedAt: "2026-04-24T09:55:00.000Z",
      },
    },
  };
}

function createParallelTitanRunningState(): DispatchState {
  return {
    schemaVersion: 1,
    records: {
      "ISSUE-2": {
        issueId: "ISSUE-2",
        stage: "implementing",
        runningAgent: {
          caste: "titan",
          sessionId: "session-2",
          startedAt: "2026-04-14T11:55:00.000Z",
        },
        oracleAssessmentRef: ".aegis/oracle/ISSUE-2.json",
        titanHandoffRef: null,
        titanClarificationRef: null,
        sentinelVerdictRef: null,
        janusArtifactRef: null,
        failureTranscriptRef: null,
        fileScope: null,
        failureCount: 0,
        consecutiveFailures: 0,
        failureWindowStartMs: null,
        cooldownUntil: null,
        sessionProvenanceId: "daemon-1",
        updatedAt: "2026-04-14T11:55:00.000Z",
      },
      "ISSUE-3": {
        issueId: "ISSUE-3",
        stage: "implementing",
        runningAgent: {
          caste: "titan",
          sessionId: "session-3",
          startedAt: "2026-04-14T11:55:30.000Z",
        },
        oracleAssessmentRef: ".aegis/oracle/ISSUE-3.json",
        titanHandoffRef: null,
        titanClarificationRef: null,
        sentinelVerdictRef: null,
        janusArtifactRef: null,
        failureTranscriptRef: null,
        fileScope: null,
        failureCount: 0,
        consecutiveFailures: 0,
        failureWindowStartMs: null,
        cooldownUntil: null,
        sessionProvenanceId: "daemon-1",
        updatedAt: "2026-04-14T11:55:30.000Z",
      },
    },
  };
}

const tempRoots: string[] = [];

function createTempRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "aegis-reaper-"));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("reapFinishedWork", () => {
  it("moves successful oracle runs to the generic scouted stage", async () => {
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
        return null;
      },
    };

    mkdirSync(path.join(root, ".aegis"), { recursive: true });
    writeFileSync(
      path.join(root, ".aegis", "dispatch-state.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        records: {
          "ISSUE-1": {
            issueId: "ISSUE-1",
            stage: "scouted",
            runningAgent: {
              caste: "oracle",
              sessionId: "session-1",
              startedAt: "2026-04-14T11:55:00.000Z",
            },
            oracleAssessmentRef: ".aegis/oracle/ISSUE-1.json",
            sentinelVerdictRef: null,
            fileScope: null,
            failureCount: 0,
            consecutiveFailures: 0,
            failureWindowStartMs: null,
            cooldownUntil: null,
            sessionProvenanceId: "daemon-1",
            updatedAt: "2026-04-14T11:56:00.000Z",
          },
        },
      }, null, 2)}\n`,
      "utf8",
    );

    const result = await reapFinishedWork({
      dispatchState: createRunningState(),
      runtime,
      issueIds: ["ISSUE-1"],
      root,
      now: "2026-04-14T12:00:00.000Z",
    });

    expect(result.completed).toEqual(["ISSUE-1"]);
    expect(result.failed).toEqual([]);
    expect(result.state.records["ISSUE-1"]).toMatchObject({
      issueId: "ISSUE-1",
      stage: "scouted",
      runningAgent: null,
    });
  });

  it("heals a missing Oracle artifact ref from durable artifacts before finalizing the session", async () => {
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
        return null;
      },
    };

    mkdirSync(path.join(root, ".aegis", "oracle"), { recursive: true });
    writeFileSync(
      path.join(root, ".aegis", "dispatch-state.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        records: {
          "ISSUE-1": {
            issueId: "ISSUE-1",
            stage: "scouted",
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
            updatedAt: "2026-04-14T11:56:00.000Z",
          },
        },
      }, null, 2)}\n`,
      "utf8",
    );
    writeFileSync(
      path.join(root, ".aegis", "oracle", "ISSUE-1.json"),
      `${JSON.stringify({ files_affected: [] }, null, 2)}\n`,
      "utf8",
    );

    const result = await reapFinishedWork({
      dispatchState: createRunningState(),
      runtime,
      issueIds: ["ISSUE-1"],
      root,
      now: "2026-04-14T12:00:00.000Z",
    });

    expect(result.completed).toEqual(["ISSUE-1"]);
    expect(result.failed).toEqual([]);
    expect(result.state.records["ISSUE-1"]).toMatchObject({
      issueId: "ISSUE-1",
      stage: "scouted",
      runningAgent: null,
      oracleAssessmentRef: path.join(".aegis", "oracle", "ISSUE-1.json"),
    });
  });

  it("hydrates missing file scope from durable Oracle artifact before Titan dispatch", async () => {
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
        return null;
      },
    };

    mkdirSync(path.join(root, ".aegis", "oracle"), { recursive: true });
    writeFileSync(
      path.join(root, ".aegis", "dispatch-state.json"),
      `${JSON.stringify({
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
            oracleAssessmentRef: ".aegis/oracle/ISSUE-1.json",
            sentinelVerdictRef: null,
            fileScope: null,
            failureCount: 0,
            consecutiveFailures: 0,
            failureWindowStartMs: null,
            cooldownUntil: null,
            sessionProvenanceId: "daemon-1",
            updatedAt: "2026-04-14T11:56:00.000Z",
          },
        },
      }, null, 2)}\n`,
      "utf8",
    );
    writeFileSync(
      path.join(root, ".aegis", "oracle", "ISSUE-1.json"),
      `${JSON.stringify({ files_affected: ["docs/setup-contract.md"] }, null, 2)}\n`,
      "utf8",
    );

    const result = await reapFinishedWork({
      dispatchState: createRunningState(),
      runtime,
      issueIds: ["ISSUE-1"],
      root,
      now: "2026-04-14T12:00:00.000Z",
    });

    expect(result.state.records["ISSUE-1"]?.fileScope).toEqual({
      files: ["docs/setup-contract.md"],
    });
  });

  it("marks failed sessions as failed_operational and increments counters", async () => {
    const root = createTempRoot();
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
      root,
      now: "2026-04-14T12:00:00.000Z",
    });

    expect(result.completed).toEqual([]);
    expect(result.failed).toEqual(["ISSUE-1"]);
    expect(result.state.records["ISSUE-1"]).toMatchObject({
      issueId: "ISSUE-1",
      stage: "failed_operational",
      runningAgent: null,
      failureCount: 1,
      consecutiveFailures: 1,
    });
    expect(result.state.records["ISSUE-1"]?.cooldownUntil).toBeTruthy();
  });

  it("records the failed caste transcript ref when one was persisted", async () => {
    const root = createTempRoot();
    mkdirSync(path.join(root, ".aegis", "transcripts"), { recursive: true });
    writeFileSync(
      path.join(root, ".aegis", "transcripts", "ISSUE-2--titan.json"),
      `${JSON.stringify({ status: "failed" }, null, 2)}\n`,
      "utf8",
    );
    const runtime: AgentRuntime = {
      async launch() {
        throw new Error("unused");
      },
      async readSession() {
        return {
          sessionId: "session-2",
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
      dispatchState: createTitanRunningState(),
      runtime,
      issueIds: ["ISSUE-2"],
      root,
      now: "2026-04-14T12:00:00.000Z",
    });

    expect(result.state.records["ISSUE-2"]).toMatchObject({
      stage: "failed_operational",
      failureTranscriptRef: path.join(".aegis", "transcripts", "ISSUE-2--titan.json"),
      operationalFailureKind: "runtime_failure",
    });
  });

  it("exhausts operational retries immediately for provider usage limits", async () => {
    const root = createTempRoot();
    const runtime: AgentRuntime = {
      async launch() {
        throw new Error("unused");
      },
      async readSession() {
        return {
          sessionId: "session-1",
          status: "failed",
          finishedAt: "2026-04-29T14:54:04.000Z",
          error: "You've hit your usage limit. Upgrade to Pro or try again at 6:19 PM.",
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
      root,
      now: "2026-04-29T14:55:00.000Z",
    });

    expect(result.state.records["ISSUE-1"]).toMatchObject({
      stage: "failed_operational",
      failureCount: 1,
      consecutiveFailures: 3,
      operationalFailureKind: "provider_usage_limit",
    });
  });

  it("marks failed sessions as failed_operational and increments counters", async () => {
    const root = createTempRoot();
    const runtime: AgentRuntime = {
      async launch() {
        throw new Error("unused");
      },
      async readSession() {
        return {
          sessionId: "session-1",
          status: "failed",
          finishedAt: "2026-04-24T10:00:00.000Z",
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
      root,
      now: "2026-04-24T10:00:00.000Z",
    });

    expect(result.completed).toEqual([]);
    expect(result.failed).toEqual(["ISSUE-1"]);
    expect(result.state.records["ISSUE-1"]).toMatchObject({
      issueId: "ISSUE-1",
      stage: "failed_operational",
      runningAgent: null,
      failureCount: 1,
      consecutiveFailures: 1,
      operationalFailureKind: "runtime_failure",
    });
    expect(result.state.records["ISSUE-1"]?.cooldownUntil).toBeTruthy();
  });

  it("moves successful Sentinel sessions to queued_for_merge and keeps review feedback for rework loops", async () => {
    const root = createTempRoot();
    const runtime: AgentRuntime = {
      async launch() {
        throw new Error("unused");
      },
      async readSession() {
        return {
          sessionId: "session-9",
          status: "succeeded",
          finishedAt: "2026-04-24T10:00:00.000Z",
        };
      },
      async terminate() {
        return null;
      },
    };

    mkdirSync(path.join(root, ".aegis"), { recursive: true });
    writeFileSync(
      path.join(root, ".aegis", "dispatch-state.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        records: {
          "ISSUE-9": {
            issueId: "ISSUE-9",
            stage: "queued_for_merge",
            runningAgent: {
              caste: "sentinel",
              sessionId: "session-9",
              startedAt: "2026-04-24T09:55:00.000Z",
            },
            oracleAssessmentRef: ".aegis/oracle/ISSUE-9.json",
            titanHandoffRef: ".aegis/titan/ISSUE-9.json",
            sentinelVerdictRef: ".aegis/sentinel/ISSUE-9.json",
            reviewFeedbackRef: ".aegis/sentinel/ISSUE-9.json",
            janusArtifactRef: null,
            fileScope: null,
            failureCount: 0,
            consecutiveFailures: 0,
            failureWindowStartMs: null,
            cooldownUntil: null,
            sessionProvenanceId: "daemon-1",
            updatedAt: "2026-04-24T10:00:00.000Z",
          },
        },
      }, null, 2)}\n`,
      "utf8",
    );

    const result = await reapFinishedWork({
      dispatchState: createSentinelRunningState(),
      runtime,
      issueIds: ["ISSUE-9"],
      root,
      now: "2026-04-24T10:00:00.000Z",
    });

    expect(result.completed).toEqual(["ISSUE-9"]);
    expect(result.state.records["ISSUE-9"]).toMatchObject({
      stage: "queued_for_merge",
      runningAgent: null,
      reviewFeedbackRef: ".aegis/sentinel/ISSUE-9.json",
    });
  });

  it("returns failed Sentinel sessions to implemented cooldown for review retry", async () => {
    const root = createTempRoot();
    const runtime: AgentRuntime = {
      async launch() {
        throw new Error("unused");
      },
      async readSession() {
        return {
          sessionId: "session-9",
          status: "failed",
          finishedAt: "2026-04-24T10:00:00.000Z",
          error: "Sentinel timed out",
        };
      },
      async terminate() {
        return null;
      },
    };

    const result = await reapFinishedWork({
      dispatchState: createSentinelRunningState(),
      runtime,
      issueIds: ["ISSUE-9"],
      root,
      now: "2026-04-24T10:00:00.000Z",
    });

    expect(result.completed).toEqual([]);
    expect(result.failed).toEqual(["ISSUE-9"]);
    expect(result.state.records["ISSUE-9"]).toMatchObject({
      stage: "implemented",
      runningAgent: null,
      titanHandoffRef: ".aegis/titan/ISSUE-9.json",
      failureCount: 1,
      consecutiveFailures: 1,
    });
    expect(result.state.records["ISSUE-9"]?.cooldownUntil).toBeTruthy();
  });

  it("escalates repeated Sentinel operational failures back to Titan dispatch", async () => {
    const root = createTempRoot();
    const runtime: AgentRuntime = {
      async launch() {
        throw new Error("unused");
      },
      async readSession() {
        return {
          sessionId: "session-9",
          status: "failed",
          finishedAt: "2026-04-24T10:00:00.000Z",
          error: "Sentinel timed out again",
        };
      },
      async terminate() {
        return null;
      },
    };
    const state = createSentinelRunningState();
    state.records["ISSUE-9"] = {
      ...state.records["ISSUE-9"]!,
      reviewFeedbackRef: ".aegis/sentinel/ISSUE-9.json",
      failureCount: 1,
      consecutiveFailures: 1,
      failureWindowStartMs: 1777049700000,
    };

    const result = await reapFinishedWork({
      dispatchState: state,
      runtime,
      issueIds: ["ISSUE-9"],
      root,
      now: "2026-04-24T10:00:00.000Z",
    });

    expect(result.completed).toEqual([]);
    expect(result.failed).toEqual(["ISSUE-9"]);
    expect(result.state.records["ISSUE-9"]).toMatchObject({
      stage: "failed_operational",
      runningAgent: null,
      oracleAssessmentRef: ".aegis/oracle/ISSUE-9.json",
      reviewFeedbackRef: ".aegis/sentinel/ISSUE-9.json",
      failureCount: 2,
      consecutiveFailures: 2,
    });
    expect(result.state.records["ISSUE-9"]?.cooldownUntil).toBeTruthy();
  });

  it("moves successful titan runs to implemented stage while clearing running assignment", async () => {
    const root = createTempRoot();
    const runtime: AgentRuntime = {
      async launch() {
        throw new Error("unused");
      },
      async readSession() {
        return {
          sessionId: "session-2",
          status: "succeeded",
          finishedAt: "2026-04-14T11:56:00.000Z",
        };
      },
      async terminate() {
        return null;
      },
    };

    mkdirSync(path.join(root, ".aegis"), { recursive: true });
    writeFileSync(
      path.join(root, ".aegis", "dispatch-state.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        records: {
          "ISSUE-2": {
            issueId: "ISSUE-2",
            stage: "implemented",
            runningAgent: {
              caste: "titan",
              sessionId: "session-2",
              startedAt: "2026-04-14T11:55:00.000Z",
            },
            oracleAssessmentRef: ".aegis/oracle/ISSUE-2.json",
            titanHandoffRef: ".aegis/titan/ISSUE-2.json",
            titanClarificationRef: null,
            sentinelVerdictRef: null,
            janusArtifactRef: null,
            failureTranscriptRef: null,
            fileScope: null,
            failureCount: 0,
            consecutiveFailures: 0,
            failureWindowStartMs: null,
            cooldownUntil: null,
            sessionProvenanceId: "daemon-1",
            updatedAt: "2026-04-14T11:56:00.000Z",
          },
        },
      }, null, 2)}\n`,
      "utf8",
    );

    const result = await reapFinishedWork({
      dispatchState: createTitanRunningState(),
      runtime,
      issueIds: ["ISSUE-2"],
      root,
      now: "2026-04-14T12:00:00.000Z",
    });

    expect(result.completed).toEqual(["ISSUE-2"]);
    expect(result.failed).toEqual([]);
    expect(result.state.records["ISSUE-2"]).toMatchObject({
      issueId: "ISSUE-2",
      stage: "implemented",
      runningAgent: null,
      oracleAssessmentRef: ".aegis/oracle/ISSUE-2.json",
    });
  });

  it("fails closed when a succeeded titan session lacks required artifact refs", async () => {
    const root = createTempRoot();
    const runtime: AgentRuntime = {
      async launch() {
        throw new Error("unused");
      },
      async readSession() {
        return {
          sessionId: "session-2",
          status: "succeeded",
          finishedAt: "2026-04-14T11:56:00.000Z",
        };
      },
      async terminate() {
        return null;
      },
    };

    mkdirSync(path.join(root, ".aegis"), { recursive: true });
    writeFileSync(
      path.join(root, ".aegis", "dispatch-state.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        records: {
          "ISSUE-2": {
            issueId: "ISSUE-2",
            stage: "implemented",
            runningAgent: {
              caste: "titan",
              sessionId: "session-2",
              startedAt: "2026-04-14T11:55:00.000Z",
            },
            oracleAssessmentRef: null,
            titanHandoffRef: ".aegis/titan/ISSUE-2.json",
            titanClarificationRef: null,
            sentinelVerdictRef: null,
            janusArtifactRef: null,
            failureTranscriptRef: null,
            fileScope: null,
            failureCount: 0,
            consecutiveFailures: 0,
            failureWindowStartMs: null,
            cooldownUntil: null,
            sessionProvenanceId: "daemon-1",
            updatedAt: "2026-04-14T11:56:00.000Z",
          },
        },
      }, null, 2)}\n`,
      "utf8",
    );

    const result = await reapFinishedWork({
      dispatchState: createTitanRunningState(),
      runtime,
      issueIds: ["ISSUE-2"],
      root,
      now: "2026-04-14T12:00:00.000Z",
    });

    expect(result.completed).toEqual([]);
    expect(result.failed).toEqual(["ISSUE-2"]);
    expect(result.state.records["ISSUE-2"]).toMatchObject({
      issueId: "ISSUE-2",
      stage: "failed_operational",
      runningAgent: null,
      titanHandoffRef: ".aegis/titan/ISSUE-2.json",
      oracleAssessmentRef: null,
    });
  });

  it("preserves the latest persisted artifact refs written by async caste runs", async () => {
    const root = createTempRoot();
    const runtime: AgentRuntime = {
      async launch() {
        throw new Error("unused");
      },
      async readSession() {
        return {
          sessionId: "session-2",
          status: "succeeded",
          finishedAt: "2026-04-14T11:56:00.000Z",
        };
      },
      async terminate() {
        return null;
      },
    };

    mkdirSync(path.join(root, ".aegis"), { recursive: true });
    writeFileSync(
      path.join(root, ".aegis", "dispatch-state.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        records: {
          "ISSUE-2": {
            issueId: "ISSUE-2",
            stage: "implemented",
            runningAgent: {
              caste: "titan",
              sessionId: "session-2",
              startedAt: "2026-04-14T11:55:00.000Z",
            },
            oracleAssessmentRef: ".aegis/oracle/ISSUE-2.json",
            titanHandoffRef: ".aegis/titan/ISSUE-2.json",
            titanClarificationRef: null,
            sentinelVerdictRef: null,
            janusArtifactRef: null,
            failureTranscriptRef: null,
            fileScope: null,
            failureCount: 0,
            consecutiveFailures: 0,
            failureWindowStartMs: null,
            cooldownUntil: null,
            sessionProvenanceId: "daemon-1",
            updatedAt: "2026-04-14T11:56:00.000Z",
          },
        },
      }, null, 2)}\n`,
      "utf8",
    );

    const result = await reapFinishedWork({
      dispatchState: createTitanRunningState(),
      runtime,
      issueIds: ["ISSUE-2"],
      root,
      now: "2026-04-14T12:00:00.000Z",
    });

    expect(result.completed).toEqual(["ISSUE-2"]);
    expect(result.failed).toEqual([]);
    expect(result.state.records["ISSUE-2"]).toMatchObject({
      issueId: "ISSUE-2",
      stage: "implemented",
      runningAgent: null,
      titanHandoffRef: ".aegis/titan/ISSUE-2.json",
    });
  });

  it("does not clobber unrelated latest persisted records while reaping another issue", async () => {
    const root = createTempRoot();
    const runtime: AgentRuntime = {
      async launch() {
        throw new Error("unused");
      },
      async readSession(_root: string, sessionId: string) {
        if (sessionId === "session-3") {
          return {
            sessionId,
            status: "succeeded",
            finishedAt: "2026-04-14T11:56:30.000Z",
          };
        }

        return {
          sessionId,
          status: "running",
        };
      },
      async terminate() {
        return null;
      },
    };

    mkdirSync(path.join(root, ".aegis"), { recursive: true });
    writeFileSync(
      path.join(root, ".aegis", "dispatch-state.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        records: {
          "ISSUE-2": {
            issueId: "ISSUE-2",
            stage: "implemented",
            runningAgent: {
              caste: "titan",
              sessionId: "session-2",
              startedAt: "2026-04-14T11:55:00.000Z",
            },
            oracleAssessmentRef: ".aegis/oracle/ISSUE-2.json",
            titanHandoffRef: ".aegis/titan/ISSUE-2.json",
            titanClarificationRef: null,
            sentinelVerdictRef: null,
            janusArtifactRef: null,
            failureTranscriptRef: null,
            fileScope: null,
            failureCount: 0,
            consecutiveFailures: 0,
            failureWindowStartMs: null,
            cooldownUntil: null,
            sessionProvenanceId: "daemon-1",
            updatedAt: "2026-04-14T11:56:00.000Z",
          },
          "ISSUE-3": {
            issueId: "ISSUE-3",
            stage: "implemented",
            runningAgent: {
              caste: "titan",
              sessionId: "session-3",
              startedAt: "2026-04-14T11:55:30.000Z",
            },
            oracleAssessmentRef: ".aegis/oracle/ISSUE-3.json",
            titanHandoffRef: ".aegis/titan/ISSUE-3.json",
            titanClarificationRef: null,
            sentinelVerdictRef: null,
            janusArtifactRef: null,
            failureTranscriptRef: null,
            fileScope: null,
            failureCount: 0,
            consecutiveFailures: 0,
            failureWindowStartMs: null,
            cooldownUntil: null,
            sessionProvenanceId: "daemon-1",
            updatedAt: "2026-04-14T11:55:30.000Z",
          },
        },
      }, null, 2)}\n`,
      "utf8",
    );

    const result = await reapFinishedWork({
      dispatchState: createParallelTitanRunningState(),
      runtime,
      issueIds: ["ISSUE-3"],
      root,
      now: "2026-04-14T12:00:00.000Z",
    });

    expect(result.completed).toEqual(["ISSUE-3"]);
    expect(result.failed).toEqual([]);
    expect(result.state.records["ISSUE-2"]).toMatchObject({
      issueId: "ISSUE-2",
      stage: "implemented",
      titanHandoffRef: ".aegis/titan/ISSUE-2.json",
    });
  });

  it("writes a reap phase log even when nothing is ready to reap", async () => {
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

    const result = await reapFinishedWork({
      dispatchState: {
        schemaVersion: 1,
        records: {},
      },
      runtime,
      issueIds: [],
      root,
      now: "2026-04-14T12:00:00.000Z",
    });

    expect(result).toEqual({
      state: {
        schemaVersion: 1,
        records: {},
      },
      completed: [],
      failed: [],
    });

    const logPath = path.join(
      root,
      ".aegis",
      "logs",
      "phases",
      "2026-04-14T12-00-00.000Z-reap-_all.json",
    );
    expect(existsSync(logPath)).toBe(true);
    expect(JSON.parse(readFileSync(logPath, "utf8"))).toMatchObject({
      phase: "reap",
      issueId: "_all",
    });
  });
});
