import path from "node:path";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { persistArtifact } from "../../../src/core/artifact-store.js";

const tempRoots: string[] = [];

function createTempRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "aegis-artifact-store-"));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("persistArtifact", () => {
  it("writes artifacts through tmp -> rename", () => {
    const root = createTempRoot();
    const ref = persistArtifact(root, {
      family: "oracle",
      issueId: "aegis-123",
      artifact: {
        files_affected: ["src/index.ts"],
        estimated_complexity: "moderate",
        decompose: false,
        ready: true,
      },
    });

    const artifactPath = path.join(root, ".aegis", "oracle", "aegis-123.json");

    expect(ref).toBe(path.join(".aegis", "oracle", "aegis-123.json"));
    expect(existsSync(artifactPath)).toBe(true);
    expect(JSON.parse(readFileSync(artifactPath, "utf8"))).toMatchObject({
      ready: true,
    });
    expect(existsSync(`${artifactPath}.tmp`)).toBe(false);
  });
});
