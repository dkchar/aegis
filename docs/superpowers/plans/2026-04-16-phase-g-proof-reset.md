# Phase G Proof Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish Phase G by narrowing CI to deterministic seam tests, moving end-to-end proof to seeded mock-run acceptance, and syncing the emergency triage docs/handoff notes to the actual post-Phase-F repo state.

**Architecture:** Keep production orchestration behavior intact. Carve acceptance-only verification out of the default Vitest/CI path, add a focused mock-run proof helper that drives the existing seeded repo surface, and update the source-of-truth docs so proof expectations match what the repository now proves.

**Tech Stack:** TypeScript, Vitest, Node.js CLI scripts, GitHub Actions, Beads-backed mock-run repo seeding.

---

### Task 1: Split seam tests from acceptance-only bootstrap checks

**Files:**
- Modify: `package.json`
- Modify: `vitest.config.ts`
- Modify: `tests/unit/bootstrap/project-skeleton.test.ts`

- [ ] **Step 1: Write the failing test for the Phase G CI contract**

```ts
it("keeps npm test focused on deterministic seam coverage", () => {
  const packageJson = readJson<RootPackageJson>("package.json");
  const scripts = packageJson.scripts ?? {};

  expect(scripts.test).toBe("vitest run --config vitest.config.ts");
  expect(scripts["test:acceptance"]).toBe("vitest run --config vitest.config.ts --project acceptance");
});
```

- [ ] **Step 2: Write the failing Vitest project assertion**

```ts
it("separates seam tests from acceptance-only checks", async () => {
  const vitestConfig = (await import(
    pathToFileURL(path.join(repoRoot, "vitest.config.ts")).href
  )).default;

  expect(vitestConfig.test?.projects).toEqual([
    expect.objectContaining({
      test: expect.objectContaining({
        name: "default",
      }),
    }),
    expect.objectContaining({
      test: expect.objectContaining({
        name: "acceptance",
      }),
    }),
  ]);
});
```

- [ ] **Step 3: Run the targeted bootstrap test to verify it fails**

Run: `npm test -- tests/unit/bootstrap/project-skeleton.test.ts`
Expected: FAIL because `test:acceptance` and the acceptance project do not exist yet.

- [ ] **Step 4: Implement the minimal test split**

```ts
// package.json
"scripts": {
  "test": "vitest run --config vitest.config.ts --project default",
  "test:acceptance": "vitest run --config vitest.config.ts --project acceptance"
}
```

```ts
// vitest.config.ts
export default defineConfig({
  test: {
    testTimeout: 60000,
    projects: [
      {
        test: {
          name: "default",
          include: ["tests/**/*.{test,spec}.{ts,tsx}"],
          exclude: ["tests/acceptance/**/*.{test,spec}.{ts,tsx}"],
          environment: "node",
        },
      },
      {
        test: {
          name: "acceptance",
          include: ["tests/acceptance/**/*.{test,spec}.{ts,tsx}"],
          environment: "node",
        },
      },
    ],
  },
});
```

```ts
// tests/unit/bootstrap/project-skeleton.test.ts
it("uses a seam-only default Vitest project and a separate acceptance lane", async () => {
  expect(vitestConfig.default.test?.projects).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        test: expect.objectContaining({ name: "default" }),
      }),
      expect.objectContaining({
        test: expect.objectContaining({ name: "acceptance" }),
      }),
    ]),
  );
});
```

- [ ] **Step 5: Move bootstrap subprocess assertions into acceptance scope**

```ts
// tests/acceptance/bootstrap/project-skeleton.acceptance.test.ts
describe("bootstrap acceptance", () => {
  it("builds the CLI, runs the built entrypoint, and verifies npm pack output", () => {
    expect(buildRun.status).toBe(0);
    expect(cliRun.status).toBe(0);
    expect(packRun.status).toBe(0);
  });
});
```

- [ ] **Step 6: Run the seam and acceptance lanes**

Run: `npm test -- tests/unit/bootstrap/project-skeleton.test.ts`
Expected: PASS

Run: `npm run test:acceptance -- tests/acceptance/bootstrap/project-skeleton.acceptance.test.ts`
Expected: PASS

- [ ] **Step 7: Commit the test-lane split**

```bash
git add package.json vitest.config.ts tests/unit/bootstrap/project-skeleton.test.ts tests/acceptance/bootstrap/project-skeleton.acceptance.test.ts
git commit -m "test: split seam and acceptance lanes"
```

### Task 2: Add seeded mock-run acceptance proof helper

**Files:**
- Create: `src/mock-run/acceptance.ts`
- Modify: `package.json`
- Test: `tests/unit/mock-run/acceptance.test.ts`

- [ ] **Step 1: Write the failing acceptance helper sequencing test**

