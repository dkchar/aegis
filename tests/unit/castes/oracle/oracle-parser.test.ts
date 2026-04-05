/**
 * S08 contract seed â€” Oracle parser contract tests.
 *
 * These tests define the strict machine-parseable shape for OracleAssessment
 * from SPECv2 Â§10.1.1 and the failure semantics for malformed output.
 */

import { describe, expect, it } from "vitest";

import {
  OracleAssessmentParseError,
  parseOracleAssessment,
} from "../../../../src/castes/oracle/oracle-parser.js";

function makeAssessment(overrides: Record<string, unknown> = {}) {
  return {
    files_affected: ["src/core/run-oracle.ts", "src/tracker/create-derived-issues.ts"],
    estimated_complexity: "moderate",
    decompose: false,
    ready: true,
    ...overrides,
  };
}

describe("parseOracleAssessment", () => {
  it("parses a valid minimal OracleAssessment", () => {
    const raw = JSON.stringify(makeAssessment());

    expect(parseOracleAssessment(raw)).toEqual({
      files_affected: ["src/core/run-oracle.ts", "src/tracker/create-derived-issues.ts"],
      estimated_complexity: "moderate",
      decompose: false,
      ready: true,
    });
  });

  it("parses optional blockers and sub_issues", () => {
    const raw = JSON.stringify(
      makeAssessment({
        estimated_complexity: "complex",
        decompose: true,
        sub_issues: ["Split Oracle prompt", "Add decomposition helper"],
        blockers: ["src/core/run-oracle.ts"],
        ready: false,
      }),
    );

    expect(parseOracleAssessment(raw)).toEqual({
      files_affected: ["src/core/run-oracle.ts", "src/tracker/create-derived-issues.ts"],
      estimated_complexity: "complex",
      decompose: true,
      sub_issues: ["Split Oracle prompt", "Add decomposition helper"],
      blockers: ["src/core/run-oracle.ts"],
      ready: false,
    });
  });

  it.each([
    ["sub_issues", makeAssessment({ sub_issues: "Split Oracle prompt" })],
    ["sub_issues", makeAssessment({ sub_issues: ["Split Oracle prompt", 42] })],
    ["blockers", makeAssessment({ blockers: "src/core/run-oracle.ts" })],
    ["blockers", makeAssessment({ blockers: ["src/core/run-oracle.ts", 42] })],
  ])("rejects malformed optional %s arrays", (field, payload) => {
    const raw = JSON.stringify(payload);

    expect(() => parseOracleAssessment(raw)).toThrow(OracleAssessmentParseError);
    expect(() => parseOracleAssessment(raw)).toThrow(new RegExp(field, "i"));
  });

  it.each([
    ["files_affected", { estimated_complexity: "moderate", decompose: false, ready: true }],
    ["estimated_complexity", { files_affected: [], decompose: false, ready: true }],
    ["decompose", { files_affected: [], estimated_complexity: "trivial", ready: true }],
    ["ready", { files_affected: [], estimated_complexity: "trivial", decompose: false }],
  ])("rejects a missing required field: %s", (field, payload) => {
    const raw = JSON.stringify(payload);

    expect(() => parseOracleAssessment(raw)).toThrow(OracleAssessmentParseError);
    expect(() => parseOracleAssessment(raw)).toThrow(new RegExp(field, "i"));
  });

  it("rejects invalid complexity values", () => {
    const raw = JSON.stringify(makeAssessment({ estimated_complexity: "hard" }));

    expect(() => parseOracleAssessment(raw)).toThrow(OracleAssessmentParseError);
    expect(() => parseOracleAssessment(raw)).toThrow(/estimated_complexity/i);
  });

  it("rejects extra top-level keys to keep the contract strict", () => {
    const raw = JSON.stringify(
      makeAssessment({
        extra_notes: "not part of the contract",
      }),
    );

    expect(() => parseOracleAssessment(raw)).toThrow(OracleAssessmentParseError);
    expect(() => parseOracleAssessment(raw)).toThrow(/extra_notes/i);
  });

  it("rejects malformed JSON", () => {
    expect(() => parseOracleAssessment("{ not json")).toThrow(OracleAssessmentParseError);
    expect(() => parseOracleAssessment("{ not json")).toThrow(/JSON/i);
  });

  it.each([
    makeAssessment({
      estimated_complexity: "complex",
      decompose: true,
      ready: false,
    }),
    makeAssessment({
      estimated_complexity: "complex",
      decompose: true,
      sub_issues: [],
      ready: false,
    }),
  ])("rejects decompose=true without usable sub_issues", (payload) => {
    const raw = JSON.stringify(payload);

    expect(() => parseOracleAssessment(raw)).toThrow(OracleAssessmentParseError);
    expect(() => parseOracleAssessment(raw)).toThrow(/sub_issues/i);
  });
});
