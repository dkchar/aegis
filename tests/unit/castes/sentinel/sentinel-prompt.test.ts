/**
 * S09A lane A — Sentinel prompt unit tests.
 *
 * Tests the prompt construction contract from sentinel-prompt.ts,
 * following the patterns established by Oracle and Titan prompt tests.
 */

import { describe, expect, it } from "vitest";

import {
  buildSentinelPrompt,
  createSentinelPromptContract,
  SENTINEL_PROMPT_SECTIONS,
  SENTINEL_PROMPT_RULES,
} from "../../../../src/castes/sentinel/sentinel-prompt.js";

describe("createSentinelPromptContract", () => {
  it("returns a contract with all context fields", () => {
    const contract = createSentinelPromptContract({
      issueId: "aegis-fjm.10",
      issueTitle: "Add dispatch reconciliation",
      issueDescription: "Implement reconcileDispatchState",
      targetBranch: "main",
      baseBranch: "main",
    });

    expect(contract.issueId).toBe("aegis-fjm.10");
    expect(contract.issueTitle).toBe("Add dispatch reconciliation");
    expect(contract.issueDescription).toBe("Implement reconcileDispatchState");
    expect(contract.targetBranch).toBe("main");
    expect(contract.baseBranch).toBe("main");
  });

  it("includes the canonical sections array", () => {
    const contract = createSentinelPromptContract({
      issueId: "aegis-fjm.1",
      issueTitle: "Test",
      issueDescription: null,
      targetBranch: "main",
      baseBranch: "main",
    });

    expect(contract.sections).toEqual(SENTINEL_PROMPT_SECTIONS);
  });

  it("includes the canonical rules array", () => {
    const contract = createSentinelPromptContract({
      issueId: "aegis-fjm.1",
      issueTitle: "Test",
      issueDescription: null,
      targetBranch: "main",
      baseBranch: "main",
    });

    expect(contract.rules).toEqual(SENTINEL_PROMPT_RULES);
  });
});

describe("buildSentinelPrompt", () => {
  it("produces a non-empty string", () => {
    const contract = createSentinelPromptContract({
      issueId: "aegis-fjm.1",
      issueTitle: "Test",
      issueDescription: null,
      targetBranch: "main",
      baseBranch: "main",
    });

    const prompt = buildSentinelPrompt(contract);

    expect(prompt).toBeDefined();
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(0);
  });

  it("identifies the agent as Sentinel", () => {
    const contract = createSentinelPromptContract({
      issueId: "aegis-fjm.1",
      issueTitle: "Test",
      issueDescription: null,
      targetBranch: "main",
      baseBranch: "main",
    });

    const prompt = buildSentinelPrompt(contract);

    expect(prompt).toContain("You are Sentinel");
  });

  it("includes the issue ID in the prompt", () => {
    const contract = createSentinelPromptContract({
      issueId: "aegis-fjm.42",
      issueTitle: "Test",
      issueDescription: null,
      targetBranch: "main",
      baseBranch: "main",
    });

    const prompt = buildSentinelPrompt(contract);

    expect(prompt).toContain("aegis-fjm.42");
  });

  it("includes the issue title in the prompt", () => {
    const contract = createSentinelPromptContract({
      issueId: "aegis-fjm.1",
      issueTitle: "Implement feature X",
      issueDescription: null,
      targetBranch: "main",
      baseBranch: "main",
    });

    const prompt = buildSentinelPrompt(contract);

    expect(prompt).toContain("Implement feature X");
  });

  it("renders null description as (none)", () => {
    const contract = createSentinelPromptContract({
      issueId: "aegis-fjm.1",
      issueTitle: "Test",
      issueDescription: null,
      targetBranch: "main",
      baseBranch: "main",
    });

    const prompt = buildSentinelPrompt(contract);

    expect(prompt).toContain("Description: (none)");
  });

  it("includes the actual description when provided", () => {
    const contract = createSentinelPromptContract({
      issueId: "aegis-fjm.1",
      issueTitle: "Test",
      issueDescription: "A detailed description of the work",
      targetBranch: "main",
      baseBranch: "main",
    });

    const prompt = buildSentinelPrompt(contract);

    expect(prompt).toContain("A detailed description of the work");
  });

  it("includes target branch and base branch", () => {
    const contract = createSentinelPromptContract({
      issueId: "aegis-fjm.1",
      issueTitle: "Test",
      issueDescription: null,
      targetBranch: "main",
      baseBranch: "develop",
    });

    const prompt = buildSentinelPrompt(contract);

    expect(prompt).toContain("Target branch: main");
    expect(prompt).toContain("Base branch: develop");
  });

  it("lists all prompt sections", () => {
    const contract = createSentinelPromptContract({
      issueId: "aegis-fjm.1",
      issueTitle: "Test",
      issueDescription: null,
      targetBranch: "main",
      baseBranch: "main",
    });

    const prompt = buildSentinelPrompt(contract);

    for (const section of SENTINEL_PROMPT_SECTIONS) {
      expect(prompt).toContain(section);
    }
  });

  it("lists all prompt rules", () => {
    const contract = createSentinelPromptContract({
      issueId: "aegis-fjm.1",
      issueTitle: "Test",
      issueDescription: null,
      targetBranch: "main",
      baseBranch: "main",
    });

    const prompt = buildSentinelPrompt(contract);

    for (const rule of SENTINEL_PROMPT_RULES) {
      expect(prompt).toContain(rule);
    }
  });

  it("specifies the required JSON output keys", () => {
    const contract = createSentinelPromptContract({
      issueId: "aegis-fjm.1",
      issueTitle: "Test",
      issueDescription: null,
      targetBranch: "main",
      baseBranch: "main",
    });

    const prompt = buildSentinelPrompt(contract);

    expect(prompt).toContain("verdict");
    expect(prompt).toContain("reviewSummary");
    expect(prompt).toContain("issuesFound");
    expect(prompt).toContain("followUpIssueIds");
    expect(prompt).toContain("riskAreas");
  });

  it("specifies that verdict must be pass or fail", () => {
    const contract = createSentinelPromptContract({
      issueId: "aegis-fjm.1",
      issueTitle: "Test",
      issueDescription: null,
      targetBranch: "main",
      baseBranch: "main",
    });

    const prompt = buildSentinelPrompt(contract);

    expect(prompt).toContain("pass");
    expect(prompt).toContain("fail");
  });

  it("instructs to return only JSON", () => {
    const contract = createSentinelPromptContract({
      issueId: "aegis-fjm.1",
      issueTitle: "Test",
      issueDescription: null,
      targetBranch: "main",
      baseBranch: "main",
    });

    const prompt = buildSentinelPrompt(contract);

    expect(prompt.toLowerCase()).toContain("json");
  });

  it("uses newline separators between sections", () => {
    const contract = createSentinelPromptContract({
      issueId: "aegis-fjm.1",
      issueTitle: "Test",
      issueDescription: null,
      targetBranch: "main",
      baseBranch: "main",
    });

    const prompt = buildSentinelPrompt(contract);

    expect(prompt).toContain("\n");
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

  it("includes follow-up issue creation rule for fail verdicts", () => {
    const contract = createSentinelPromptContract({
      issueId: "aegis-fjm.1",
      issueTitle: "Test",
      issueDescription: null,
      targetBranch: "main",
      baseBranch: "main",
    });

    const prompt = buildSentinelPrompt(contract);

    expect(prompt).toMatch(/follow.?up/i);
  });
});
