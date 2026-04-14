# Phase D Core Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the stripped Phase D loop shell on top of `feat/emergency-mvp-rewrite` by adding deterministic `poll -> triage -> dispatch -> monitor -> reap` modules, exposing `aegis poll|dispatch|monitor|reap`, and making `aegis start` reuse the same phase runner without pulling Phase E/F caste, artifact, or merge work forward.

**Architecture:** Add minimal `tracker`, `runtime`, and loop-phase modules under the preserved boundaries. Keep real tracker access on `bd`, keep the default `pi` runtime config intact, and use a tiny explicit `phase_d_shell` runtime only for deterministic seam tests and mock-run proof so Phase D can exercise the loop mechanics without pretending Phase E caste execution already exists.

**Tech Stack:** TypeScript, Node.js, Vitest, `bd`

---

### Task 1: Tracker, Poller, and Triage Contracts

**Files:**
- Create: `src/tracker/tracker.ts`
- Create: `src/tracker/beads-tracker.ts`
- Create: `src/core/poller.ts`
- Create: `src/core/triage.ts`
- Test: `tests/unit/core/poller.test.ts`
- Test: `tests/unit/core/triage.test.ts`

- [ ] **Step 1: Write the failing poller and triage tests**

```ts
import { describe, expect, it } from "vitest";

import { emptyDispatchState } from "../../../src/core/dispatch-state.js";
import { pollReadyWork } from "../../../src/core/poller.js";
import { triageReadyWork } from "../../../src/core/triage.js";

describe("pollReadyWork", () => {
  it("returns tracker ready work alongside dispatch-state counts", async () => {
    const snapshot = await pollReadyWork({
      dispatchState: emptyDispatchState(),
      tracker: {
        listReadyIssues: async () => [
          { id: "ISSUE-1", title: "First" },
          { id: "ISSUE-2", title: "Second" },
        ],
      },
    });

    expect(snapshot.readyIssues.map((issue) => issue.id)).toEqual([
      "ISSUE-1",
      "ISSUE-2",
    ]);
    expect(snapshot.activeAgentCount).toBe(0);
  });
});

describe("triageReadyWork", () => {
  it("dispatches pending work to oracle first and preserves ready-queue order", () => {
    const decision = triageReadyWork({
      readyIssues: [
        { id: "ISSUE-1", title: "First" },
        { id: "ISSUE-2", title: "Second" },
      ],
      dispatchState: emptyDispatchState(),
      config: {
        concurrency: { max_agents: 2, max_oracles: 2 },
      },
      now: "2026-04-14T12:00:00.000Z",
    });

    expect(decision.dispatchable.map((item) => item.issueId)).toEqual([
      "ISSUE-1",
      "ISSUE-2",
    ]);
  });
});
```

- [ ] **Step 2: Run the targeted tests to verify the new modules are missing**

Run: `npm test -- tests/unit/core/poller.test.ts tests/unit/core/triage.test.ts`
Expected: FAIL with module-not-found or missing export errors for the new tracker/poller/triage modules.

- [ ] **Step 3: Add the minimal tracker, poller, and triage implementations**

```ts
export interface TrackerReadyIssue {
  id: string;
  title: string;
}

export interface TrackerClient {
  listReadyIssues(root: string): Promise<TrackerReadyIssue[]>;
}

export async function pollReadyWork(input: PollerInput): Promise<PollSnapshot> {
  const readyIssues = await input.tracker.listReadyIssues(input.root ?? process.cwd());
  return {
    readyIssues,
    activeAgentCount: Object.values(input.dispatchState.records).filter(
      (record) => record.runningAgent !== null,
    ).length,
  };
}

export function triageReadyWork(input: TriageInput): TriageResult {
  // Iterate in tracker order, skip running or cooled-down records, and
  // emit only Phase D oracle dispatch decisions.
}
```

- [ ] **Step 4: Re-run the targeted tests and keep them green**

Run: `npm test -- tests/unit/core/poller.test.ts tests/unit/core/triage.test.ts`
Expected: PASS

- [ ] **Step 5: Commit the tracker and triage slice**

```bash
git add src/tracker/tracker.ts src/tracker/beads-tracker.ts src/core/poller.ts src/core/triage.ts tests/unit/core/poller.test.ts tests/unit/core/triage.test.ts
git commit -m "feat: add phase d poller and triage shell"
```

### Task 2: Dispatcher, Monitor, Reaper, and Runtime Seam

**Files:**
- Create: `src/runtime/agent-runtime.ts`
- Create: `src/runtime/phase-d-shell-runtime.ts`
- Create: `src/runtime/session-report.ts`
- Create: `src/core/phase-log.ts`
- Create: `src/core/dispatcher.ts`
- Create: `src/core/monitor.ts`
- Create: `src/core/reaper.ts`
- Modify: `src/core/dispatch-state.ts`
- Modify: `src/config/defaults.ts`
- Modify: `src/config/load-config.ts`
- Test: `tests/unit/core/dispatcher.test.ts`
- Test: `tests/unit/core/monitor.test.ts`
- Test: `tests/unit/core/reaper.test.ts`

