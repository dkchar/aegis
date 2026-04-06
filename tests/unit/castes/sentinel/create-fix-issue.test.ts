/**
 * S09A lane A — Fix issue creation unit tests.
 *
 * Tests the convert-from-verdict-to-fix-issues logic in create-fix-issue.ts.
 */

import { describe, expect, it } from "vitest";

import {
  sentinelFixDescription,
  createFixIssueInputs,
} from "../../../../src/tracker/create-fix-issue.js";
import type { SentinelVerdict } from "../../../../src/castes/sentinel/sentinel-parser.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeVerdict(
  overrides: Partial<SentinelVerdict> = {},
): SentinelVerdict {
  return {
    verdict: "fail",
    reviewSummary: "Issues found during review",
    issuesFound: ["Missing null check", "No test coverage"],
    followUpIssueIds: [],
    riskAreas: ["Error handling"],
    ...overrides,
  };
}

function makeOriginIssue(
  overrides: Partial<{ id: string; priority: 1 | 2 | 3 | 4 | 5 }> = {},
) {
  return {
    id: "aegis-fjm.10",
    priority: 1 as const,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// sentinelFixDescription
// ---------------------------------------------------------------------------

describe("sentinelFixDescription", () => {
  it("includes the origin issue ID", () => {
    const desc = sentinelFixDescription("aegis-fjm.10", "sentinel-verdict-abc", "Summary", []);

    expect(desc).toContain("aegis-fjm.10");
  });

  it("includes the verdict reference", () => {
    const desc = sentinelFixDescription("aegis-fjm.10", "sentinel-verdict-abc", "Summary", []);

    expect(desc).toContain("sentinel-verdict-abc");
  });

  it("mentions corrective work", () => {
    const desc = sentinelFixDescription("aegis-fjm.10", "sentinel-verdict-abc", "Summary", []);

    expect(desc).toMatch(/corrective work/i);
  });

  it("mentions Sentinel review", () => {
    const desc = sentinelFixDescription("aegis-fjm.10", "sentinel-verdict-abc", "Summary", []);

    expect(desc).toMatch(/sentinel/i);
  });

  it("includes review summary", () => {
    const desc = sentinelFixDescription("aegis-fjm.10", "sentinel-verdict-abc", "Critical defect", []);

    expect(desc).toContain("Critical defect");
  });

  it("includes risk areas when provided", () => {
    const desc = sentinelFixDescription("aegis-fjm.10", "sentinel-verdict-abc", "Summary", ["Risk A", "Risk B"]);

    expect(desc).toContain("Risk A");
    expect(desc).toContain("Risk B");
  });

  it("omits risk areas section when empty", () => {
    const desc = sentinelFixDescription("aegis-fjm.10", "sentinel-verdict-abc", "Summary", []);

    expect(desc).not.toContain("Risk areas flagged");
  });
});

// ---------------------------------------------------------------------------
// createFixIssueInputs
// ---------------------------------------------------------------------------

describe("createFixIssueInputs", () => {
  it("returns empty array for a pass verdict", () => {
    const inputs = createFixIssueInputs(makeOriginIssue(), makeVerdict({ verdict: "pass", issuesFound: [] }));

    expect(inputs).toEqual([]);
  });

  it("returns empty array for a fail verdict with no issuesFound", () => {
    const inputs = createFixIssueInputs(makeOriginIssue(), makeVerdict({ issuesFound: [] }));

    expect(inputs).toEqual([]);
  });

  it("creates one fix input per issue found", () => {
    const verdict = makeVerdict({
      issuesFound: ["Issue one", "Issue two", "Issue three"],
    });

    const inputs = createFixIssueInputs(makeOriginIssue(), verdict);

    expect(inputs.length).toBe(3);
  });

  it("prefixes each title with Fix:", () => {
    const verdict = makeVerdict({
      issuesFound: ["Missing null check"],
    });

    const inputs = createFixIssueInputs(makeOriginIssue(), verdict);

    expect(inputs[0].title).toBe("Fix: Missing null check");
  });

  it("sets issueClass to fix", () => {
    const inputs = createFixIssueInputs(makeOriginIssue(), makeVerdict());

    expect(inputs[0].issueClass).toBe("fix");
  });

  it("inherits priority from the origin issue", () => {
    const inputs = createFixIssueInputs(
      makeOriginIssue({ id: "aegis-fjm.5", priority: 3 }),
      makeVerdict(),
    );

    expect(inputs[0].priority).toBe(3);
  });

  it("sets originId to the origin issue id", () => {
    const inputs = createFixIssueInputs(
      makeOriginIssue({ id: "aegis-fjm.42" }),
      makeVerdict(),
    );

    expect(inputs[0].originId).toBe("aegis-fjm.42");
  });

  it("includes sentinel-fix label", () => {
    const inputs = createFixIssueInputs(makeOriginIssue(), makeVerdict());

    expect(inputs[0].labels).toContain("sentinel-fix");
  });

  it("includes the origin issue in the description", () => {
    const inputs = createFixIssueInputs(
      makeOriginIssue({ id: "aegis-fjm.7" }),
      makeVerdict(),
    );

    expect(inputs[0].description).toContain("aegis-fjm.7");
  });

  it("includes the verdict reference in the description", () => {
    const inputs = createFixIssueInputs(
      makeOriginIssue({ id: "aegis-fjm.7" }),
      makeVerdict(),
    );

    expect(inputs[0].description).toContain("sentinel-verdict-aegis-fjm.7");
  });

  it("includes review summary in the description for context", () => {
    const verdict = makeVerdict({
      reviewSummary: "Critical defect in merge logic",
      issuesFound: ["Broken merge"],
    });

    const inputs = createFixIssueInputs(makeOriginIssue(), verdict);

    expect(inputs[0].description).toContain("Critical defect in merge logic");
  });

  it("includes risk areas in the description for context", () => {
    const verdict = makeVerdict({
      issuesFound: ["Missing test"],
      riskAreas: ["Merge queue edge cases", "Error boundary"],
    });

    const inputs = createFixIssueInputs(makeOriginIssue(), verdict);

    expect(inputs[0].description).toContain("Merge queue edge cases");
    expect(inputs[0].description).toContain("Error boundary");
  });

  it("produces distinct descriptions for each fix issue", () => {
    const verdict = makeVerdict({
      issuesFound: ["Issue A", "Issue B"],
    });

    const inputs = createFixIssueInputs(makeOriginIssue(), verdict);

    expect(inputs[0].title).toBe("Fix: Issue A");
    expect(inputs[1].title).toBe("Fix: Issue B");
  });

  it("handles multiple fix issues with correct fields", () => {
    const verdict = makeVerdict({
      issuesFound: ["First issue", "Second issue"],
    });

    const inputs = createFixIssueInputs(makeOriginIssue(), verdict);

    expect(inputs.length).toBe(2);
    for (const input of inputs) {
      expect(input.issueClass).toBe("fix");
      expect(input.priority).toBe(1);
      expect(input.originId).toBe("aegis-fjm.10");
      expect(input.labels).toContain("sentinel-fix");
    }
  });
});
