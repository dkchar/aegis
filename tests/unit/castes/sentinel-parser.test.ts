import { describe, expect, it } from "vitest";

import { parseSentinelVerdict } from "../../../src/castes/sentinel/sentinel-parser.js";

describe("parseSentinelVerdict", () => {
  it("parses a valid verdict", () => {
    expect(
      parseSentinelVerdict(JSON.stringify({
        verdict: "pass",
        reviewSummary: "clean",
        blockingFindings: [],
        advisories: [],
        touchedFiles: ["src/index.ts"],
        contractChecks: ["no old follow-up authority"],
      })),
    ).toMatchObject({
      verdict: "pass",
      reviewSummary: "clean",
      blockingFindings: [],
    });
  });

  it("parses fail_blocking with blocking findings and advisories", () => {
    expect(
      parseSentinelVerdict(JSON.stringify({
        verdict: "fail_blocking",
        reviewSummary: "contract broken",
        blockingFindings: ["missing required test"],
        advisories: ["rename helper later"],
        touchedFiles: ["src/index.ts"],
        contractChecks: ["required tests run"],
      })),
    ).toEqual({
      verdict: "fail_blocking",
      reviewSummary: "contract broken",
      blockingFindings: ["missing required test"],
      advisories: ["rename helper later"],
      touchedFiles: ["src/index.ts"],
      contractChecks: ["required tests run"],
    });
  });

  it("rejects old follow-up control fields", () => {
    expect(() =>
      parseSentinelVerdict(JSON.stringify({
        verdict: "pass",
        reviewSummary: "clean",
        blockingFindings: [],
        advisories: [],
        touchedFiles: [],
        contractChecks: [],
        followUpIssueIds: ["aegis-2"],
      })),
    ).toThrow(/unexpected field/i);
  });

  it("rejects missing required fields", () => {
    expect(() =>
      parseSentinelVerdict(JSON.stringify({
        verdict: "pass",
        reviewSummary: "clean",
      })),
    ).toThrow(/missing required field/i);
  });
});