- [ ] **Step 1: Write the failing dispatcher, monitor, and reaper tests**

```ts
import { describe, expect, it } from "vitest";

import { emptyDispatchState } from "../../../src/core/dispatch-state.js";
import { dispatchReadyWork } from "../../../src/core/dispatcher.js";
import { monitorActiveWork } from "../../../src/core/monitor.js";
import { reapFinishedWork } from "../../../src/core/reaper.js";

describe("dispatchReadyWork", () => {
  it("marks oracle dispatch as running and records the returned session id", async () => {
    const result = await dispatchReadyWork({
      dispatchState: emptyDispatchState(),
      decisions: [{ issueId: "ISSUE-1", caste: "oracle", stage: "scouting" }],
      runtime: {
        launch: async () => ({ sessionId: "session-1", startedAt: "2026-04-14T12:00:00.000Z" }),
      },
    });

    expect(result.state.records["ISSUE-1"]?.runningAgent?.sessionId).toBe("session-1");
  });
});

describe("monitorActiveWork", () => {
  it("flags expired runs once they cross the kill threshold", async () => {
    const result = await monitorActiveWork({
      dispatchState: {
        schemaVersion: 1,
        records: {
          "ISSUE-1": {
            issueId: "ISSUE-1",
            stage: "scouting",
            runningAgent: {
              caste: "oracle",
              sessionId: "session-1",
              startedAt: "2026-04-14T11:50:00.000Z",
            },
            oracleAssessmentRef: null,
            sentinelVerdictRef: null,
            fileScope: null,
            failureCount: 0,
            consecutiveFailures: 0,
            failureWindowStartMs: null,
            cooldownUntil: null,
            sessionProvenanceId: "daemon-1",
            updatedAt: "2026-04-14T11:50:00.000Z",
          },
        },
      },
      runtime: {
        readSession: async () => ({ sessionId: "session-1", status: "running" }),
      },
      thresholds: { stuck_warning_seconds: 90, stuck_kill_seconds: 150 },
      now: "2026-04-14T12:00:00.000Z",
    });

    expect(result.killList).toEqual(["ISSUE-1"]);
  });
});

describe("reapFinishedWork", () => {
  it("moves successful phase-d oracle runs to a phase-d-complete placeholder stage", async () => {
    const result = await reapFinishedWork({
      dispatchState: emptyDispatchState(),
      runtime: {
        readSession: async () => ({ sessionId: "session-1", status: "succeeded" }),
      },
    });

    expect(result.state.records["ISSUE-1"]?.stage).toBe("phase_d_complete");
  });
});
```

- [ ] **Step 2: Run the targeted tests to verify the new runtime and loop modules fail for the expected reason**

Run: `npm test -- tests/unit/core/dispatcher.test.ts tests/unit/core/monitor.test.ts tests/unit/core/reaper.test.ts`
Expected: FAIL with missing module or missing export errors.

- [ ] **Step 3: Implement the runtime seam, structured phase logging, and state transitions**

```ts
export interface RuntimeSessionSnapshot {
  sessionId: string;
  status: "running" | "succeeded" | "failed";
  finishedAt?: string;
  error?: string;
}

export interface AgentRuntime {
  launch(input: RuntimeLaunchInput): Promise<RuntimeLaunchResult>;
  readSession(root: string, sessionId: string): Promise<RuntimeSessionSnapshot | null>;
}

export async function dispatchReadyWork(input: DispatchInput): Promise<DispatchResult> {
  // Copy records, launch runtime sessions, and write a phase log per dispatch.
}

export async function monitorActiveWork(input: MonitorInput): Promise<MonitorResult> {
  // Report ready-for-reap sessions and threshold-based warnings/kills.
}

export async function reapFinishedWork(input: ReapInput): Promise<ReapResult> {
  // Clear running ownership, increment failures on runtime errors, and map
  // successful Phase D shell runs to `phase_d_complete`.
}
```

- [ ] **Step 4: Re-run the targeted tests and keep them green**

Run: `npm test -- tests/unit/core/dispatcher.test.ts tests/unit/core/monitor.test.ts tests/unit/core/reaper.test.ts`
Expected: PASS

- [ ] **Step 5: Commit the dispatcher/monitor/reaper slice**

```bash
git add src/runtime/agent-runtime.ts src/runtime/phase-d-shell-runtime.ts src/runtime/session-report.ts src/core/phase-log.ts src/core/dispatcher.ts src/core/monitor.ts src/core/reaper.ts src/core/dispatch-state.ts src/config/defaults.ts src/config/load-config.ts tests/unit/core/dispatcher.test.ts tests/unit/core/monitor.test.ts tests/unit/core/reaper.test.ts
git commit -m "feat: add phase d dispatch monitor and reap shell"
```

