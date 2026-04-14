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

import { describe, expect, it, vi } from "vitest";

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
  main: string;
  bin: Record<string, string>;
  scripts: Record<string, string>;
  engines?: Record<string, string>;
  files?: string[];
  workspaces?: string[];
}

interface TsConfigShape {
  compilerOptions: {
    rootDir?: string;
    outDir?: string;
    noEmit?: boolean;
  };
  include?: string[];
}

interface WorkspaceContractFixture {
  requiredPaths: string[];
}

function readJson<T>(relativePath: string) {
  return JSON.parse(
    readFileSync(path.join(repoRoot, relativePath), "utf8"),
  ) as T;
}

describe("S00 project skeleton contract", () => {
  it("defines the shared TypeScript and Vitest toolchain", () => {
    expect(existsSync(path.join(repoRoot, "tsconfig.json"))).toBe(true);
    expect(existsSync(path.join(repoRoot, "tsconfig.tests.json"))).toBe(true);
    expect(existsSync(path.join(repoRoot, "vitest.config.ts"))).toBe(true);

    const packageJson = readJson<RootPackageJson>("package.json");
    const scripts = packageJson.scripts ?? {};
    const tsconfig = readJson<TsConfigShape>("tsconfig.json");
    const testTsconfig = readJson<TsConfigShape>("tsconfig.tests.json");

    expect(packageJson.main).toBe("dist/index.js");
    expect(packageJson.bin.aegis).toBe("dist/index.js");
    expect(packageJson.files).toEqual(["dist"]);
    expect(packageJson.workspaces).toBeUndefined();
    expect(scripts.build).toBe("npm run build:node");
    expect(scripts["build:node"]).toContain("tsc --project tsconfig.json");
    expect(scripts.dev).toBe("tsx src/index.ts");
    expect(scripts.start).toBe("node dist/index.js");
    expect(scripts.test).toBe("vitest run --config vitest.config.ts");
    expect(scripts.lint).toBe("tsc --project tsconfig.tests.json --noEmit");
    expect(scripts["build:olympus"]).toBeUndefined();
    expect(scripts["build:all"]).toBeUndefined();
    expect(scripts.prepack).toBe("npm run build");
    expect(packageJson.engines?.node).toBe(">=22.12.0");

    expect(tsconfig.compilerOptions.rootDir).toBe("src");
    expect(tsconfig.compilerOptions.outDir).toBe("dist");
    expect(tsconfig.include).toEqual(["src/**/*.ts"]);
    expect(testTsconfig.compilerOptions.noEmit).toBe(true);
    expect((testTsconfig.include as string[])).toEqual(
      expect.arrayContaining([
        "src/**/*.ts",
        "tests/**/*.ts",
        "vitest.config.ts",
      ]),
    );
  });

  it("ignores repo-local runtime artifacts and scratch directories", () => {
    const gitIgnoreContents = readFileSync(path.join(repoRoot, ".gitignore"), "utf8");

    expect(gitIgnoreContents).toContain(".aegis/logs/");
    expect(gitIgnoreContents).toContain(".aegis/oracle/");
    expect(gitIgnoreContents).toContain(".aegis-cli-*");
  });

  it("scaffolds the node entrypoint and shared path helpers", async () => {
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
      buildBootstrapManifest: (root?: string) => {
        appName: string;
        paths: {
          repoRoot: string;
          srcRoot: string;
          distRoot: string;
        };
      };
      isDirectExecution: (entrypoint?: string, moduleUrl?: string) => boolean;
    };

    const paths = sharedPathsModule.resolveProjectPaths(repoRoot);

    expect(paths).toEqual({
      repoRoot,
      srcRoot: path.join(repoRoot, "src"),
      distRoot: path.join(repoRoot, "dist"),
    });

    expect(entrypointModule.buildBootstrapManifest(repoRoot)).toEqual({
      appName: "aegis",
      paths,
    });

    const packageJson = readJson<RootPackageJson>("package.json");
    const cleanupRun = spawnSync(
      process.execPath,
      [
        "--eval",
        "require('node:fs').rmSync('dist', { recursive: true, force: true })",
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
      },
    );
    const buildRun = spawnSync(
      process.execPath,
      [
        typescriptCliPath,
        "--project",
        "tsconfig.json",
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
      },
    );
    const cliPath = path.join(repoRoot, packageJson.bin.aegis);
    const cliRun = spawnSync(process.execPath, [cliPath], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    const linkedRoot = mkdtempSync(path.join(tmpdir(), "aegis-cli-link-"));
    const repoLinkPath = path.join(linkedRoot, "repo-link");

    expect(cleanupRun.status).toBe(0);
    expect(buildRun.status).toBe(0);
    expect(existsSync(cliPath)).toBe(true);
    expect(cliRun.status).toBe(0);
    expect(cliRun.stdout).toContain("Aegis CLI scaffold ready");
    expect(linkedRoot.startsWith(tmpdir())).toBe(true);
    expect(linkedRoot.startsWith(repoRoot)).toBe(false);
    expect(
      entrypointModule.isDirectExecution(
        path.join(repoLinkPath, "src", "index.ts"),
        pathToFileURL(path.join(repoRoot, "src", "index.ts")).href,
      ),
    ).toBe(false);

    try {
      symlinkSync(
        repoRoot,
        repoLinkPath,
        process.platform === "win32" ? "junction" : "dir",
      );
      const linkedCliRun = spawnSync(
        process.execPath,
        [path.join(repoLinkPath, packageJson.bin.aegis)],
        {
        cwd: repoRoot,
        encoding: "utf8",
      },
      );

      expect(
        entrypointModule.isDirectExecution(
          path.join(repoLinkPath, "src", "index.ts"),
          pathToFileURL(path.join(repoRoot, "src", "index.ts")).href,
        ),
      ).toBe(true);
      expect(linkedCliRun.status).toBe(0);
      expect(linkedCliRun.stdout).toContain("Aegis CLI scaffold ready");
    } finally {
      rmSync(linkedRoot, { recursive: true, force: true });
    }
  }, 15_000);

  it("buildBootstrapManifest delegates path resolution to src/shared/paths", async () => {
    vi.resetModules();

    const mockedPaths = {
      repoRoot: "C:/tmp/repo",
      srcRoot: "C:/tmp/repo/src",
      distRoot: "C:/tmp/repo/dist",
    };
    const resolveProjectPaths = vi.fn(() => mockedPaths);

    vi.doMock("../../../src/shared/paths.js", async () => {
      const actual = await vi.importActual<object>(
        "../../../src/shared/paths.js",
      );

      return {
        ...actual,
        resolveProjectPaths,
      };
    });

    const entrypointModule = await import("../../../src/index.js");

    expect(entrypointModule.buildBootstrapManifest("C:/tmp/repo")).toEqual({
      appName: "aegis",
      paths: mockedPaths,
    });
    expect(resolveProjectPaths).toHaveBeenCalledWith("C:/tmp/repo");
  });

  it("uses a single node Vitest project with no Olympus lane", async () => {
    const vitestConfig = (await import(
      pathToFileURL(path.join(repoRoot, "vitest.config.ts")).href
    )) as {
      default: {
        test?: {
          include?: string[];
          environment?: string;
          projects?: Array<{
            test?: {
              include?: string[];
              environment?: string;
            };
          }>;
        };
      };
    };

    expect(existsSync(path.join(repoRoot, "olympus/tsconfig.json"))).toBe(false);
    expect(vitestConfig.default.test?.projects).toBeUndefined();
    expect(vitestConfig.default.test?.include).toEqual(["tests/**/*.{test,spec}.{ts,tsx}"]);
    expect(vitestConfig.default.test?.environment).toBe("node");
  });

  it("keeps the stripped source tree free of hidden legacy orchestration modules", () => {
    expect(existsSync(path.join(repoRoot, "src", "castes"))).toBe(false);
    expect(existsSync(path.join(repoRoot, "src", "labor"))).toBe(false);
    expect(existsSync(path.join(repoRoot, "src", "merge"))).toBe(false);
    expect(existsSync(path.join(repoRoot, "src", "cli", "parse-command.ts"))).toBe(false);
    expect(existsSync(path.join(repoRoot, "src", "shared", "issue-id.ts"))).toBe(false);
    expect(existsSync(path.join(repoRoot, "src", "shared", "steer-command-reference.ts"))).toBe(false);
  });

  it("keeps CI package verification aligned with the stripped CLI artifact set", () => {
    const ciWorkflow = readFileSync(path.join(repoRoot, ".github", "workflows", "ci.yml"), "utf8");

    expect(ciWorkflow).toContain("dist/index.js");
    expect(ciWorkflow).not.toContain("olympus/dist/index.html");
  });

  it("documents the current stripped-base surface separately from later rewrite phases", () => {
    const agentsGuide = readFileSync(path.join(repoRoot, "AGENTS.md"), "utf8");
    const designDoc = readFileSync(
      path.join(
        repoRoot,
        "docs",
        "superpowers",
        "specs",
        "2026-04-13-aegis-emergency-mvp-triage-design.md",
      ),
      "utf8",
    );

    expect(agentsGuide).toContain("Current Phase A-C Available Commands");
    expect(agentsGuide).toContain("Future Phase Command Targets");
    expect(designDoc).toContain("### Current Phase A-C command surface");
    expect(designDoc).toContain("### Phase D+ target command surface");
    expect(designDoc).toContain("### Current Phase A-C proof scope");
    expect(designDoc).toContain("### Full MVP proof target");
  });

  it("creates the workspace skeleton required by the workspace contract", () => {
    const fixture = readJson<WorkspaceContractFixture>(
      "tests/fixtures/bootstrap/workspace-contract.json",
    );
    const expectedPaths = fixture.requiredPaths;

    expect(Array.isArray(expectedPaths)).toBe(true);
    expect(expectedPaths.length).toBeGreaterThan(0);

    for (const expectedPath of expectedPaths) {
      expect(existsSync(path.join(repoRoot, expectedPath)), expectedPath).toBe(
        true,
      );
    }
  });

  it("wires `aegis init` through the built CLI entrypoint", () => {
    const packageJson = readJson<RootPackageJson>("package.json");
    const cleanupRun = spawnSync(
      process.execPath,
      [
        "--eval",
        "require('node:fs').rmSync('dist', { recursive: true, force: true })",
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
      },
    );
    const buildRun = spawnSync(
      process.execPath,
      [
        typescriptCliPath,
        "--project",
        "tsconfig.json",
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
      },
    );
    const cliPath = path.join(repoRoot, packageJson.bin.aegis);
    const tempRepo = mkdtempSync(path.join(tmpdir(), "aegis-cli-init-"));
    const initRun = spawnSync(process.execPath, [cliPath, "init"], {
      cwd: tempRepo,
      encoding: "utf8",
    });

    try {
      expect(cleanupRun.status).toBe(0);
      expect(buildRun.status).toBe(0);
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
    const cleanupRun = spawnSync(
      process.execPath,
      [
        "--eval",
        "require('node:fs').rmSync('dist', { recursive: true, force: true })",
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
      },
    );
    const buildRun = spawnSync(
      process.execPath,
      [
        typescriptCliPath,
        "--project",
        "tsconfig.json",
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
      },
    );
    const packRun = spawnSync(
      process.execPath,
      [npmExecPath!, "pack", "--json", "--dry-run", "--ignore-scripts"],
      {
        cwd: repoRoot,
        encoding: "utf8",
      },
    );

    expect(npmExecPath).toBeTruthy();
    expect(cleanupRun.status).toBe(0);
    expect(buildRun.status).toBe(0);
    expect(packRun.status).toBe(0);

    const packOutput = JSON.parse(packRun.stdout) as Array<{
      files: Array<{ path: string }>;
    }>;
    const packagedFiles = new Set(packOutput[0]?.files.map((file) => file.path) ?? []);

    expect(packagedFiles.has("dist/index.js")).toBe(true);
  }, 20_000);
});
