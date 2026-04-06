/**
 * S9.4 — Dispatcher unit tests.
 *
 * Validates dispatch decision flow:
 *   a) All dispatchable ScoutedIssues are dispatched successfully
 *   b) State is updated with new records for dispatched issues
 *   c) Spawn failures are collected but do not abort remaining dispatches
 *   d) File scope is cleared on error
 *   e) Empty dispatchable list returns empty result
 *   f) No mutation of input state or ScoutedIssue arrays
 */

import { describe, it, expect, vi } from "vitest";

import { dispatchScoutedIssues, type TitanSpawner } from "../../../src/core/dispatcher.js";
import type { ScoutedIssue } from "../../../src/core/triage.js";
import type { DispatchState, DispatchRecord } from "../../../src/core/dispatch-state.js";
import { DispatchStage } from "../../../src/core/stage-transition.js";
import type { OracleAssessment } from "../../../src/castes/oracle/oracle-parser.js";
import type { SpawnResult } from "../../../src/core/spawner.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAssessment(files: string[]): OracleAssessment {
  return {
    files_affected: files,
    estimated_complexity: "moderate",
    decompose: false,
    ready: true,
  };
}

function makeRecord(issueId: string, stage: DispatchStage): DispatchRecord {
  return {
    issueId,
    stage,
    runningAgent: null,
    oracleAssessmentRef: `.aegis/oracle/${issueId}.json`,
    sentinelVerdictRef: null,
    fileScope: null,
    failureCount: 0,
    consecutiveFailures: 0,
    failureWindowStartMs: null,
    cooldownUntil: null,
    cumulativeSpendUsd: null,
    sessionProvenanceId: "test-session",
    updatedAt: new Date().toISOString(),
  };
}

function makeScoutedIssue(issueId: string, files: string[]): ScoutedIssue {
  return {
    issueId,
    assessment: makeAssessment(files),
    record: makeRecord(issueId, DispatchStage.Scouted),
  };
}

function makeDispatchState(records: DispatchRecord[]): DispatchState {
  const state: DispatchState = { schemaVersion: 1, records: {} };
  for (const r of records) {
    state.records[r.issueId] = r;
  }
  return state;
}

function makeSpawnResult(issueId: string): SpawnResult {
  const record = makeRecord(issueId, DispatchStage.Implementing);
  return {
    laborPath: `.aegis/labors/labor-${issueId}`,
    branchName: `aegis/${issueId}`,
    handle: {} as import("../../../src/runtime/agent-runtime.js").AgentHandle,
    updatedRecord: record,
  };
}

function mockSpawner(
  successIds: Set<string>,
): TitanSpawner {
  return {
    spawnForTitan: vi.fn().mockImplementation(async (issueId: string, _record: DispatchRecord) => {
      if (successIds.has(issueId)) {
        return makeSpawnResult(issueId);
      }
      throw new Error(`spawn failed for ${issueId}`);
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("S9.4 — dispatchScoutedIssues", () => {
  it("dispatches all scouted issues successfully", async () => {
    const state = makeDispatchState([
      makeRecord("issue-1", DispatchStage.Scouted),
      makeRecord("issue-2", DispatchStage.Scouted),
    ]);
    const dispatchable: ScoutedIssue[] = [
      makeScoutedIssue("issue-1", ["a.ts"]),
      makeScoutedIssue("issue-2", ["b.ts"]),
    ];

    const result = await dispatchScoutedIssues(
      dispatchable,
      state,
      mockSpawner(new Set(["issue-1", "issue-2"])),
    );

    expect(result.dispatched).toEqual(["issue-1", "issue-2"]);
    expect(result.errors).toEqual([]);
    expect(Object.keys(result.spawnResults)).toHaveLength(2);
  });

  it("collects errors but continues dispatching remaining issues", async () => {
    const state = makeDispatchState([
      makeRecord("issue-1", DispatchStage.Scouted),
      makeRecord("issue-2", DispatchStage.Scouted),
    ]);
    const dispatchable: ScoutedIssue[] = [
      makeScoutedIssue("issue-1", ["a.ts"]),
      makeScoutedIssue("issue-2", ["b.ts"]),
    ];

    const result = await dispatchScoutedIssues(
      dispatchable,
      state,
      mockSpawner(new Set(["issue-2"])),
    );

    expect(result.dispatched).toEqual(["issue-2"]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].issueId).toBe("issue-1");
    expect(result.errors[0].error).toContain("spawn failed");
  });

  it("clears file scope on dispatch failure", async () => {
    const state = makeDispatchState([
      makeRecord("issue-1", DispatchStage.Scouted),
    ]);
    const dispatchable: ScoutedIssue[] = [
      makeScoutedIssue("issue-1", ["shared.ts"]),
    ];

    const result = await dispatchScoutedIssues(
      dispatchable,
      state,
      mockSpawner(new Set()),
    );

    expect(result.errors).toHaveLength(1);
    const updatedRecord = result.updatedState.records["issue-1"];
    expect(updatedRecord.fileScope).toBeNull();
  });

  it("returns empty result for empty dispatchable list", async () => {
    const state = makeDispatchState([]);
    const result = await dispatchScoutedIssues(
      [],
      state,
      mockSpawner(new Set()),
    );

    expect(result.dispatched).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.spawnResults).toEqual({});
  });

  it("returns error when dispatch record is missing", async () => {
    const state = makeDispatchState([]);
    const dispatchable: ScoutedIssue[] = [
      makeScoutedIssue("issue-1", ["a.ts"]),
    ];

    const result = await dispatchScoutedIssues(
      dispatchable,
      state,
      mockSpawner(new Set(["issue-1"])),
    );

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].issueId).toBe("issue-1");
  });

  it("does not mutate input dispatch state", async () => {
    const state = makeDispatchState([
      makeRecord("issue-1", DispatchStage.Scouted),
    ]);
    const dispatchable: ScoutedIssue[] = [
      makeScoutedIssue("issue-1", ["a.ts"]),
    ];
    const stateBefore = JSON.parse(JSON.stringify(state));

    await dispatchScoutedIssues(
      dispatchable,
      state,
      mockSpawner(new Set(["issue-1"])),
    );

    expect(state).toEqual(stateBefore);
  });

  it("does not mutate input ScoutedIssue array or contents", async () => {
    const state = makeDispatchState([
      makeRecord("issue-1", DispatchStage.Scouted),
    ]);
    const dispatchable: ScoutedIssue[] = [
      makeScoutedIssue("issue-1", ["a.ts"]),
    ];
    const filesBefore = [...dispatchable[0].assessment.files_affected];

    await dispatchScoutedIssues(
      dispatchable,
      state,
      mockSpawner(new Set(["issue-1"])),
    );

    expect(dispatchable).toHaveLength(1);
    expect(dispatchable[0].assessment.files_affected).toEqual(filesBefore);
  });
});
