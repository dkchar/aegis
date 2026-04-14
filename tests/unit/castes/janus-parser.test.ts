import { describe, expect, it } from "vitest";

import { parseJanusResolutionArtifact } from "../../../src/castes/janus/janus-parser.js";

describe("parseJanusResolutionArtifact", () => {
  it("parses a valid janus artifact", () => {
    expect(
      parseJanusResolutionArtifact(JSON.stringify({
        originatingIssueId: "aegis-123",
        queueItemId: "queue-1",
        preservedLaborPath: "C:/repo/.aegis/labors/labor-aegis-123",
        conflictSummary: "resolved",
        resolutionStrategy: "rebase then keep target changes",
        filesTouched: ["src/index.ts"],
        validationsRun: ["npm test"],
        residualRisks: [],
        recommendedNextAction: "requeue",
      })),
    ).toMatchObject({
      originatingIssueId: "aegis-123",
      recommendedNextAction: "requeue",
    });
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
        recommendedNextAction: "requeue",
        extra: true,
      })),
    ).toThrow(/unexpected field/i);
  });
});
