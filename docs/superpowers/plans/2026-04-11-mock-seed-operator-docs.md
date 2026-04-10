# Mock Seed and Operator Docs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `npm run mock:seed` into a deterministic scratchpad repo generator with no seeded example app source, and add operator-facing docs plus a deterministic steer reference that make Aegis usable without source spelunking.

**Architecture:** Simplify the mock-run manifest so it seeds only bootstrap files and the Beads graph, refactor the seeder to write a bare repo plus runtime config, and add operator docs plus a canonical steer command catalog that can be rendered consistently in docs and Olympus.

**Tech Stack:** TypeScript, existing mock-run module, Node.js `fs/path/child_process`, markdown docs, Vitest

---

### Task 1: Remove the seeded example app baseline from the mock-run manifest

**Files:**
- Modify: `src/mock-run/todo-manifest.ts`
- Modify: `src/mock-run/types.ts`
- Modify: `tests/unit/mock-run/todo-manifest.test.ts`

- [ ] **Step 1: Write the failing manifest test for a source-free scratchpad seed**

```ts
it("defines a scratchpad baseline with no seeded src or tests tree", () => {
  expect(Object.keys(TODO_BASELINE_FILES)).toEqual([
    ".gitignore",
    ".pi/settings.json",
  ]);
  expect(Object.keys(TODO_BASELINE_FILES).some((key) => key.startsWith("src/"))).toBe(false);
  expect(Object.keys(TODO_BASELINE_FILES).some((key) => key.startsWith("tests/"))).toBe(false);
  expect(TODO_READY_QUEUE_EXPECTATION).toEqual(["foundation.contract"]);
});
```

- [ ] **Step 2: Run the manifest test to verify it fails**

Run: `npm run test -- tests/unit/mock-run/todo-manifest.test.ts`
Expected: FAIL because the current baseline still seeds the todo app files

- [ ] **Step 3: Replace the baseline file map with a minimal scratchpad bootstrap**

```ts
export const TODO_BASELINE_FILES: Record<string, string> = {
  ".gitignore": [
    ".dolt/",
    "*.db",
    ".beads-credential-key",
    ".aegis/config.json",
    ".aegis/dispatch-state.json",
    ".aegis/merge-queue.json",
    ".aegis/mnemosyne.jsonl",
    ".aegis/runtime-state.json",
    ".aegis/labors/",
    ".aegis/evals/",
    ".aegis/mock-run-manifest.json",
    ".aegis/oracle/",
  ].join("\n"),
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
```

- [ ] **Step 4: Re-run the manifest test**

Run: `npm run test -- tests/unit/mock-run/todo-manifest.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/mock-run/todo-manifest.ts src/mock-run/types.ts tests/unit/mock-run/todo-manifest.test.ts
git commit -m "feat: make mock seed a bare scratchpad baseline"
```

### Task 2: Update the seeder to write only the minimal repo bootstrap and deterministic issue graph

**Files:**
- Modify: `src/mock-run/seed-mock-run.ts`
- Modify: `tests/integration/mock-run/seed-mock-run.test.ts`
- Modify: `tests/unit/mock-run/todo-manifest.test.ts`

- [ ] **Step 1: Add a failing integration test for a bare seeded repo**

```ts
it("creates a seeded repo without example source files", async () => {
  const result = await seedMockRun({ workspaceRoot: tempRoot, repoName: "scratchpad" });

  expect(existsSync(path.join(result.repoRoot, "src"))).toBe(false);
  expect(existsSync(path.join(result.repoRoot, "tests"))).toBe(false);
  expect(parseReadyQueue(result.repoRoot)).toEqual(["foundation.contract"]);
});
```

- [ ] **Step 2: Run the integration test to verify it fails**

Run: `npm run test -- tests/integration/mock-run/seed-mock-run.test.ts`
Expected: FAIL because the current seeder still writes the example app baseline

- [ ] **Step 3: Refactor the seeder to write only bootstrap files, run `aegis init`, and seed Beads**

```ts
for (const [relativePath, contents] of Object.entries(TODO_BASELINE_FILES)) {
  writeProjectFile(repoRoot, relativePath, contents);
}

run("git", ["init"], repoRoot);
run("bd", ["init", "--server", "--shared-server", "--skip-agents"], repoRoot);
initProject(repoRoot);
writeProjectFile(repoRoot, ".aegis/config.json", JSON.stringify(buildMockRunConfig(), null, 2));
```

- [ ] **Step 4: Re-run the mock-run integration test**

Run: `npm run test -- tests/integration/mock-run/seed-mock-run.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/mock-run/seed-mock-run.ts tests/integration/mock-run/seed-mock-run.test.ts tests/unit/mock-run/todo-manifest.test.ts
git commit -m "feat: seed bare mock scratchpad repos"
```

### Task 3: Centralize the deterministic steer reference and use it in docs and Olympus

**Files:**
- Create: `src/shared/steer-command-reference.ts`
- Modify: `olympus/src/components/steer-panel.tsx`
- Create: `tests/unit/shared/steer-command-reference.test.ts`