```ts
it("seeds a repo, drives the happy-path commands, and stops the daemon", async () => {
  const seedMockRun = vi.fn(async () => ({
    repoRoot: "repo/aegis-mock-run",
    databaseName: "aegismockrun-test",
    issueIdByKey: { "foundation.contract": "ISSUE-1" },
    initialReadyKeys: ["foundation.contract"],
    manifestPath: "repo/aegis-mock-run/.aegis/mock-run-manifest.json",
  }));
  const runMockCommand = vi.fn(async () => undefined);

  await runMockAcceptance({
    seedMockRun,
    runMockCommand,
  });

  expect(runMockCommand.mock.calls.map(([args]) => args.join(" "))).toEqual([
    "node ../dist/index.js start",
    "node ../dist/index.js scout ISSUE-1",
    "node ../dist/index.js implement ISSUE-1",
    "node ../dist/index.js process ISSUE-1",
    "node ../dist/index.js merge next",
    "node ../dist/index.js stop",
  ]);
});
```

- [ ] **Step 2: Write the failing proof-surface assertion**

```ts
it("verifies dispatch, merge, and artifact outputs after the happy path", async () => {
  expect(() => validateMockAcceptanceArtifacts("repo/aegis-mock-run", "ISSUE-1")).not.toThrow();
});
```

- [ ] **Step 3: Run the targeted mock-run helper test to verify it fails**

Run: `npm test -- tests/unit/mock-run/acceptance.test.ts`
Expected: FAIL because the helper does not exist yet.

- [ ] **Step 4: Implement the minimal helper and script**

```ts
// src/mock-run/acceptance.ts
export async function runMockAcceptance(...) {
  const seeded = await seedMockRun();
  const issueId = seeded.issueIdByKey["foundation.contract"];

  await runMockCommand(["node", "../dist/index.js", "start"], { mockDir: seeded.repoRoot });
  await runMockCommand(["node", "../dist/index.js", "scout", issueId], { mockDir: seeded.repoRoot });
  await runMockCommand(["node", "../dist/index.js", "implement", issueId], { mockDir: seeded.repoRoot });
  await runMockCommand(["node", "../dist/index.js", "process", issueId], { mockDir: seeded.repoRoot });
  await runMockCommand(["node", "../dist/index.js", "merge", "next"], { mockDir: seeded.repoRoot });
  validateMockAcceptanceArtifacts(seeded.repoRoot, issueId);
  await runMockCommand(["node", "../dist/index.js", "stop"], { mockDir: seeded.repoRoot });
}
```

```json
// package.json
"mock:acceptance": "tsx src/mock-run/acceptance.ts"
```

- [ ] **Step 5: Run the targeted helper test to verify it passes**

Run: `npm test -- tests/unit/mock-run/acceptance.test.ts`
Expected: PASS

- [ ] **Step 6: Commit the proof helper**

```bash
git add package.json src/mock-run/acceptance.ts tests/unit/mock-run/acceptance.test.ts
git commit -m "feat: add seeded mock-run proof helper"
```

### Task 3: Sync source-of-truth docs and handoff notes to Phase G reality

**Files:**
- Modify: `docs/superpowers/specs/2026-04-13-aegis-emergency-mvp-triage-design.md`
- Modify: `docs/superpowers/plans/2026-04-14-phase-g-proof-reset-handoff-prompt.md`
- Modify: `docs/superpowers/plans/2026-04-16-phase-g-proof-reset.md`

- [ ] **Step 1: Write the failing documentation assertion**

```ts
it("marks Phase G complete and points end-to-end proof at seeded mock-run acceptance", () => {
  const spec = readFileSync(path.join(repoRoot, "docs/superpowers/specs/2026-04-13-aegis-emergency-mvp-triage-design.md"), "utf8");

  expect(spec).toContain("Phase G complete");
  expect(spec).toContain("seeded mock-run acceptance");
  expect(spec).not.toContain("currently proves the Phase D loop shell");
});
```

- [ ] **Step 2: Run the doc/bootstrap test to verify it fails**

Run: `npm test -- tests/unit/bootstrap/project-skeleton.test.ts`
Expected: FAIL because the docs still describe pre-Phase-G proof state.

- [ ] **Step 3: Update the spec and handoff note**

```md
- Phase G complete on 2026-04-16.
- CI runs deterministic seam tests only.
- Seeded mock-run acceptance is the end-to-end proof surface.
- The old Phase G handoff prompt now becomes a completion note for the emergency rewrite rather than an open implementation prompt.
```

- [ ] **Step 4: Re-run the bootstrap/doc assertions**

Run: `npm test -- tests/unit/bootstrap/project-skeleton.test.ts`
Expected: PASS

- [ ] **Step 5: Commit the doc sync**

```bash
git add docs/superpowers/specs/2026-04-13-aegis-emergency-mvp-triage-design.md docs/superpowers/plans/2026-04-14-phase-g-proof-reset-handoff-prompt.md docs/superpowers/plans/2026-04-16-phase-g-proof-reset.md tests/unit/bootstrap/project-skeleton.test.ts
git commit -m "docs: complete phase g proof reset"
```

## Self-Review

- Phase G stays scoped to proof/reset work. It does not reopen queue mechanics, restart/requeue recovery verbs, UI/SSE, economics, or tracker semantics.
- Default CI/test execution becomes seam-only, while acceptance-heavy bootstrap and mock-run proof move into explicit non-CI lanes.
- Documentation must describe the repository as it exists after Phase F plus Phase G, not as it looked during Phase D.
