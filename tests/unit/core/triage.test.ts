/**
 * S15A — Triage unit tests.
 *
 * Validates the scope-aware triage logic from SPECv2 §9.3:
 *   a) triageScouted correctly suppresses overlapping candidates
 *   b) triageScouted allows non-overlapping candidates
 *   c) triageScouted works with no active Titans
 *   d) checkDispatchConflict catches conflicts at dispatch time
 *   e) attachFileScope / clearFileScope manipulate records correctly
 *   f) activeTitanScopes extracts correct scopes from dispatch state
 */

import { describe, it, expect } from "vitest";

import { DispatchStage } from "../../../src/core/stage-transition.js";
import type { DispatchState, DispatchRecord } from "../../../src/core/dispatch-state.js";
import {
  triageScouted,
  checkDispatchConflict,
  attachFileScope,
  clearFileScope,
  type ScoutedIssue,
  type BatchTriageResult,
} from "../../../src/core/triage.js";
import type { OracleAssessment } from "../../../src/castes/oracle/oracle-parser.js";
import type { FileScope } from "../../../src/core/scope-allocator.js";

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

function makeRecord(issueId: string, stage: DispatchStage, fileScope: FileScope | null = null): DispatchRecord {
  return {
    issueId,
    stage,
    runningAgent: null,
    oracleAssessmentRef: `.aegis/oracle/${issueId}.json`,
    sentinelVerdictRef: null,
    fileScope,
    failureCount: 0,
    consecutiveFailures: 0,
    failureWindowStartMs: null,
    cooldownUntil: null,
    cumulativeSpendUsd: null,
    sessionProvenanceId: "test-session",
    updatedAt: new Date().toISOString(),
  };
}

function makeScouted(issueId: string, files: string[]): ScoutedIssue {
  return {
    issueId,
    assessment: makeAssessment(files),
    record: makeRecord(issueId, DispatchStage.Scouted),
  };
}

function makeDispatchState(records: DispatchRecord[]): DispatchState {
  const state: DispatchState = { schemaVersion: 1, records: {} };
  for (const record of records) {
    state.records[record.issueId] = record;
  }
  return state;
}

// ---------------------------------------------------------------------------
// 1. triageScouted — overlap with active Titans
// ---------------------------------------------------------------------------

describe("triageScouted — overlap with active Titans", () => {
  it("suppresses a candidate that overlaps with an active Titan", () => {
    const state = makeDispatchState([
      makeRecord("titan-1", DispatchStage.Implementing, {
        issueId: "titan-1",
        files: ["src/core/dispatch-state.ts", "src/core/stage-transition.ts"],
      }),
    ]);

    const scouted = [makeScouted("candidate-1", ["src/core/dispatch-state.ts"])];

    const result = triageScouted(scouted, state);

    expect(result.dispatchable).toEqual([]);
    expect(result.suppressed).toHaveLength(1);
    expect(result.suppressed[0].issueId).toBe("candidate-1");
    expect(result.suppressed[0].canDispatch).toBe(false);
    expect(result.suppressed[0].suppressionReason).toBeDefined();
  });

  it("allows a candidate with no overlap", () => {
    const state = makeDispatchState([
      makeRecord("titan-1", DispatchStage.Implementing, {
        issueId: "titan-1",
        files: ["src/core/dispatch-state.ts"],
      }),
    ]);

    const scouted = [makeScouted("candidate-1", ["src/cli/status.ts"])];

    const result = triageScouted(scouted, state);

    expect(result.dispatchable).toHaveLength(1);
    expect(result.dispatchable[0].issueId).toBe("candidate-1");
    expect(result.suppressed).toEqual([]);
  });

  it("handles multiple active Titans with mixed overlap", () => {
    const state = makeDispatchState([
      makeRecord("titan-1", DispatchStage.Implementing, {
        issueId: "titan-1",
        files: ["src/core/a.ts"],
      }),
      makeRecord("titan-2", DispatchStage.Implementing, {
        issueId: "titan-2",
        files: ["src/core/b.ts"],
      }),
    ]);

    const scouted = [
      makeScouted("cand-1", ["src/core/a.ts"]),   // blocked by titan-1
      makeScouted("cand-2", ["src/core/c.ts"]),    // safe
      makeScouted("cand-3", ["src/core/b.ts"]),    // blocked by titan-2
    ];

    const result = triageScouted(scouted, state);

    expect(result.dispatchable).toHaveLength(1);
    expect(result.dispatchable[0].issueId).toBe("cand-2");
    expect(result.suppressed).toHaveLength(2);
    expect(result.suppressed.map((s) => s.issueId)).toContain("cand-1");
    expect(result.suppressed.map((s) => s.issueId)).toContain("cand-3");
  });
});

// ---------------------------------------------------------------------------
// 2. triageScouted — no active Titans
// ---------------------------------------------------------------------------

