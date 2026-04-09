# Aegis Mock Run Seeder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic `npm run mock:seed` command that recreates an untracked `aegis-mock-run` todo repo, initializes git and Beads, applies Aegis and Pi defaults, seeds a fixed issue graph, and verifies the initial ready queue.

**Architecture:** Add a small manifest-backed mock-run module under `src/mock-run/` so the seeded repo layout, logical issue graph, and command execution stay explicit and testable. The seeder owns repo recreation, baseline file writing, `git` and `bd` initialization, issue graph creation, and final validation, while tests exercise the whole flow against disposable directories and live `bd` commands.

**Tech Stack:** TypeScript, Node.js `fs/path/child_process`, existing Aegis config helpers, Beads CLI, git, Vitest

---

### Task 1: Define the mock-run manifest and typed contracts

**Files:**
- Create: `src/mock-run/types.ts`
- Create: `src/mock-run/todo-manifest.ts`
- Test: `tests/unit/mock-run/todo-manifest.test.ts`

- [ ] **Step 1: Write the failing manifest contract test**

```ts
import { describe, expect, it } from "vitest";

import {
  TODO_MOCK_RUN_MANIFEST,
  TODO_BASELINE_FILES,
  TODO_MOCK_RUN_ISSUES,
  TODO_READY_QUEUE_EXPECTATION,
} from "../../../src/mock-run/todo-manifest.js";

describe("todo mock-run manifest", () => {
  it("defines the deterministic baseline repo and issue graph", () => {
    expect(TODO_BASELINE_FILES["README.md"]).toContain("Todo System Mock Run");
    expect(TODO_BASELINE_FILES[".pi/settings.json"]).toContain("gemma-4-31b-it");

    expect(TODO_MOCK_RUN_ISSUES.map((issue) => issue.key)).toEqual([
      "todo-system",
      "foundation",
      "foundation.contract",
      "foundation.lane_a",
      "foundation.lane_b",
      "foundation.gate",
      "commands",
      "commands.contract",
      "commands.lane_a",
      "commands.lane_b",
      "commands.gate",
      "integration",
      "integration.contract",
      "integration.lane_a",
      "integration.lane_b",
      "integration.gate",
    ]);

    expect(TODO_READY_QUEUE_EXPECTATION).toEqual(["foundation.contract"]);
    expect(TODO_MOCK_RUN_MANIFEST.repoName).toBe("aegis-mock-run");
  });
});
```

- [ ] **Step 2: Run the unit test to verify it fails**

Run: `npm run test -- tests/unit/mock-run/todo-manifest.test.ts`
Expected: FAIL with `Cannot find module '../../../src/mock-run/todo-manifest.js'`

- [ ] **Step 3: Add the mock-run types**

```ts
export interface MockRunIssueDefinition {
  key: string;
  title: string;
  description: string;
  issueType: "epic" | "task";
  priority: 0 | 1 | 2 | 3 | 4;
  queueRole: "coordination" | "executable";
  parentKey: string | null;
  blocks: string[];
  labels: string[];
}

export interface MockRunManifest {
  repoName: string;
  beadsPrefix: string;
  baselineFiles: Record<string, string>;
  issues: MockRunIssueDefinition[];
  expectedInitialReadyKeys: string[];
}
```

- [ ] **Step 4: Add the todo manifest with baseline files and logical issue definitions**

