# Phase E Caste And Artifact Enforcement Implementation Plan

Status: completed on 2026-04-14.
Execution notes: implemented in caveman mode, finished the direct caste command/artifact surface, fixed the `mock:run start` proof flow to background the daemon and wait for the new pid, and pared back brittle static repo-file assertions so CI stays focused on necessary behavior.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the Phase E caste surface on top of `feat/emergency-mvp-rewrite` by adding strict Oracle/Titan/Sentinel/Janus artifact contracts, direct caste commands, deterministic proof/runtime seams, and artifact-driven completion rules without pulling merge-queue execution forward.

**Architecture:** Keep the Phase D loop shell intact for `poll -> triage -> dispatch -> monitor -> reap`, and add a separate Phase E direct-command spine for `scout`, `implement`, `review`, and `process`. Put prompt/parser/artifact logic under `src/castes/*`, orchestration runners under `src/core/run-*.ts`, runtime-specific session execution under `src/runtime/*`, tracker/labor helpers under their own boundaries, and keep Phase F merge mechanics deferred except for the minimal Janus artifact shape and direct-command plumbing needed now.

**Tech Stack:** TypeScript, Node.js, Vitest, `bd`, Pi SDK (`@mariozechner/pi-coding-agent`)

---

### Task 1: Tracker, Issue, and Labor Contracts For Phase E

**Files:**
- Create: `src/tracker/issue-model.ts`
- Modify: `src/tracker/tracker.ts`
- Modify: `src/tracker/beads-tracker.ts`
- Create: `src/labor/create-labor.ts`
- Test: `tests/unit/tracker/beads-tracker.test.ts`
- Test: `tests/unit/labor/create-labor.test.ts`

- [ ] **Step 1: Write the failing tracker and labor contract tests**

```ts
import { describe, expect, it, vi } from "vitest";

import { BeadsTrackerClient } from "../../../src/tracker/beads-tracker.js";
import { buildLaborBranchName, planLaborCreation } from "../../../src/labor/create-labor.js";

describe("BeadsTrackerClient", () => {
  it("normalizes bd show JSON into the generic Aegis issue model", async () => {
    const tracker = new BeadsTrackerClient({
      execFile: vi.fn((_cmd, _args, _opts, callback) => {
        callback(
          null,
          JSON.stringify({
            id: "aegis-123",
            title: "Example",
            description: "Desc",
            status: "open",
            priority: 1,
            labels: ["phase-e"],
            dependencies: [],
            parent_id: null,
            child_ids: [],
          }),
          "",
        );
      }),
    });

    const issue = await tracker.getIssue("aegis-123", "C:/repo");

    expect(issue).toMatchObject({
      id: "aegis-123",
      title: "Example",
      issueClass: "primary",
      status: "open",
      priority: 1,
    });
  });
});

describe("planLaborCreation", () => {
  it("creates a deterministic labor branch and worktree path per issue", () => {
    const plan = planLaborCreation({
      issueId: "aegis-123",
      projectRoot: "C:/repo",
      baseBranch: "feat/emergency-mvp-rewrite",
    });

    expect(buildLaborBranchName("aegis-123")).toBe("aegis/aegis-123");
    expect(plan.laborPath).toContain(".aegis");
    expect(plan.createWorktreeCommand.args).toEqual([
      "worktree",
      "add",
      "-b",
      "aegis/aegis-123",
      plan.laborPath,
      "feat/emergency-mvp-rewrite",
    ]);
  });
});
```

- [ ] **Step 2: Run the targeted tests to verify the contracts are missing**

Run: `npm test -- tests/unit/tracker/beads-tracker.test.ts tests/unit/labor/create-labor.test.ts`
Expected: FAIL with missing modules/exports or unsupported tracker behavior.

- [ ] **Step 3: Add the generic issue model, tracker methods, and labor planner**

```ts
export interface AegisIssue {
  id: string;
  title: string;
  description: string | null;
  issueClass: "primary" | "sub" | "fix" | "conflict" | "escalation" | "clarification";
  status: "open" | "in_progress" | "closed" | "blocked";
  priority: 0 | 1 | 2 | 3 | 4;
  blockers: string[];
  parentId: string | null;
  childIds: string[];
  labels: string[];
}

export interface TrackerClient {
  listReadyIssues(root?: string): Promise<TrackerReadyIssue[]>;
  getIssue(id: string, root?: string): Promise<AegisIssue>;
  createIssue(input: CreateIssueInput, root?: string): Promise<AegisIssue>;
  addBlocker(blockedId: string, blockerId: string, root?: string): Promise<void>;
  closeIssue(id: string, reason?: string, root?: string): Promise<AegisIssue>;
}
```

