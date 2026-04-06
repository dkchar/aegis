/**
 * S15A — Overlap visibility unit tests.
 *
 * Validates the visibility formatting functions from overlap-visibility.ts:
 *   a) buildScopeVisibilitySummary produces correct Olympus-ready summary cards
 *   b) buildIssueScopeVisibility produces correct per-issue cards
 *   c) formatSuppressionEntry returns human-readable status lines
 *   d) formatAllocationSummary produces correct CLI/SSE output strings
 *   e) Immutability — no shared references between input and output
 *   f) Edge cases — empty allocations, single-issue scenarios
 */

import { describe, it, expect } from "vitest";

import {
  buildScopeVisibilitySummary,
  buildIssueScopeVisibility,
  formatSuppressionEntry,
  formatAllocationSummary,
  type ScopeVisibilitySummary,
  type IssueScopeVisibility,
} from "../../../src/core/overlap-visibility.js";
import type { ScopeAllocation, SuppressionEntry, FileScope } from "../../../src/core/scope-allocator.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function allocation(dispatchable: string[], suppressed: SuppressionEntry[]): ScopeAllocation {
  return { dispatchable, suppressed };
}

function suppression(issueId: string, blockedBy: string[], overlappingFiles: string[], reason: string): SuppressionEntry {
  return { issueId, blockedBy, overlappingFiles, reason };
}

function fileScope(issueId: string, files: string[]): FileScope {
  return { issueId, files };
}

// ---------------------------------------------------------------------------
// 1. buildScopeVisibilitySummary — Olympus summary card
// ---------------------------------------------------------------------------

describe("buildScopeVisibilitySummary", () => {
  it("produces correct summary with suppressions", () => {
    const alloc = allocation(
      ["safe-1", "safe-2"],
      [
        suppression("blocked-1", ["active-1"], ["shared.ts"], "Issue blocked-1 suppressed: overlaps with active-1 on shared.ts"),
      ],
    );

    const summary = buildScopeVisibilitySummary(alloc);

    expect(summary.dispatchableCount).toBe(2);
    expect(summary.suppressedCount).toBe(1);
    expect(summary.hasOverlap).toBe(true);
    expect(summary.dispatchable).toEqual(["safe-1", "safe-2"]);
    expect(summary.suppressions).toHaveLength(1);
    expect(summary.suppressions[0].issueId).toBe("blocked-1");
    expect(summary.suppressions[0].blockedBy).toEqual(["active-1"]);
    expect(summary.suppressions[0].overlappingFiles).toEqual(["shared.ts"]);
  });

  it("produces correct summary with no suppressions", () => {
    const alloc = allocation(["a", "b", "c"], []);

    const summary = buildScopeVisibilitySummary(alloc);

    expect(summary.dispatchableCount).toBe(3);
    expect(summary.suppressedCount).toBe(0);
    expect(summary.hasOverlap).toBe(false);
    expect(summary.dispatchable).toEqual(["a", "b", "c"]);
    expect(summary.suppressions).toEqual([]);
  });

  it("produces correct summary for empty allocation", () => {
    const alloc = allocation([], []);

    const summary = buildScopeVisibilitySummary(alloc);

    expect(summary.dispatchableCount).toBe(0);
    expect(summary.suppressedCount).toBe(0);
    expect(summary.hasOverlap).toBe(false);
    expect(summary.dispatchable).toEqual([]);
    expect(summary.suppressions).toEqual([]);
  });

  it("handles multiple suppressions from different blockers", () => {
    const alloc = allocation(
      ["safe"],
      [
        suppression("blocked-1", ["titan-1"], ["a.ts"], "blocked-1 overlaps titan-1"),
        suppression("blocked-2", ["titan-1", "titan-2"], ["b.ts", "c.ts"], "blocked-2 overlaps titan-1, titan-2"),
      ],
    );

    const summary = buildScopeVisibilitySummary(alloc);

    expect(summary.dispatchableCount).toBe(1);
    expect(summary.suppressedCount).toBe(2);
    expect(summary.hasOverlap).toBe(true);
    expect(summary.suppressions[1].blockedBy).toEqual(["titan-1", "titan-2"]);
    expect(summary.suppressions[1].overlappingFiles).toEqual(["b.ts", "c.ts"]);
  });
});

// ---------------------------------------------------------------------------
// 2. buildIssueScopeVisibility — per-issue cards
// ---------------------------------------------------------------------------

