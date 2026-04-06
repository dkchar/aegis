/**
 * S15A — Scope Allocator unit tests.
 *
 * Validates the overlap detection and suppression logic from SPECv2 §9.3.1:
 *   a) computeOverlap returns correct shared files between two sets
 *   b) overlapCount / isWithinThreshold helpers behave correctly
 *   c) allocateScope correctly suppresses overlapping candidates
 *   d) allocateScope respects the threshold parameter
 *   e) allocateScope is deterministic and immutable
 *   f) buildSuppressionReason produces clear operator-facing text
 *   g) checkCandidateConflict works as a single-issue convenience wrapper
 */

import { describe, it, expect } from "vitest";

import {
  computeOverlap,
  overlapCount,
  isWithinThreshold,
  allocateScope,
  buildSuppressionReason,
  checkCandidateConflict,
  seedFileScope,
  narrowFileScope,
} from "../../../src/core/scope-allocator.js";
import type { ScopeCandidate, ActiveTitanScope, FileScope } from "../../../src/core/scope-allocator.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fileScope(issueId: string, files: string[]): FileScope {
  return { issueId, files };
}

function candidate(issueId: string, files: string[]): ScopeCandidate {
  return { issueId, fileScope: fileScope(issueId, files) };
}

function activeTitan(issueId: string, files: string[]): ActiveTitanScope {
  return { issueId, files };
}

// ---------------------------------------------------------------------------
// 1. computeOverlap — basic correctness
// ---------------------------------------------------------------------------

describe("computeOverlap", () => {
  it("returns empty array when there is no overlap", () => {
    expect(computeOverlap(["a.ts", "b.ts"], ["c.ts", "d.ts"])).toEqual([]);
  });

  it("returns shared files when there is exact overlap", () => {
    expect(computeOverlap(["a.ts", "b.ts"], ["b.ts", "c.ts"])).toEqual(["b.ts"]);
  });

  it("returns all files when sets are identical", () => {
    const result = computeOverlap(["x.ts", "y.ts"], ["x.ts", "y.ts"]);
    expect(result).toHaveLength(2);
    expect(result).toContain("x.ts");
    expect(result).toContain("y.ts");
  });

  it("handles empty input arrays", () => {
    expect(computeOverlap([], ["a.ts"])).toEqual([]);
    expect(computeOverlap(["a.ts"], [])).toEqual([]);
    expect(computeOverlap([], [])).toEqual([]);
  });

  it("is directional — returns files from the first set only", () => {
    // Same files, different order — result should follow the first array's order
    expect(computeOverlap(["b.ts", "a.ts"], ["a.ts", "b.ts", "c.ts"])).toEqual(["b.ts", "a.ts"]);
  });
});

// ---------------------------------------------------------------------------
// 2. overlapCount and isWithinThreshold
// ---------------------------------------------------------------------------

describe("overlapCount", () => {
  it("returns 0 when no files overlap", () => {
    const a = fileScope("a", ["x.ts"]);
    const b = fileScope("b", ["y.ts"]);
    expect(overlapCount(a, b)).toBe(0);
  });

  it("returns correct count for partial overlap", () => {
    const a = fileScope("a", ["x.ts", "y.ts", "z.ts"]);
    const b = fileScope("b", ["y.ts", "z.ts", "w.ts"]);
    expect(overlapCount(a, b)).toBe(2);
  });
});