- [ ] **Step 4: Re-run the targeted tests until they pass**

Run: `npm test -- tests/unit/tracker/beads-tracker.test.ts tests/unit/labor/create-labor.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tracker/issue-model.ts src/tracker/tracker.ts src/tracker/beads-tracker.ts src/labor/create-labor.ts tests/unit/tracker/beads-tracker.test.ts tests/unit/labor/create-labor.test.ts
git commit -m "feat: add phase e tracker and labor contracts"
```

### Task 2: Caste Prompts, Parsers, and Artifact Stores

**Files:**
- Create: `src/castes/oracle/oracle-prompt.ts`
- Create: `src/castes/oracle/oracle-parser.ts`
- Create: `src/castes/titan/titan-prompt.ts`
- Create: `src/castes/titan/titan-parser.ts`
- Create: `src/castes/sentinel/sentinel-prompt.ts`
- Create: `src/castes/sentinel/sentinel-parser.ts`
- Create: `src/castes/janus/janus-prompt.ts`
- Create: `src/castes/janus/janus-parser.ts`
- Create: `src/core/artifact-store.ts`
- Test: `tests/unit/castes/oracle-parser.test.ts`
- Test: `tests/unit/castes/titan-parser.test.ts`
- Test: `tests/unit/castes/sentinel-parser.test.ts`
- Test: `tests/unit/castes/janus-parser.test.ts`
- Test: `tests/unit/core/artifact-store.test.ts`

- [ ] **Step 1: Write parser and artifact-store tests that fail on malformed JSON and non-atomic writes**

```ts
it("rejects titan artifacts with unexpected keys", () => {
  expect(() =>
    parseTitanArtifact(JSON.stringify({
      outcome: "success",
      files_changed: [],
      tests_and_checks_run: [],
      known_risks: [],
      follow_up_work: [],
      extra: true,
    })),
  ).toThrow(/unexpected/i);
});

it("writes artifacts through tmp -> rename", () => {
  const ref = persistArtifact("C:/repo", {
    family: "oracle",
    issueId: "aegis-123",
    artifact: { ready: true, decompose: false, files_affected: [] },
  });

  expect(ref).toBe(".aegis/oracle/aegis-123.json");
  expect(existsSync("C:/repo/.aegis/oracle/aegis-123.json")).toBe(true);
});
```

- [ ] **Step 2: Run the parser and artifact-store tests to watch them fail**

Run: `npm test -- tests/unit/castes/oracle-parser.test.ts tests/unit/castes/titan-parser.test.ts tests/unit/castes/sentinel-parser.test.ts tests/unit/castes/janus-parser.test.ts tests/unit/core/artifact-store.test.ts`
Expected: FAIL with missing parser/store modules.

- [ ] **Step 3: Implement strict prompt/parser/store modules**

```ts
export interface PersistArtifactInput {
  family: "oracle" | "titan" | "sentinel" | "janus" | "transcripts";
  issueId: string;
  artifact: unknown;
}

export function persistArtifact(root: string, input: PersistArtifactInput): string {
  const artifactRef = join(".aegis", input.family, `${input.issueId}.json`);
  const absolutePath = join(root, artifactRef);
  const tmpPath = `${absolutePath}.tmp`;
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(tmpPath, `${JSON.stringify(input.artifact, null, 2)}\n`, "utf8");
  renameSync(tmpPath, absolutePath);
  return artifactRef;
}
```

- [ ] **Step 4: Re-run the parser/store tests until they pass**

Run: `npm test -- tests/unit/castes/oracle-parser.test.ts tests/unit/castes/titan-parser.test.ts tests/unit/castes/sentinel-parser.test.ts tests/unit/castes/janus-parser.test.ts tests/unit/core/artifact-store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/castes src/core/artifact-store.ts tests/unit/castes tests/unit/core/artifact-store.test.ts
git commit -m "feat: add phase e caste prompt and parser contracts"
```

### Task 3: Phase E Runtime and Direct Caste Command Routing

**Files:**
- Create: `src/runtime/caste-runtime.ts`
- Create: `src/runtime/pi-caste-runtime.ts`
- Create: `src/runtime/scripted-caste-runtime.ts`
- Modify: `src/runtime/session-report.ts`
- Modify: `src/cli/runtime-command.ts`
- Create: `src/cli/caste-command.ts`
- Modify: `src/cli/start.ts`
- Modify: `src/index.ts`
- Test: `tests/unit/runtime/scripted-caste-runtime.test.ts`
- Test: `tests/unit/cli/caste-command.test.ts`
- Test: `tests/unit/cli/runtime-command.test.ts`
- Test: `tests/integration/cli/caste-commands.test.ts`

