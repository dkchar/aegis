import { describe, expect, it } from "vitest";

import { parseTitanArtifact } from "../../../src/castes/titan/titan-parser.js";

describe("parseTitanArtifact", () => {
  it("parses a valid titan success artifact", () => {
    expect(
      parseTitanArtifact(JSON.stringify({
        outcome: "success",
        summary: "done",
        files_changed: ["src/index.ts"],
        tests_and_checks_run: ["npm test"],
        known_risks: [],
        follow_up_work: [],
        learnings_written_to_mnemosyne: [],
      })),
    ).toMatchObject({
      outcome: "success",
      summary: "done",
      files_changed: ["src/index.ts"],
    });
  });

  it("parses a blocking mutation proposal", () => {
    expect(
      parseTitanArtifact(JSON.stringify({
        outcome: "clarification",
        summary: "needs product answer",
        files_changed: [],
        tests_and_checks_run: [],
        known_risks: ["blocked on ambiguity"],
        follow_up_work: [],
        learnings_written_to_mnemosyne: [],
        mutation_proposal: {
          proposal_type: "create_clarification_blocker",
          summary: "Need acceptance rule.",
          suggested_title: "Clarify acceptance rule",
          suggested_description: "Parent cannot proceed until acceptance rule is explicit.",
          scope_evidence: ["Issue asks for policy but omits gate condition."],
        },
      })),
    ).toMatchObject({
      outcome: "clarification",
      mutation_proposal: {
        proposal_type: "create_clarification_blocker",
        suggested_title: "Clarify acceptance rule",
      },
    });
  });

  it("rejects non-blocking follow-up creation authority", () => {
    expect(() =>
      parseTitanArtifact(JSON.stringify({
        outcome: "success",
        summary: "done",
        files_changed: [],
        tests_and_checks_run: [],
        known_risks: [],
        follow_up_work: [],
        learnings_written_to_mnemosyne: [],
        mutation_proposal: {
          proposal_type: "create_follow_up",
          summary: "nice to have cleanup",
          suggested_title: "Cleanup",
          suggested_description: "Non-blocking cleanup.",
          scope_evidence: ["Observed while editing."],
        },
      })),
    ).toThrow(/proposal_type/i);
  });

  it("rejects unexpected keys", () => {
    expect(() =>
      parseTitanArtifact(JSON.stringify({
        outcome: "success",
        summary: "done",
        files_changed: [],
        tests_and_checks_run: [],
        known_risks: [],
        follow_up_work: [],
        learnings_written_to_mnemosyne: [],
        extra: true,
      })),
    ).toThrow(/unexpected keys/i);
  });
});
