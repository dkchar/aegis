# Phase L Tight-Scope Final Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver final Phase L slice so default daemon output is readable by phase tags, optional `--view-agent-sessions` opens live per-session terminals, and seeded mock-run graph auto-drives an empty repo to a working localhost React todo app with README.

**Architecture:** Keep deterministic core loop and durable JSON truth unchanged. Add a thin terminal formatting layer and a session-event log surface (`.aegis/logs/sessions/*.events.jsonl`) for live per-session streams. Rework mock-run manifest/acceptance so autonomous daemon flow (not direct caste commands) is proof path from empty repo baseline to app delivery.

**Tech Stack:** TypeScript, Node.js process APIs (`spawn`, `execFileSync`), Vitest, Beads (`bd`), existing Aegis CLI/runtime modules.

---

## File Structure

### New files
- `src/cli/session-view.ts` — session-window launcher + lifecycle tracker for `--view-agent-sessions`
- `src/runtime/session-events.ts` — append/read helpers for per-session JSONL event stream
- `tests/unit/cli/session-view.test.ts` — deterministic tests for session window launcher behavior
- `tests/unit/runtime/session-events.test.ts` — deterministic tests for session event persistence/reading
- `tests/unit/mock-run/todo-manifest.test.ts` — validates seeded graph shape (parallel lanes + gates + React delivery tasks)

### Modified files
- `src/cli/start.ts` — parse/wire `--view-agent-sessions`, call session-view tracker while daemon runs
- `src/index.ts` — route `stream session <session-id>` target
- `src/cli/stream.ts` — add `streamSessionView`, phase-tag readable formatter (`[DISPATCH] ...`)
- `src/runtime/pi-caste-runtime.ts` — emit live session events for all castes during runtime subscription
- `src/runtime/scripted-caste-runtime.ts` — emit deterministic session events for scripted runs
- `src/mock-run/todo-manifest.ts` — replace remaining issue text/labels with React scaffold+deps+UI+README+serve tasks while keeping lane parallelism and gates
- `src/mock-run/acceptance.ts` — convert proof flow to autonomous daemon run + completion wait + app evidence checks
- `tests/unit/cli/start.test.ts` — start flag + daemon integration tests
- `tests/unit/cli/stream.test.ts` — daemon phase-tag readability + session stream tests
- `tests/integration/cli/stream-command.test.ts` — CLI contract for `stream session`
- `tests/unit/runtime/pi-caste-runtime.test.ts` — asserts session-event emission during live session execution
- `tests/unit/mock-run/acceptance.test.ts` — autonomous flow assertions (no manual `scout/implement/process`)

### External workspace target (proof graph)
- `C:/dev/aegis-qa/aegis-mock-run` — reseeded from updated manifest; verify graph and ready queue using `bd`.

---

### Task 1: Add `--view-agent-sessions` Start Contract

**Files:**
- Modify: `src/cli/start.ts`
- Modify: `tests/unit/cli/start.test.ts`

- [ ] **Step 1: Write failing tests for start override parsing and default behavior**

```ts
// tests/unit/cli/start.test.ts
it("parses --view-agent-sessions override", async () => {
  const startModule = await import("../../../src/cli/start.js");
  expect(startModule.parseStartOverrides(["--view-agent-sessions"]))
    .toEqual({ viewAgentSessions: true });
});

it("rejects unknown start override flags", async () => {
  const startModule = await import("../../../src/cli/start.js");
  expect(() => startModule.parseStartOverrides(["--bad-flag"]))
    .toThrow("Unknown start override flag");
});
```

- [ ] **Step 2: Run targeted tests and confirm RED**

Run: `npm run test -- tests/unit/cli/start.test.ts`
Expected: FAIL with mismatch for parsed overrides.

- [ ] **Step 3: Implement typed start override parsing**

```ts
// src/cli/start.ts
export const START_OVERRIDE_FLAGS = ["--view-agent-sessions"] as const;

export interface StartCommandOverrides {
  viewAgentSessions: boolean;
}

function parseStartOverrides(argv: readonly string[]): StartCommandOverrides {
  const overrides: StartCommandOverrides = { viewAgentSessions: false };

  for (const arg of argv) {
    if (arg === "--view-agent-sessions") {
      overrides.viewAgentSessions = true;
      continue;
    }
    throw new Error(`Unknown start override flag: ${arg}`);
  }

  return overrides;
}
```

- [ ] **Step 4: Run targeted tests and confirm GREEN**

Run: `npm run test -- tests/unit/cli/start.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/cli/start.ts tests/unit/cli/start.test.ts
git commit -m "feat: add start view-agent-sessions override"
```

