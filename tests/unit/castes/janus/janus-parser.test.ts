/**
 * S15B contract seed — Janus parser contract tests.
 *
 * These tests define the strict machine-parseable shape for JanusResolutionArtifact
 * from SPECv2 §10.4.1 and the failure semantics for malformed output.
 */

import { describe, expect, it } from "vitest";

import {
  JanusParseError,
  parseJanusResolutionArtifact,
} from "../../../../src/castes/janus/janus-parser.js";

function makeArtifact(overrides: Record<string, unknown> = {}) {
  return {
    originatingIssueId: "aegis-fjm.5",
    queueItemId: "aegis-fjm.5",
    preservedLaborPath: ".aegis/labors/labor-aegis-fjm.5",
    conflictSummary: "Merge conflict in src/dispatch-state.ts between main and feature branch",
    resolutionStrategy: "Manual conflict resolution preserving both sides' intent",
    filesTouched: ["src/dispatch-state.ts"],
    validationsRun: ["npm run test", "npm run lint", "npm run build"],
    residualRisks: ["Edge case in error handling not covered by tests"],
    recommendedNextAction: "requeue" as const,
    ...overrides,
  };
}

describe("parseJanusResolutionArtifact", () => {
  // -----------------------------------------------------------------------
  // Valid artifacts
  // -----------------------------------------------------------------------

  it("parses a valid minimal artifact with requeue action", () => {
    const raw = JSON.stringify(makeArtifact());

    expect(parseJanusResolutionArtifact(raw)).toEqual({
      originatingIssueId: "aegis-fjm.5",
      queueItemId: "aegis-fjm.5",
      preservedLaborPath: ".aegis/labors/labor-aegis-fjm.5",
      conflictSummary: "Merge conflict in src/dispatch-state.ts between main and feature branch",
      resolutionStrategy: "Manual conflict resolution preserving both sides' intent",
      filesTouched: ["src/dispatch-state.ts"],
      validationsRun: ["npm run test", "npm run lint", "npm run build"],
      residualRisks: ["Edge case in error handling not covered by tests"],
      recommendedNextAction: "requeue",
    });
  });

  it("parses a manual_decision recommendedNextAction", () => {
    const raw = JSON.stringify(
      makeArtifact({
        recommendedNextAction: "manual_decision",
        residualRisks: ["Semantic ambiguity in merged logic requires human review"],
      }),
    );

    const result = parseJanusResolutionArtifact(raw);
    expect(result.recommendedNextAction).toBe("manual_decision");
  });

  it("parses a fail recommendedNextAction", () => {
    const raw = JSON.stringify(
      makeArtifact({
        recommendedNextAction: "fail",
        conflictSummary: "Budget exhausted before resolution could complete",
      }),
    );

    const result = parseJanusResolutionArtifact(raw);
    expect(result.recommendedNextAction).toBe("fail");
  });

  it("parses a valid artifact with empty arrays", () => {
    const raw = JSON.stringify(
      makeArtifact({
        filesTouched: [],
        validationsRun: [],
        residualRisks: [],
      }),
    );

    const result = parseJanusResolutionArtifact(raw);
    expect(result.filesTouched).toEqual([]);
    expect(result.validationsRun).toEqual([]);
    expect(result.residualRisks).toEqual([]);
  });

  it("parses a valid artifact with multiple files touched", () => {
    const raw = JSON.stringify(
      makeArtifact({
        filesTouched: [
          "src/dispatch-state.ts",
          "src/merge/queue-worker.ts",
          "tests/unit/merge/queue-worker.test.ts",
        ],
      }),
    );

    const result = parseJanusResolutionArtifact(raw);
    expect(result.filesTouched).toHaveLength(3);
  });

  // -----------------------------------------------------------------------
  // Missing required fields
  // -----------------------------------------------------------------------

  it.each([
    ["originatingIssueId"],
    ["queueItemId"],
    ["preservedLaborPath"],
    ["conflictSummary"],
    ["resolutionStrategy"],
    ["filesTouched"],
    ["validationsRun"],
    ["residualRisks"],
    ["recommendedNextAction"],
  ])("rejects a missing required field: %s", (field) => {
    const payload: Record<string, unknown> = makeArtifact();
    delete payload[field];
    const raw = JSON.stringify(payload);

    expect(() => parseJanusResolutionArtifact(raw)).toThrow(JanusParseError);
    expect(() => parseJanusResolutionArtifact(raw)).toThrow(new RegExp(field, "i"));
  });

  // -----------------------------------------------------------------------
  // Wrong types
  // -----------------------------------------------------------------------

  it("rejects originatingIssueId as number", () => {
    const raw = JSON.stringify(makeArtifact({ originatingIssueId: 42 }));
    expect(() => parseJanusResolutionArtifact(raw)).toThrow(JanusParseError);
    expect(() => parseJanusResolutionArtifact(raw)).toThrow(/originatingIssueId/i);
  });

  it("rejects queueItemId as null", () => {
    const raw = JSON.stringify(makeArtifact({ queueItemId: null }));
    expect(() => parseJanusResolutionArtifact(raw)).toThrow(JanusParseError);
  });

  it("rejects preservedLaborPath as number", () => {
    const raw = JSON.stringify(makeArtifact({ preservedLaborPath: 123 }));
    expect(() => parseJanusResolutionArtifact(raw)).toThrow(JanusParseError);
  });

  it("rejects conflictSummary as number", () => {
    const raw = JSON.stringify(makeArtifact({ conflictSummary: 42 }));
    expect(() => parseJanusResolutionArtifact(raw)).toThrow(JanusParseError);
  });

  it("rejects resolutionStrategy as array", () => {
    const raw = JSON.stringify(makeArtifact({ resolutionStrategy: ["strategy"] }));
    expect(() => parseJanusResolutionArtifact(raw)).toThrow(JanusParseError);
  });

  it("rejects filesTouched as string", () => {
    const raw = JSON.stringify(makeArtifact({ filesTouched: "single-file.ts" }));
    expect(() => parseJanusResolutionArtifact(raw)).toThrow(JanusParseError);
    expect(() => parseJanusResolutionArtifact(raw)).toThrow(/filesTouched/i);
  });

  it("rejects validationsRun as object", () => {
    const raw = JSON.stringify(makeArtifact({ validationsRun: { test: true } }));
    expect(() => parseJanusResolutionArtifact(raw)).toThrow(JanusParseError);
  });

  it("rejects residualRisks as string", () => {
    const raw = JSON.stringify(makeArtifact({ residualRisks: "just one risk" }));
    expect(() => parseJanusResolutionArtifact(raw)).toThrow(JanusParseError);
  });

  it("rejects filesTouched with non-string items", () => {
    const raw = JSON.stringify(
      makeArtifact({ filesTouched: ["valid.ts", 42] }),
    );
    expect(() => parseJanusResolutionArtifact(raw)).toThrow(JanusParseError);
  });

  it("rejects validationsRun with non-string items", () => {
    const raw = JSON.stringify(
      makeArtifact({ validationsRun: ["npm run test", null] }),
    );
    expect(() => parseJanusResolutionArtifact(raw)).toThrow(JanusParseError);
  });

  it("rejects residualRisks with non-string items", () => {
    const raw = JSON.stringify(
      makeArtifact({ residualRisks: ["Valid risk", { nested: true }] }),
    );
    expect(() => parseJanusResolutionArtifact(raw)).toThrow(JanusParseError);
  });

  // -----------------------------------------------------------------------
  // Invalid recommendedNextAction
  // -----------------------------------------------------------------------

  it("rejects invalid recommendedNextAction: 'merge'", () => {
    const raw = JSON.stringify(makeArtifact({ recommendedNextAction: "merge" }));
    expect(() => parseJanusResolutionArtifact(raw)).toThrow(JanusParseError);
    expect(() => parseJanusResolutionArtifact(raw)).toThrow(/recommendedNextAction/i);
  });

  it("rejects invalid recommendedNextAction: 'retry'", () => {
    const raw = JSON.stringify(makeArtifact({ recommendedNextAction: "retry" }));
    expect(() => parseJanusResolutionArtifact(raw)).toThrow(JanusParseError);
  });

  it("rejects invalid recommendedNextAction: number", () => {
    const raw = JSON.stringify(makeArtifact({ recommendedNextAction: 1 }));
    expect(() => parseJanusResolutionArtifact(raw)).toThrow(JanusParseError);
  });

  it("rejects invalid recommendedNextAction: null", () => {
    const raw = JSON.stringify(makeArtifact({ recommendedNextAction: null }));
    expect(() => parseJanusResolutionArtifact(raw)).toThrow(JanusParseError);
  });

  // -----------------------------------------------------------------------
  // Extra keys
  // -----------------------------------------------------------------------

  it("rejects extra top-level keys to keep the contract strict", () => {
    const raw = JSON.stringify(
      makeArtifact({
        extraField: "not part of the contract",
      }),
    );

    expect(() => parseJanusResolutionArtifact(raw)).toThrow(JanusParseError);
    expect(() => parseJanusResolutionArtifact(raw)).toThrow(/extraField/i);
  });

  it("rejects multiple extra keys", () => {
    const raw = JSON.stringify(
      makeArtifact({
        extraField1: "value1",
        extraField2: "value2",
      }),
    );

    expect(() => parseJanusResolutionArtifact(raw)).toThrow(JanusParseError);
  });

  // -----------------------------------------------------------------------
  // Malformed JSON and non-object roots
  // -----------------------------------------------------------------------

  it("rejects malformed JSON", () => {
    expect(() => parseJanusResolutionArtifact("{ not json")).toThrow(JanusParseError);
    expect(() => parseJanusResolutionArtifact("{ not json")).toThrow(/JSON/i);
  });

  it("rejects non-object JSON roots: null", () => {
    expect(() => parseJanusResolutionArtifact("null")).toThrow(JanusParseError);
    const err = (() => {
      try { parseJanusResolutionArtifact("null"); } catch (e) { return e as JanusParseError; }
    })();
    expect(err?.reason).toBe("invalid_shape");
  });

  it("rejects non-object JSON roots: array", () => {
    expect(() => parseJanusResolutionArtifact("[]")).toThrow(JanusParseError);
    const err = (() => {
      try { parseJanusResolutionArtifact("[]"); } catch (e) { return e as JanusParseError; }
    })();
    expect(err?.reason).toBe("invalid_shape");
  });

  it("rejects non-object JSON roots: string", () => {
    expect(() => parseJanusResolutionArtifact('"hello"')).toThrow(JanusParseError);
    const err = (() => {
      try { parseJanusResolutionArtifact('"hello"'); } catch (e) { return e as JanusParseError; }
    })();
    expect(err?.reason).toBe("invalid_shape");
  });

  it("rejects non-object JSON roots: number", () => {
    expect(() => parseJanusResolutionArtifact("42")).toThrow(JanusParseError);
    const err = (() => {
      try { parseJanusResolutionArtifact("42"); } catch (e) { return e as JanusParseError; }
    })();
    expect(err?.reason).toBe("invalid_shape");
  });

  it("rejects non-object JSON roots: boolean", () => {
    expect(() => parseJanusResolutionArtifact("true")).toThrow(JanusParseError);
    const err = (() => {
      try { parseJanusResolutionArtifact("true"); } catch (e) { return e as JanusParseError; }
    })();
    expect(err?.reason).toBe("invalid_shape");
  });

  // -----------------------------------------------------------------------
  // Error reason distinction
  // -----------------------------------------------------------------------

  it("distinguishes invalid_json vs invalid_shape error reasons", () => {
    const jsonErr = (() => {
      try { parseJanusResolutionArtifact("{bad"); } catch (e) { return e as JanusParseError; }
    })();
    expect(jsonErr?.reason).toBe("invalid_json");

    const shapeErr = (() => {
      try { parseJanusResolutionArtifact("{}"); } catch (e) { return e as JanusParseError; }
    })();
    expect(shapeErr?.reason).toBe("invalid_shape");
  });

  it("returns invalid_shape for empty object", () => {
    expect(() => parseJanusResolutionArtifact("{}")).toThrow(JanusParseError);
    const err = (() => {
      try { parseJanusResolutionArtifact("{}"); } catch (e) { return e as JanusParseError; }
    })();
    expect(err?.reason).toBe("invalid_shape");
  });

  it("returns invalid_shape for object with only some fields", () => {
    const partial = JSON.stringify({
      originatingIssueId: "aegis-fjm.5",
      queueItemId: "aegis-fjm.5",
      // missing all other fields
    });
    expect(() => parseJanusResolutionArtifact(partial)).toThrow(JanusParseError);
  });

  // -----------------------------------------------------------------------
  // Immutability: returned arrays are copies
  // -----------------------------------------------------------------------

  it("returns new arrays for filesTouched, validationsRun, residualRisks", () => {
    const raw = JSON.stringify(makeArtifact());
    const result = parseJanusResolutionArtifact(raw);

    result.filesTouched.push("mutated.ts");
    const result2 = parseJanusResolutionArtifact(raw);
    expect(result2.filesTouched).not.toContain("mutated.ts");
  });
});