- [ ] **Step 1: Write the failing steer-reference contract test**

```ts
import { describe, expect, it } from "vitest";

import { STEER_COMMAND_REFERENCE } from "../../../src/shared/steer-command-reference.js";

describe("STEER_COMMAND_REFERENCE", () => {
  it("lists the deterministic MVP steer commands", () => {
    expect(STEER_COMMAND_REFERENCE.map((entry) => entry.command)).toEqual([
      "status",
      "pause",
      "resume",
      "focus <issue-id>",
      "kill <agent-id>",
    ]);
  });
});
```

- [ ] **Step 2: Run the steer-reference test to verify it fails**

Run: `npm run test -- tests/unit/shared/steer-command-reference.test.ts`
Expected: FAIL with `Cannot find module '../../../src/shared/steer-command-reference.js'`

- [ ] **Step 3: Add the shared steer catalog and render it in Olympus**

```ts
export const STEER_COMMAND_REFERENCE = [
  { command: "status", description: "Show current loop and queue status." },
  { command: "pause", description: "Pause dispatching new work." },
  { command: "resume", description: "Resume the paused loop." },
  { command: "focus <issue-id>", description: "Pin attention to one ready or active issue." },
  { command: "kill <agent-id>", description: "Abort one live agent session." },
] as const;
```

- [ ] **Step 4: Re-run the steer-reference test**

Run: `npm run test -- tests/unit/shared/steer-command-reference.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/steer-command-reference.ts olympus/src/components/steer-panel.tsx tests/unit/shared/steer-command-reference.test.ts
git commit -m "feat: centralize deterministic steer reference"
```

### Task 4: Write operator-facing docs and add a docs contract test

**Files:**
- Create: `docs/operator-quickstart.md`
- Create: `docs/olympus-operator-guide.md`
- Create: `docs/steer-reference.md`
- Create: `docs/mock-seed-guide.md`
- Create: `tests/unit/docs/operator-docs.test.ts`
- Modify: `docs/superpowers/aegis-execution-workflow.md`

- [ ] **Step 1: Write the failing docs contract test**

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

describe("operator docs", () => {
  it("publish the quickstart, olympus guide, steer reference, and mock seed guide", () => {
    const quickstart = readFileSync(path.join(repoRoot, "docs/operator-quickstart.md"), "utf8");
    const olympusGuide = readFileSync(path.join(repoRoot, "docs/olympus-operator-guide.md"), "utf8");
    const steerReference = readFileSync(path.join(repoRoot, "docs/steer-reference.md"), "utf8");
    const mockSeedGuide = readFileSync(path.join(repoRoot, "docs/mock-seed-guide.md"), "utf8");

    expect(quickstart).toContain("aegis start");
    expect(olympusGuide).toContain("Aegis Loop");
    expect(steerReference).toContain("focus <issue-id>");
    expect(mockSeedGuide).toContain("scratchpad");
  });
});
```

- [ ] **Step 2: Run the docs contract test to verify it fails**

Run: `npm run test -- tests/unit/docs/operator-docs.test.ts`
Expected: FAIL because the docs files do not exist yet

- [ ] **Step 3: Write the operator docs and update the execution workflow doc**

```md
# Operator Quickstart

## Prerequisites

- Node.js
- git
- Beads CLI (`bd`)
- configured runtime provider (Pi in MVP)

## First launch in an arbitrary repo

1. `bd init` or `bd onboard`
2. `aegis init`
3. `aegis start`
4. If preflight passes, Olympus opens and shows the Aegis Loop shell
```

- [ ] **Step 4: Re-run the docs contract test**

Run: `npm run test -- tests/unit/docs/operator-docs.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add docs/operator-quickstart.md docs/olympus-operator-guide.md docs/steer-reference.md docs/mock-seed-guide.md docs/superpowers/aegis-execution-workflow.md tests/unit/docs/operator-docs.test.ts
git commit -m "docs: add operator quickstart and steer reference"
```

### Task 5: Run the mock seed and operator-doc verification bundle

**Files:**
- Modify: `tests/integration/mock-run/seed-mock-run.test.ts`
- Modify: `tests/unit/docs/operator-docs.test.ts`

- [ ] **Step 1: Run the focused verification bundle**

Run: `npm run test -- tests/unit/mock-run/todo-manifest.test.ts tests/integration/mock-run/seed-mock-run.test.ts tests/unit/shared/steer-command-reference.test.ts tests/unit/docs/operator-docs.test.ts`
Expected: PASS

- [ ] **Step 2: Run the seed command manually and verify the scratchpad shape**

Run: `npm run mock:seed`
Expected: PASS and `aegis-mock-run/` contains no seeded `src/` or `tests/` tree

- [ ] **Step 3: Commit any final doc/test adjustments**

```bash
git add tests/integration/mock-run/seed-mock-run.test.ts tests/unit/docs/operator-docs.test.ts
git commit -m "test: verify mock seed and operator docs"
```

