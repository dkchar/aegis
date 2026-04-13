import path from "node:path";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { getMockRunBdSupport, seedMockRun } from "../../../src/mock-run/seed-mock-run.js";

const tempRoots: string[] = [];
const bdSupport = getMockRunBdSupport();

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe.skipIf(!bdSupport.supported)("seedMockRun", () => {
  it("creates a seeded repo without example source files", async () => {
    const sandboxRoot = mkdtempSync(path.join(tmpdir(), "aegis-mock-run-"));
    tempRoots.push(sandboxRoot);

    const result = await seedMockRun({
      workspaceRoot: sandboxRoot,
      repoName: "scratchpad",
      beadsPrefix: "mockrunseed",
    });

    expect(existsSync(path.join(result.repoRoot, "src"))).toBe(false);
    expect(existsSync(path.join(result.repoRoot, "tests"))).toBe(false);
    expect(result.initialReadyKeys).toEqual(["foundation.contract"]);
  }, 90_000);

  it("recreates the repo and verifies foundation.contract is the only initial ready issue", async () => {
    const sandboxRoot = mkdtempSync(path.join(tmpdir(), "aegis-mock-run-"));
    tempRoots.push(sandboxRoot);

    const result = await seedMockRun({
      workspaceRoot: sandboxRoot,
      repoName: "aegis-mock-run",
      beadsPrefix: "mockrunseed",
    });

    expect(existsSync(path.join(result.repoRoot, ".git"))).toBe(true);
    expect(existsSync(path.join(result.repoRoot, ".beads"))).toBe(true);
    expect(existsSync(path.join(result.repoRoot, ".aegis", "mock-run-manifest.json"))).toBe(true);
    expect(result.initialReadyKeys).toEqual(["foundation.contract"]);

    const manifest = JSON.parse(
      readFileSync(path.join(result.repoRoot, ".aegis", "mock-run-manifest.json"), "utf8"),
    ) as {
      repoRoot: string;
      initialReadyKeys: string[];
      configuredModels: Record<string, string>;
    };

    expect(manifest.repoRoot).toBe("..");
    expect(manifest.initialReadyKeys).toEqual(["foundation.contract"]);
    expect(manifest.configuredModels.oracle).toBe("pi:gemma-4-31b-it");
    expect(manifest.configuredModels.titan).toBe("pi:gemma-4-31b-it");
  }, 90_000);

  it("creates the live Beads queue so only foundation.contract is initially ready", async () => {
    const sandboxRoot = mkdtempSync(path.join(tmpdir(), "aegis-mock-run-"));
    tempRoots.push(sandboxRoot);

    const result = await seedMockRun({
      workspaceRoot: sandboxRoot,
      repoName: "aegis-mock-run",
      beadsPrefix: "mockrunseed",
    });

    const ready = JSON.parse(
      execFileSync("bd", ["ready", "--json"], {
        cwd: result.repoRoot,
        encoding: "utf8",
        windowsHide: true,
      }),
    ) as Array<{ id: string; title: string }>;

    expect(ready).toHaveLength(1);
    expect(ready[0]?.title).toBe("[foundation] Contract seed");
    expect(ready[0]?.id).toBe(result.issueIdByKey["foundation.contract"]);
  }, 90_000);

  it("writes Gemma defaults into the generated repo config", async () => {
    const sandboxRoot = mkdtempSync(path.join(tmpdir(), "aegis-mock-run-"));
    tempRoots.push(sandboxRoot);

    const result = await seedMockRun({
      workspaceRoot: sandboxRoot,
      repoName: "aegis-mock-run",
      beadsPrefix: "mockrunseed",
    });

    const piSettings = readFileSync(path.join(result.repoRoot, ".pi", "settings.json"), "utf8");
    const aegisConfig = JSON.parse(
      readFileSync(path.join(result.repoRoot, ".aegis", "config.json"), "utf8"),
    ) as {
      models: Record<string, string>;
      olympus: { open_browser: boolean };
    };

    expect(piSettings).toContain("gemma-4-31b-it");
    expect(aegisConfig.models.oracle).toBe("pi:gemma-4-31b-it");
    expect(aegisConfig.models.titan).toBe("pi:gemma-4-31b-it");
    expect(aegisConfig.models.sentinel).toBe("pi:gemma-4-31b-it");
    expect(aegisConfig.olympus.open_browser).toBe(false);
  }, 90_000);

  it("makes all three foundation lanes ready after the contract closes", async () => {
    const sandboxRoot = mkdtempSync(path.join(tmpdir(), "aegis-mock-run-"));
    tempRoots.push(sandboxRoot);

    const result = await seedMockRun({
      workspaceRoot: sandboxRoot,
      repoName: "aegis-mock-run",
      beadsPrefix: "mockrunseed",
    });

    execFileSync("bd", ["close", result.issueIdByKey["foundation.contract"], "--reason", "test"], {
      cwd: result.repoRoot,
      encoding: "utf8",
      windowsHide: true,
    });

    const ready = JSON.parse(
      execFileSync("bd", ["ready", "--json"], {
        cwd: result.repoRoot,
        encoding: "utf8",
        windowsHide: true,
      }),
    ) as Array<{ id: string; title: string }>;

    expect(ready.map((issue) => issue.title).sort()).toEqual([
      "[foundation] Lane A",
      "[foundation] Lane B",
      "[foundation] Lane C",
    ].sort());
    expect(ready.map((issue) => issue.id).sort()).toEqual([
      result.issueIdByKey["foundation.lane_a"],
      result.issueIdByKey["foundation.lane_b"],
      result.issueIdByKey["foundation.lane_c"],
    ].sort());
  }, 90_000);
});
