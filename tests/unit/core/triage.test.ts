import { describe, expect, it } from "vitest";

import { emptyDispatchState, type DispatchState } from "../../../src/core/dispatch-state.js";
import { triageReadyWork } from "../../../src/core/triage.js";
import { DEFAULT_AEGIS_CONFIG } from "../../../src/config/defaults.js";

function createDispatchState(overrides: DispatchState["records"]): DispatchState {
  return {
    schemaVersion: 1,
    records: overrides,
  };
}

describe("triageReadyWork", () => {
  it("dispatches pending work to oracle in tracker order", () => {
    const result = triageReadyWork({
      readyIssues: [
        { id: "ISSUE-1", title: "First" },
        { id: "ISSUE-2", title: "Second" },
      ],
      dispatchState: emptyDispatchState(),
      config: DEFAULT_AEGIS_CONFIG,
      now: "2026-04-14T12:00:00.000Z",
    });

    expect(result.dispatchable.map((item) => item.issueId)).toEqual([
      "ISSUE-1",
    ]);
    expect(result.dispatchable[0]).toMatchObject({
      issueId: "ISSUE-1",
      caste: "oracle",
      stage: "scouting",
    });
    expect(result.skipped).toEqual([
      {
        issueId: "ISSUE-2",
        reason: "capacity",
      },
    ]);
  });

  it("skips running work and advances scouted issues to titan dispatch", () => {
    const result = triageReadyWork({
      readyIssues: [
        { id: "ISSUE-1", title: "Running" },
        { id: "ISSUE-2", title: "Later" },
      ],
      dispatchState: createDispatchState({
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
        "ISSUE-2": {
          issueId: "ISSUE-2",
          stage: "scouted",
          runningAgent: null,
          oracleAssessmentRef: ".aegis/oracle/ISSUE-2.json",
          sentinelVerdictRef: null,
          fileScope: null,
          failureCount: 0,
          consecutiveFailures: 0,
          failureWindowStartMs: null,
          cooldownUntil: null,
          sessionProvenanceId: "daemon-1",
          updatedAt: "2026-04-14T12:00:00.000Z",
        },
      }),
      config: DEFAULT_AEGIS_CONFIG,
      now: "2026-04-14T12:01:00.000Z",
    });

    expect(result.dispatchable).toEqual([
      {
        issueId: "ISSUE-2",
        title: "Later",
        caste: "titan",
        stage: "implementing",
      },
    ]);
    expect(result.skipped).toEqual([
      {
        issueId: "ISSUE-1",
        reason: "in_progress",
      },
    ]);
  });

  it("blocks Titan dispatch when Oracle marked the issue not ready", () => {
    const result = triageReadyWork({
      readyIssues: [{ id: "ISSUE-3", title: "Blocked" }],
      dispatchState: createDispatchState({
        "ISSUE-3": {
          issueId: "ISSUE-3",
          stage: "scouted",
          runningAgent: null,
          oracleAssessmentRef: ".aegis/oracle/ISSUE-3.json",
          sentinelVerdictRef: null,
          fileScope: null,
          failureCount: 0,
          consecutiveFailures: 0,
          failureWindowStartMs: null,
          cooldownUntil: null,
          sessionProvenanceId: "daemon-1",
          updatedAt: "2026-04-14T12:00:00.000Z",
          oracleReady: false,
          oracleDecompose: true,
          oracleBlockers: ["missing scope"],
        } as any,
      }),
      config: DEFAULT_AEGIS_CONFIG,
      now: "2026-04-14T12:01:00.000Z",
    });

    expect(result.dispatchable).toEqual([]);
    expect(result.skipped).toEqual([
      {
        issueId: "ISSUE-3",
        reason: "blocked",
      },
    ]);
  });

  it("respects cooldowns on failed issues", () => {
    const result = triageReadyWork({
      readyIssues: [{ id: "ISSUE-1", title: "Retry later" }],
      dispatchState: createDispatchState({
        "ISSUE-1": {
          issueId: "ISSUE-1",
          stage: "failed",
          runningAgent: null,
          oracleAssessmentRef: null,
          sentinelVerdictRef: null,
          fileScope: null,
          failureCount: 1,
          consecutiveFailures: 1,
          failureWindowStartMs: null,
          cooldownUntil: "2026-04-14T12:05:00.000Z",
          sessionProvenanceId: "daemon-1",
          updatedAt: "2026-04-14T12:00:00.000Z",
        },
      }),
      config: DEFAULT_AEGIS_CONFIG,
      now: "2026-04-14T12:01:00.000Z",
    });

    expect(result.dispatchable).toEqual([]);
    expect(result.skipped).toEqual([
      {
        issueId: "ISSUE-1",
        reason: "cooldown",
      },
    ]);
  });

  it("does not auto-retry failed Sentinel reviews", () => {
    const result = triageReadyWork({
      readyIssues: [
        { id: "ISSUE-1", title: "Originating issue" },
        { id: "ISSUE-2", title: "Sentinel follow-up" },
      ],
      dispatchState: createDispatchState({
        "ISSUE-1": {
          issueId: "ISSUE-1",
          stage: "failed",
          runningAgent: null,
          oracleAssessmentRef: ".aegis/oracle/ISSUE-1.json",
          titanHandoffRef: ".aegis/titan/ISSUE-1.json",
          titanClarificationRef: null,
          sentinelVerdictRef: ".aegis/sentinel/ISSUE-1.json",
          janusArtifactRef: null,
          failureTranscriptRef: null,
          fileScope: null,
          failureCount: 1,
          consecutiveFailures: 1,
          failureWindowStartMs: null,
          cooldownUntil: null,
          sessionProvenanceId: "daemon-1",
          updatedAt: "2026-04-14T12:00:00.000Z",
        },
      }),
      config: DEFAULT_AEGIS_CONFIG,
      now: "2026-04-14T12:01:00.000Z",
    });

    expect(result.dispatchable).toEqual([
      {
        issueId: "ISSUE-2",
        title: "Sentinel follow-up",
        caste: "oracle",
        stage: "scouting",
      },
    ]);
    expect(result.skipped).toEqual([
      {
        issueId: "ISSUE-1",
        reason: "already_progressed",
      },
    ]);
  });

  it("does not auto-retry failed Titan clarification issues", () => {
    const result = triageReadyWork({
      readyIssues: [{ id: "ISSUE-1", title: "Clarify first" }],
      dispatchState: createDispatchState({
        "ISSUE-1": {
          issueId: "ISSUE-1",
          stage: "failed",
          runningAgent: null,
          oracleAssessmentRef: ".aegis/oracle/ISSUE-1.json",
          titanHandoffRef: null,
          titanClarificationRef: ".aegis/titan/ISSUE-1.json",
          sentinelVerdictRef: null,
          janusArtifactRef: null,
          failureTranscriptRef: null,
          fileScope: null,
          failureCount: 1,
          consecutiveFailures: 1,
          failureWindowStartMs: null,
          cooldownUntil: null,
          sessionProvenanceId: "daemon-1",
          updatedAt: "2026-04-14T12:00:00.000Z",
        },
      }),
      config: DEFAULT_AEGIS_CONFIG,
      now: "2026-04-14T12:01:00.000Z",
    });

    expect(result.dispatchable).toEqual([]);
    expect(result.skipped).toEqual([
      {
        issueId: "ISSUE-1",
        reason: "blocked",
      },
    ]);
  });

  it("does not auto-retry failed Oracle not-ready assessments", () => {
    const result = triageReadyWork({
      readyIssues: [{ id: "ISSUE-1", title: "Need prerequisite work" }],
      dispatchState: createDispatchState({
        "ISSUE-1": {
          issueId: "ISSUE-1",
          stage: "failed",
          runningAgent: null,
          oracleAssessmentRef: ".aegis/oracle/ISSUE-1.json",
          titanHandoffRef: null,
          titanClarificationRef: null,
          sentinelVerdictRef: null,
          janusArtifactRef: null,
          failureTranscriptRef: null,
          fileScope: null,
          failureCount: 1,
          consecutiveFailures: 1,
          failureWindowStartMs: null,
          cooldownUntil: null,
          sessionProvenanceId: "daemon-1",
          updatedAt: "2026-04-14T12:00:00.000Z",
          oracleReady: false,
          oracleDecompose: false,
          oracleBlockers: ["missing prerequisite"],
        } as any,
      }),
      config: DEFAULT_AEGIS_CONFIG,
      now: "2026-04-14T12:01:00.000Z",
    });

    expect(result.dispatchable).toEqual([]);
    expect(result.skipped).toEqual([
      {
        issueId: "ISSUE-1",
        reason: "blocked",
      },
    ]);
  });
});