```ts
import type { MockRunManifest } from "./types.js";

export const TODO_BASELINE_FILES: Record<string, string> = {
  "README.md": "# Todo System Mock Run\n",
  ".pi/settings.json": JSON.stringify(
    {
      defaultProvider: "google",
      defaultModel: "gemma-4-31b-it",
      defaultThinkingLevel: "high",
    },
    null,
    2,
  ),
};

export const TODO_MOCK_RUN_ISSUES: MockRunManifest["issues"] = [
  {
    key: "todo-system",
    title: "Todo system program",
    description: "Program epic for the deterministic mock-run todo system.",
    issueType: "epic",
    priority: 1,
    queueRole: "coordination",
    parentKey: null,
    blocks: [],
    labels: ["mock-run", "program"],
  },
  {
    key: "foundation",
    title: "Foundation slice",
    description: "Coordination epic for foundation work.",
    issueType: "epic",
    priority: 1,
    queueRole: "coordination",
    parentKey: "todo-system",
    blocks: [],
    labels: ["mock-run", "slice", "foundation"],
  },
  {
    key: "foundation.contract",
    title: "[foundation] Contract seed",
    description: "Lock the todo model, storage interface, and baseline test contract.",
    issueType: "task",
    priority: 1,
    queueRole: "executable",
    parentKey: "foundation",
    blocks: [],
    labels: ["mock-run", "foundation", "contract"],
  },
  {
    key: "foundation.lane_a",
    title: "[foundation] Lane A",
    description: "Implement task model and in-memory store behavior.",
    issueType: "task",
    priority: 1,
    queueRole: "executable",
    parentKey: "foundation",
    blocks: ["foundation.contract"],
    labels: ["mock-run", "foundation", "lane_a"],
  },
  {
    key: "foundation.lane_b",
    title: "[foundation] Lane B",
    description: "Implement shared validation and baseline test utilities.",
    issueType: "task",
    priority: 1,
    queueRole: "executable",
    parentKey: "foundation",
    blocks: ["foundation.contract"],
    labels: ["mock-run", "foundation", "lane_b"],
  },
  {
    key: "foundation.gate",
    title: "[foundation] Gate",
    description: "Prove the foundation slice and unlock commands.",
    issueType: "task",
    priority: 1,
    queueRole: "executable",
    parentKey: "foundation",
    blocks: ["foundation.lane_a", "foundation.lane_b"],
    labels: ["mock-run", "foundation", "gate"],
  },
  {
    key: "commands",
    title: "Commands slice",
    description: "Coordination epic for command work.",
    issueType: "epic",
    priority: 1,
    queueRole: "coordination",
    parentKey: "todo-system",
    blocks: [],
    labels: ["mock-run", "slice", "commands"],
  },
  {
    key: "commands.contract",
    title: "[commands] Contract seed",
    description: "Define command behavior for create, list, and complete flows.",
    issueType: "task",
    priority: 1,
    queueRole: "executable",
    parentKey: "commands",
    blocks: ["foundation.gate"],
    labels: ["mock-run", "commands", "contract"],
  },
  {
    key: "commands.lane_a",
    title: "[commands] Lane A",
    description: "Implement create and list commands.",
    issueType: "task",
    priority: 1,
    queueRole: "executable",
    parentKey: "commands",
    blocks: ["commands.contract"],
    labels: ["mock-run", "commands", "lane_a"],
  },
  {
    key: "commands.lane_b",
    title: "[commands] Lane B",
    description: "Implement complete-task behavior and command tests.",
    issueType: "task",
    priority: 1,
    queueRole: "executable",
    parentKey: "commands",
    blocks: ["commands.contract"],
    labels: ["mock-run", "commands", "lane_b"],
  },
  {
    key: "commands.gate",
    title: "[commands] Gate",
    description: "Prove the command slice and unlock integration.",
    issueType: "task",
    priority: 1,
    queueRole: "executable",
    parentKey: "commands",
    blocks: ["commands.lane_a", "commands.lane_b"],
    labels: ["mock-run", "commands", "gate"],
  },
  {
    key: "integration",
    title: "Integration slice",
    description: "Coordination epic for CLI and reporting work.",
    issueType: "epic",
    priority: 1,
    queueRole: "coordination",
    parentKey: "todo-system",
    blocks: [],
    labels: ["mock-run", "slice", "integration"],
  },
  {
    key: "integration.contract",
    title: "[integration] Contract seed",
    description: "Lock CLI integration, summary output, and end-to-end behavior.",
    issueType: "task",
    priority: 1,
    queueRole: "executable",
    parentKey: "integration",
    blocks: ["commands.gate"],
    labels: ["mock-run", "integration", "contract"],
  },
  {
    key: "integration.lane_a",
    title: "[integration] Lane A",
    description: "Implement CLI wiring.",
    issueType: "task",
    priority: 1,
    queueRole: "executable",
    parentKey: "integration",
    blocks: ["integration.contract"],
    labels: ["mock-run", "integration", "lane_a"],
  },
  {
    key: "integration.lane_b",
    title: "[integration] Lane B",
    description: "Implement reporting and end-to-end verification.",
    issueType: "task",
    priority: 1,
    queueRole: "executable",
    parentKey: "integration",
    blocks: ["integration.contract"],
    labels: ["mock-run", "integration", "lane_b"],
  },
  {
    key: "integration.gate",
    title: "[integration] Gate",
    description: "Prove the integrated todo system.",
    issueType: "task",
    priority: 1,
    queueRole: "executable",
    parentKey: "integration",
    blocks: ["integration.lane_a", "integration.lane_b"],
    labels: ["mock-run", "integration", "gate"],
  },
];

export const TODO_READY_QUEUE_EXPECTATION = ["foundation.contract"] as const;

export const TODO_MOCK_RUN_MANIFEST: MockRunManifest = {
  repoName: "aegis-mock-run",
  beadsPrefix: "aegismockrun",
  baselineFiles: TODO_BASELINE_FILES,
  issues: TODO_MOCK_RUN_ISSUES,
  expectedInitialReadyKeys: [...TODO_READY_QUEUE_EXPECTATION],
};
```

