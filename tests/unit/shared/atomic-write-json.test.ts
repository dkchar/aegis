import path from "node:path";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { buildTemporaryPath, createJsonExclusive, writeJsonAtomic } from "../../../src/shared/atomic-write.js";

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

describe("createJsonExclusive", () => {
  it("never overwrites an existing entry", () => {
    const root = createTempRoot();
    const target = path.join(root, "2026-01-01T00-00-00.000Z-dispatch-_all.json");

    const first = createJsonExclusive(target, { n: 1 });
    const second = createJsonExclusive(target, { n: 2 });
    const third = createJsonExclusive(target, { n: 3 });

    expect(first).toBe(target);
    expect(path.basename(second)).toBe("2026-01-01T00-00-00.000Z-dispatch-_all~2.json");
    expect(path.basename(third)).toBe("2026-01-01T00-00-00.000Z-dispatch-_all~3.json");
    expect(JSON.parse(readFileSync(first, "utf8"))).toEqual({ n: 1 });
    expect(JSON.parse(readFileSync(third, "utf8"))).toEqual({ n: 3 });
    expect(readdirSync(root).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });
});
