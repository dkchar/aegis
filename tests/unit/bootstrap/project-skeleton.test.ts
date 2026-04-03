import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

function readJson(relativePath: string) {
  return JSON.parse(
    readFileSync(path.join(repoRoot, relativePath), "utf8"),
  ) as Record<string, unknown>;
}

describe("S00 project skeleton contract", () => {
  it("defines the shared TypeScript and Vitest toolchain", () => {
    expect(existsSync(path.join(repoRoot, "tsconfig.json"))).toBe(true);
    expect(existsSync(path.join(repoRoot, "vitest.config.ts"))).toBe(true);

    const packageJson = readJson("package.json");
    const scripts = (packageJson.scripts ?? {}) as Record<string, string>;

    expect(scripts.build).toBe("tsc --project tsconfig.json");
    expect(scripts.test).toBe("vitest run --config vitest.config.ts");
    expect(scripts["build:olympus"]).toBe("npm run build --workspace olympus");
  });

  it("creates the workspace skeleton needed by the implementation lanes", () => {
    const fixture = readJson("tests/fixtures/bootstrap/workspace-contract.json");
    const expectedPaths = fixture.requiredPaths as string[];

    expect(Array.isArray(expectedPaths)).toBe(true);
    expect(expectedPaths.length).toBeGreaterThan(0);

    for (const expectedPath of expectedPaths) {
      expect(existsSync(path.join(repoRoot, expectedPath)), expectedPath).toBe(
        true,
      );
    }
  });
});
