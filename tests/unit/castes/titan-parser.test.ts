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
