import { describe, expect, it } from "vitest";

import { parseJanusResolutionArtifact } from "../../../src/castes/janus/janus-parser.js";

describe("parseJanusResolutionArtifact", () => {
  it("parses a valid janus artifact", () => {
    expect(
      parseJanusResolutionArtifact(JSON.stringify({
        originatingIssueId: "aegis-123",
        queueItemId: "queue-1",
        preservedLaborPath: ".aegis/labors/labor-aegis-123",
        conflictSummary: "resolved",
        resolutionStrategy: "rebase then keep target changes",
        filesTouched: ["src/index.ts"],
        validationsRun: ["npm test"],
        residualRisks: [],
        mutation_proposal: {
          proposal_type: "requeue_parent",
          summary: "Conflict remains in parent scope.",
          scope_evidence: ["Only touched parent implementation files."],
        },
      })),
    ).toMatchObject({
      originatingIssueId: "aegis-123",
      mutation_proposal: {
        proposal_type: "requeue_parent",
      },
    });
  });

  it("parses integration blocker mutation proposal", () => {
    expect(
      parseJanusResolutionArtifact(JSON.stringify({
        originatingIssueId: "aegis-123",
        queueItemId: "queue-1",
        preservedLaborPath: ".aegis/labors/labor-aegis-123",
        conflictSummary: "external migration conflict",
        resolutionStrategy: "block parent on migration",
        filesTouched: ["migrations/001.sql"],
        validationsRun: [],
        residualRisks: ["parent cannot merge until migration order fixed"],
        mutation_proposal: {
          proposal_type: "create_integration_blocker",
          summary: "Migration order conflict outside parent scope.",
          suggested_title: "Fix migration order conflict",
          suggested_description: "Resolve external migration ordering before parent can merge.",
          scope_evidence: ["Conflict is in migration not touched by parent branch."],
        },
      })),
    ).toMatchObject({
      mutation_proposal: {
        proposal_type: "create_integration_blocker",
        suggested_title: "Fix migration order conflict",
      },
    });
  });

  it("rejects old recommendedNextAction control field", () => {
    expect(() =>
      parseJanusResolutionArtifact(JSON.stringify({
        originatingIssueId: "aegis-123",
        queueItemId: "queue-1",
        preservedLaborPath: "labor",
        conflictSummary: "resolved",
        resolutionStrategy: "strategy",
        filesTouched: [],
        validationsRun: [],
        residualRisks: [],
        recommendedNextAction: "requeue",
      })),
    ).toThrow(/unexpected field/i);
  });

  it("rejects unexpected keys", () => {
    expect(() =>
      parseJanusResolutionArtifact(JSON.stringify({
        originatingIssueId: "aegis-123",
        queueItemId: "queue-1",
        preservedLaborPath: "labor",
        conflictSummary: "resolved",
        resolutionStrategy: "strategy",
        filesTouched: [],
        validationsRun: [],
        residualRisks: [],
        mutation_proposal: {
          proposal_type: "requeue_parent",
          summary: "retry parent",
          scope_evidence: ["in scope"],
        },
        extra: true,
      })),
    ).toThrow(/unexpected field/i);
  });
});
