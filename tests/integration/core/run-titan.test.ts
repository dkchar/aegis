import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  TITAN_PROMPT_RULES,
  TITAN_PROMPT_SECTIONS,
  createTitanPromptContract,
} from "../../../src/castes/titan/titan-prompt.js";
import {
  TITAN_RUN_LIFECYCLE_RULES,
  createTitanRunContract,
} from "../../../src/core/run-titan.js";

describe("S09 Titan contract seed", () => {
  it("pins the Titan prompt sections and rules around labor isolation and clarification", () => {
    const projectRoot = path.resolve("C:/dev/aegis");
    const laborPath = path.join(projectRoot, ".aegis", "labors", "labor-aegis-fjm.10.1");

    expect(
      createTitanPromptContract({
        issueId: "aegis-fjm.10.1",
        issueTitle: "[S09] Contract seed",
        issueDescription: "Seed the Titan contract surface.",
        laborPath,
        branchName: "aegis/aegis-fjm.10.1",
        baseBranch: "main",
      }),
    ).toEqual({
      issueId: "aegis-fjm.10.1",
      issueTitle: "[S09] Contract seed",
      issueDescription: "Seed the Titan contract surface.",
      laborPath,
      branchName: "aegis/aegis-fjm.10.1",
      baseBranch: "main",
      sections: TITAN_PROMPT_SECTIONS,
      rules: TITAN_PROMPT_RULES,
    });

    expect(TITAN_PROMPT_SECTIONS).toEqual([
      "issue_context",
      "labor_boundary",
      "handoff_requirements",
      "clarification_rule",
    ]);
    expect(TITAN_PROMPT_RULES).toEqual([
      "write only inside the labor",
      "produce a structured handoff artifact",
      "create a clarification issue instead of guessing",
      "preserve the labor on failure or ambiguity",
    ]);
  });

  it("defines the Titan run contract with handoff and clarification artifact shapes", () => {
    const contract = createTitanRunContract({
      issueId: "aegis-fjm.10.1",
      issueTitle: "[S09] Contract seed",
      issueDescription: "Seed the Titan contract surface.",
      laborPath: path.join("C:/dev/aegis", ".aegis", "labors", "labor-aegis-fjm.10.1"),
      branchName: "aegis/aegis-fjm.10.1",
      baseBranch: "main",
    });

    expect(contract.lifecycleRules).toEqual(TITAN_RUN_LIFECYCLE_RULES);
    expect(contract.handoffArtifact).toEqual({
      issueId: "aegis-fjm.10.1",
      laborPath: path.join("C:/dev/aegis", ".aegis", "labors", "labor-aegis-fjm.10.1"),
      candidateBranch: "aegis/aegis-fjm.10.1",
      baseBranch: "main",
      filesChanged: [],
      testsAndChecksRun: [],
      knownRisks: [],
      followUpWork: [],
      learningsWrittenToMnemosyne: [],
    });
    expect(contract.clarificationArtifact).toEqual({
      originalIssueId: "aegis-fjm.10.1",
      issueTitle: "[S09] Contract seed",
      laborPath: path.join("C:/dev/aegis", ".aegis", "labors", "labor-aegis-fjm.10.1"),
      candidateBranch: "aegis/aegis-fjm.10.1",
      baseBranch: "main",
      blockingQuestion: "",
      handoffNote: "",
      preserveLabor: true,
      linkedClarificationIssueId: null,
    });
  });

  it("keeps Titan lifecycle rules explicit for success, clarification, and failure outcomes", () => {
    expect(TITAN_RUN_LIFECYCLE_RULES).toEqual({
      success: {
        outcome: "success",
        retainLabor: true,
        emitHandoffArtifact: true,
        emitClarificationArtifact: false,
      },
      clarification: {
        outcome: "clarification",
        retainLabor: true,
        emitHandoffArtifact: true,
        emitClarificationArtifact: true,
      },
      failure: {
        outcome: "failure",
        retainLabor: true,
        emitHandoffArtifact: true,
        emitClarificationArtifact: false,
      },
    });
  });
});