- [ ] **Step 1: Write failing tests for daemon-routed caste commands and scripted runtime session reports**

```ts
it("routes implement through the daemon when runtime ownership is active", async () => {
  const result = await runDirectCasteCommand("C:/repo", "implement", "aegis-123", {
    readRuntimeState: () => createRuntimeState(),
    isProcessRunning: () => true,
    runLocal: vi.fn(),
    routeToDaemon: vi.fn(async () => ({ action: "implement", issueId: "aegis-123" })),
  });

  expect(result).toEqual({ action: "implement", issueId: "aegis-123" });
});

it("stores tool usage, final payload, and artifact refs in the session report", async () => {
  const runtime = new ScriptedCasteRuntime({
    oracle: () => ({
      output: JSON.stringify({
        files_affected: ["src/index.ts"],
        estimated_complexity: "moderate",
        decompose: false,
        ready: true,
      }),
      toolsUsed: ["read_file"],
    }),
  });

  const session = await runtime.run({
    caste: "oracle",
    issueId: "aegis-123",
    root: tempRoot,
    workingDirectory: tempRoot,
    prompt: "prompt",
  });

  expect(session.toolsUsed).toEqual(["read_file"]);
  expect(session.outputText).toContain("\"ready\":true");
});
```

- [ ] **Step 2: Run the routing/runtime tests to verify the missing behavior**

Run: `npm test -- tests/unit/runtime/scripted-caste-runtime.test.ts tests/unit/cli/caste-command.test.ts tests/unit/cli/runtime-command.test.ts tests/integration/cli/caste-commands.test.ts`
Expected: FAIL with missing direct-caste routing/runtime support.

- [ ] **Step 3: Implement runtime adapters and direct-command transport**

```ts
export type CasteAction = "scout" | "implement" | "review" | "process";

export interface CasteSessionResult {
  sessionId: string;
  caste: "oracle" | "titan" | "sentinel" | "janus";
  status: "succeeded" | "failed";
  outputText: string;
  toolsUsed: string[];
  startedAt: string;
  finishedAt: string;
  error?: string;
}
```

- [ ] **Step 4: Re-run the routing/runtime tests until they pass**

Run: `npm test -- tests/unit/runtime/scripted-caste-runtime.test.ts tests/unit/cli/caste-command.test.ts tests/unit/cli/runtime-command.test.ts tests/integration/cli/caste-commands.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/runtime src/cli/runtime-command.ts src/cli/caste-command.ts src/cli/start.ts src/index.ts tests/unit/runtime/scripted-caste-runtime.test.ts tests/unit/cli/caste-command.test.ts tests/unit/cli/runtime-command.test.ts tests/integration/cli/caste-commands.test.ts
git commit -m "feat: add phase e runtime and caste command routing"
```

### Task 4: Oracle and Titan Orchestrators With Artifact-Enforced Completion

**Files:**
- Create: `src/core/run-oracle.ts`
- Create: `src/core/run-titan.ts`
- Create: `src/core/caste-runner.ts`
- Modify: `src/core/dispatch-state.ts`
- Modify: `src/core/reaper.ts`
- Test: `tests/unit/core/run-oracle.test.ts`
- Test: `tests/unit/core/run-titan.test.ts`
- Test: `tests/unit/core/caste-runner.test.ts`
- Test: `tests/unit/core/reaper.test.ts`

- [ ] **Step 1: Write failing Oracle/Titan orchestration tests**

```ts
it("marks oracle success only after the assessment artifact is persisted", async () => {
  const result = await runOracle({
    issue,
    record,
    tracker,
    runtime,
    root: tempRoot,
  });

  expect(result.updatedRecord.stage).toBe("scouted");
  expect(result.updatedRecord.oracleAssessmentRef).toBe(".aegis/oracle/aegis-123.json");
});

it("keeps titan labor and writes a handoff artifact on success", async () => {
  const result = await runTitan({
    issue,
    record,
    labor,
    tracker,
    runtime,
    root: tempRoot,
  });

  expect(result.updatedRecord.stage).toBe("implemented");
  expect(result.handoffArtifactRef).toBe(".aegis/titan/aegis-123.json");
});
```

- [ ] **Step 2: Run the targeted tests and confirm they fail for missing orchestrators**

Run: `npm test -- tests/unit/core/run-oracle.test.ts tests/unit/core/run-titan.test.ts tests/unit/core/caste-runner.test.ts tests/unit/core/reaper.test.ts`
Expected: FAIL with missing exports or incorrect Phase D-only state transitions.

