/**
 * S9.2 — Poller unit tests.
 *
 * Validates the pollForWork function from SPECv2 §9.2:
 *   a) Issues with no dispatch record → needsOracle
 *   b) Issues with pending stage → needsOracle
 *   c) Issues in active/in-progress stages → inProgress
 *   d) Issues in queued_for_merge / implemented / merged → inProgress
 *   e) Issues in scouted stage with assessment → triage runs
 *   f) Issues in scouted stage without assessment → needsOracle
 *   g) Triage integration: dispatchable vs suppressed
 *   h) Empty ready queue returns empty PollResult
 *   i) Immutability: inputs are never mutated
 *   j) Threshold parameter is passed through to triage
 *   k) Completed/failed issues are skipped
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import { DispatchStage } from "../../../src/core/stage-transition.js";
import type { DispatchState, DispatchRecord } from "../../../src/core/dispatch-state.js";
import type { BeadsClient } from "../../../src/tracker/beads-client.js";
import type { ReadyIssue } from "../../../src/tracker/issue-model.js";
import { pollForWork, type PollResult } from "../../../src/core/poller.js";
import type { OracleAssessment } from "../../../src/castes/oracle/oracle-parser.js";
import type { FileScope } from "../../../src/core/scope-allocator.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReadyIssue(id: string): ReadyIssue {
  return { id, title: `Issue ${id}`, issueClass: "primary", priority: 3 };
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

function makeDispatchState(records: DispatchRecord[]): DispatchState {
  const state: DispatchState = { schemaVersion: 1, records: {} };
  for (const record of records) {
    state.records[record.issueId] = { ...record };
  }
  return state;
}

function makeAssessment(files: string[]): OracleAssessment {
  return {
    files_affected: files,
    estimated_complexity: "moderate",
    decompose: false,
    ready: true,
  };
}

function makeMockClient(readyQueue: ReadyIssue[]): BeadsClient {
  return {
    getReadyQueue: vi.fn().mockResolvedValue(readyQueue),
    getIssue: vi.fn(),
    createIssue: vi.fn(),
    updateIssue: vi.fn(),
    closeIssue: vi.fn(),
    linkIssue: vi.fn(),
    unlinkIssue: vi.fn(),
    addBlocker: vi.fn(),
    removeBlocker: vi.fn(),
  } as unknown as BeadsClient;
}

// ---------------------------------------------------------------------------
// 1. No dispatch record → needsOracle
// ---------------------------------------------------------------------------

describe("pollForWork — no dispatch record", () => {
  it("classifies issue with no record as needsOracle", async () => {
    const readyQueue = [makeReadyIssue("new-1")];
    const client = makeMockClient(readyQueue);
    const state: DispatchState = { schemaVersion: 1, records: {} };

    const result = await pollForWork(client, state);

    expect(result.needsOracle).toContain("new-1");
    expect(result.dispatchable).toEqual([]);
    expect(result.suppressed).toEqual([]);
    expect(result.inProgress).toEqual([]);
  });

  it("handles multiple issues with no records", async () => {
    const readyQueue = [makeReadyIssue("new-1"), makeReadyIssue("new-2")];
    const client = makeMockClient(readyQueue);
    const state: DispatchState = { schemaVersion: 1, records: {} };

    const result = await pollForWork(client, state);

    expect(result.needsOracle).toEqual(["new-1", "new-2"]);
  });
});

// ---------------------------------------------------------------------------
// 2. Pending stage → needsOracle
// ---------------------------------------------------------------------------

describe("pollForWork — pending stage", () => {
  it("classifies pending issue as needsOracle", async () => {
    const readyQueue = [makeReadyIssue("pending-1")];
    const client = makeMockClient(readyQueue);
    const state = makeDispatchState([
      makeRecord("pending-1", DispatchStage.Pending),
    ]);

    const result = await pollForWork(client, state);

    expect(result.needsOracle).toContain("pending-1");
    expect(result.dispatchable).toEqual([]);
    expect(result.inProgress).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. Active stages → inProgress
// ---------------------------------------------------------------------------

describe("pollForWork — active stages", () => {
  it.each([
    [DispatchStage.Scouting],
    [DispatchStage.Implementing],
    [DispatchStage.Merging],
    [DispatchStage.Reviewing],
    [DispatchStage.ResolvingIntegration],
  ])("classifies %s as inProgress", async (stage) => {
    const readyQueue = [makeReadyIssue("active-1")];
    const client = makeMockClient(readyQueue);
    const state = makeDispatchState([
      makeRecord("active-1", stage),
    ]);

    const result = await pollForWork(client, state);

    expect(result.inProgress).toContain("active-1");
    expect(result.needsOracle).toEqual([]);
    expect(result.dispatchable).toEqual([]);
  });

  it("handles multiple active issues across different stages", async () => {
    const readyQueue = [makeReadyIssue("a-1"), makeReadyIssue("a-2")];
    const client = makeMockClient(readyQueue);
    const state = makeDispatchState([
      makeRecord("a-1", DispatchStage.Implementing),
      makeRecord("a-2", DispatchStage.Scouting),
    ]);

    const result = await pollForWork(client, state);

    expect(result.inProgress).toEqual(["a-1", "a-2"]);
  });
});

// ---------------------------------------------------------------------------
// 4. Waiting stages (queued_for_merge, implemented, merged) → inProgress
// ---------------------------------------------------------------------------

describe("pollForWork — waiting stages", () => {
  it.each([
    [DispatchStage.QueuedForMerge],
    [DispatchStage.Implemented],
    [DispatchStage.Merged],
  ])("classifies %s as inProgress", async (stage) => {
    const readyQueue = [makeReadyIssue("waiting-1")];
    const client = makeMockClient(readyQueue);
    const state = makeDispatchState([
      makeRecord("waiting-1", stage),
    ]);

    const result = await pollForWork(client, state);

    expect(result.inProgress).toContain("waiting-1");
    expect(result.needsOracle).toEqual([]);
    expect(result.dispatchable).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 5. Scouted stage with assessment → triage runs
// ---------------------------------------------------------------------------

describe("pollForWork — scouted with assessment", () => {
  it("runs triage and classifies as dispatchable when no overlap", async () => {
    const readyQueue = [makeReadyIssue("scouted-1")];
    const client = makeMockClient(readyQueue);
    const state = makeDispatchState([
      makeRecord("scouted-1", DispatchStage.Scouted),
    ]);
    const assessments = new Map([
      ["scouted-1", makeAssessment(["src/new.ts"])],
    ]);

    const result = await pollForWork(client, state, assessments);

    expect(result.dispatchable).toHaveLength(1);
    expect(result.dispatchable[0].issueId).toBe("scouted-1");
    expect(result.suppressed).toEqual([]);
    expect(result.needsOracle).toEqual([]);
  });

  it("runs triage and classifies as suppressed when overlap exists", async () => {
    const readyQueue = [makeReadyIssue("scouted-1")];
    const client = makeMockClient(readyQueue);
    const state = makeDispatchState([
      makeRecord("titan-1", DispatchStage.Implementing, {
        issueId: "titan-1",
        files: ["src/shared.ts"],
      }),
      makeRecord("scouted-1", DispatchStage.Scouted),
    ]);
    const assessments = new Map([
      ["scouted-1", makeAssessment(["src/shared.ts"])],
    ]);

    const result = await pollForWork(client, state, assessments);

    expect(result.suppressed).toContain("scouted-1");
    expect(result.dispatchable).toEqual([]);
    expect(result.needsOracle).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 6. Scouted stage without assessment → needsOracle
// ---------------------------------------------------------------------------

describe("pollForWork — scouted without assessment", () => {
  it("classifies as needsOracle when assessment not in map", async () => {
    const readyQueue = [makeReadyIssue("scouted-1")];
    const client = makeMockClient(readyQueue);
    const state = makeDispatchState([
      makeRecord("scouted-1", DispatchStage.Scouted),
    ]);

    const result = await pollForWork(client, state, new Map());

    expect(result.needsOracle).toContain("scouted-1");
    expect(result.dispatchable).toEqual([]);
    expect(result.suppressed).toEqual([]);
  });

  it("classifies as needsOracle when assessments map is empty", async () => {
    const readyQueue = [makeReadyIssue("scouted-1"), makeReadyIssue("scouted-2")];
    const client = makeMockClient(readyQueue);
    const state = makeDispatchState([
      makeRecord("scouted-1", DispatchStage.Scouted),
      makeRecord("scouted-2", DispatchStage.Scouted),
    ]);

    const result = await pollForWork(client, state);

    expect(result.needsOracle).toEqual(["scouted-1", "scouted-2"]);
  });
});

// ---------------------------------------------------------------------------
// 7. Terminal stages (complete, failed) → skipped
// ---------------------------------------------------------------------------

describe("pollForWork — terminal stages", () => {
  it.each([
    [DispatchStage.Complete],
    [DispatchStage.Failed],
  ])("skips issue in %s stage", async (stage) => {
    const readyQueue = [makeReadyIssue("terminal-1")];
    const client = makeMockClient(readyQueue);
    const state = makeDispatchState([
      makeRecord("terminal-1", stage),
    ]);

    const result = await pollForWork(client, state);

    expect(result.needsOracle).toEqual([]);
    expect(result.inProgress).toEqual([]);
    expect(result.dispatchable).toEqual([]);
    expect(result.suppressed).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 8. Empty ready queue
// ---------------------------------------------------------------------------

describe("pollForWork — empty queue", () => {
  it("returns empty PollResult when ready queue is empty", async () => {
    const client = makeMockClient([]);
    const state: DispatchState = { schemaVersion: 1, records: {} };

    const result = await pollForWork(client, state);

    expect(result).toEqual({
      dispatchable: [],
      suppressed: [],
      needsOracle: [],
      inProgress: [],
    });
  });
});

// ---------------------------------------------------------------------------
// 9. Immutability — inputs are never mutated
// ---------------------------------------------------------------------------

describe("pollForWork — immutability", () => {
  it("does not mutate dispatchState", async () => {
    const readyQueue = [makeReadyIssue("issue-1")];
    const client = makeMockClient(readyQueue);
    const state = makeDispatchState([
      makeRecord("issue-1", DispatchStage.Pending),
    ]);
    const stateBefore = JSON.parse(JSON.stringify(state));

    await pollForWork(client, state);

    expect(state).toEqual(stateBefore);
  });

  it("does not mutate dispatchState for scouted issues", async () => {
    const readyQueue = [makeReadyIssue("scouted-1")];
    const client = makeMockClient(readyQueue);
    const state = makeDispatchState([
      makeRecord("scouted-1", DispatchStage.Scouted),
    ]);
    const assessments = new Map([
      ["scouted-1", makeAssessment(["src/a.ts"])],
    ]);
    const stateBefore = JSON.parse(JSON.stringify(state));

    await pollForWork(client, state, assessments);

    expect(state).toEqual(stateBefore);
  });

  it("does not mutate the assessments map", async () => {
    const readyQueue = [makeReadyIssue("scouted-1")];
    const client = makeMockClient(readyQueue);
    const state = makeDispatchState([
      makeRecord("scouted-1", DispatchStage.Scouted),
    ]);
    const assessment = makeAssessment(["src/a.ts"]);
    const assessments = new Map([["scouted-1", assessment]]);
    const assessmentFilesBefore = [...assessment.files_affected];

    await pollForWork(client, state, assessments);

    expect(assessments.get("scouted-1")!.files_affected).toEqual(assessmentFilesBefore);
    expect(assessments.size).toBe(1);
  });

  it("triage result dispatchable array is independent of poller internals", async () => {
    const readyQueue = [makeReadyIssue("scouted-1")];
    const client = makeMockClient(readyQueue);
    const state = makeDispatchState([
      makeRecord("scouted-1", DispatchStage.Scouted),
    ]);
    const assessments = new Map([
      ["scouted-1", makeAssessment(["src/new.ts"])],
    ]);

    const result = await pollForWork(client, state, assessments);

    // Mutating result should not affect anything else
    result.dispatchable.push({} as import("../../../src/core/triage.js").ScoutedIssue);
    expect(result.dispatchable).toHaveLength(2);
    // A second poll should still return the original single item
    const result2 = await pollForWork(client, state, assessments);
    expect(result2.dispatchable).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 10. Threshold parameter passed through to triage
// ---------------------------------------------------------------------------

describe("pollForWork — threshold", () => {
  it("allows overlap when threshold is above overlap count", async () => {
    const readyQueue = [makeReadyIssue("scouted-1")];
    const client = makeMockClient(readyQueue);
    const state = makeDispatchState([
      makeRecord("titan-1", DispatchStage.Implementing, {
        issueId: "titan-1",
        files: ["a.ts", "b.ts"],
      }),
      makeRecord("scouted-1", DispatchStage.Scouted),
    ]);
    const assessments = new Map([
      ["scouted-1", makeAssessment(["a.ts", "c.ts"])],
    ]);

    // 1 overlapping file, threshold=1 → allowed
    const result = await pollForWork(client, state, assessments, 1);

    expect(result.dispatchable).toHaveLength(1);
    expect(result.suppressed).toEqual([]);
  });

  it("blocks overlap when threshold is exceeded", async () => {
    const readyQueue = [makeReadyIssue("scouted-1")];
    const client = makeMockClient(readyQueue);
    const state = makeDispatchState([
      makeRecord("titan-1", DispatchStage.Implementing, {
        issueId: "titan-1",
        files: ["a.ts", "b.ts"],
      }),
      makeRecord("scouted-1", DispatchStage.Scouted),
    ]);
    const assessments = new Map([
      ["scouted-1", makeAssessment(["a.ts", "b.ts", "c.ts"])],
    ]);

    // 2 overlapping files, threshold=1 → blocked
    const result = await pollForWork(client, state, assessments, 1);

    expect(result.suppressed).toContain("scouted-1");
    expect(result.dispatchable).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 11. Mixed categories in a single poll
// ---------------------------------------------------------------------------

describe("pollForWork — mixed categories", () => {
  it("correctly classifies all four categories in one poll", async () => {
    const readyQueue = [
      makeReadyIssue("new-1"),
      makeReadyIssue("pending-1"),
      makeReadyIssue("implementing-1"),
      makeReadyIssue("scouted-Good"),
      makeReadyIssue("scouted-Bad"),
      makeReadyIssue("scouted-no-assessment"),
      makeReadyIssue("complete-1"),
    ];
    const client = makeMockClient(readyQueue);
    const state = makeDispatchState([
      makeRecord("pending-1", DispatchStage.Pending),
      makeRecord("implementing-1", DispatchStage.Implementing),
      // Active Titan that blocks scouted-Bad via overlap
      makeRecord("titan-1", DispatchStage.Implementing, {
        issueId: "titan-1",
        files: ["src/shared.ts"],
      }),
      makeRecord("scouted-Good", DispatchStage.Scouted),
      makeRecord("scouted-Bad", DispatchStage.Scouted),
      makeRecord("scouted-no-assessment", DispatchStage.Scouted),
      makeRecord("complete-1", DispatchStage.Complete),
    ]);
    const assessments = new Map([
      ["scouted-Good", makeAssessment(["src/unique.ts"])],
      ["scouted-Bad", makeAssessment(["src/shared.ts"])],
    ]);

    const result = await pollForWork(client, state, assessments);

    // new-1 (no record) + pending-1 + scouted-no-assessment → needsOracle
    expect(result.needsOracle).toContain("new-1");
    expect(result.needsOracle).toContain("pending-1");
    expect(result.needsOracle).toContain("scouted-no-assessment");

    // implementing-1 → inProgress
    expect(result.inProgress).toContain("implementing-1");

    // scouted-Good (no overlap) → dispatchable
    expect(result.dispatchable).toHaveLength(1);
    expect(result.dispatchable[0].issueId).toBe("scouted-Good");

    // scouted-Bad (overlap with titan-1) → suppressed
    expect(result.suppressed).toContain("scouted-Bad");

    // complete-1 → skipped
    expect(result.needsOracle).not.toContain("complete-1");
    expect(result.inProgress).not.toContain("complete-1");
  });
});

// ---------------------------------------------------------------------------
// 12. getReadyQueue is called exactly once
// ---------------------------------------------------------------------------

describe("pollForWork — client interaction", () => {
  it("calls getReadyQueue exactly once", async () => {
    const readyQueue: ReadyIssue[] = [];
    const client = makeMockClient(readyQueue);
    const state: DispatchState = { schemaVersion: 1, records: {} };

    await pollForWork(client, state);

    expect(client.getReadyQueue).toHaveBeenCalledTimes(1);
  });
});
