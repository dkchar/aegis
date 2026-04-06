/**
 * S15A — Scope allocation integration tests.
 *
 * Validates the end-to-end scope allocation workflow from SPECv2 §9.3.1:
 *   a) A realistic ready-queue with active Titans produces correct dispatch/suppress split
 *   b) The visibility layer correctly renders Olympus-ready summary cards
 *   c) The visibility layer produces per-issue cards with suppression context
 *   d) Threshold configuration changes dispatch decisions as expected
 *   e) Format helpers produce correct CLI/SSE output
 *   f) The full pipeline is pure, deterministic, and side-effect-free
 *   g) SSE event payloads are correctly constructed from allocation results
 *   h) The scope status endpoint returns correct suppression visibility
 */

import { describe, it, expect } from "vitest";

import {
  allocateScope,
  buildSuppressionReason,
} from "../../../src/core/scope-allocator.js";
import type { ScopeCandidate, ActiveTitanScope, ScopeAllocation } from "../../../src/core/scope-allocator.js";
import {
  buildScopeVisibilitySummary,
  buildIssueScopeVisibility,
  formatSuppressionEntry,
  formatAllocationSummary,
} from "../../../src/core/overlap-visibility.js";
import {
  triageScouted,
  checkDispatchConflict,
  attachFileScope,
  clearFileScope,
  type ScoutedIssue,
  type BatchTriageResult,
} from "../../../src/core/triage.js";
import { DispatchStage } from "../../../src/core/stage-transition.js";
import type { DispatchState, DispatchRecord } from "../../../src/core/dispatch-state.js";
import type { FileScope } from "../../../src/core/scope-allocator.js";
import type { OracleAssessment } from "../../../src/castes/oracle/oracle-parser.js";
import {
  createLiveEvent,
  isLiveEventType,
  getLiveEventPayloadFields,
} from "../../../src/events/event-bus.js";
import {
  serializeLiveEventForSse,
  formatSseFrame,
} from "../../../src/events/sse-stream.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function candidate(issueId: string, files: string[]): ScopeCandidate {
  return { issueId, fileScope: { issueId, files } };
}

function activeTitan(issueId: string, files: string[]): ActiveTitanScope {
  return { issueId, files };
}

// ---------------------------------------------------------------------------
// 1. Realistic ready-queue scenario
// ---------------------------------------------------------------------------

