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

interface RootPackageJson {
  main: string;
  bin: Record<string, string>;
  scripts: Record<string, string>;
  engines?: Record<string, string>;
  files?: string[];
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface TsConfigShape {
  compilerOptions: {
    rootDir?: string;
    outDir?: string;
    noEmit?: boolean;
    jsx?: string;
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
    expect((packageJson.files ?? [])).toEqual(
      expect.arrayContaining(["dist", "olympus/dist"]),
    );
    expect(scripts.build).toContain("build:node");
    expect(scripts.build).toContain("build:olympus");
    expect(scripts["build:node"]).toContain("tsc --project tsconfig.json");
    expect(scripts.dev).toBe("tsx src/index.ts");
    expect(scripts.test).toBe("vitest run --config vitest.config.ts");
    expect(scripts.lint).toContain("tsconfig.tests.json");
    expect(scripts.lint).toContain("lint --workspace olympus");
    expect(scripts["build:olympus"]).toBe("npm run build --workspace olympus");
    expect(scripts["build:all"]).toBeUndefined();
    expect(scripts.prepack).toBe("npm run build");
    expect(packageJson.engines?.node).toBe(">=22.12.0");

    expect(tsconfig.compilerOptions.rootDir).toBe("src");
    expect(tsconfig.compilerOptions.outDir).toBe("dist");
    expect(tsconfig.include).toEqual(["src/**/*.ts"]);
    expect(testTsconfig.compilerOptions.noEmit).toBe(true);
    expect((testTsconfig.include as string[])).toEqual(
      expect.arrayContaining(["src/**/*.ts", "tests/**/*.ts", "vitest.config.ts"]),
    );
  });

  it("ignores repo-local runtime artifacts and scratch directories", () => {
    const gitIgnoreContents = readFileSync(path.join(repoRoot, ".gitignore"), "utf8");

    expect(gitIgnoreContents).toContain(".aegis/evals/");
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

  it("defines a minimal Olympus Vite build shell", async () => {
    const olympusPackageJson = readJson<RootPackageJson>("olympus/package.json");
    const scripts = olympusPackageJson.scripts ?? {};
    const olympusTsconfig = readJson<TsConfigShape>("olympus/tsconfig.json");
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

    expect(existsSync(path.join(repoRoot, "olympus/tsconfig.json"))).toBe(true);
    expect((olympusPackageJson.dependencies as Record<string, string>).react).toBeTruthy();
    expect((olympusPackageJson.dependencies as Record<string, string>)["react-dom"]).toBeTruthy();
    expect((olympusPackageJson.devDependencies as Record<string, string>).typescript).toBeTruthy();
    expect((olympusPackageJson.devDependencies as Record<string, string>)["@vitejs/plugin-react"]).toBeTruthy();
    expect(scripts.lint).toContain("tsc --project tsconfig.json --noEmit");
    expect(scripts.build).toContain("npm run lint");
    expect(scripts.build).toContain("vite build");
    expect(olympusTsconfig.compilerOptions.jsx).toBe("react-jsx");
    expect((olympusTsconfig.include as string[])).toEqual(
      expect.arrayContaining(["src/**/*.ts", "src/**/*.tsx", "vite.config.ts"]),
    );
    expect(vitestConfig.default.test?.include).toEqual(
      undefined,
    );
    expect(vitestConfig.default.test?.projects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          test: expect.objectContaining({
            include: ["tests/**/*.{test,spec}.{ts,tsx}"],
            environment: "node",
          }),
        }),
        expect.objectContaining({
          test: expect.objectContaining({
            include: ["olympus/src/**/*.{test,spec}.{ts,tsx}"],
            environment: "jsdom",
          }),
        }),
      ]),
    );
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
      expect(existsSync(path.join(tempRepo, ".aegis", "mnemosyne.jsonl"))).toBe(true);
    } finally {
      rmSync(tempRepo, { recursive: true, force: true });
    }
  });
});
