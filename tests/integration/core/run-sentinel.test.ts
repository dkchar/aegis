/**
 * S09A contract seed — Sentinel integration test scaffold.
 *
 * This file provides the test scaffolding for the Sentinel review pipeline.
 * Lane B will implement the actual run-sentinel.ts dispatch logic and fill
 * in these tests with concrete integration scenarios.
 *
 * The contract seed establishes the test file location and the expected test
 * shape so the gate command in the tracker can be satisfied once lanes complete.
 */

import { describe, expect, it } from "vitest";

import {
  parseSentinelVerdict,
  type SentinelVerdict,
} from "../../../src/castes/sentinel/sentinel-parser.js";
import {
  buildSentinelPrompt,
  createSentinelPromptContract,
} from "../../../src/castes/sentinel/sentinel-prompt.js";
import {
  createFixIssueInputs,
} from "../../../src/tracker/create-fix-issue.js";
import type { AegisIssue } from "../../../src/tracker/issue-model.js";

function makeIssue(overrides: Partial<AegisIssue> = {}): AegisIssue {
  return {
    id: "aegis-fjm.1",
    title: "Test issue for Sentinel review",
    description: "An issue that has been merged and needs review.",
    issueClass: "primary",
    status: "open",
    priority: 1,
    blockers: [],
    parentId: null,
    childIds: [],
    labels: ["mvp", "phase1", "s09a"],
    createdAt: "2026-04-03T01:07:43Z",
    updatedAt: "2026-04-06T17:00:00Z",
    ...overrides,
  };
}

describe("Sentinel integration scaffold", () => {
  describe("prompt construction", () => {
    it("builds a valid Sentinel prompt from a contract", () => {
      const contract = createSentinelPromptContract({
        issueId: "aegis-fjm.1",
        issueTitle: "Test issue",
        issueDescription: "Test description",
        targetBranch: "main",
        baseBranch: "main",
      });

      const prompt = buildSentinelPrompt(contract);

      expect(prompt).toContain("You are Sentinel");
      expect(prompt).toContain("Issue ID: aegis-fjm.1");
      expect(prompt).toContain("Title: Test issue");
      expect(prompt).toContain("Target branch: main");
      expect(prompt).toContain("verdict");
      expect(prompt).toContain("reviewSummary");
      expect(prompt).toContain("issuesFound");
      expect(prompt).toContain("followUpIssueIds");
      expect(prompt).toContain("riskAreas");
    });

    it("handles null issueDescription gracefully", () => {
      const contract = createSentinelPromptContract({
        issueId: "aegis-fjm.2",
        issueTitle: "No description",
        issueDescription: null,
        targetBranch: "main",
        baseBranch: "develop",
      });

      const prompt = buildSentinelPrompt(contract);

      expect(prompt).toContain("Description: (none)");
      expect(prompt).toContain("Base branch: develop");
    });

    it("includes read-only tool constraint", () => {
      const contract = createSentinelPromptContract({
        issueId: "aegis-fjm.1",
        issueTitle: "Test",
        issueDescription: null,
        targetBranch: "main",
        baseBranch: "main",
      });

      const prompt = buildSentinelPrompt(contract);

      expect(prompt).toMatch(/read.only/i);
    });
  });

  describe("verdict parsing integration", () => {
    it("parses a realistic pass verdict from a simulated Sentinel response", () => {
      const simulatedResponse = JSON.stringify({
        verdict: "pass",
        reviewSummary: "All changes look good. Code follows conventions.",
        issuesFound: [],
        followUpIssueIds: [],
        riskAreas: ["Consider adding integration tests for the new dispatch flow"],
      });

      const verdict = parseSentinelVerdict(simulatedResponse);

      expect(verdict.verdict).toBe("pass");
      expect(verdict.reviewSummary).toContain("All changes look good");
      expect(verdict.issuesFound).toEqual([]);
      expect(verdict.followUpIssueIds).toEqual([]);
      expect(verdict.riskAreas.length).toBeGreaterThan(0);
    });

    it("parses a realistic fail verdict from a simulated Sentinel response", () => {
      const simulatedResponse = JSON.stringify({
        verdict: "fail",
        reviewSummary: "Critical issues found in the merge handling logic.",
        issuesFound: [
          "Missing error handling in dispatch-state reconciliation",
          "No test coverage for concurrent merge attempts",
        ],
        followUpIssueIds: [],
        riskAreas: ["Dispatch state persistence", "Merge queue edge cases"],
      });

      const verdict = parseSentinelVerdict(simulatedResponse);

      expect(verdict.verdict).toBe("fail");
      expect(verdict.issuesFound.length).toBe(2);
      expect(verdict.riskAreas.length).toBe(2);
    });
  });

  describe("fix issue creation integration", () => {
    it("creates fix issue inputs from a fail verdict", () => {
      const verdict: SentinelVerdict = {
        verdict: "fail",
        reviewSummary: "Issues found",
        issuesFound: [
          "Missing error handling",
          "No test coverage",
        ],
        followUpIssueIds: [],
        riskAreas: ["Error handling"],
      };

      const inputs = createFixIssueInputs(makeIssue(), verdict);

      expect(inputs.length).toBe(2);
      expect(inputs[0].title).toBe("Fix: Missing error handling");
      expect(inputs[0].issueClass).toBe("fix");
      expect(inputs[0].originId).toBe("aegis-fjm.1");
      expect(inputs[0].labels).toContain("sentinel-fix");
    });

    it("returns empty array for a pass verdict", () => {
      const verdict: SentinelVerdict = {
        verdict: "pass",
        reviewSummary: "All good",
        issuesFound: [],
        followUpIssueIds: [],
        riskAreas: [],
      };

      const inputs = createFixIssueInputs(makeIssue(), verdict);

      expect(inputs).toEqual([]);
    });

    it("returns empty array for a fail verdict with no issuesFound", () => {
      const verdict: SentinelVerdict = {
        verdict: "fail",
        reviewSummary: "Vague failure without specifics",
        issuesFound: [],
        followUpIssueIds: [],
        riskAreas: [],
      };

      const inputs = createFixIssueInputs(makeIssue(), verdict);

      expect(inputs).toEqual([]);
    });
  });
});