describe("S15A scope allocation — realistic ready queue", () => {
  it("suppresses overlapping candidates while dispatching safe ones", () => {
    // Simulate two active Titans working on different subsystems.
    const activeTitans: ActiveTitanScope[] = [
      activeTitan("issue-10", ["src/core/dispatch-state.ts", "src/core/stage-transition.ts"]),
      activeTitan("issue-11", ["src/runtime/pi-runtime.ts", "src/runtime/agent-runtime.ts"]),
    ];

    // Five ready issues with varying degrees of overlap.
    const candidates: ScopeCandidate[] = [
      candidate("issue-12", ["src/core/dispatch-state.ts"]),          // overlaps with issue-10
      candidate("issue-13", ["src/cli/status.ts", "src/cli/start.ts"]), // safe
      candidate("issue-14", ["src/runtime/pi-runtime.ts"]),            // overlaps with issue-11
      candidate("issue-15", ["src/config/schema.ts", "src/config/defaults.ts"]), // safe
      candidate("issue-16", ["docs/README.md"]),                       // safe
    ];

    const result = allocateScope(candidates, activeTitans);

    expect(result.dispatchable).toEqual(["issue-13", "issue-15", "issue-16"]);
    expect(result.suppressed).toHaveLength(2);
    expect(result.suppressed.map((s) => s.issueId)).toEqual(["issue-12", "issue-14"]);
    expect(result.suppressed[0].blockedBy).toEqual(["issue-10"]);
    expect(result.suppressed[1].blockedBy).toEqual(["issue-11"]);
  });

  it("dispatches all candidates when no Titans are active", () => {
    const candidates = [
      candidate("a", ["x.ts"]),
      candidate("b", ["y.ts"]),
      candidate("c", ["z.ts"]),
    ];

    const result = allocateScope(candidates, []);

    expect(result.dispatchable).toEqual(["a", "b", "c"]);
    expect(result.suppressed).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. Visibility summary — Olympus card
// ---------------------------------------------------------------------------

describe("S15A visibility — scope summary card", () => {
  it("builds a correct summary when there are suppressions", () => {
    const allocation: ScopeAllocation = {
      dispatchable: ["safe-1", "safe-2"],
      suppressed: [
        {
          issueId: "blocked-1",
          blockedBy: ["active-1"],
          overlappingFiles: ["shared.ts"],
          reason: "Issue blocked-1 suppressed: scope overlaps with active Titan(s) [active-1] on 1 file(s): shared.ts",
        },
      ],
    };

    const summary = buildScopeVisibilitySummary(allocation);

    expect(summary.dispatchableCount).toBe(2);
    expect(summary.suppressedCount).toBe(1);
    expect(summary.hasOverlap).toBe(true);
    expect(summary.dispatchable).toEqual(["safe-1", "safe-2"]);
    expect(summary.suppressions).toHaveLength(1);
    expect(summary.suppressions[0].issueId).toBe("blocked-1");
  });

  it("builds a correct summary when there is no overlap", () => {
    const allocation: ScopeAllocation = {
      dispatchable: ["a", "b"],
      suppressed: [],
    };

    const summary = buildScopeVisibilitySummary(allocation);

    expect(summary.dispatchableCount).toBe(2);
    expect(summary.suppressedCount).toBe(0);
    expect(summary.hasOverlap).toBe(false);
  });

  it("returns independent copies (no shared references)", () => {
    const allocation: ScopeAllocation = {
      dispatchable: ["a"],
      suppressed: [
        { issueId: "b", blockedBy: ["c"], overlappingFiles: ["x.ts"], reason: "test" },
      ],
    };

    const summary = buildScopeVisibilitySummary(allocation);

    // Mutating the summary should not affect the original
    summary.dispatchable.push("mutated");
    expect(allocation.dispatchable).toEqual(["a"]);
  });
});

// ---------------------------------------------------------------------------
// 3. Per-issue visibility — Olympus issue cards
// ---------------------------------------------------------------------------

describe("S15A visibility — per-issue cards", () => {
  it("marks dispatchable issues as safe and suppressed issues with context", () => {
    const allocation: ScopeAllocation = {
      dispatchable: ["safe-issue"],
      suppressed: [
        {
          issueId: "blocked-issue",
          blockedBy: ["titan-1"],
          overlappingFiles: ["shared.ts"],
          reason: "test reason",
        },
      ],
    };

    const fileScopes = new Map([
      ["safe-issue", { issueId: "safe-issue", files: ["a.ts"] }],
      ["blocked-issue", { issueId: "blocked-issue", files: ["shared.ts"] }],
    ]);

    const visibility = buildIssueScopeVisibility(fileScopes, allocation);

    const safeEntry = visibility.find((v) => v.issueId === "safe-issue");
    expect(safeEntry).toBeDefined();
    expect(safeEntry!.isDispatchable).toBe(true);
    expect(safeEntry!.suppression).toBeNull();

    const blockedEntry = visibility.find((v) => v.issueId === "blocked-issue");
    expect(blockedEntry).toBeDefined();
    expect(blockedEntry!.isDispatchable).toBe(false);
    expect(blockedEntry!.suppression).not.toBeNull();
    expect(blockedEntry!.suppression!.blockedBy).toEqual(["titan-1"]);
  });

  it("returns deep copies of file scopes", () => {
    const allocation: ScopeAllocation = {
      dispatchable: ["a"],
      suppressed: [],
    };
    const fileScopes = new Map([["a", { issueId: "a", files: ["x.ts"] }]]);

    const visibility = buildIssueScopeVisibility(fileScopes, allocation);

    visibility[0].fileScope.files.push("mutated");
    expect(fileScopes.get("a")!.files).toEqual(["x.ts"]);
  });
});

// ---------------------------------------------------------------------------
// 4. Threshold configuration changes behavior
// ---------------------------------------------------------------------------

describe("S15A — threshold configuration", () => {
  it("higher threshold allows more parallel dispatch", () => {
    const candidates = [
      candidate("first", ["a.ts", "b.ts", "c.ts"]),
      candidate("second", ["a.ts", "b.ts", "d.ts"]),
    ];

    // threshold=0: any overlap blocks
    const result0 = allocateScope(candidates, [], 0);
    expect(result0.dispatchable).toEqual(["first"]);

    // threshold=1: 2 overlaps > 1, still blocked
    const result1 = allocateScope(candidates, [], 1);
    expect(result1.dispatchable).toEqual(["first"]);

    // threshold=2: 2 overlaps <= 2, allowed
    const result2 = allocateScope(candidates, [], 2);
    expect(result2.dispatchable).toEqual(["first", "second"]);
  });

  it("threshold=0 is the SPECv2 default (any overlap blocks)", () => {
    const candidates = [
      candidate("a", ["shared.ts"]),
      candidate("b", ["shared.ts"]),
    ];

    const result = allocateScope(candidates, [], 0);
    expect(result.suppressed).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 5. Format helpers — CLI/SSE output
// ---------------------------------------------------------------------------

describe("S15A — format helpers", () => {
  it("formatSuppressionEntry returns the suppression reason", () => {
    const entry = {
      issueId: "x",
      blockedBy: ["y"],
      overlappingFiles: ["z.ts"],
      reason: "Issue x suppressed: overlaps with y on z.ts",
    };

    expect(formatSuppressionEntry(entry)).toBe(entry.reason);
  });

  it("formatAllocationSummary shows all-clear when no suppressions", () => {
    const allocation: ScopeAllocation = {
      dispatchable: ["a", "b"],
      suppressed: [],
    };

    const summary = formatAllocationSummary(allocation);

    expect(summary).toContain("2 candidate(s)");
    expect(summary).toContain("no overlap");
  });

  it("formatAllocationSummary lists all suppressed issues", () => {
    const allocation: ScopeAllocation = {
      dispatchable: ["a"],
      suppressed: [
        { issueId: "b", blockedBy: ["a"], overlappingFiles: ["x.ts"], reason: "b overlaps a" },
        { issueId: "c", blockedBy: ["a"], overlappingFiles: ["y.ts"], reason: "c overlaps a" },
      ],
    };

    const summary = formatAllocationSummary(allocation);

    expect(summary).toContain("1 dispatchable");
    expect(summary).toContain("2 suppressed");
    expect(summary).toContain("b overlaps a");
    expect(summary).toContain("c overlaps a");
  });

  it("formatAllocationSummary handles empty allocation", () => {
    const allocation: ScopeAllocation = {
      dispatchable: [],
      suppressed: [],
    };

    expect(formatAllocationSummary(allocation)).toBe("No candidates to dispatch.");
  });
});

// ---------------------------------------------------------------------------
// 6. End-to-end purity
// ---------------------------------------------------------------------------

describe("S15A — end-to-end purity", () => {
  it("full pipeline (allocate + visibility) produces consistent, serializable output", () => {
    const activeTitans: ActiveTitanScope[] = [
      activeTitan("t1", ["core.ts"]),
    ];
    const candidates: ScopeCandidate[] = [
      candidate("c1", ["core.ts", "extra.ts"]),
      candidate("c2", ["unrelated.ts"]),
    ];

    const allocation = allocateScope(candidates, activeTitans);
    const summary = buildScopeVisibilitySummary(allocation);

    // All output should be JSON-serializable (no circular refs, no undefined)
    const json = JSON.stringify(summary);
    const parsed = JSON.parse(json);

    expect(parsed.dispatchableCount).toBe(1);
    expect(parsed.suppressedCount).toBe(1);
    expect(parsed.hasOverlap).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. Wired dispatch path — triage + dispatch state integration
// ---------------------------------------------------------------------------

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
    assessment: {
      files_affected: files,
      estimated_complexity: "moderate",
      decompose: false,
      ready: true,
    } as OracleAssessment,
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

describe("S15A — wired dispatch path", () => {
  it("triage suppresses a scouted issue that overlaps with an active Titan in dispatch state", () => {
    const state = makeDispatchState([
      makeRecord("issue-10", DispatchStage.Implementing, {
        issueId: "issue-10",
        files: ["src/core/dispatch-state.ts"],
      }),
    ]);

    const scouted = [makeScouted("issue-12", ["src/core/dispatch-state.ts"])];

    const result = triageScouted(scouted, state);

    expect(result.dispatchable).toEqual([]);
    expect(result.suppressed).toHaveLength(1);
    expect(result.suppressed[0].issueId).toBe("issue-12");
  });

  it("triage dispatches a scouted issue with no overlap", () => {
    const state = makeDispatchState([
      makeRecord("issue-10", DispatchStage.Implementing, {
        issueId: "issue-10",
        files: ["src/core/dispatch-state.ts"],
      }),
    ]);

    const scouted = [makeScouted("issue-13", ["src/cli/status.ts"])];

    const result = triageScouted(scouted, state);

    expect(result.dispatchable).toHaveLength(1);
    expect(result.dispatchable[0].issueId).toBe("issue-13");
    expect(result.suppressed).toEqual([]);
  });

  it("attachFileScope wires file scope into the record before Titan dispatch", () => {
    const record = makeRecord("issue-12", DispatchStage.Implementing);
    const fileScope: FileScope = { issueId: "issue-12", files: ["src/core/x.ts"] };

    const updated = attachFileScope(record, fileScope);

    expect(updated.fileScope).toEqual(fileScope);
    expect(record.fileScope).toBeNull(); // original not mutated
  });

  it("clearFileScope removes scope when Titan completes or fails", () => {
    const record = makeRecord("issue-12", DispatchStage.Implementing, {
      issueId: "issue-12",
      files: ["src/core/x.ts"],
    });

    const updated = clearFileScope(record);

    expect(updated.fileScope).toBeNull();
    expect(record.fileScope).not.toBeNull(); // original not mutated
  });

  it("checkDispatchConflict catches overlap at dispatch time (pre-flight guard)", () => {
    const state = makeDispatchState([
      makeRecord("titan-1", DispatchStage.Implementing, {
        issueId: "titan-1",
        files: ["shared.ts"],
      }),
    ]);

    const conflictResult = checkDispatchConflict(
      { issueId: "candidate", files: ["shared.ts", "other.ts"] },
      state,
    );

    expect(conflictResult.hasConflict).toBe(true);
    expect(conflictResult.conflictsWith).toEqual(["titan-1"]);
    expect(conflictResult.overlappingFiles).toContain("shared.ts");
  });

  it("checkDispatchConflict returns clear when no active Titans claim the files", () => {
    const state = makeDispatchState([
      makeRecord("titan-1", DispatchStage.Implementing, {
        issueId: "titan-1",
        files: ["other.ts"],
      }),
    ]);

    const conflictResult = checkDispatchConflict(
      { issueId: "candidate", files: ["unique.ts"] },
      state,
    );

    expect(conflictResult.hasConflict).toBe(false);
    expect(conflictResult.conflictsWith).toEqual([]);
  });

  it("full wired pipeline: Oracle assessment -> triage -> dispatch/suppress", () => {
    // Simulate two active Titans from dispatch state.
    const state = makeDispatchState([
      makeRecord("titan-1", DispatchStage.Implementing, {
        issueId: "titan-1",
        files: ["src/core/dispatch-state.ts", "src/core/stage-transition.ts"],
      }),
      makeRecord("titan-2", DispatchStage.Implementing, {
        issueId: "titan-2",
        files: ["src/runtime/pi-runtime.ts"],
      }),
    ]);

    // Five scouted issues (as if Oracle just assessed them).
    const scouted = [
      makeScouted("issue-12", ["src/core/dispatch-state.ts"]),          // overlaps titan-1
      makeScouted("issue-13", ["src/cli/status.ts", "src/cli/start.ts"]), // safe
      makeScouted("issue-14", ["src/runtime/pi-runtime.ts"]),            // overlaps titan-2
      makeScouted("issue-15", ["src/config/schema.ts"]),                  // safe
      makeScouted("issue-16", ["docs/README.md"]),                        // safe
    ];

    const result: BatchTriageResult = triageScouted(scouted, state);

    expect(result.dispatchable.map((s) => s.issueId)).toEqual(["issue-13", "issue-15", "issue-16"]);
    expect(result.suppressed).toHaveLength(2);
    expect(result.suppressed.map((s) => s.issueId)).toEqual(["issue-12", "issue-14"]);
  });
});

// ---------------------------------------------------------------------------
// 8. SSE event payload construction from scope allocation
// ---------------------------------------------------------------------------

describe("S15A — SSE event payload for scope suppression", () => {
  it("scope.suppression is a recognized live event type", () => {
    expect(isLiveEventType("scope.suppression")).toBe(true);
  });

  it("scope.suppression event has correct payload fields", () => {
    const fields = getLiveEventPayloadFields("scope.suppression");

    expect(fields).toContain("dispatchable");
    expect(fields).toContain("suppressed");
    expect(fields).toContain("hasOverlap");
    expect(fields).toContain("evaluatedAt");
  });

  it("can construct a valid scope.suppression live event from allocation", () => {
    const activeTitans: ActiveTitanScope[] = [
      activeTitan("t1", ["core.ts"]),
    ];
    const candidates: ScopeCandidate[] = [
      candidate("c1", ["core.ts", "extra.ts"]),
      candidate("c2", ["unrelated.ts"]),
    ];

    const alloc = allocateScope(candidates, activeTitans);
    const summary = buildScopeVisibilitySummary(alloc);

    const event = createLiveEvent({
      id: "evt-scope-1",
      type: "scope.suppression",
      timestamp: new Date().toISOString(),
      sequence: 1,
      payload: {
        dispatchable: summary.dispatchable,
        suppressed: summary.suppressions,
        hasOverlap: summary.hasOverlap,
        evaluatedAt: new Date().toISOString(),
      },
    });

    expect(event.type).toBe("scope.suppression");
    expect(event.payload.dispatchable).toEqual(["c2"]);
    expect(event.payload.suppressed).toHaveLength(1);
    expect(event.payload.suppressed[0].issueId).toBe("c1");
    expect(event.payload.hasOverlap).toBe(true);
  });

  it("scope.suppression event serializes to valid SSE frame", () => {
    const event = createLiveEvent({
      id: "evt-scope-2",
      type: "scope.suppression",
      timestamp: new Date().toISOString(),
      sequence: 2,
      payload: {
        dispatchable: ["safe"],
        suppressed: [
          { issueId: "blocked", blockedBy: ["t1"], overlappingFiles: ["x.ts"], reason: "test" },
        ],
        hasOverlap: true,
        evaluatedAt: new Date().toISOString(),
      },
    });

    const frame = serializeLiveEventForSse(event);

    expect(frame.id).toBe("evt-scope-2");
    expect(frame.event).toBe("scope.suppression");

    const sseOutput = formatSseFrame(frame);
    expect(sseOutput).toContain("id: evt-scope-2");
    expect(sseOutput).toContain("event: scope.suppression");
    expect(sseOutput).toContain("safe");
    expect(sseOutput).toContain("blocked");
  });

  it("empty allocation produces valid SSE event with no overlap", () => {
    const alloc: ScopeAllocation = { dispatchable: [], suppressed: [] };
    const summary = buildScopeVisibilitySummary(alloc);

    const event = createLiveEvent({
      id: "evt-empty",
      type: "scope.suppression",
      timestamp: new Date().toISOString(),
      sequence: 3,
      payload: {
        dispatchable: summary.dispatchable,
        suppressed: summary.suppressions,
        hasOverlap: summary.hasOverlap,
        evaluatedAt: new Date().toISOString(),
      },
    });

    expect(event.payload.hasOverlap).toBe(false);
    expect(event.payload.dispatchable).toEqual([]);
    expect(event.payload.suppressed).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 9. Visibility with complex overlap scenarios
// ---------------------------------------------------------------------------

describe("S15A — visibility with complex overlap scenarios", () => {
  it("visibility correctly reflects cascading candidate suppression", () => {
    // first claims shared.ts; second and third both overlap with first.
    const candidates: ScopeCandidate[] = [
      candidate("first", ["shared.ts"]),
      candidate("second", ["shared.ts", "unique-2.ts"]),
      candidate("third", ["shared.ts", "unique-3.ts"]),
    ];

    const alloc = allocateScope(candidates, []);

    expect(alloc.dispatchable).toEqual(["first"]);
    expect(alloc.suppressed).toHaveLength(2);

    const summary = buildScopeVisibilitySummary(alloc);
    expect(summary.dispatchableCount).toBe(1);
    expect(summary.suppressedCount).toBe(2);
    expect(summary.suppressions.map((s) => s.issueId)).toEqual(["second", "third"]);

    // Each suppression entry should identify first as the blocker
    expect(summary.suppressions[0].blockedBy).toEqual(["first"]);
    expect(summary.suppressions[1].blockedBy).toEqual(["first"]);
  });

  it("visibility correctly reflects mixed active Titan and candidate overlap", () => {
    const activeTitans: ActiveTitanScope[] = [
      activeTitan("titan-active", ["auth.ts", "db.ts"]),
    ];
    const candidates: ScopeCandidate[] = [
      candidate("c1", ["auth.ts"]),       // overlaps with titan-active
      candidate("c2", ["ui.ts"]),         // safe
      candidate("c3", ["db.ts", "api.ts"]), // overlaps with titan-active
    ];

    const alloc = allocateScope(candidates, activeTitans);

    expect(alloc.dispatchable).toEqual(["c2"]);
    expect(alloc.suppressed).toHaveLength(2);

    const summary = buildScopeVisibilitySummary(alloc);
    expect(summary.hasOverlap).toBe(true);
    expect(summary.suppressions[0].blockedBy).toEqual(["titan-active"]);
    expect(summary.suppressions[1].blockedBy).toEqual(["titan-active"]);

    // Per-issue visibility should correctly tag each issue
    const fileScopes = new Map([
      ["c1", { issueId: "c1", files: ["auth.ts"] }],
      ["c2", { issueId: "c2", files: ["ui.ts"] }],
      ["c3", { issueId: "c3", files: ["db.ts", "api.ts"] }],
    ]);

    const visibility = buildIssueScopeVisibility(fileScopes, alloc);

    const c1Entry = visibility.find((v) => v.issueId === "c1");
    const c2Entry = visibility.find((v) => v.issueId === "c2");
    const c3Entry = visibility.find((v) => v.issueId === "c3");

    expect(c1Entry!.isDispatchable).toBe(false);
    expect(c1Entry!.suppression).not.toBeNull();
    expect(c2Entry!.isDispatchable).toBe(true);
    expect(c2Entry!.suppression).toBeNull();
    expect(c3Entry!.isDispatchable).toBe(false);
    expect(c3Entry!.suppression).not.toBeNull();
  });

  it("formatAllocationSummary produces multi-line output for complex suppressions", () => {
    const alloc: ScopeAllocation = {
      dispatchable: ["safe-1"],
      suppressed: [
        { issueId: "blocked-1", blockedBy: ["t1"], overlappingFiles: ["a.ts"], reason: "blocked-1 overlaps t1 on a.ts" },
        { issueId: "blocked-2", blockedBy: ["t1", "t2"], overlappingFiles: ["b.ts", "c.ts"], reason: "blocked-2 overlaps t1, t2 on b.ts, c.ts" },
        { issueId: "blocked-3", blockedBy: ["safe-1"], overlappingFiles: ["d.ts"], reason: "blocked-3 overlaps safe-1 on d.ts" },
      ],
    };

    const summary = formatAllocationSummary(alloc);

    const lines = summary.split("\n");
    expect(lines).toHaveLength(4); // header + 3 suppression lines
    expect(lines[0]).toContain("1 dispatchable");
    expect(lines[0]).toContain("3 suppressed");
    expect(lines[1]).toContain("blocked-1");
    expect(lines[2]).toContain("blocked-2");
    expect(lines[3]).toContain("blocked-3");
  });
});