### Task 2: Add `stream session <session-id>` CLI Surface

**Files:**
- Modify: `src/index.ts`
- Modify: `src/cli/stream.ts`
- Modify: `tests/integration/cli/stream-command.test.ts`
- Modify: `tests/unit/cli/stream.test.ts`

- [ ] **Step 1: Write failing CLI/integration tests for `stream session` routing**

```ts
// tests/integration/cli/stream-command.test.ts
it("supports stream session through shared stream runner", async () => {
  vi.resetModules();
  const streamSessionView = vi.fn(async () => undefined);
  vi.doMock("../../../src/cli/stream.js", async () => {
    const actual = await vi.importActual<object>("../../../src/cli/stream.js");
    return { ...actual, streamSessionView };
  });

  const { runCli } = await import("../../../src/index.js");
  await runCli("repo", ["stream", "session", "session-1"]);
  expect(streamSessionView).toHaveBeenCalledWith("repo", "session-1");
});
```

- [ ] **Step 2: Run targeted tests and confirm RED**

Run: `npm run test -- tests/integration/cli/stream-command.test.ts tests/unit/cli/stream.test.ts`
Expected: FAIL because `streamSessionView` and session target routing do not exist.

- [ ] **Step 3: Implement stream session target and handler**

```ts
// src/index.ts
if (command === "stream") {
  const target = argv[1] ?? "daemon";
  if (target === "daemon") {
    await streamDaemonView(root);
    return manifest;
  }
  if (target === "session") {
    const sessionId = argv[2];
    if (!sessionId) {
      console.error("Missing session id for stream session");
      process.exitCode = 1;
      return manifest;
    }
    await streamSessionView(root, sessionId);
    return manifest;
  }
  console.error(`Unsupported stream target: ${target}`);
  process.exitCode = 1;
  return manifest;
}
```

```ts
// src/cli/stream.ts
export async function streamSessionView(root = process.cwd(), sessionId: string, options: StreamDaemonOptions = {}) {
  // tail .aegis/logs/sessions/<sessionId>.events.jsonl
  // stop when session report status is succeeded/failed
}
```

- [ ] **Step 4: Add/adjust unit tests for session stream termination behavior**

```ts
// tests/unit/cli/stream.test.ts
it("streams session events and stops when session is finalized", async () => {
  // seed session events file + write final session report status=succeeded
  // expect stream output contains event lines and exits cleanly
});
```

- [ ] **Step 5: Run targeted tests and confirm GREEN**

Run: `npm run test -- tests/integration/cli/stream-command.test.ts tests/unit/cli/stream.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git add src/index.ts src/cli/stream.ts tests/integration/cli/stream-command.test.ts tests/unit/cli/stream.test.ts
git commit -m "feat: add stream session command surface"
```

### Task 3: Add Readable Phase-Tag Daemon Output

**Files:**
- Modify: `src/cli/stream.ts`
- Modify: `tests/unit/cli/stream.test.ts`

- [ ] **Step 1: Write failing stream formatting tests for `[PHASE]` readability**

```ts
// tests/unit/cli/stream.test.ts
expect(lines).toContain(
  "[DISPATCH] issue=aegis-1 action=launch_oracle outcome=running caste=oracle session=session-1",
);
expect(lines).toContain(
  "[REAP] issue=aegis-1 action=finalize_session outcome=scouted session=session-1",
);
```

- [ ] **Step 2: Run tests and confirm RED**

Run: `npm run test -- tests/unit/cli/stream.test.ts`
Expected: FAIL because output still uses `[phase] phase=dispatch ...` format.

- [ ] **Step 3: Implement phase-tag formatter in stream layer**

```ts
// src/cli/stream.ts
function toPhaseTag(phase: PhaseLogEntry["phase"]) {
  return `[${phase.toUpperCase()}]`;
}

function inferCaste(action: string): string | null {
  if (action.startsWith("launch_")) {
    return action.slice("launch_".length);
  }
  return null;
}

function formatPhaseEntry(entry: PhaseLogEntry) {
  const parts = [
    toPhaseTag(entry.phase),
    `issue=${entry.issueId}`,
    `action=${entry.action}`,
    `outcome=${entry.outcome}`,
  ];
  const caste = inferCaste(entry.action);
  if (caste) parts.push(`caste=${caste}`);
  if (entry.sessionId) parts.push(`session=${entry.sessionId}`);
  if (entry.detail) parts.push(`detail=${entry.detail}`);
  return parts.join(" ");
}
```

- [ ] **Step 4: Run tests and confirm GREEN**

