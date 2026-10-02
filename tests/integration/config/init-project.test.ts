import path from "node:path";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { DEFAULT_AEGIS_CONFIG } from "../../../src/config/defaults.js";
import {
  REQUIRED_PROJECT_DIRECTORIES,
  REQUIRED_PROJECT_FILES,
  buildInitProjectPlan,
  initProject,
} from "../../../src/config/init-project.js";
import {
  emptyDispatchState,
  loadDispatchState,
} from "../../../src/core/dispatch-state.js";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

interface InitProjectLayoutFixture {
  directories: string[];
  files: string[];
}

function readLayoutFixture() {
  return JSON.parse(
    readFileSync(
      path.join(
        repoRoot,
        "tests",
        "fixtures",
        "config",
        "init-project-layout.json",
      ),
      "utf8",
    ),
  ) as InitProjectLayoutFixture;
}

function createTempRepo() {
  return mkdtempSync(path.join(tmpdir(), "aegis-init-project-"));
}

describe("S01 init project contract seed", () => {
  it("defines the required project layout", () => {
    const fixture = readLayoutFixture();

    expect(REQUIRED_PROJECT_DIRECTORIES).toEqual(fixture.directories);
    expect(REQUIRED_PROJECT_FILES).toEqual(fixture.files);
  });

  it("builds an init plan that maps the contract to repository paths", () => {
    const plan = buildInitProjectPlan(repoRoot);

    expect(plan.repoRoot).toBe(repoRoot);
    expect(plan.directories).toEqual(
      REQUIRED_PROJECT_DIRECTORIES.map((entry) => path.join(repoRoot, entry)),
    );
    expect(plan.files).toEqual(
      REQUIRED_PROJECT_FILES.map((entry) => path.join(repoRoot, entry)),
    );
    expect(plan.gitIgnoreEntries.length).toBeGreaterThan(0);
  });

  it("creates the .aegis project layout and seeded files", () => {
    const tempRepo = createTempRepo();

    try {
      const result = initProject(tempRepo);

      expect(result.repoRoot).toBe(tempRepo);
      for (const relativeDirectory of REQUIRED_PROJECT_DIRECTORIES) {
        expect(existsSync(path.join(tempRepo, relativeDirectory))).toBe(true);
      }
      for (const relativeFile of REQUIRED_PROJECT_FILES) {
        expect(existsSync(path.join(tempRepo, relativeFile))).toBe(true);
      }

      expect(
        JSON.parse(
          readFileSync(path.join(tempRepo, ".aegis", "config.json"), "utf8"),
        ),
      ).toEqual(DEFAULT_AEGIS_CONFIG);
      expect(
        JSON.parse(
          readFileSync(path.join(tempRepo, ".aegis", "config.json"), "utf8"),
        ).thinking,
      ).toEqual(DEFAULT_AEGIS_CONFIG.thinking);
      expect(
        loadDispatchState(tempRepo),
      ).toEqual(emptyDispatchState());
      expect(
        JSON.parse(
          readFileSync(path.join(tempRepo, ".aegis", "merge-queue.json"), "utf8"),
        ),
      ).toEqual({
        schemaVersion: 1,
        items: [],
      });
      expect(existsSync(path.join(tempRepo, ".gitignore"))).toBe(true);
    } finally {
      rmSync(tempRepo, { recursive: true, force: true });
    }
  });

  it("is idempotent and does not clobber an existing config or duplicate gitignore entries", () => {
    const tempRepo = createTempRepo();
    const existingConfig = {
      runtime: "custom-runtime",
    };

    try {
      writeFileSync(
        path.join(tempRepo, ".gitignore"),
        "node_modules/\n",
        "utf8",
      );
      mkdirSync(path.join(tempRepo, ".aegis"), { recursive: true });
      writeFileSync(
        path.join(tempRepo, ".aegis", "config.json"),
        JSON.stringify(existingConfig, null, 2),
        "utf8",
      );

      initProject(tempRepo);
      const afterFirstRun = readFileSync(path.join(tempRepo, ".gitignore"), "utf8");
      const secondRun = initProject(tempRepo);

      expect(
        JSON.parse(
          readFileSync(path.join(tempRepo, ".aegis", "config.json"), "utf8"),
        ),
      ).toEqual(existingConfig);
      expect(secondRun.updatedGitIgnore).toBe(false);
      expect(readFileSync(path.join(tempRepo, ".gitignore"), "utf8")).toBe(afterFirstRun);
    } finally {
      rmSync(tempRepo, { recursive: true, force: true });
    }
  });

  it("leaves the project's package.json untouched", () => {
    const tempRepo = createTempRepo();
    const packageJsonPath = path.join(tempRepo, "package.json");
    const packageJson = "{\n  \"name\": \"demo\",\n  \"scripts\": { \"test\": \"vitest\" }\n}\n";

    try {
      writeFileSync(packageJsonPath, packageJson, "utf8");

      initProject(tempRepo);

      expect(readFileSync(packageJsonPath, "utf8")).toBe(packageJson);
    } finally {
      rmSync(tempRepo, { recursive: true, force: true });
    }
  });
});
