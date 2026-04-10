# Aegis Startup and Preflight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `aegis start` block on clear startup preflight checks for arbitrary repositories, and make `aegis init` add non-invasive repo-local `aegis:*` npm aliases when possible.

**Architecture:** Introduce an explicit startup-preflight module under `src/cli/` that returns structured check results plus a formatter, then wire `start.ts` to run that module before server startup or browser open. Keep package-script alias installation isolated in a config helper so `initProject()` stays idempotent and never rewrites user-owned scripts.

**Tech Stack:** TypeScript, Node.js `fs/path/child_process`, existing CLI/config modules, Vitest

---

### Task 1: Add a structured startup preflight module

**Files:**
- Create: `src/cli/startup-preflight.ts`
- Create: `tests/unit/cli/startup-preflight.test.ts`

- [ ] **Step 1: Write the failing startup preflight unit test**

```ts
import { describe, expect, it } from "vitest";

import {
  formatStartupPreflight,
  runStartupPreflight,
  type StartupPreflightDependencies,
} from "../../../src/cli/startup-preflight.js";

function makeDeps(overrides: Partial<StartupPreflightDependencies> = {}): StartupPreflightDependencies {
  return {
    verifyGitRepo: () => undefined,
    probeBeadsCli: () => ({ ok: true }),
    probeBeadsRepo: () => ({ ok: true }),
    loadConfig: () => ({
      runtime: "pi",
      models: { oracle: "pi:default", titan: "pi:default", sentinel: "pi:default", janus: "pi:default", metis: "pi:default", prometheus: "pi:default" },
    }),
    verifyRuntimeAdapter: () => ({ ok: true }),
    verifyRuntimeLocalConfig: () => ({ ok: true }),
    verifyModelRefs: () => ({ ok: true }),
    verifyRuntimeStatePaths: () => ({ ok: true }),
    ...overrides,
  };
}

describe("runStartupPreflight", () => {
  it("returns blocked when the Beads repository is missing", () => {
    const report = runStartupPreflight("C:/repo", makeDeps({
      probeBeadsRepo: () => ({
        ok: false,
        detail: "Beads tracker is not initialized.",
        fix: "run `bd init` or `bd onboard` in this repository",
      }),
    }));

    expect(report.overall).toBe("blocked");
    expect(report.checks.map((check) => [check.id, check.status])).toEqual([
      ["git_repo", "pass"],
      ["beads_cli", "pass"],
      ["beads_repo", "fail"],
      ["aegis_config", "skipped"],
      ["runtime_adapter", "skipped"],
      ["runtime_local_config", "skipped"],
      ["model_refs", "skipped"],
      ["runtime_state_paths", "skipped"],
    ]);
    expect(formatStartupPreflight(report)).toContain("fix: run `bd init` or `bd onboard` in this repository");
  });
});
```

- [ ] **Step 2: Run the unit test to verify it fails**

Run: `npm run test -- tests/unit/cli/startup-preflight.test.ts`
Expected: FAIL with `Cannot find module '../../../src/cli/startup-preflight.js'`

- [ ] **Step 3: Implement the structured preflight contract**

