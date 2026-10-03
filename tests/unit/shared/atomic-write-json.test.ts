import path from "node:path";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { buildTemporaryPath, writeJsonAtomic } from "../../../src/shared/atomic-write.js";

const tempRoots: string[] = [];

function createTempRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "aegis-atomic-"));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("writeJsonAtomic", () => {
  it("creates parent directories, writes pretty JSON, and leaves no temp files", () => {
    const root = createTempRoot();
    const target = path.join(root, "nested", "state.json");

    writeJsonAtomic(target, { a: 1 });
    writeJsonAtomic(target, { a: 2 });

    expect(readFileSync(target, "utf8")).toBe("{\n  \"a\": 2\n}\n");
    expect(readdirSync(path.dirname(target))).toEqual(["state.json"]);
  });

  it("uses a unique temp path per write", () => {
    expect(buildTemporaryPath("/x/state.json")).not.toBe(buildTemporaryPath("/x/state.json"));
  });
});