describe("buildIssueScopeVisibility", () => {
  it("marks dispatchable issues as safe with no suppression", () => {
    const alloc = allocation(["safe-issue"], []);
    const fileScopes = new Map([
      ["safe-issue", fileScope("safe-issue", ["a.ts", "b.ts"])],
    ]);

    const visibility = buildIssueScopeVisibility(fileScopes, alloc);

    expect(visibility).toHaveLength(1);
    expect(visibility[0].issueId).toBe("safe-issue");
    expect(visibility[0].isDispatchable).toBe(true);
    expect(visibility[0].suppression).toBeNull();
    expect(visibility[0].fileScope.files).toEqual(["a.ts", "b.ts"]);
  });

  it("marks suppressed issues with full suppression context", () => {
    const alloc = allocation(
      ["safe"],
      [
        suppression("blocked", ["titan-1"], ["shared.ts"], "Issue blocked suppressed: overlaps with titan-1 on shared.ts"),
      ],
    );
    const fileScopes = new Map([
      ["safe", fileScope("safe", ["x.ts"])],
      ["blocked", fileScope("blocked", ["shared.ts"])],
    ]);

    const visibility = buildIssueScopeVisibility(fileScopes, alloc);

    const blockedEntry = visibility.find((v) => v.issueId === "blocked");
    expect(blockedEntry).toBeDefined();
    expect(blockedEntry!.isDispatchable).toBe(false);
    expect(blockedEntry!.suppression).not.toBeNull();
    expect(blockedEntry!.suppression!.blockedBy).toEqual(["titan-1"]);
    expect(blockedEntry!.suppression!.overlappingFiles).toEqual(["shared.ts"]);
  });

  it("returns one entry per file scope input", () => {
    const alloc = allocation(["a"], []);
    const fileScopes = new Map([
      ["a", fileScope("a", ["x.ts"])],
      ["b", fileScope("b", ["y.ts"])],
      ["c", fileScope("c", ["z.ts"])],
    ]);

    const visibility = buildIssueScopeVisibility(fileScopes, alloc);

    expect(visibility).toHaveLength(3);
    const ids = visibility.map((v) => v.issueId);
    expect(ids).toContain("a");
    expect(ids).toContain("b");
    expect(ids).toContain("c");
  });

  it("handles empty file scopes", () => {
    const alloc = allocation([], []);
    const fileScopes = new Map<string, FileScope>();

    const visibility = buildIssueScopeVisibility(fileScopes, alloc);

    expect(visibility).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. formatSuppressionEntry — human-readable status lines
// ---------------------------------------------------------------------------

describe("formatSuppressionEntry", () => {
  it("returns the reason string from the suppression entry", () => {
    const entry = suppression("x", ["y"], ["z.ts"], "Issue x suppressed: overlaps with y on z.ts");

    expect(formatSuppressionEntry(entry)).toBe("Issue x suppressed: overlaps with y on z.ts");
  });

  it("handles multi-blocker entries", () => {
    const entry = suppression("c1", ["t1", "t2"], ["a.ts", "b.ts"], "Issue c1 suppressed: overlaps with t1, t2 on 2 files");

    expect(formatSuppressionEntry(entry)).toBe("Issue c1 suppressed: overlaps with t1, t2 on 2 files");
  });

  it("returns empty reason if reason is empty string", () => {
    const entry = suppression("x", [], [], "");

    expect(formatSuppressionEntry(entry)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// 4. formatAllocationSummary — CLI/SSE output strings
// ---------------------------------------------------------------------------

describe("formatAllocationSummary", () => {
  it("shows all-clear when all candidates are dispatchable", () => {
    const alloc = allocation(["a", "b"], []);

    const summary = formatAllocationSummary(alloc);

    expect(summary).toBe("All 2 candidate(s) are dispatchable; no overlap detected.");
  });

  it("shows all-clear for single dispatchable candidate", () => {
    const alloc = allocation(["only"], []);

    const summary = formatAllocationSummary(alloc);

    expect(summary).toBe("All 1 candidate(s) are dispatchable; no overlap detected.");
  });

  it("returns 'No candidates to dispatch.' for empty allocation", () => {
    const alloc = allocation([], []);

    expect(formatAllocationSummary(alloc)).toBe("No candidates to dispatch.");
  });

  it("lists suppressed issues with overlap details", () => {
    const alloc = allocation(
      ["safe"],
      [
        suppression("blocked-1", ["t1"], ["a.ts"], "blocked-1 overlaps t1"),
        suppression("blocked-2", ["t2"], ["b.ts"], "blocked-2 overlaps t2"),
      ],
    );

    const summary = formatAllocationSummary(alloc);

    expect(summary).toContain("1 dispatchable");
    expect(summary).toContain("2 suppressed");
    expect(summary).toContain("blocked-1 overlaps t1");
    expect(summary).toContain("blocked-2 overlaps t2");
  });

  it("correctly reports zero dispatchable when all are suppressed", () => {
    const alloc = allocation(
      [],
      [
        suppression("blocked", ["active"], ["x.ts"], "blocked overlaps active"),
      ],
    );

    const summary = formatAllocationSummary(alloc);

    expect(summary).toContain("0 dispatchable");
    expect(summary).toContain("1 suppressed");
  });
});

// ---------------------------------------------------------------------------
// 5. Immutability — no shared references
// ---------------------------------------------------------------------------

describe("Visibility immutability", () => {
  it("buildScopeVisibilitySummary returns independent copies", () => {
    const alloc = allocation(
      ["a"],
      [suppression("b", ["a"], ["x.ts"], "test")],
    );

    const summary = buildScopeVisibilitySummary(alloc);

    // Mutating the summary should not affect the original
    summary.dispatchable.push("mutated");
    summary.suppressions.push({ issueId: "fake", blockedBy: [], overlappingFiles: [], reason: "fake" });

    expect(alloc.dispatchable).toEqual(["a"]);
    expect(alloc.suppressed).toHaveLength(1);
  });

  it("buildIssueScopeVisibility returns deep copies of file scopes", () => {
    const alloc = allocation(["a"], []);
    const fileScopes = new Map([["a", fileScope("a", ["x.ts"])]]);

    const visibility = buildIssueScopeVisibility(fileScopes, alloc);

    visibility[0].fileScope.files.push("mutated");
    expect(fileScopes.get("a")!.files).toEqual(["x.ts"]);
  });

  it("buildIssueScopeVisibility returns null for non-suppressed entries (not a reference)", () => {
    const alloc = allocation(["a"], []);
    const fileScopes = new Map([["a", fileScope("a", ["x.ts"])]]);

    const visibility = buildIssueScopeVisibility(fileScopes, alloc);

    // The suppression should be null, not an empty object
    expect(visibility[0].suppression).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6. Edge cases
// ---------------------------------------------------------------------------

describe("Visibility edge cases", () => {
  it("summary with only suppressions and no dispatchable", () => {
    const alloc = allocation(
      [],
      [
        suppression("blocked-1", ["t1"], ["a.ts"], "blocked-1 overlaps t1"),
        suppression("blocked-2", ["t1"], ["b.ts"], "blocked-2 overlaps t1"),
      ],
    );

    const summary = buildScopeVisibilitySummary(alloc);

    expect(summary.dispatchableCount).toBe(0);
    expect(summary.suppressedCount).toBe(2);
    expect(summary.hasOverlap).toBe(true);
    expect(summary.dispatchable).toEqual([]);
  });

  it("visibility cards handle issues that are neither dispatchable nor suppressed", () => {
    // This can happen if a file scope is provided that was not part of the allocation
    const alloc = allocation(["a"], []);
    const fileScopes = new Map([
      ["a", fileScope("a", ["x.ts"])],
      ["unknown", fileScope("unknown", ["y.ts"])],
    ]);

    const visibility = buildIssueScopeVisibility(fileScopes, alloc);

    const unknownEntry = visibility.find((v) => v.issueId === "unknown");
    expect(unknownEntry).toBeDefined();
    expect(unknownEntry!.isDispatchable).toBe(false);
    expect(unknownEntry!.suppression).toBeNull();
  });

  it("suppression entry with multiple overlapping files is formatted correctly", () => {
    const entry = suppression(
      "heavy-blocker",
      ["t1", "t2", "t3"],
      ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "f.ts"],
      "Issue heavy-blocker suppressed: overlaps with t1, t2, t3 on 6 files: a.ts, b.ts, c.ts, d.ts, e.ts, +1 more",
    );

    const formatted = formatSuppressionEntry(entry);

    expect(formatted).toContain("heavy-blocker");
    expect(formatted).toContain("6 files");
  });
});

// ---------------------------------------------------------------------------
// 7. JSON serializability for SSE transport
// ---------------------------------------------------------------------------

describe("Visibility JSON serializability", () => {
  it("summary card round-trips through JSON.stringify/parse", () => {
    const alloc = allocation(
      ["safe-1"],
      [suppression("blocked-1", ["t1"], ["shared.ts"], "test reason")],
    );

    const summary = buildScopeVisibilitySummary(alloc);
    const json = JSON.stringify(summary);
    const parsed = JSON.parse(json) as ScopeVisibilitySummary;

    expect(parsed.dispatchableCount).toBe(1);
    expect(parsed.suppressedCount).toBe(1);
    expect(parsed.hasOverlap).toBe(true);
    expect(parsed.dispatchable).toEqual(["safe-1"]);
    expect(parsed.suppressions[0].issueId).toBe("blocked-1");
  });

  it("issue visibility cards round-trip through JSON.stringify/parse", () => {
    const alloc = allocation(
      ["a"],
      [suppression("b", ["a"], ["x.ts"], "b overlaps a")],
    );
    const fileScopes = new Map([
      ["a", fileScope("a", ["x.ts"])],
      ["b", fileScope("b", ["x.ts"])],
    ]);

    const visibility = buildIssueScopeVisibility(fileScopes, alloc);
    const json = JSON.stringify(visibility);
    const parsed = JSON.parse(json) as IssueScopeVisibility[];

    expect(parsed).toHaveLength(2);
    const aEntry = parsed.find((v) => v.issueId === "a");
    const bEntry = parsed.find((v) => v.issueId === "b");
    expect(aEntry!.isDispatchable).toBe(true);
    expect(bEntry!.isDispatchable).toBe(false);
    expect(bEntry!.suppression!.reason).toBe("b overlaps a");
  });
});