```ts
export type StartupPreflightCheckId =
  | "git_repo"
  | "beads_cli"
  | "beads_repo"
  | "aegis_config"
  | "runtime_adapter"
  | "runtime_local_config"
  | "model_refs"
  | "runtime_state_paths";

export interface StartupPreflightCheck {
  id: StartupPreflightCheckId;
  label: string;
  status: "pass" | "fail" | "skipped";
  detail: string;
  fix?: string;
}

export interface StartupPreflightReport {
  overall: "ready" | "blocked";
  repoRoot: string;
  checks: StartupPreflightCheck[];
}

export function runStartupPreflight(
  repoRoot: string,
  deps: StartupPreflightDependencies,
): StartupPreflightReport {
  const checks: StartupPreflightCheck[] = [];

  const push = (check: StartupPreflightCheck) => {
    checks.push(check);
    return check.status !== "fail";
  };

  if (!push({ id: "git_repo", label: "git repo", ...toCheckResult(deps.verifyGitRepo()) })) {
    return blocked(repoRoot, checks, ["beads_cli", "beads_repo", "aegis_config", "runtime_adapter", "runtime_local_config", "model_refs", "runtime_state_paths"]);
  }

  if (!push({ id: "beads_cli", label: "beads cli", ...toCheckResult(deps.probeBeadsCli()) })) {
    return blocked(repoRoot, checks, ["beads_repo", "aegis_config", "runtime_adapter", "runtime_local_config", "model_refs", "runtime_state_paths"]);
  }

  if (!push({ id: "beads_repo", label: "beads repo", ...toCheckResult(deps.probeBeadsRepo()) })) {
    return blocked(repoRoot, checks, ["aegis_config", "runtime_adapter", "runtime_local_config", "model_refs", "runtime_state_paths"]);
  }

  const config = deps.loadConfig();
  push({ id: "aegis_config", label: "aegis config", status: "pass", detail: "Config loaded." });
  push({ id: "runtime_adapter", label: "runtime adapter", ...toCheckResult(deps.verifyRuntimeAdapter(config)) });
  push({ id: "runtime_local_config", label: "runtime config", ...toCheckResult(deps.verifyRuntimeLocalConfig(config)) });
  push({ id: "model_refs", label: "model refs", ...toCheckResult(deps.verifyModelRefs(config)) });
  push({ id: "runtime_state_paths", label: "runtime state paths", ...toCheckResult(deps.verifyRuntimeStatePaths(repoRoot)) });

  return {
    overall: checks.some((check) => check.status === "fail") ? "blocked" : "ready",
    repoRoot,
    checks,
  };
}
```

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `npm run test -- tests/unit/cli/startup-preflight.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/startup-preflight.ts tests/unit/cli/startup-preflight.test.ts
git commit -m "feat: add startup preflight contract"
```

### Task 2: Wire `aegis start` to block before server startup or browser open

**Files:**
- Modify: `src/cli/start.ts`
- Modify: `tests/integration/cli/start-stop.test.ts`
- Modify: `tests/unit/cli/browser-and-stop-contract.test.ts`

- [ ] **Step 1: Add failing start-path tests for blocked preflight**

```ts
it("does not start the server or open the browser when preflight is blocked", async () => {
  const openBrowser = vi.fn(() => true);
  const verifyTracker = vi.fn(() => {
    throw new Error("Beads tracker is not initialized or healthy for this repository.");
  });

  await expect(
    startAegis(repoRoot, {}, { verifyTracker, openBrowser, registerSignalHandlers: false }),
  ).rejects.toThrow("Aegis startup preflight blocked.");

  expect(openBrowser).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the targeted CLI tests to verify they fail**

Run: `npm run test -- tests/integration/cli/start-stop.test.ts tests/unit/cli/browser-and-stop-contract.test.ts`
Expected: FAIL because `startAegis()` still starts from ad-hoc checks instead of the preflight report

- [ ] **Step 3: Integrate the preflight module into `start.ts`**

```ts
const preflight = runStartupPreflight(repoRoot, {
  verifyGitRepo: () => ({ ok: verifyGitRepository(repoRoot) === undefined, detail: "Inside a git worktree." }),
  probeBeadsCli: () => probeBeadsCli(),
  probeBeadsRepo: () => probeBeadsRepository(repoRoot),
  loadConfig: () => loadConfig(repoRoot),
  verifyRuntimeAdapter: (config) => verifyRuntimeAdapter(config.runtime),
  verifyRuntimeLocalConfig: (config) => verifyRuntimeLocalConfig(repoRoot, config),
  verifyModelRefs: (config) => verifyConfiguredModels(config),
  verifyRuntimeStatePaths: (root) => verifyRuntimeStatePaths(root),
});

