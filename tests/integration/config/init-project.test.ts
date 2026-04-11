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

  it("adds aegis package aliases without overwriting existing scripts", () => {
    const tempRepo = createTempRepo();
    const packageJsonPath = path.join(tempRepo, "package.json");
    const initialPackageJson = `{
    "name": "demo-repo",
    "scripts": {
        "start": "vite",
        "test": "vitest"
    },
    "private": true
}
`;

    try {
      writeFileSync(
        packageJsonPath,
        initialPackageJson,
        "utf8",
      );

      initProject(tempRepo);

      const updated = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
        scripts: Record<string, string>;
      };
      expect(updated.scripts.start).toBe("vite");
      expect(updated.scripts.test).toBe("vitest");
      expect(updated.scripts["aegis:init"]).toBe("aegis init");
      expect(updated.scripts["aegis:start"]).toBe("aegis start");
      expect(updated.scripts["aegis:status"]).toBe("aegis status");
      expect(updated.scripts["aegis:stop"]).toBe("aegis stop");
      expect(readFileSync(packageJsonPath, "utf8")).toBe(`{
    "name": "demo-repo",
    "scripts": {
        "start": "vite",
        "test": "vitest",
        "aegis:init": "aegis init",
        "aegis:start": "aegis start",
        "aegis:status": "aegis status",
        "aegis:stop": "aegis stop"
    },
    "private": true
}
`);
    } finally {
      rmSync(tempRepo, { recursive: true, force: true });
    }
  });

  it("creates an aegis scripts block when package.json has no scripts", () => {
    const tempRepo = createTempRepo();
    const packageJsonPath = path.join(tempRepo, "package.json");
    const packageJson = `{
  "name": "demo-repo"
}
`;

    try {
      writeFileSync(
        packageJsonPath,
        packageJson,
        "utf8",
      );

      initProject(tempRepo);

      const updated = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
        scripts?: Record<string, string>;
      };
      expect(updated.scripts).toEqual({
        "aegis:init": "aegis init",
        "aegis:start": "aegis start",
        "aegis:status": "aegis status",
        "aegis:stop": "aegis stop",
      });
      expect(readFileSync(packageJsonPath, "utf8")).toBe(`{
  "name": "demo-repo",
  "scripts": {
    "aegis:init": "aegis init",
    "aegis:start": "aegis start",
    "aegis:status": "aegis status",
    "aegis:stop": "aegis stop"
  }
}
`);
    } finally {
      rmSync(tempRepo, { recursive: true, force: true });
    }
  });

  it("leaves malformed package.json unchanged", () => {
    const tempRepo = createTempRepo();
    const packageJsonPath = path.join(tempRepo, "package.json");
    const malformedPackageJson = "{\n  \"name\": \"demo-repo\",\n";

    try {
      writeFileSync(packageJsonPath, malformedPackageJson, "utf8");

      initProject(tempRepo);

      expect(readFileSync(packageJsonPath, "utf8")).toBe(malformedPackageJson);
    } finally {
      rmSync(tempRepo, { recursive: true, force: true });
    }
  });

  it("leaves package.json unchanged when scripts is not an object", () => {
    const tempRepo = createTempRepo();
    const packageJsonPath = path.join(tempRepo, "package.json");
    const packageJson = `{
  "name": "demo-repo",
  "scripts": "vite"
}
`;

    try {
      writeFileSync(packageJsonPath, packageJson, "utf8");

      initProject(tempRepo);

      expect(readFileSync(packageJsonPath, "utf8")).toBe(packageJson);
    } finally {
      rmSync(tempRepo, { recursive: true, force: true });
    }
  });

  it("leaves package.json unchanged when an existing script value is not a string", () => {
    const tempRepo = createTempRepo();
    const packageJsonPath = path.join(tempRepo, "package.json");
    const packageJson = `{
  "name": "demo-repo",
  "scripts": {
    "start": "vite",
    "lint": false
  }
}
`;

    try {
      writeFileSync(packageJsonPath, packageJson, "utf8");

      initProject(tempRepo);

      expect(readFileSync(packageJsonPath, "utf8")).toBe(packageJson);
    } finally {
      rmSync(tempRepo, { recursive: true, force: true });
    }
  });

  it("does not rewrite package.json on a second initProject run after aliases are installed", () => {
    const tempRepo = createTempRepo();
    const packageJsonPath = path.join(tempRepo, "package.json");
    const packageJson = `{
  "name": "demo-repo",
  "scripts": {
    "start": "vite"
  }
}
`;

    try {
      writeFileSync(packageJsonPath, packageJson, "utf8");

      initProject(tempRepo);
      const afterFirstRun = readFileSync(packageJsonPath, "utf8");

      initProject(tempRepo);

      expect(readFileSync(packageJsonPath, "utf8")).toBe(afterFirstRun);
    } finally {
      rmSync(tempRepo, { recursive: true, force: true });
    }
  });
});
