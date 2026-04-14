import { describe, expect, it } from "vitest";

import { parseOracleAssessment } from "../../../src/castes/oracle/oracle-parser.js";

describe("parseOracleAssessment", () => {
  it("parses a valid oracle assessment", () => {
    expect(
      parseOracleAssessment(JSON.stringify({
        files_affected: ["src/index.ts"],
        estimated_complexity: "moderate",
        decompose: false,
        ready: true,
      })),
    ).toEqual({
      files_affected: ["src/index.ts"],
      estimated_complexity: "moderate",
      decompose: false,
      ready: true,
    });
  });

  it("rejects unexpected keys", () => {
    expect(() =>
      parseOracleAssessment(JSON.stringify({
        files_affected: [],
        estimated_complexity: "trivial",
        decompose: false,
        ready: true,
        extra: "nope",
      })),
    ).toThrow(/unexpected field/i);
  });
});