Run: `npm run test -- tests/unit/cli/stream.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add src/cli/stream.ts tests/unit/cli/stream.test.ts
git commit -m "feat: add readable phase-tag stream output"
```

### Task 4: Add Session Event Persistence for All Castes

**Files:**
- Create: `src/runtime/session-events.ts`
- Modify: `src/runtime/pi-caste-runtime.ts`
- Modify: `src/runtime/scripted-caste-runtime.ts`
- Create: `tests/unit/runtime/session-events.test.ts`
- Modify: `tests/unit/runtime/pi-caste-runtime.test.ts`

- [ ] **Step 1: Write failing unit tests for session event append/read helpers**

```ts
// tests/unit/runtime/session-events.test.ts
it("appends jsonl events and reads them in order", () => {
  appendSessionEvent(root, { sessionId: "s1", eventType: "session_started", ... });
  appendSessionEvent(root, { sessionId: "s1", eventType: "message", ... });
  const events = readSessionEvents(root, "s1");
  expect(events.map((e) => e.eventType)).toEqual(["session_started", "message"]);
});
```

- [ ] **Step 2: Run tests and confirm RED**

Run: `npm run test -- tests/unit/runtime/session-events.test.ts`
Expected: FAIL because helper module does not exist.

- [ ] **Step 3: Implement session event helper module**

```ts
// src/runtime/session-events.ts
export interface SessionEventRecord {
  timestamp: string;
  sessionId: string;
  issueId: string;
  caste: CasteName;
  eventType: "session_started" | "tool_start" | "assistant_message" | "session_finished" | "session_failed";
  summary: string;
  detail?: string;
}

export function appendSessionEvent(root: string, event: SessionEventRecord): void {
  const filePath = resolveSessionEventsPath(root, event.sessionId);
  mkdirSync(path.dirname(filePath), { recursive: true });
  appendFileSync(filePath, `${JSON.stringify(event)}\n`, "utf8");
}
```

- [ ] **Step 4: Instrument Pi runtime event emission during live session subscription**

```ts
// src/runtime/pi-caste-runtime.ts
appendSessionEvent(input.root, {
  timestamp: startedAt,
  sessionId: session.sessionId,
  issueId: input.issueId,
  caste: input.caste,
  eventType: "session_started",
  summary: "Pi session started",
});

if (event.type === "tool_execution_start") {
  appendSessionEvent(input.root, {
    timestamp: new Date().toISOString(),
    sessionId: session.sessionId,
    issueId: input.issueId,
    caste: input.caste,
    eventType: "tool_start",
    summary: event.toolName,
  });
}
```

- [ ] **Step 5: Instrument scripted runtime start/finish events**

```ts
// src/runtime/scripted-caste-runtime.ts
appendSessionEvent(input.root, {
  timestamp: startedAt,
  sessionId,
  issueId: input.issueId,
  caste: input.caste,
  eventType: "session_started",
  summary: "Scripted session started",
});
// append session_finished/session_failed before return
```

- [ ] **Step 6: Extend Pi runtime tests to assert event writes**

```ts
// tests/unit/runtime/pi-caste-runtime.test.ts
expect(readSessionEvents(root, "pi-session-1").some((e) => e.eventType === "session_started")).toBe(true);
```

- [ ] **Step 7: Run targeted tests and confirm GREEN**

Run: `npm run test -- tests/unit/runtime/session-events.test.ts tests/unit/runtime/pi-caste-runtime.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit Task 4**

```bash
git add src/runtime/session-events.ts src/runtime/pi-caste-runtime.ts src/runtime/scripted-caste-runtime.ts tests/unit/runtime/session-events.test.ts tests/unit/runtime/pi-caste-runtime.test.ts
git commit -m "feat: persist per-session runtime events"
```

### Task 5: Implement `--view-agent-sessions` Window Launcher

**Files:**
- Create: `src/cli/session-view.ts`
- Modify: `src/cli/start.ts`
- Create: `tests/unit/cli/session-view.test.ts`
- Modify: `tests/unit/cli/start.test.ts`

- [ ] **Step 1: Write failing tests for session window launching only when flag enabled**

```ts
// tests/unit/cli/session-view.test.ts
it("spawns one viewer process per unseen running session", async () => {
  const spawnMock = vi.fn(() => ({ unref: vi.fn() }));
  const tracker = createSessionViewTracker({ spawn: spawnMock, ... });
  tracker.tick(["session-1", "session-2"]);
  expect(spawnMock).toHaveBeenCalledTimes(2);
});
```

```ts
// tests/unit/cli/start.test.ts
it("does not launch session windows when view flag is false", async () => {
  // startAegis(..., parseStartOverrides([]))
  // assert launch helper not called
});
```

- [ ] **Step 2: Run targeted tests and confirm RED**

Run: `npm run test -- tests/unit/cli/session-view.test.ts tests/unit/cli/start.test.ts`
Expected: FAIL because tracker module and wiring do not exist.

- [ ] **Step 3: Implement cross-platform session-view tracker module**

```ts
// src/cli/session-view.ts
export interface SessionViewTracker {
  tick(): void;
  stop(): void;
}