describe("triageScouted — no active Titans", () => {
  it("dispatches all candidates when dispatch state has no active Titans", () => {
    const state = makeDispatchState([
      makeRecord("completed-1", DispatchStage.Complete),
      makeRecord("scouted-1", DispatchStage.Scouted),
    ]);

    const scouted = [
      makeScouted("new-1", ["src/core/x.ts"]),
      makeScouted("new-2", ["src/core/y.ts"]),
    ];

    const result = triageScouted(scouted, state);

    expect(result.dispatchable).toHaveLength(2);
    expect(result.suppressed).toEqual([]);
  });

  it("still respects pairwise candidate overlap", () => {
    const state = makeDispatchState([]);

    const scouted = [
      makeScouted("first", ["shared.ts", "a.ts"]),
      makeScouted("second", ["shared.ts", "b.ts"]),
    ];

    const result = triageScouted(scouted, state);

    expect(result.dispatchable).toHaveLength(1);
    expect(result.dispatchable[0].issueId).toBe("first");
    expect(result.suppressed).toHaveLength(1);
    expect(result.suppressed[0].issueId).toBe("second");
  });
});

// ---------------------------------------------------------------------------
// 3. triageScouted — threshold behavior
// ---------------------------------------------------------------------------

describe("triageScouted — threshold parameter", () => {
  it("allows overlap when threshold is above the overlap count", () => {
    const state = makeDispatchState([
      makeRecord("titan-1", DispatchStage.Implementing, {
        issueId: "titan-1",
        files: ["a.ts", "b.ts"],
      }),
    ]);

    const scouted = [makeScouted("cand", ["a.ts", "c.ts"])];
    // 1 overlapping file, threshold=1 -> allowed

    const result = triageScouted(scouted, state, 1);

    expect(result.dispatchable).toHaveLength(1);
    expect(result.suppressed).toEqual([]);
  });

  it("blocks overlap when threshold is exceeded", () => {
    const state = makeDispatchState([
      makeRecord("titan-1", DispatchStage.Implementing, {
        issueId: "titan-1",
        files: ["a.ts", "b.ts"],
      }),
    ]);

    const scouted = [makeScouted("cand", ["a.ts", "b.ts", "c.ts"])];
    // 2 overlapping files, threshold=1 -> blocked

    const result = triageScouted(scouted, state, 1);

    expect(result.dispatchable).toEqual([]);
    expect(result.suppressed).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 4. checkDispatchConflict — dispatch-time guard
// ---------------------------------------------------------------------------

describe("checkDispatchConflict", () => {
  it("returns no conflict when scope is clear", () => {
    const state = makeDispatchState([
      makeRecord("titan-1", DispatchStage.Implementing, {
        issueId: "titan-1",
        files: ["a.ts"],
      }),
    ]);

    const fileScope: FileScope = { issueId: "cand", files: ["b.ts"] };
    const result = checkDispatchConflict(fileScope, state);

    expect(result.hasConflict).toBe(false);
    expect(result.conflictsWith).toEqual([]);
    expect(result.overlappingFiles).toEqual([]);
  });

  it("detects conflict with an active Titan", () => {
    const state = makeDispatchState([
      makeRecord("titan-1", DispatchStage.Implementing, {
        issueId: "titan-1",
        files: ["shared.ts", "other.ts"],
      }),
    ]);

    const fileScope: FileScope = { issueId: "cand", files: ["shared.ts", "unique.ts"] };
    const result = checkDispatchConflict(fileScope, state);

    expect(result.hasConflict).toBe(true);
    expect(result.conflictsWith).toEqual(["titan-1"]);
    expect(result.overlappingFiles).toContain("shared.ts");
  });

  it("ignores non-implementing records", () => {
    const state = makeDispatchState([
      makeRecord("scouted-1", DispatchStage.Scouted, {
        issueId: "scouted-1",
        files: ["shared.ts"],
      }),
    ]);

    const fileScope: FileScope = { issueId: "cand", files: ["shared.ts"] };
    const result = checkDispatchConflict(fileScope, state);

    expect(result.hasConflict).toBe(false);
  });

  it("respects threshold parameter", () => {
    const state = makeDispatchState([
      makeRecord("titan-1", DispatchStage.Implementing, {
        issueId: "titan-1",
        files: ["a.ts", "b.ts"],
      }),
    ]);

    const fileScope: FileScope = { issueId: "cand", files: ["a.ts", "c.ts"] };

    // 1 overlap, threshold=1 -> no conflict
    expect(checkDispatchConflict(fileScope, state, 1).hasConflict).toBe(false);
    // 1 overlap, threshold=0 -> conflict
    expect(checkDispatchConflict(fileScope, state, 0).hasConflict).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. attachFileScope / clearFileScope
// ---------------------------------------------------------------------------

describe("attachFileScope", () => {
  it("attaches fileScope to a record", () => {
    const record = makeRecord("issue-1", DispatchStage.Implementing);
    const fileScope: FileScope = { issueId: "issue-1", files: ["a.ts", "b.ts"] };

    const updated = attachFileScope(record, fileScope);

    expect(updated.fileScope).toEqual(fileScope);
    // Original is not mutated
    expect(record.fileScope).toBeNull();
  });

  it("returns a new record (no shared reference to files array)", () => {
    const record = makeRecord("issue-1", DispatchStage.Implementing);
    const fileScope: FileScope = { issueId: "issue-1", files: ["a.ts"] };

    const updated = attachFileScope(record, fileScope);
    updated.fileScope!.files.push("mutated.ts");

    expect(fileScope.files).toEqual(["a.ts"]);
  });
});

describe("clearFileScope", () => {
  it("sets fileScope to null", () => {
    const record = makeRecord("issue-1", DispatchStage.Implementing, {
      issueId: "issue-1",
      files: ["a.ts"],
    });

    const updated = clearFileScope(record);

    expect(updated.fileScope).toBeNull();
    // Original is not mutated
    expect(record.fileScope).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6. activeTitanScopes — extraction from dispatch state
// ---------------------------------------------------------------------------

describe("activeTitanScopes (via triage)", () => {
  it("extracts scopes only from implementing-stage records with fileScope", () => {
    const state = makeDispatchState([
      makeRecord("titan-1", DispatchStage.Implementing, {
        issueId: "titan-1",
        files: ["a.ts"],
      }),
      makeRecord("scouted-1", DispatchStage.Scouted, {
        issueId: "scouted-1",
        files: ["b.ts"],
      }),
      makeRecord("completed-1", DispatchStage.Complete, {
        issueId: "completed-1",
        files: ["c.ts"],
      }),
      makeRecord("titan-2", DispatchStage.Implementing, {
        issueId: "titan-2",
        files: ["d.ts"],
      }),
      // Record in implementing stage but no fileScope — should be excluded
      makeRecord("titan-3", DispatchStage.Implementing, null),
    ]);

    // Use triage to indirectly verify activeTitanScopes
    const scouted = [makeScouted("cand", ["a.ts"])]; // overlaps with titan-1
    const result = triageScouted(scouted, state);

    expect(result.suppressed).toHaveLength(1);
    expect(result.suppressed[0].suppressionReason).toContain("titan-1");
    // titan-2's scope should NOT affect this candidate (d.ts != a.ts)
  });
});

// ---------------------------------------------------------------------------
// 7. End-to-end purity
// ---------------------------------------------------------------------------

describe("triageScouted — end-to-end purity", () => {
  it("full pipeline produces consistent, serializable output", () => {
    const state = makeDispatchState([
      makeRecord("t1", DispatchStage.Implementing, {
        issueId: "t1",
        files: ["core.ts"],
      }),
    ]);

    const scouted = [
      makeScouted("c1", ["core.ts", "extra.ts"]),
      makeScouted("c2", ["unrelated.ts"]),
    ];

    const result: BatchTriageResult = triageScouted(scouted, state);

    // All output should be JSON-serializable
    const json = JSON.stringify(result);
    const parsed = JSON.parse(json);

    expect(parsed.dispatchable).toHaveLength(1);
    expect(parsed.dispatchable[0].issueId).toBe("c2");
    expect(parsed.suppressed).toHaveLength(1);
    expect(parsed.suppressed[0].issueId).toBe("c1");
  });

  it("does not mutate input scouted issues or dispatch state", () => {
    const state = makeDispatchState([
      makeRecord("t1", DispatchStage.Implementing, {
        issueId: "t1",
        files: ["a.ts"],
      }),
    ]);

    const scouted = [makeScouted("c1", ["b.ts"])];
    const filesBefore = [...scouted[0].assessment.files_affected];
    const stateRecordsBefore = JSON.parse(JSON.stringify(state.records));

    triageScouted(scouted, state);

    expect(scouted[0].assessment.files_affected).toEqual(filesBefore);
    expect(state.records).toEqual(stateRecordsBefore);
  });

  it("forceDispatch parameter overrides overlap suppression", () => {
    const state = makeDispatchState([
      makeRecord("t1", DispatchStage.Implementing, {
        issueId: "t1",
        files: ["shared.ts"],
      }),
    ]);

    const scouted = [makeScouted("overlap", ["shared.ts"])];

    // Without force: suppressed
    const normal = triageScouted(scouted, state);
    expect(normal.dispatchable).toEqual([]);
    expect(normal.suppressed).toHaveLength(1);

    // With force: dispatched
    const forced = triageScouted(scouted, state, 0, new Set(["overlap"]));
    expect(forced.dispatchable).toHaveLength(1);
    expect(forced.dispatchable[0].issueId).toBe("overlap");
    expect(forced.suppressed).toEqual([]);
  });
});