if (preflight.overall === "blocked") {
  console.error(formatStartupPreflight(preflight));
  throw new Error("Aegis startup preflight blocked.");
}
```

- [ ] **Step 4: Re-run the targeted CLI tests**

Run: `npm run test -- tests/integration/cli/start-stop.test.ts tests/unit/cli/browser-and-stop-contract.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/start.ts tests/integration/cli/start-stop.test.ts tests/unit/cli/browser-and-stop-contract.test.ts
git commit -m "feat: gate aegis start behind preflight"
```

### Task 3: Add non-invasive repo-local `aegis:*` package aliases during `aegis init`

**Files:**
- Create: `src/config/package-json-aliases.ts`
- Modify: `src/config/init-project.ts`
- Modify: `tests/integration/config/init-project.test.ts`

- [ ] **Step 1: Add a failing init-project test for package alias installation**

```ts
it("adds aegis package aliases without overwriting existing scripts", () => {
  const packageJsonPath = path.join(repoRoot, "package.json");
  writeFileSync(packageJsonPath, JSON.stringify({
    name: "demo-repo",
    scripts: {
      start: "vite",
      test: "vitest",
    },
  }, null, 2));

  initProject(repoRoot);

  const updated = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  expect(updated.scripts.start).toBe("vite");
  expect(updated.scripts["aegis:init"]).toBe("aegis init");
  expect(updated.scripts["aegis:start"]).toBe("aegis start");
  expect(updated.scripts["aegis:status"]).toBe("aegis status");
  expect(updated.scripts["aegis:stop"]).toBe("aegis stop");
});
```

- [ ] **Step 2: Run the init-project test to verify it fails**

Run: `npm run test -- tests/integration/config/init-project.test.ts`
Expected: FAIL because `initProject()` does not yet inspect or update `package.json`

- [ ] **Step 3: Implement a dedicated package-alias helper and wire it into `initProject()`**

```ts
export const AEGIS_PACKAGE_SCRIPTS = {
  "aegis:init": "aegis init",
  "aegis:start": "aegis start",
  "aegis:status": "aegis status",
  "aegis:stop": "aegis stop",
} as const;

export function ensureAegisPackageScripts(packageJson: Record<string, unknown>) {
  const scripts = isRecord(packageJson.scripts) ? { ...packageJson.scripts } : {};
  let changed = false;

  for (const [name, command] of Object.entries(AEGIS_PACKAGE_SCRIPTS)) {
    if (!(name in scripts)) {
      scripts[name] = command;
      changed = true;
    }
  }

  return {
    changed,
    packageJson: changed ? { ...packageJson, scripts } : packageJson,
  };
}
```

- [ ] **Step 4: Re-run the init-project test**

Run: `npm run test -- tests/integration/config/init-project.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/config/package-json-aliases.ts src/config/init-project.ts tests/integration/config/init-project.test.ts
git commit -m "feat: add repo-local aegis npm aliases"
```

### Task 4: Run the startup/preflight verification bundle

**Files:**
- Modify: `tests/integration/cli/start-stop.test.ts`
- Modify: `tests/integration/config/init-project.test.ts`

- [ ] **Step 1: Extend the CLI integration test to cover the full happy path**

```ts
it("prints the Olympus URL only after preflight succeeds", async () => {
  const result = await startAegis(repoRoot, { noBrowser: true }, {
    verifyTracker: () => undefined,
    verifyGitRepo: () => undefined,
    registerSignalHandlers: false,
  });

  expect(result.url).toContain("http://127.0.0.1:");
});
```

- [ ] **Step 2: Run the focused verification bundle**

Run: `npm run test -- tests/unit/cli/startup-preflight.test.ts tests/integration/cli/start-stop.test.ts tests/unit/cli/browser-and-stop-contract.test.ts tests/integration/config/init-project.test.ts`
Expected: PASS

- [ ] **Step 3: Run build to catch type regressions**

Run: `npm run build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add tests/integration/cli/start-stop.test.ts tests/integration/config/init-project.test.ts
git commit -m "test: verify startup preflight and init aliases"
```