export function createSessionViewTracker(root: string, options: { nodePath?: string; spawn?: typeof spawn } = {}): SessionViewTracker {
  const seen = new Set<string>();
  const tick = () => {
    const runningSessions = listRunningSessionsFromEventLogs(root);
    for (const sessionId of runningSessions) {
      if (seen.has(sessionId)) continue;
      seen.add(sessionId);
      launchSessionViewer(root, sessionId, options);
    }
  };
  return { tick, stop: () => undefined };
}
```

- [ ] **Step 4: Wire tracker into daemon lifecycle under start override flag**

```ts
// src/cli/start.ts
const sessionViewTracker = overrides.viewAgentSessions
  ? createSessionViewTracker(repoRoot)
  : null;

const runCycleSafely = async () => {
  ...
  await runDaemonCycle(repoRoot);
  await runMergeCommand(repoRoot, "next");
  sessionViewTracker?.tick();
};

async stop(...) {
  ...
  sessionViewTracker?.stop();
}
```

- [ ] **Step 5: Run targeted tests and confirm GREEN**

Run: `npm run test -- tests/unit/cli/session-view.test.ts tests/unit/cli/start.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```bash
git add src/cli/session-view.ts src/cli/start.ts tests/unit/cli/session-view.test.ts tests/unit/cli/start.test.ts
git commit -m "feat: add opt-in session viewer terminal launcher"
```

### Task 6: Rebuild Mock-Run Graph for React Todo Delivery + Parallel Proof

**Files:**
- Modify: `src/mock-run/todo-manifest.ts`
- Create: `tests/unit/mock-run/todo-manifest.test.ts`

- [ ] **Step 1: Write failing tests for updated graph semantics**

```ts
// tests/unit/mock-run/todo-manifest.test.ts
it("keeps lane parallelism with gate dependencies", () => {
  const laneA = findIssue("integration.lane_a");
  const laneB = findIssue("integration.lane_b");
  const gate = findIssue("integration.gate");
  expect(gate.blocks).toContain(laneA.key);
  expect(gate.blocks).toContain(laneB.key);
});

it("contains React scaffold and localhost serve delivery tasks", () => {
  const titles = TODO_MOCK_RUN_ISSUES.map((i) => i.title.toLowerCase());
  expect(titles.some((t) => t.includes("react scaffold"))).toBe(true);
  expect(titles.some((t) => t.includes("localhost serve"))).toBe(true);
});
```

- [ ] **Step 2: Run tests and confirm RED**

Run: `npm run test -- tests/unit/mock-run/todo-manifest.test.ts`
Expected: FAIL because new expectations not present.

- [ ] **Step 3: Update manifest issue definitions to explicit React delivery tasks**

```ts
// src/mock-run/todo-manifest.ts (example issue titles/descriptions)
{
  key: "foundation.contract",
  title: "[foundation] React scaffold contract",
  description: "Lock Vite React TypeScript stack, scripts, and acceptance contract.",
  ...
}
{
  key: "integration.lane_b",
  title: "[integration] Lane B localhost serve proof",
  description: "Verify npm install + npm run dev serves working todo UI and capture proof notes.",
  ...
}
```

- [ ] **Step 4: Run tests and confirm GREEN**

