import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it, vi } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

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
    expect(scripts.test).toBe("vitest run --config vitest.config.ts --project default");
    expect(scripts["test:acceptance"]).toBe("vitest run --config vitest.config.ts --project acceptance");
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
  }, 15_000);

  it("buildBootstrapManifest delegates path resolution to src/shared/paths", async () => {
    vi.resetModules();

    const mockedPaths = {
      repoRoot: "tmp/repo",
      srcRoot: "tmp/repo/src",
      distRoot: "tmp/repo/dist",
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

    expect(entrypointModule.buildBootstrapManifest("tmp/repo")).toEqual({
      appName: "aegis",
      paths: mockedPaths,
    });
    expect(resolveProjectPaths).toHaveBeenCalledWith("tmp/repo");
  });

  it("uses a seam-only default Vitest project and a separate acceptance lane", async () => {
    const vitestConfig = (await import(
      pathToFileURL(path.join(repoRoot, "vitest.config.ts")).href
    )) as {
      default: {
        test?: {
          projects?: Array<{
            test?: {
              name?: string;
              include?: string[];
              exclude?: string[];
              environment?: string;
            };
          }>;
        };
      };
    };

    expect(vitestConfig.default.test?.projects).toEqual([
      expect.objectContaining({
        test: expect.objectContaining({
          name: "default",
          include: ["tests/**/*.{test,spec}.{ts,tsx}"],
          exclude: ["tests/acceptance/**/*.{test,spec}.{ts,tsx}"],
          environment: "node",
        }),
      }),
      expect.objectContaining({
        test: expect.objectContaining({
          name: "acceptance",
          include: ["tests/acceptance/**/*.{test,spec}.{ts,tsx}"],
          environment: "node",
        }),
      }),
    ]);
  });

  it("keeps the stripped source tree free of hidden legacy orchestration modules", () => {
    expect(existsSync(path.join(repoRoot, "src", "core", "poller.ts"))).toBe(true);
    expect(existsSync(path.join(repoRoot, "src", "core", "triage.ts"))).toBe(true);
    expect(existsSync(path.join(repoRoot, "src", "core", "dispatcher.ts"))).toBe(true);
    expect(existsSync(path.join(repoRoot, "src", "core", "monitor.ts"))).toBe(true);
    expect(existsSync(path.join(repoRoot, "src", "core", "reaper.ts"))).toBe(true);
    expect(existsSync(path.join(repoRoot, "src", "runtime", "agent-runtime.ts"))).toBe(true);
    expect(existsSync(path.join(repoRoot, "src", "tracker", "tracker.ts"))).toBe(true);
    expect(existsSync(path.join(repoRoot, "src", "castes", "oracle", "oracle-parser.ts"))).toBe(true);
    expect(existsSync(path.join(repoRoot, "src", "castes", "titan", "titan-parser.ts"))).toBe(true);
    expect(existsSync(path.join(repoRoot, "src", "castes", "sentinel", "sentinel-parser.ts"))).toBe(true);
    expect(existsSync(path.join(repoRoot, "src", "castes", "janus", "janus-parser.ts"))).toBe(true);
    expect(existsSync(path.join(repoRoot, "src", "labor", "create-labor.ts"))).toBe(true);
    expect(existsSync(path.join(repoRoot, "src", "merge", "merge-state.ts"))).toBe(true);
    expect(existsSync(path.join(repoRoot, "src", "merge", "tier-policy.ts"))).toBe(true);
    expect(existsSync(path.join(repoRoot, "src", "merge", "merge-next.ts"))).toBe(true);
    expect(existsSync(path.join(repoRoot, "src", "cli", "parse-command.ts"))).toBe(false);
    expect(existsSync(path.join(repoRoot, "src", "shared", "issue-id.ts"))).toBe(false);
    expect(existsSync(path.join(repoRoot, "src", "shared", "steer-command-reference.ts"))).toBe(false);
  });

  it("pins the seam-only CI and Phase G completion docs", () => {
    const ciWorkflow = readFileSync(path.join(repoRoot, ".github", "workflows", "ci.yml"), "utf8");
    const triageDesign = readFileSync(
      path.join(
        repoRoot,
        "docs",
        "superpowers",
        "specs",
        "2026-04-13-aegis-emergency-mvp-triage-design.md",
      ),
      "utf8",
    );
    const handoffPrompt = readFileSync(
      path.join(
        repoRoot,
        "docs",
        "superpowers",
        "plans",
        "2026-04-14-phase-g-proof-reset-handoff-prompt.md",
      ),
      "utf8",
    );

    expect(ciWorkflow).toContain("name: Seam-only CI");
    expect(ciWorkflow).toContain("npm run lint");
    expect(ciWorkflow).toContain("npm run test");
    expect(ciWorkflow).toContain("npm run build");
    expect(ciWorkflow).not.toContain("npm pack");
    expect(ciWorkflow).not.toContain("npm run test:acceptance");

    expect(triageDesign).toContain("Phase G complete on 2026-04-16.");
    expect(triageDesign).toContain("CI should run deterministic tests only.");
    expect(triageDesign).toContain("Seeded mock-run acceptance");
    expect(triageDesign).not.toContain("Phase G remains open.");

    expect(handoffPrompt).toContain("Emergency rewrite phases are complete.");
    expect(handoffPrompt).toContain("Fresh follow-up work belongs in new addenda and Beads issues");
    expect(handoffPrompt).not.toContain("implement Phase G only");
    expect(handoffPrompt).not.toContain("Phase G remains open");
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

});
