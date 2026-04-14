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

  it("skips running work and phase-e-only placeholder stages", () => {
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
          stage: "phase_d_complete",
          runningAgent: null,
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
      }),
      config: DEFAULT_AEGIS_CONFIG,
      now: "2026-04-14T12:01:00.000Z",
    });

    expect(result.dispatchable).toEqual([]);
    expect(result.skipped).toEqual([
      {
        issueId: "ISSUE-1",
        reason: "in_progress",
      },
      {
        issueId: "ISSUE-2",
        reason: "phase_e_required",
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
});