### Task 3: CLI Commands, Daemon Reuse, and Command Routing

**Files:**
- Create: `src/core/loop-runner.ts`
- Create: `src/cli/phase-command.ts`
- Create: `src/cli/runtime-command.ts`
- Modify: `src/cli/start.ts`
- Modify: `src/cli/status.ts`
- Modify: `src/index.ts`
- Test: `tests/unit/cli/phase-command.test.ts`
- Test: `tests/unit/cli/start.test.ts`
- Test: `tests/integration/cli/phase-commands.test.ts`

- [ ] **Step 1: Write the failing CLI and daemon-routing tests**

```ts
import { describe, expect, it } from "vitest";

import { runCli } from "../../../src/index.js";

describe("runCli phase commands", () => {
  it("supports poll, dispatch, monitor, and reap", async () => {
    await expect(runCli("C:/repo", ["poll"])).resolves.toBeDefined();
    await expect(runCli("C:/repo", ["dispatch"])).resolves.toBeDefined();
    await expect(runCli("C:/repo", ["monitor"])).resolves.toBeDefined();
    await expect(runCli("C:/repo", ["reap"])).resolves.toBeDefined();
  });
});
```

- [ ] **Step 2: Run the targeted tests to verify the CLI surface is still missing**

Run: `npm test -- tests/unit/cli/phase-command.test.ts tests/unit/cli/start.test.ts tests/integration/cli/phase-commands.test.ts`
Expected: FAIL with unsupported command behavior or missing modules.

- [ ] **Step 3: Implement the loop runner and wire the CLI through it**

```ts
export async function runPhaseCommand(root: string, phase: LoopPhase): Promise<PhaseCommandResult> {
  return runLoopCycle(root, { mode: "single_phase", phase });
}

export async function startAegis(root = process.cwd(), overrides = {}, options = {}) {
  // Existing preflight remains. After writing runtime-state, schedule
  // `runLoopCycle(root, { mode: "daemon_tick" })` on the configured interval
  // and poll the command-request file for routed direct commands.
}
```

- [ ] **Step 4: Re-run the targeted tests and keep them green**

Run: `npm test -- tests/unit/cli/phase-command.test.ts tests/unit/cli/start.test.ts tests/integration/cli/phase-commands.test.ts`
Expected: PASS

- [ ] **Step 5: Commit the CLI and daemon integration slice**

```bash
git add src/core/loop-runner.ts src/cli/phase-command.ts src/cli/runtime-command.ts src/cli/start.ts src/cli/status.ts src/index.ts tests/unit/cli/phase-command.test.ts tests/unit/cli/start.test.ts tests/integration/cli/phase-commands.test.ts
git commit -m "feat: wire phase d loop commands through the daemon shell"
```

### Task 4: Docs, Mock-Run Proof Surface, and Final Verification

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/superpowers/specs/2026-04-13-aegis-emergency-mvp-triage-design.md`
- Modify: `src/mock-run/seed-mock-run.ts`
- Modify: `tests/unit/bootstrap/project-skeleton.test.ts`
- Modify: `tests/unit/mock-run/seed-mock-run.test.ts`

- [ ] **Step 1: Write the failing docs and mock-run tests**

```ts
expect(agentsGuide).toContain("Current Phase D Available Commands");
expect(agentsGuide).toContain("aegis poll");
expect(designDoc).toContain("### Current Phase D command surface");
expect(buildMockRunConfig().runtime).toBe("phase_d_shell");
```

- [ ] **Step 2: Run the targeted tests to verify the docs and proof surface still describe Phase A-C only**

Run: `npm test -- tests/unit/bootstrap/project-skeleton.test.ts tests/unit/mock-run/seed-mock-run.test.ts`
Expected: FAIL on missing Phase D command-surface assertions.

- [ ] **Step 3: Update the docs and mock-run config**

```ts
export function buildMockRunConfig() {
  return {
    ...DEFAULT_AEGIS_CONFIG,
    runtime: "phase_d_shell",
  };
}
```

- [ ] **Step 4: Run the full verification set**

Run: `npm test`
Expected: PASS with all Vitest suites green.

Run: `npm run lint`
Expected: PASS with `tsc --project tsconfig.tests.json --noEmit`.

Run: `npm run build`
Expected: PASS and emit `dist/index.js`.

- [ ] **Step 5: Commit the docs and proof updates**

```bash
git add AGENTS.md docs/superpowers/specs/2026-04-13-aegis-emergency-mvp-triage-design.md src/mock-run/seed-mock-run.ts tests/unit/bootstrap/project-skeleton.test.ts tests/unit/mock-run/seed-mock-run.test.ts
git commit -m "docs: update phase d command surface and proof notes"
```
