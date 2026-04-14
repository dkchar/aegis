import { describe, expect, it } from "vitest";

import { parseSentinelVerdict } from "../../../src/castes/sentinel/sentinel-parser.js";

describe("parseSentinelVerdict", () => {
  it("parses a valid verdict", () => {
    expect(
      parseSentinelVerdict(JSON.stringify({
        verdict: "pass",
        reviewSummary: "clean",
        issuesFound: [],
        followUpIssueIds: [],
        riskAreas: [],
      })),
    ).toMatchObject({
      verdict: "pass",
      reviewSummary: "clean",
    });
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
