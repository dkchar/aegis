import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

function resolveNodeModuleBinary(startDirectory: string, relativePath: string) {
  let current = startDirectory;

  while (true) {
    const candidate = path.join(current, ...relativePath.split("/"));
    if (existsSync(candidate)) {
      return candidate;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(`Unable to resolve ${relativePath} from this worktree.`);
    }
    current = parent;
  }
}

const typescriptCliPath = resolveNodeModuleBinary(
  repoRoot,
  "node_modules/typescript/bin/tsc",
);
const npmExecPath = process.env.npm_execpath;

interface RootPackageJson {
  bin: Record<string, string>;
}

function readJson<T>(relativePath: string) {
  return JSON.parse(
    readFileSync(path.join(repoRoot, relativePath), "utf8"),
  ) as T;
}

function cleanDist() {
  const cleanupRun = spawnSync(
    process.execPath,
    ["--eval", "require('node:fs').rmSync('dist', { recursive: true, force: true })"],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );

  expect(cleanupRun.status).toBe(0);
}

function buildProject() {
  const buildRun = spawnSync(
    process.execPath,
    [typescriptCliPath, "--project", "tsconfig.json"],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );

  expect(buildRun.status).toBe(0);
}

describe("S00 project skeleton acceptance", () => {
  it("builds the CLI and runs the built entrypoint from the repo root and a symlinked repo", async () => {
    const packageJson = readJson<RootPackageJson>("package.json");
    const sharedPathsModule = (await import(
      pathToFileURL(path.join(repoRoot, "src/shared/paths.ts")).href
    )) as {
      resolveProjectPaths: (root?: string) => {
        repoRoot: string;
        srcRoot: string;
        distRoot: string;
      };
    };
    const entrypointModule = (await import(
      pathToFileURL(path.join(repoRoot, "src/index.ts")).href
    )) as {
      isDirectExecution: (entrypoint?: string, moduleUrl?: string) => boolean;
    };

    cleanDist();
    buildProject();

    const cliPath = path.join(repoRoot, packageJson.bin.aegis);
    const cliRun = spawnSync(process.execPath, [cliPath], {
      cwd: repoRoot,
      encoding: "utf8",
    });

    expect(existsSync(cliPath)).toBe(true);
    expect(cliRun.status).toBe(0);
    expect(cliRun.stdout).toContain("Aegis CLI scaffold ready");
    expect(sharedPathsModule.resolveProjectPaths(repoRoot)).toEqual({
      repoRoot,
      srcRoot: path.join(repoRoot, "src"),
      distRoot: path.join(repoRoot, "dist"),
    });

    const linkedRoot = mkdtempSync(path.join(tmpdir(), "aegis-cli-link-"));
    const repoLinkPath = path.join(linkedRoot, "repo-link");

    try {
      symlinkSync(
        repoRoot,
        repoLinkPath,
        process.platform === "win32" ? "junction" : "dir",
      );

      expect(
        entrypointModule.isDirectExecution(
          path.join(repoLinkPath, "src", "index.ts"),
          pathToFileURL(path.join(repoRoot, "src", "index.ts")).href,
        ),
      ).toBe(true);

      const linkedCliRun = spawnSync(
        process.execPath,
        [path.join(repoLinkPath, packageJson.bin.aegis)],
        {
          cwd: repoRoot,
          encoding: "utf8",
        },
      );

      expect(linkedCliRun.status).toBe(0);
      expect(linkedCliRun.stdout).toContain("Aegis CLI scaffold ready");
    } finally {
      rmSync(linkedRoot, { recursive: true, force: true });
    }
  }, 15_000);

  it("wires aegis init through the built CLI entrypoint", () => {
    const packageJson = readJson<RootPackageJson>("package.json");
    const tempRepo = mkdtempSync(path.join(tmpdir(), "aegis-cli-init-"));
    const cliPath = path.join(repoRoot, packageJson.bin.aegis);

    try {
      cleanDist();
      buildProject();

      const initRun = spawnSync(process.execPath, [cliPath, "init"], {
        cwd: tempRepo,
        encoding: "utf8",
      });

      expect(initRun.status).toBe(0);
      expect(initRun.stdout).toContain("Aegis project initialized");
      expect(existsSync(path.join(tempRepo, ".aegis", "config.json"))).toBe(true);
      expect(existsSync(path.join(tempRepo, ".aegis", "dispatch-state.json"))).toBe(true);
      expect(existsSync(path.join(tempRepo, ".aegis", "merge-queue.json"))).toBe(true);
      expect(existsSync(path.join(tempRepo, ".aegis", "logs"))).toBe(true);
    } finally {
      rmSync(tempRepo, { recursive: true, force: true });
    }
  }, 20_000);

  it("packages the stripped CLI artifact set in npm pack output", () => {
    expect(npmExecPath).toBeTruthy();

    cleanDist();
    buildProject();

    const packRun = spawnSync(
      process.execPath,
      [npmExecPath!, "pack", "--json", "--dry-run", "--ignore-scripts"],
      {
        cwd: repoRoot,
        encoding: "utf8",
      },
    );

    expect(packRun.status).toBe(0);

    const packOutput = JSON.parse(packRun.stdout) as Array<{
      files: Array<{ path: string }>;
    }>;
    const packagedFiles = new Set(packOutput[0]?.files.map((file) => file.path) ?? []);

    expect(packagedFiles.has("dist/index.js")).toBe(true);
  }, 20_000);
});