- [ ] **Step 5: Run the unit test to verify it passes**

Run: `npm run test -- tests/unit/mock-run/todo-manifest.test.ts`
Expected: PASS

- [ ] **Step 6: Commit the manifest contract**

```bash
git add src/mock-run/types.ts src/mock-run/todo-manifest.ts tests/unit/mock-run/todo-manifest.test.ts
git commit -m "feat: define mock run manifest contracts"
```

### Task 2: Implement the repo recreation and seeding flow

**Files:**
- Create: `src/mock-run/seed-mock-run.ts`
- Test: `tests/integration/mock-run/seed-mock-run.test.ts`

- [ ] **Step 1: Write the failing integration test for repo recreation and seeded queue state**

```ts
import path from "node:path";
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
  });
});
```

- [ ] **Step 2: Run the integration test to verify it fails**

Run: `npm run test -- tests/integration/mock-run/seed-mock-run.test.ts`
Expected: FAIL with `Cannot find module '../../../src/mock-run/seed-mock-run.js'`

- [ ] **Step 3: Implement the seeder entry point and command runner helpers**

```ts
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { initProject } from "../config/init-project.js";
import { TODO_MOCK_RUN_MANIFEST } from "./todo-manifest.js";

function run(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  }).trim();
}

export async function seedMockRun(options?: {
  workspaceRoot?: string;
  repoName?: string;
  beadsPrefix?: string;
}) {
  const workspaceRoot = path.resolve(options?.workspaceRoot ?? process.cwd());
  const repoName = options?.repoName ?? TODO_MOCK_RUN_MANIFEST.repoName;
  const repoRoot = path.join(workspaceRoot, repoName);

  rmSync(repoRoot, { recursive: true, force: true });
  mkdirSync(repoRoot, { recursive: true });

  run("git", ["init"], repoRoot);
  run("git", ["config", "user.email", "mock-run@aegis.local"], repoRoot);
  run("git", ["config", "user.name", "Aegis Mock Run"], repoRoot);

  initProject(repoRoot);

  return {
    repoRoot,
    issueIdByKey: {},
    initialReadyKeys: [],
  };
}
```

- [ ] **Step 4: Expand the seeder to write baseline files, initialize Beads, create the baseline commit, seed issues, seed dependencies, verify ready queue, and write `.aegis/mock-run-manifest.json`**

```ts
for (const [relativePath, contents] of Object.entries(TODO_MOCK_RUN_MANIFEST.baselineFiles)) {
  const targetPath = path.join(repoRoot, relativePath);
  mkdirSync(path.dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, `${contents}\n`, "utf8");
}

run(
  "bd",
  [
    "init",
    "-p",
    beadsPrefix,
    "--server",
    "--shared-server",
    "--server-port",
    "3308",
    "--skip-hooks",
    "--skip-agents",
  ],
  repoRoot,
);

run("git", ["add", "--all"], repoRoot);
run("git", ["commit", "-m", "mock baseline"], repoRoot);
run("git", ["branch", "-M", "main"], repoRoot);

const issueIdByKey: Record<string, string> = {};
for (const issue of TODO_MOCK_RUN_MANIFEST.issues) {
  const created = JSON.parse(
    run(
      "bd",
      [
        "create",
        "--title",
        issue.title,
        "--description",
        issue.description,
        "--type",
        issue.issueType,
        "--priority",
        String(issue.priority),
        "--json",
      ],
      repoRoot,
    ),
  ) as { id: string };

  issueIdByKey[issue.key] = created.id;
}
```

- [ ] **Step 5: Run the integration test to verify it passes**

Run: `npm run test -- tests/integration/mock-run/seed-mock-run.test.ts`
Expected: PASS

- [ ] **Step 6: Commit the seeding implementation**

```bash
git add src/mock-run/seed-mock-run.ts tests/integration/mock-run/seed-mock-run.test.ts
git commit -m "feat: implement mock run repo seeder"
```

### Task 3: Wire the user-facing script and ignore rules

**Files:**
- Modify: `.gitignore`
- Modify: `package.json`
- Test: `tests/integration/mock-run/seed-mock-run.test.ts`

