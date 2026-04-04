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
  DEFAULT_GITIGNORE_ENTRIES,
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
  gitIgnoreEntries: string[];
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
  it("defines the required project layout and runtime-state ignore entries", () => {
    const fixture = readLayoutFixture();

    expect(REQUIRED_PROJECT_DIRECTORIES).toEqual(fixture.directories);
    expect(REQUIRED_PROJECT_FILES).toEqual(fixture.files);
    expect(DEFAULT_GITIGNORE_ENTRIES).toEqual(fixture.gitIgnoreEntries);
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
    expect(plan.gitIgnoreEntries).toEqual(DEFAULT_GITIGNORE_ENTRIES);
  });

  it("creates the .aegis project layout, seeded files, and gitignore entries", () => {
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
        loadDispatchState(tempRepo),
      ).toEqual(emptyDispatchState());
      expect(
        readFileSync(path.join(tempRepo, ".aegis", "merge-queue.json"), "utf8"),
      ).toBe("{}\n");
      expect(
        readFileSync(path.join(tempRepo, ".aegis", "mnemosyne.jsonl"), "utf8"),
      ).toBe("");

      const gitIgnoreContents = readFileSync(
        path.join(tempRepo, ".gitignore"),
        "utf8",
      );

      for (const entry of DEFAULT_GITIGNORE_ENTRIES) {
        expect(gitIgnoreContents).toContain(`${entry}\n`);
      }
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
        ["node_modules/", DEFAULT_GITIGNORE_ENTRIES[0], ""].join("\n"),
        "utf8",
      );
      mkdirSync(path.join(tempRepo, ".aegis"), { recursive: true });
      writeFileSync(
        path.join(tempRepo, ".aegis", "config.json"),
        JSON.stringify(existingConfig, null, 2),
        "utf8",
      );

      initProject(tempRepo);
      const secondRun = initProject(tempRepo);

      expect(
        JSON.parse(
          readFileSync(path.join(tempRepo, ".aegis", "config.json"), "utf8"),
        ),
      ).toEqual(existingConfig);
      expect(secondRun.updatedGitIgnore).toBe(false);

      const gitIgnoreLines = readFileSync(
        path.join(tempRepo, ".gitignore"),
        "utf8",
      )
        .split(/\r?\n/)
        .filter(Boolean);

      for (const entry of DEFAULT_GITIGNORE_ENTRIES) {
        expect(gitIgnoreLines.filter((line) => line === entry)).toHaveLength(1);
      }
    } finally {
      rmSync(tempRepo, { recursive: true, force: true });
    }
  });
});