describe("isWithinThreshold", () => {
  it("returns true when overlap is 0 and threshold is 0", () => {
    expect(isWithinThreshold(0, 0)).toBe(true);
  });

  it("returns false when overlap exceeds threshold", () => {
    expect(isWithinThreshold(1, 0)).toBe(false);
    expect(isWithinThreshold(3, 1)).toBe(false);
  });

  it("returns true when overlap equals threshold", () => {
    expect(isWithinThreshold(2, 2)).toBe(true);
  });

  it("returns true when overlap is below threshold", () => {
    expect(isWithinThreshold(1, 5)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. allocateScope — no active Titans, no overlap
// ---------------------------------------------------------------------------

describe("allocateScope — no overlap", () => {
  it("dispatches all candidates when there is no overlap", () => {
    const candidates = [
      candidate("issue-1", ["a.ts", "b.ts"]),
      candidate("issue-2", ["c.ts", "d.ts"]),
      candidate("issue-3", ["e.ts"]),
    ];

    const result = allocateScope(candidates, []);

    expect(result.dispatchable).toEqual(["issue-1", "issue-2", "issue-3"]);
    expect(result.suppressed).toEqual([]);
  });

  it("returns empty arrays when given no candidates", () => {
    const result = allocateScope([], []);
    expect(result.dispatchable).toEqual([]);
    expect(result.suppressed).toEqual([]);
  });

  it("dispatches a single candidate with no active Titans", () => {
    const result = allocateScope([candidate("only", ["x.ts"])], []);
    expect(result.dispatchable).toEqual(["only"]);
  });
});

// ---------------------------------------------------------------------------
// 4. allocateScope — overlap with active Titans
// ---------------------------------------------------------------------------

describe("allocateScope — overlap with active Titans", () => {
  it("suppresses a candidate that shares a file with an active Titan", () => {
    const active = [activeTitan("titan-1", ["shared.ts", "other.ts"])];
    const candidates = [candidate("cand-1", ["shared.ts", "unique.ts"])];

    const result = allocateScope(candidates, active);

    expect(result.dispatchable).toEqual([]);
    expect(result.suppressed).toHaveLength(1);
    expect(result.suppressed[0].issueId).toBe("cand-1");
    expect(result.suppressed[0].blockedBy).toEqual(["titan-1"]);
    expect(result.suppressed[0].overlappingFiles).toContain("shared.ts");
  });

  it("suppresses a candidate that overlaps with multiple active Titans", () => {
    const active = [
      activeTitan("titan-1", ["a.ts"]),
      activeTitan("titan-2", ["b.ts"]),
    ];
    const candidates = [candidate("cand-1", ["a.ts", "b.ts", "c.ts"])];

    const result = allocateScope(candidates, active);

    expect(result.dispatchable).toEqual([]);
    expect(result.suppressed).toHaveLength(1);
    expect(result.suppressed[0].blockedBy).toContain("titan-1");
    expect(result.suppressed[0].blockedBy).toContain("titan-2");
    expect(result.suppressed[0].overlappingFiles).toContain("a.ts");
    expect(result.suppressed[0].overlappingFiles).toContain("b.ts");
  });

  it("allows a candidate with no overlap alongside blocked ones", () => {
    const active = [activeTitan("titan-1", ["a.ts"])];
    const candidates = [
      candidate("cand-1", ["a.ts", "b.ts"]), // blocked
      candidate("cand-2", ["c.ts"]),          // safe
    ];

    const result = allocateScope(candidates, active);

    expect(result.dispatchable).toEqual(["cand-2"]);
    expect(result.suppressed).toHaveLength(1);
    expect(result.suppressed[0].issueId).toBe("cand-1");
  });
});

// ---------------------------------------------------------------------------
// 5. allocateScope — pairwise candidate overlap
// ---------------------------------------------------------------------------

describe("allocateScope — pairwise candidate overlap", () => {
  it("dispatches the first candidate and suppresses the second when they overlap", () => {
    const candidates = [
      candidate("first", ["shared.ts", "a.ts"]),
      candidate("second", ["shared.ts", "b.ts"]),
    ];

    const result = allocateScope(candidates, []);

    expect(result.dispatchable).toEqual(["first"]);
    expect(result.suppressed).toHaveLength(1);
    expect(result.suppressed[0].issueId).toBe("second");
    expect(result.suppressed[0].blockedBy).toEqual(["first"]);
  });

  it("dispatches non-overlapping candidates in order", () => {
    const candidates = [
      candidate("a", ["a.ts"]),
      candidate("b", ["b.ts"]),
      candidate("c", ["c.ts"]),
    ];

    const result = allocateScope(candidates, []);

    expect(result.dispatchable).toEqual(["a", "b", "c"]);
    expect(result.suppressed).toEqual([]);
  });

  it("cascades suppression through the candidate chain", () => {
    // first claims shared.ts; second overlaps with first (blocked);
    // third overlaps with first too (blocked), even though it doesn't overlap with second.
    const candidates = [
      candidate("first", ["shared.ts"]),
      candidate("second", ["shared.ts", "unique.ts"]),
      candidate("third", ["shared.ts", "other.ts"]),
    ];

    const result = allocateScope(candidates, []);

    expect(result.dispatchable).toEqual(["first"]);
    expect(result.suppressed).toHaveLength(2);
    expect(result.suppressed.map((s) => s.issueId)).toEqual(["second", "third"]);
  });
});

// ---------------------------------------------------------------------------
// 6. allocateScope — threshold behavior
// ---------------------------------------------------------------------------

describe("allocateScope — threshold parameter", () => {
  it("allows overlap when threshold is greater than overlap count", () => {
    const candidates = [
      candidate("first", ["a.ts", "b.ts"]),
      candidate("second", ["a.ts", "c.ts"]),
    ];
    // 1 overlapping file, threshold=1 -> allowed
    const result = allocateScope(candidates, [], 1);

    expect(result.dispatchable).toEqual(["first", "second"]);
    expect(result.suppressed).toEqual([]);
  });

  it("blocks overlap when threshold is exceeded", () => {
    const candidates = [
      candidate("first", ["a.ts", "b.ts"]),
      candidate("second", ["a.ts", "b.ts", "c.ts"]),
    ];
    // 2 overlapping files, threshold=1 -> blocked
    const result = allocateScope(candidates, [], 1);

    expect(result.dispatchable).toEqual(["first"]);
    expect(result.suppressed).toHaveLength(1);
  });

  it("default threshold is 0 (any overlap blocks)", () => {
    const candidates = [
      candidate("first", ["a.ts"]),
      candidate("second", ["a.ts"]),
    ];

    const resultDefault = allocateScope(candidates, []);
    const resultExplicit = allocateScope(candidates, [], 0);

    expect(resultDefault).toEqual(resultExplicit);
    expect(resultDefault.suppressed).toHaveLength(1);
  });

  it("threshold also applies to active Titan checks", () => {
    const active = [activeTitan("titan-1", ["a.ts", "b.ts"])];
    const candidates = [candidate("cand", ["a.ts", "c.ts"])];
    // 1 overlapping file, threshold=1 -> allowed
    const result = allocateScope(candidates, active, 1);

    expect(result.dispatchable).toEqual(["cand"]);
    expect(result.suppressed).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 7. Immutability and determinism
// ---------------------------------------------------------------------------

describe("allocateScope — immutability and determinism", () => {
  it("does not mutate input candidate arrays", () => {
    const candidates = [candidate("a", ["x.ts"])];
    const active = [activeTitan("t", ["y.ts"])];

    const filesBefore = [...candidates[0].fileScope.files];
    const activeFilesBefore = [...active[0].files];

    allocateScope(candidates, active);

    expect(candidates[0].fileScope.files).toEqual(filesBefore);
    expect(active[0].files).toEqual(activeFilesBefore);
  });

  it("returns independent arrays (no shared references)", () => {
    const candidates = [candidate("a", ["x.ts"])];
    const result = allocateScope(candidates, []);

    result.dispatchable.push("mutated");
    expect(result.dispatchable).not.toEqual(candidates.map((c) => c.issueId));
  });

  it("produces the same result on repeated calls", () => {
    const candidates = [
      candidate("first", ["shared.ts"]),
      candidate("second", ["shared.ts"]),
    ];

    const r1 = allocateScope(candidates, []);
    const r2 = allocateScope(candidates, []);

    expect(r1.dispatchable).toEqual(r2.dispatchable);
    expect(r1.suppressed.map((s) => s.issueId)).toEqual(r2.suppressed.map((s) => s.issueId));
  });
});

// ---------------------------------------------------------------------------
// 8. buildSuppressionReason
// ---------------------------------------------------------------------------

describe("buildSuppressionReason", () => {
  it("produces a clear human-readable message", () => {
    const reason = buildSuppressionReason("cand-1", ["titan-1"], ["shared.ts"]);

    expect(reason).toContain("cand-1");
    expect(reason).toContain("titan-1");
    expect(reason).toContain("shared.ts");
    expect(reason).toContain("suppressed");
  });

  it("includes file count in the message", () => {
    const reason = buildSuppressionReason("c", ["t"], ["a.ts", "b.ts", "c.ts"]);

    expect(reason).toContain("3 file(s)");
  });

  it("truncates long file lists with ellipsis", () => {
    const files = Array.from({ length: 8 }, (_, i) => `f${i}.ts`);
    const reason = buildSuppressionReason("c", ["t"], files);

    expect(reason).toContain("f0.ts");
    expect(reason).toContain("+3 more");
  });
});

// ---------------------------------------------------------------------------
// 9. checkCandidateConflict — single-issue convenience
// ---------------------------------------------------------------------------

describe("checkCandidateConflict", () => {
  it("returns no conflict when there is no overlap", () => {
    const c = fileScope("cand", ["a.ts"]);
    const result = checkCandidateConflict(c, [activeTitan("t", ["b.ts"])]);

    expect(result.hasConflict).toBe(false);
    expect(result.conflictsWith).toEqual([]);
    expect(result.overlappingFiles).toEqual([]);
  });

  it("detects conflict with a single active Titan", () => {
    const c = fileScope("cand", ["shared.ts", "unique.ts"]);
    const result = checkCandidateConflict(c, [activeTitan("t", ["shared.ts"])]);

    expect(result.hasConflict).toBe(true);
    expect(result.conflictsWith).toEqual(["t"]);
    expect(result.overlappingFiles).toContain("shared.ts");
  });

  it("respects the threshold parameter", () => {
    const c = fileScope("cand", ["a.ts", "b.ts"]);
    const active = [activeTitan("t", ["a.ts", "c.ts"])];

    // 1 overlap, threshold=1 -> no conflict
    const result1 = checkCandidateConflict(c, active, 1);
    expect(result1.hasConflict).toBe(false);

    // 1 overlap, threshold=0 -> conflict
    const result0 = checkCandidateConflict(c, active, 0);
    expect(result0.hasConflict).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Human override (force dispatch)
// ---------------------------------------------------------------------------

describe("S15A — human override (force dispatch)", () => {
  it("force-dispatched candidate bypasses overlap suppression", () => {
    const candidates = [
      candidate("forced", ["shared.ts", "other.ts"]),
      candidate("normal", ["unique.ts"]),
    ];
    const activeTitans = [activeTitan("t1", ["shared.ts"])];

    const result = allocateScope(candidates, activeTitans, 0, new Set(["forced"]));

    expect(result.dispatchable).toEqual(["forced", "normal"]);
    expect(result.suppressed).toEqual([]);
  });

  it("non-forced overlapping candidate is still suppressed when another is forced", () => {
    const candidates = [
      candidate("forced", ["shared.ts"]),
      candidate("overlap", ["shared.ts", "unique.ts"]),
    ];
    const activeTitans: ActiveTitanScope[] = [];

    const result = allocateScope(candidates, activeTitans, 0, new Set(["forced"]));

    expect(result.dispatchable).toEqual(["forced"]);
    expect(result.suppressed).toHaveLength(1);
    expect(result.suppressed[0].issueId).toBe("overlap");
  });

  it("empty forceDispatch set behaves normally", () => {
    const candidates = [candidate("a", ["x.ts"]), candidate("b", ["x.ts"])];
    const active: ActiveTitanScope[] = [];

    const result = allocateScope(candidates, active, 0, new Set());

    expect(result.dispatchable).toEqual(["a"]);
    expect(result.suppressed).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Scope seeding and narrowing
// ---------------------------------------------------------------------------

describe("S15A — scope seeding and narrowing", () => {
  it("seedFileScope creates a FileScope from explicit file list", () => {
    const scope = seedFileScope("issue-1", ["a.ts", "b.ts"]);

    expect(scope.issueId).toBe("issue-1");
    expect(scope.files).toEqual(["a.ts", "b.ts"]);
  });

  it("seedFileScope does not mutate the input array", () => {
    const files = ["a.ts"];
    const scope = seedFileScope("x", files);

    files.push("b.ts");
    expect(scope.files).toEqual(["a.ts"]);
  });

  it("narrowFileScope removes excluded files", () => {
    const scope: FileScope = { issueId: "issue-1", files: ["a.ts", "b.ts", "c.ts"] };

    const narrowed = narrowFileScope(scope, ["b.ts"]);

    expect(narrowed.files).toEqual(["a.ts", "c.ts"]);
    expect(scope.files).toEqual(["a.ts", "b.ts", "c.ts"]); // original not mutated
  });

  it("narrowFileScope with non-existent files is a no-op", () => {
    const scope: FileScope = { issueId: "x", files: ["a.ts"] };

    const narrowed = narrowFileScope(scope, ["z.ts"]);

    expect(narrowed.files).toEqual(["a.ts"]);
  });

  it("seeded scope works correctly with allocateScope", () => {
    const candidates: ScopeCandidate[] = [
      { issueId: "seeded", fileScope: seedFileScope("seeded", ["safe.ts"]) },
      { issueId: "oracle", fileScope: { issueId: "oracle", files: ["other.ts"] } },
    ];

    const result = allocateScope(candidates, [], 0);

    expect(result.dispatchable).toEqual(["seeded", "oracle"]);
  });

  it("narrowed scope eliminates false overlap", () => {
    const active = [activeTitan("t1", ["shared.ts", "other.ts"])];
    const originalScope: FileScope = { issueId: "c1", files: ["shared.ts", "unique.ts"] };
    const narrowed = narrowFileScope(originalScope, ["shared.ts"]);

    const candidates: ScopeCandidate[] = [
      { issueId: "c1", fileScope: narrowed },
    ];

    const result = allocateScope(candidates, active, 0);

    // After narrowing, c1 no longer overlaps with t1
    expect(result.dispatchable).toEqual(["c1"]);
    expect(result.suppressed).toEqual([]);
  });
});
