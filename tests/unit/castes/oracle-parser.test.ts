import { describe, expect, it } from "vitest";

import { parseOracleAssessment } from "../../../src/castes/oracle/oracle-parser.js";

describe("parseOracleAssessment", () => {
  it("parses a valid oracle assessment", () => {
    expect(
      parseOracleAssessment(JSON.stringify({
        files_affected: ["src/index.ts"],
        estimated_complexity: "moderate",
        risks: ["touches dispatch policy"],
        suggested_checks: ["npm test"],
        scope_notes: ["parser-only change"],
      })),
    ).toEqual({
      files_affected: ["src/index.ts"],
      estimated_complexity: "moderate",
      risks: ["touches dispatch policy"],
      suggested_checks: ["npm test"],
      scope_notes: ["parser-only change"],
    });
  });

  it("rejects old readiness and decomposition fields", () => {
    expect(() =>
      parseOracleAssessment(JSON.stringify({
        files_affected: [],
        estimated_complexity: "trivial",
        risks: [],
        suggested_checks: [],
        scope_notes: [],
        ready: true,
        decompose: false,
      })),
    ).toThrow(/unexpected field/i);
  });

  it("rejects unexpected keys", () => {
    expect(() =>
      parseOracleAssessment(JSON.stringify({
        files_affected: [],
        estimated_complexity: "trivial",
        risks: [],
        suggested_checks: [],
        scope_notes: [],
        extra: "nope",
      })),
    ).toThrow(/unexpected field/i);
  });
});
