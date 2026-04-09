import path from "node:path";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { seedMockRun } from "../../../src/mock-run/seed-mock-run.js";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("seedMockRun", () => {
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
      initialReadyKeys: string[];
      configuredModels: Record<string, string>;
    };

    expect(manifest.initialReadyKeys).toEqual(["foundation.contract"]);
    expect(manifest.configuredModels.oracle).toBe("pi:gemma-4-31b-it");
    expect(manifest.configuredModels.titan).toBe("pi:gemma-4-31b-it");
  }, 60_000);

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
  }, 60_000);

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
  }, 60_000);

  it("makes both foundation lanes ready after the contract closes", async () => {
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
    ].sort());
    expect(ready.map((issue) => issue.id).sort()).toEqual([
      result.issueIdByKey["foundation.lane_a"],
      result.issueIdByKey["foundation.lane_b"],
    ].sort());
  }, 60_000);
});