Run: `npm run test -- tests/unit/mock-run/todo-manifest.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit Task 6**

```bash
git add src/mock-run/todo-manifest.ts tests/unit/mock-run/todo-manifest.test.ts
git commit -m "feat: seed react todo delivery graph with parallel gates"
```

### Task 7: Convert Mock Acceptance to Autonomous Daemon Flow

**Files:**
- Modify: `src/mock-run/acceptance.ts`
- Modify: `tests/unit/mock-run/acceptance.test.ts`

- [ ] **Step 1: Write failing acceptance test asserting no manual caste command sequence**

```ts
// tests/unit/mock-run/acceptance.test.ts
expect(sequence).toEqual([
  "seed",
  "start --view-agent-sessions",
  "status",
  "stop",
  "status",
]);
expect(sequence.some((s) => s.startsWith("scout"))).toBe(false);
expect(sequence.some((s) => s.startsWith("implement"))).toBe(false);
```

- [ ] **Step 2: Run tests and confirm RED**

Run: `npm run test -- tests/unit/mock-run/acceptance.test.ts`
Expected: FAIL because current flow manually runs `scout/implement/process/merge next`.

- [ ] **Step 3: Implement autonomous acceptance wait loop and app evidence checks**

```ts
// src/mock-run/acceptance.ts
await runCommand(["node", aegisCliPath, "start", "--view-agent-sessions"], { mockDir: seed.repoRoot });
await waitForTrackerCompletion(seed.repoRoot, integrationGateIssueId, { timeoutMs: 15 * 60_000 });
await assertTodoAppSurface(seed.repoRoot, {
  requiredFiles: ["package.json", "README.md", "src/main.tsx", "src/App.tsx"],
});
await runCommand(["node", aegisCliPath, "stop"], { mockDir: seed.repoRoot });
```

- [ ] **Step 4: Update surface assertions for autonomous completion semantics**

```ts
// src/mock-run/acceptance.ts
if (surface.trackerIssues.integrationGate.status !== "closed") {
  throw new Error("Expected integration gate to be closed after autonomous run.");
}
```

- [ ] **Step 5: Run tests and confirm GREEN**

Run: `npm run test -- tests/unit/mock-run/acceptance.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit Task 7**

```bash
git add src/mock-run/acceptance.ts tests/unit/mock-run/acceptance.test.ts
git commit -m "feat: switch mock acceptance to autonomous daemon run"
```

### Task 8: Validate and Update External Mock Graph (`../aegis-qa/aegis-mock-run`)

**Files:**
- Runtime workspace: `C:/dev/aegis-qa/aegis-mock-run`
- (No source file creation in this step; this is proof graph materialization)

- [ ] **Step 1: Rebuild dist before reseed**

Run: `npm run build`
Expected: build completes with no TypeScript errors.

- [ ] **Step 2: Reseed workspace graph from updated manifest**

Run: `npm run mock:seed`
Expected: output includes `Mock repo seeded at C:\dev\aegis-qa\aegis-mock-run`.

- [ ] **Step 3: Verify ready queue and parallel graph dependencies**

Run: `bd ready --json`
Expected: initial ready contains only contract-seed issue key mapped from manifest.

Run: `bd list --json`
Expected: includes lane A/lane B pairs and gate nodes with `blocks` dependencies on both lanes.

- [ ] **Step 4: Commit Task 8 (source-side verification artifacts only if any changed)**

```bash
# If reseed changed tracked proof artifacts in repo, commit them.
# Otherwise no-op commit step for this task.
git status --short
```

### Task 9: Full Verification + Delivery Proof

**Files:**
- Modify as needed from fixes surfaced by verification

- [ ] **Step 1: Run deterministic/full suites**

Run: `npm run test`
Expected: PASS.

- [ ] **Step 2: Run lint and build**

Run: `npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 3: Run autonomous mock acceptance end-to-end**

Run: `npm run mock:acceptance`
Expected: PASS with final output showing mock acceptance completed and issue IDs.

- [ ] **Step 4: Live verify localhost serve from seeded app**

Run:
```bash
cd C:/dev/aegis-qa/aegis-mock-run
npm install
npm run dev
```
Expected: dev server starts and serves React todo UI on localhost URL shown by Vite.

- [ ] **Step 5: Final commit for verification/fixes**

```bash
git add -A
git commit -m "chore: finalize phase l tight-scope delivery proof"
```

---

## Spec Coverage Check

- Readable daemon phase-tag output: Task 3
- `--view-agent-sessions` gated behavior: Tasks 1 and 5
- Per-session live stream surface: Tasks 2 and 4
- All-caste session event capture: Task 4
- Mock graph update for React todo + parallel gates: Task 6
- Autonomous run from empty seeded repo to working app: Task 7
- External workspace graph materialization and validation: Task 8
- End-to-end verification including localhost serving: Task 9

## Placeholder Scan

- No `TODO`/`TBD` placeholders.
- Every code step includes concrete snippet.
- Every test step includes concrete command + expected result.

## Type/Interface Consistency Check

- `StartCommandOverrides.viewAgentSessions` used consistently in parse + daemon wiring.
- `streamSessionView(root, sessionId, options?)` used consistently in CLI routing/tests.
- `SessionEventRecord` fields align with stream consumer (`timestamp`, `sessionId`, `issueId`, `caste`, `eventType`, `summary`, `detail?`).

