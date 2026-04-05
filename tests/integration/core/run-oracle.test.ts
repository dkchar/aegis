/**
 * S08 contract seed - Oracle orchestration contract tests.
 *
 * These tests lock the prompt shape, strict parsing flow, complexity pause
 * signal, and derived-issue scaffolding that lane B will wire into the tracker.
 */

import { describe, expect, it, vi } from "vitest";

import type { AegisIssue } from "../../../src/tracker/issue-model.js";
import { runOracle } from "../../../src/core/run-oracle.js";
import { buildOraclePrompt } from "../../../src/castes/oracle/oracle-prompt.js";
import { createDerivedIssueInputs } from "../../../src/tracker/create-derived-issues.js";

function makeIssue(overrides: Partial<AegisIssue> = {}): AegisIssue {
  return {
    id: "aegis-fjm.9",
    title: "[S08] Oracle Scouting Pipeline",
    description: "Implement Oracle scouting and assessment.",
    issueClass: "primary",
    status: "open",
    priority: 1,
    blockers: [],
    parentId: null,
    childIds: [],
    labels: ["mvp", "phase1", "s08"],
    createdAt: "2026-04-03T01:07:43Z",
    updatedAt: "2026-04-05T19:06:42Z",
    ...overrides,
  };
}

describe("buildOraclePrompt", () => {
  it("includes the issue context and the strict OracleAssessment contract", () => {
    const prompt = buildOraclePrompt(makeIssue());

    expect(prompt).toContain("aegis-fjm.9");
    expect(prompt).toContain("[S08] Oracle Scouting Pipeline");
    expect(prompt).toContain("files_affected");
    expect(prompt).toContain("estimated_complexity");
    expect(prompt).toContain("decompose");
    expect(prompt).toContain("ready");
    expect(prompt.toLowerCase()).toContain("no file modifications");
    expect(prompt.toLowerCase()).toContain("return only json");
  });
});

describe("createDerivedIssueInputs", () => {
  it("maps assessment sub_issues to Beads issue creation inputs that link back to the origin issue", () => {
    const assessment = {
      files_affected: ["src/core/run-oracle.ts"],
      estimated_complexity: "complex" as const,
      decompose: true,
      sub_issues: ["Split prompt construction", "Add strict parser"],
      blockers: ["src/core/run-oracle.ts"],
      ready: false,
    };

    const result = createDerivedIssueInputs(makeIssue(), assessment);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(
      expect.objectContaining({
        title: "Split prompt construction",
        description: expect.stringContaining("aegis-fjm.9"),
        issueClass: "sub",
        originId: "aegis-fjm.9",
        priority: 1,
        labels: [],
      }),
    );
    expect(result[1].originId).toBe("aegis-fjm.9");
  });

  it("returns no derived issues when decompose is false", () => {
    const assessment = {
      files_affected: ["src/core/run-oracle.ts"],
      estimated_complexity: "moderate" as const,
      decompose: false,
      ready: true,
    };

    expect(createDerivedIssueInputs(makeIssue(), assessment)).toEqual([]);
  });

  it("fails closed when decompose=true arrives without usable sub_issues", () => {
    expect(() =>
      createDerivedIssueInputs(makeIssue(), {
        files_affected: ["src/core/run-oracle.ts"],
        estimated_complexity: "complex",
        decompose: true,
        ready: false,
      }),
    ).toThrow(/sub_issues/i);
  });
});

describe("runOracle", () => {
  it("parses the Oracle reply, surfaces the prompt, and marks complex assessments for the complexity gate", async () => {
    const issue = makeIssue();
    const assessment = {
      files_affected: ["src/core/run-oracle.ts", "src/tracker/create-derived-issues.ts"],
      estimated_complexity: "complex" as const,
      decompose: true,
      sub_issues: ["Split prompt", "Add linker"],
      blockers: ["src/tracker/create-derived-issues.ts"],
      ready: false,
    };

    const askOracle = vi.fn(async (prompt: string) => {
      expect(prompt).toContain(issue.id);
      return JSON.stringify(assessment);
    });

    const result = await runOracle({ issue, askOracle });

    expect(askOracle).toHaveBeenCalledTimes(1);
    expect(result.prompt).toContain(issue.title);
    expect(result.assessment).toEqual(assessment);
    expect(result.requiresComplexityGate).toBe(true);
    expect(result.derivedIssues).toHaveLength(2);
    expect(result.derivedIssues[0]).toEqual(
      expect.objectContaining({
        originId: issue.id,
        issueClass: "sub",
      }),
    );
  });

  it("passes through non-complex assessments without the approval flag", async () => {
    const issue = makeIssue();
    const assessment = {
      files_affected: ["src/core/run-oracle.ts"],
      estimated_complexity: "moderate" as const,
      decompose: false,
      ready: true,
    };

    const result = await runOracle({
      issue,
      askOracle: async () => JSON.stringify(assessment),
    });

    expect(result.assessment).toEqual(assessment);
    expect(result.requiresComplexityGate).toBe(false);
    expect(result.derivedIssues).toEqual([]);
  });

  it("fails fast on malformed Oracle output", async () => {
    await expect(
      runOracle({
        issue: makeIssue(),
        askOracle: async () => "{ nope }",
      }),
    ).rejects.toThrow(/JSON/i);
  });

  it("rejects malformed decomposition output instead of failing open", async () => {
    await expect(
      runOracle({
        issue: makeIssue(),
        askOracle: async () =>
          JSON.stringify({
            files_affected: ["src/core/run-oracle.ts"],
            estimated_complexity: "complex",
            decompose: true,
            ready: false,
          }),
      }),
    ).rejects.toThrow(/sub_issues/i);
  });
});