- [ ] **Step 3: Implement Oracle/Titan runners and artifact-aware reaper rules**

```ts
export function classifyCompletionFromArtifacts(record: DispatchRecord): "scouted" | "implemented" | "failed" {
  if (record.stage === "scouting" && record.oracleAssessmentRef) return "scouted";
  if (record.stage === "implementing" && record.titanHandoffRef) return "implemented";
  return "failed";
}
```

- [ ] **Step 4: Re-run the Oracle/Titan tests until they pass**

Run: `npm test -- tests/unit/core/run-oracle.test.ts tests/unit/core/run-titan.test.ts tests/unit/core/caste-runner.test.ts tests/unit/core/reaper.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/run-oracle.ts src/core/run-titan.ts src/core/caste-runner.ts src/core/dispatch-state.ts src/core/reaper.ts tests/unit/core/run-oracle.test.ts tests/unit/core/run-titan.test.ts tests/unit/core/caste-runner.test.ts tests/unit/core/reaper.test.ts
git commit -m "feat: add phase e oracle and titan orchestration"
```

### Task 5: Sentinel, Janus, Mock-Run Proof, And Documentation

**Files:**
- Create: `src/core/run-sentinel.ts`
- Create: `src/core/run-janus.ts`
- Modify: `src/mock-run/seed-mock-run.ts`
- Modify: `src/mock-run/todo-manifest.ts`
- Modify: `src/config/init-project.ts`
- Modify: `src/config/defaults.ts`
- Modify: `src/config/load-config.ts`
- Modify: `AGENTS.md`
- Modify: `docs/superpowers/specs/2026-04-13-aegis-emergency-mvp-triage-design.md`
- Test: `tests/unit/core/run-sentinel.test.ts`
- Test: `tests/unit/core/run-janus.test.ts`
- Test: `tests/unit/mock-run/seed-mock-run.test.ts`
- Test: `tests/integration/mock-run/phase-e-proof.test.ts`

- [ ] **Step 1: Write failing tests for Sentinel/Janus direct runs, mock-run config, and the Phase D completion marker**

```ts
it("writes sentinel verdict artifacts and leaves fix-work creation explicit", async () => {
  const result = await runSentinel({ issue, record, tracker, runtime, root: tempRoot });

  expect(result.updatedRecord.sentinelVerdictRef).toBe(".aegis/sentinel/aegis-123.json");
});

it("keeps mock-run deterministic with the scripted runtime while seeding artifact directories", () => {
  const config = buildMockRunConfig();

  expect(config.runtime).toBe("mock_scripted");
});
```

- [ ] **Step 2: Run the Sentinel/Janus/mock-run/doc tests to verify the current gaps**

Run: `npm test -- tests/unit/core/run-sentinel.test.ts tests/unit/core/run-janus.test.ts tests/unit/mock-run/seed-mock-run.test.ts tests/integration/mock-run/phase-e-proof.test.ts`
Expected: FAIL with missing Sentinel/Janus runners and outdated Phase D-only proof/docs.

- [ ] **Step 3: Implement Sentinel/Janus direct runners, deterministic proof config, and doc updates**

```ts
// Spec/doc updates must mark Phase D complete and describe Phase E direct commands.
// Mock-run remains deterministic and stops before merge-next / queue execution.
```

- [ ] **Step 4: Re-run the targeted tests until they pass**

Run: `npm test -- tests/unit/core/run-sentinel.test.ts tests/unit/core/run-janus.test.ts tests/unit/mock-run/seed-mock-run.test.ts tests/integration/mock-run/phase-e-proof.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/run-sentinel.ts src/core/run-janus.ts src/mock-run/seed-mock-run.ts src/mock-run/todo-manifest.ts src/config/init-project.ts src/config/defaults.ts src/config/load-config.ts AGENTS.md docs/superpowers/specs/2026-04-13-aegis-emergency-mvp-triage-design.md tests/unit/core/run-sentinel.test.ts tests/unit/core/run-janus.test.ts tests/unit/mock-run/seed-mock-run.test.ts tests/integration/mock-run/phase-e-proof.test.ts
git commit -m "feat: complete phase e caste artifacts and proof surface"
```

## Self-Review

- Phase D status correction is included in the spec/doc task so the emergency design reflects the already-merged `feat/emergency-mvp-phase-d` PR.
- Phase E scope stops at direct caste commands, artifact persistence/enforcement, and deterministic proof seams. `aegis merge next`, automatic queue execution, and Sentinel post-merge automation remain Phase F.
- Every task has explicit test-first steps before production code changes.
