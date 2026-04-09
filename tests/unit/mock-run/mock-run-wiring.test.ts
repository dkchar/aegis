import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

describe("mock run wiring", () => {
  it("tracks the npm seeder script and ignores the generated repo", () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(repoRoot, "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };
    const gitIgnore = readFileSync(path.join(repoRoot, ".gitignore"), "utf8");

    expect(packageJson.scripts?.["mock:seed"]).toBe("tsx src/mock-run/seed-mock-run.ts");
    expect(gitIgnore).toContain("aegis-mock-run/");
  });
});