- [ ] **Step 1: Extend the integration test to assert the generated repo is configured for Gemma 4 and the tracked repo ignores `aegis-mock-run/`**

```ts
it("writes gemma defaults and the tracked repo ignores the generated directory", async () => {
  const result = await seedMockRun({
    workspaceRoot: sandboxRoot,
    repoName: "aegis-mock-run",
    beadsPrefix: "mockrunseed",
  });

  const piSettings = readFileSync(
    path.join(result.repoRoot, ".pi", "settings.json"),
    "utf8",
  );

  expect(piSettings).toContain("gemma-4-31b-it");
});
```

- [ ] **Step 2: Run the integration test to verify it fails on missing script and ignore wiring**

Run: `npm run test -- tests/integration/mock-run/seed-mock-run.test.ts`
Expected: FAIL on missing `mock:seed` script and/or missing ignore entry

- [ ] **Step 3: Add the tracked ignore rule and npm script**

```json
{
  "scripts": {
    "mock:seed": "tsx src/mock-run/seed-mock-run.ts"
  }
}
```

```gitignore
aegis-mock-run/
```

- [ ] **Step 4: Update the seeder entry point to run as a CLI**

```ts
if (import.meta.url === new URL(process.argv[1], "file:").href) {
  seedMockRun().then((result) => {
    console.log(`Mock repo seeded at ${result.repoRoot}`);
  });
}
```

- [ ] **Step 5: Run the integration test again**

Run: `npm run test -- tests/integration/mock-run/seed-mock-run.test.ts`
Expected: PASS

- [ ] **Step 6: Commit the script wiring**

```bash
git add .gitignore package.json src/mock-run/seed-mock-run.ts tests/integration/mock-run/seed-mock-run.test.ts
git commit -m "feat: expose mock run seeder command"
```

### Task 4: Prove deterministic dependency ordering and lane parallelism

**Files:**
- Modify: `src/mock-run/seed-mock-run.ts`
- Modify: `tests/integration/mock-run/seed-mock-run.test.ts`
- Modify: `docs/superpowers/aegis-execution-workflow.md`

- [ ] **Step 1: Add a failing test for the contract-to-lane transition**

```ts
it("makes both foundation lanes ready after the contract closes", async () => {
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
  ) as Array<{ title: string }>;

  expect(ready.map((issue) => issue.title)).toEqual([
    "[foundation] Lane A",
    "[foundation] Lane B",
  ]);
});
```

- [ ] **Step 2: Run the focused integration test to verify it fails**

Run: `npm run test -- tests/integration/mock-run/seed-mock-run.test.ts`
Expected: FAIL because the seeder does not yet persist enough issue metadata or enforce the expected titles exactly

- [ ] **Step 3: Finalize the seeder return shape and manifest output**

```ts
export interface SeedMockRunResult {
  repoRoot: string;
  issueIdByKey: Record<string, string>;
  initialReadyKeys: string[];
  manifestPath: string;
}
```

Write `.aegis/mock-run-manifest.json` with:

```json
{
  "repoRoot": "C:/dev/aegis/aegis-mock-run",
  "generatedAt": "2026-04-09T00:00:00.000Z",
  "issueIdByKey": {
    "foundation.contract": "mockrun-abc"
  },
  "initialReadyKeys": ["foundation.contract"]
}
```

- [ ] **Step 4: Document the new black-box workflow**

```md
## Mock Run Seeder

Use `npm run mock:seed` to recreate `aegis-mock-run/` from scratch with a deterministic todo-system issue graph.

After the seed completes:

- run `bd ready --json` in `aegis-mock-run/`
- process `foundation.contract`
- verify the two foundation lanes become ready in parallel
```

- [ ] **Step 5: Run the targeted checks for the touched surface**

Run: `npm run test -- tests/unit/mock-run/todo-manifest.test.ts tests/integration/mock-run/seed-mock-run.test.ts`
Expected: PASS

- [ ] **Step 6: Run the broader repo checks**

Run: `npm run test`
Expected: PASS, or if pre-existing failures remain, only the known unrelated failures should remain and must be called out explicitly

Run: `npm run lint`
Expected: PASS

Run: `npm run build`
Expected: PASS; if blocked by an unrelated main-branch failure, document it and either fix the blocker in-scope or surface it in the final PR context

- [ ] **Step 7: Commit the final verification and docs updates**

```bash
git add src/mock-run/seed-mock-run.ts tests/integration/mock-run/seed-mock-run.test.ts docs/superpowers/aegis-execution-workflow.md
git commit -m "feat: validate mock run queue progression"
```
