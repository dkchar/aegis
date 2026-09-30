import path from "node:path";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { parseJsonObjectText, readArtifactRecord, readJsonFileOrNull } from "../../../src/shared/json.js";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("parseJsonObjectText", () => {
  it("parses strict JSON", () => {
    expect(parseJsonObjectText(" {\"a\":1} ")).toEqual({ a: 1 });
  });

  it("unwraps a markdown fence", () => {
    expect(parseJsonObjectText("```json\n{\"verdict\":\"pass\"}\n```")).toEqual({ verdict: "pass" });
  });

  it("recovers the last balanced object from surrounding prose", () => {
    const text = "Draft: {\"x\":1}\nFinal artifact below.\n{\"outcome\":\"success\",\"note\":\"braces } in \\\"strings\\\" are fine\"}\nDone.";
    expect(parseJsonObjectText(text)).toEqual({
      outcome: "success",
      note: "braces } in \"strings\" are fine",
    });
  });

  it("still throws when no object is present", () => {
    expect(() => parseJsonObjectText("no json here")).toThrow();
  });
});

describe("JSON file readers", () => {
  it("returns null for missing or malformed files and resolves artifact refs", () => {
    const root = mkdtempSync(path.join(tmpdir(), "aegis-json-"));
    tempRoots.push(root);
    mkdirSync(path.join(root, ".aegis", "oracle"), { recursive: true });
    writeFileSync(path.join(root, ".aegis", "oracle", "AG-1.json"), "{\"files_affected\":[]}", "utf8");
    writeFileSync(path.join(root, "broken.json"), "{", "utf8");

    expect(readJsonFileOrNull(path.join(root, "missing.json"))).toBeNull();
    expect(readJsonFileOrNull(path.join(root, "broken.json"))).toBeNull();
    expect(readArtifactRecord(root, ".aegis/oracle/AG-1.json")).toEqual({ files_affected: [] });
    expect(readArtifactRecord(root, ".aegis\\oracle\\AG-1.json")).toEqual({ files_affected: [] });
    expect(readArtifactRecord(root, null)).toBeNull();
  });
});
