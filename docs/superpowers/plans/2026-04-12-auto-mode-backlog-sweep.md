# Auto Mode Backlog Sweep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change Aegis auto mode to sweep the full current Beads ready backlog, keep polling for later-ready work, dispatch safe work in bounded parallel, and surface the real state in Olympus.

**Architecture:** Replace the freshness-gate contract with a backlog-sweep contract, then add a dedicated auto-loop runner that reads the live ready set every cycle and dispatches up to available capacity. Wire both manual direct commands and background auto-loop work into the same HTTP-server live-event path so Olympus renders real loop, queue, and session state instead of placeholders.

**Tech Stack:** TypeScript, Node HTTP server, existing Aegis event bus and dashboard-state store, React, Vitest, Beads CLI

---

### Task 1: Replace the old fresh-ready-only contract in spec, fixtures, and core helpers

**Files:**
- Modify: `SPECv2.md`
- Modify: `plandocs/SPECv2.md`
- Modify: `plandocs/codebase-structure.md`
- Modify: `src/core/auto-loop.ts`
- Modify: `tests/fixtures/s07/operating-mode-contract.json`
- Modify: `tests/integration/core/operating-mode.test.ts`

- [ ] **Step 1: Write the failing operating-mode test for backlog sweep semantics**

```ts
it("treats both existing and newly ready issues as eligible once auto mode is enabled", async () => {
  const autoLoopModule = (await import(
    pathToFileURL(path.join(repoRoot, "src", "core", "auto-loop.ts")).href
  )) as {
    createAutoLoopState: () => { enabledAt: string | null };
    enableAutoLoop: (enabledAt: string) => { enabledAt: string };
    isAutoDispatchEligible: (
      issue: { id: string; readyAt: string },
      state: { enabledAt: string | null },
    ) => boolean;
  };

  const enabled = autoLoopModule.enableAutoLoop("2026-04-05T09:00:00.000Z");
  expect(autoLoopModule.isAutoDispatchEligible({
    id: "aegis-fjm.8.2",
    readyAt: "2026-04-05T08:59:59.000Z",
  }, enabled)).toBe(true);
  expect(autoLoopModule.isAutoDispatchEligible({
    id: "aegis-fjm.8.99",
    readyAt: "2026-04-05T09:00:01.000Z",
  }, enabled)).toBe(true);
});
```

- [ ] **Step 2: Run the focused operating-mode test and verify it fails on the old freshness gate**

Run: `npm run test -- tests/integration/core/operating-mode.test.ts`
Expected: FAIL because `src/core/auto-loop.ts` still rejects backlog items that became ready before `enabledAt`

- [ ] **Step 3: Patch the auto-loop helper and mirrored spec text to the new contract**

```ts
/**
 * Backlog-sweep auto-loop contract for S07.
 *
 * Once auto mode is enabled, any issue currently returned by `bd ready`
 * is eligible for automatic dispatch. Later polls keep ingesting newly
 * ready work as the Beads graph changes.
 */
export interface AutoLoopState {
  enabledAt: string | null;
}

export interface ReadyIssueObservation {
  id: string;
  readyAt: string;
}

export function createAutoLoopState(): AutoLoopState {
  return { enabledAt: null };
}

export function enableAutoLoop(enabledAt: string): AutoLoopState {
  return { enabledAt };
}

export function disableAutoLoop(): AutoLoopState {
  return { enabledAt: null };
}

export function isAutoDispatchEligible(
  _issue: ReadyIssueObservation,
  state: AutoLoopState,
): boolean {
  return state.enabledAt !== null;
}
```

```md
- enabling auto mode sweeps the current `bd ready` backlog immediately
- later polls continue to pick up newly ready work automatically
- auto mode does not maintain a separate freshness gate beyond Beads readiness
```

- [ ] **Step 4: Re-run the operating-mode test and verify the new contract passes**

Run: `npm run test -- tests/integration/core/operating-mode.test.ts`
Expected: PASS

- [ ] **Step 5: Commit the contract and doc parity patch**

```bash
git add SPECv2.md plandocs/SPECv2.md plandocs/codebase-structure.md src/core/auto-loop.ts tests/fixtures/s07/operating-mode-contract.json tests/integration/core/operating-mode.test.ts
git commit -m "feat: change auto mode to sweep current ready backlog"
```

### Task 2: Wire live direct-command events into the HTTP server dashboard stream

**Files:**
- Modify: `src/core/direct-command-runner.ts`
- Modify: `src/cli/start.ts`
- Modify: `src/server/http-server.ts`
- Modify: `tests/integration/core/direct-command-runner.test.ts`
- Modify: `tests/integration/server/sse-drain.test.ts`

- [ ] **Step 1: Use the failing integration tests that prove command events do not reach Olympus state**

```ts
const publishedEvents = sandbox.eventBus.snapshot();
expect(publishedEvents.some((event) =>
  event.type === "agent.session_started"
  && event.payload.caste === "oracle"
  && event.payload.issueId === ISSUE_ID
)).toBe(true);
```

```ts
const eventIngress = createInMemoryLiveEventBus();
controller = createHttpServerController({ eventIngress });

eventIngress.publish({
  id: "evt-external-1",
  type: "agent.session_started",
  timestamp: "2026-04-12T10:00:00.000Z",
  sequence: 1,
  payload: {
    sessionId: "sess-external-1",
    caste: "oracle",
    issueId: "bd-42",
    stage: "scouting",
    model: "pi:test",
  },
});
```

- [ ] **Step 2: Run the focused integration tests and verify they fail**

Run: `npm run test -- tests/integration/core/direct-command-runner.test.ts tests/integration/server/sse-drain.test.ts`
Expected: FAIL because direct commands still run with a noop event publisher and the HTTP server does not subscribe to external live-event ingress

- [ ] **Step 3: Pass the real event bus through `start.ts` and add live-event ingress support to the HTTP server**

```ts
export interface HttpServerBindings {
  eventPublisher?: LiveEventPublisher;
  eventIngress?: LiveEventPublisher;
  executeCommand?: (
    commandText: string,
    context: CommandExecutionContext,
    executor: CommandExecutor,
  ) => CommandExecutionResult | Promise<CommandExecutionResult>;
}
```

```ts
const liveEventBus = createInMemoryLiveEventBus();

const httpServerBindings: HttpServerBindings = {
  ...options.httpServerBindings,
  eventIngress: liveEventBus,
  executeCommand: options.httpServerBindings?.executeCommand ?? (async (commandText) => (
    executeProjectDirectCommand(parseCommand(commandText), {
      projectRoot: repoRoot,
      config: resolvedConfig,
      tracker,
      runtime: runtimeAdapter,
      eventPublisher: liveEventBus,
    })
  )),
};
```

```ts
const unsubscribeEventIngress = bindings.eventIngress?.subscribe((event) => {
  replayBus.publish(event);
  dashboardStateStore.apply(event);
}) ?? null;
```

- [ ] **Step 4: Re-run the direct-command and ingress tests**

Run: `npm run test -- tests/integration/core/direct-command-runner.test.ts tests/integration/server/sse-drain.test.ts`
Expected: PASS

- [ ] **Step 5: Commit the event-plumbing patch**

```bash
git add src/core/direct-command-runner.ts src/cli/start.ts src/server/http-server.ts tests/integration/core/direct-command-runner.test.ts tests/integration/server/sse-drain.test.ts
git commit -m "feat: wire live command events into olympus state"
```

### Task 3: Add a real backlog-sweeping auto-loop runner with bounded parallel dispatch

**Files:**
- Create: `src/core/auto-loop-runner.ts`
- Modify: `src/cli/start.ts`
- Modify: `tests/integration/core/auto-loop-runner.test.ts`
- Modify: `tests/integration/cli/start-stop.test.ts`

- [ ] **Step 1: Start from the failing auto-loop runner tests for backlog sweep and stale-item removal**

```ts
const result = await runAutoLoopTick({
  enabledAt: "2026-04-12T10:00:00.000Z",
  projectRoot: sandbox.projectRoot,
  config: DEFAULT_AEGIS_CONFIG,
  tracker,
  runtime,
  eventPublisher: sandbox.eventBus,
});

expect(result.processedIssueIds).toEqual([ISSUE_ID]);
expect(result.skippedIssueIds).toEqual([]);
expect(loadDispatchState(sandbox.projectRoot).records[ISSUE_ID]?.stage).toBe(
  DispatchStage.Complete,
);
```

```ts
expect(publishedEvents.some((event) =>
  event.type === "loop.phase_log"
  && event.payload.phase === "poll"
  && event.payload.line.includes("ready=1 eligible=1")
)).toBe(true);
```

- [ ] **Step 2: Run the auto-loop and start/stop tests and verify they fail before implementation**

Run: `npm run test -- tests/integration/core/auto-loop-runner.test.ts tests/integration/cli/start-stop.test.ts`
Expected: FAIL because `src/core/auto-loop-runner.ts` does not exist and `start.ts` only flips mode state without running a real poll/dispatch loop

- [ ] **Step 3: Implement the runner and start-time scheduler with bounded parallel selection**

```ts
export interface AutoLoopTickResult {
  readyIssueIds: string[];
  skippedIssueIds: string[];
  processedIssueIds: string[];
}

export async function runAutoLoopTick(
  input: AutoLoopTickInput,
): Promise<AutoLoopTickResult> {
  const readyIssues = await input.tracker.getReadyQueue();
  const dispatchState = loadDispatchState(input.projectRoot);
  const readyIssueIds = readyIssues.map((issue) => issue.id);

  input.eventPublisher.publish(createLoopPhaseLog(
    "poll",
    `ready=${readyIssues.length}`,
  ));

  const availableSlots = Math.max(
    0,
    input.config.concurrency.max_agents - Object.values(dispatchState.records).filter((record) =>
      record.stage === DispatchStage.Scouting
      || record.stage === DispatchStage.Implementing
      || record.stage === DispatchStage.Merging
      || record.stage === DispatchStage.Reviewing
      || record.stage === DispatchStage.ResolvingIntegration
    ).length,
  );

  const candidates = readyIssues.slice(0, availableSlots);
  const processedIssueIds: string[] = [];

  await Promise.all(candidates.map(async (issue) => {
    input.eventPublisher.publish(createLoopPhaseLog("dispatch", `process -> ${issue.id}`, issue.id));
    const result = await executeProjectDirectCommand(parseCommand(`process ${issue.id}`), {
      projectRoot: input.projectRoot,
      config: input.config,
      tracker: input.tracker,
      runtime: input.runtime,
      eventPublisher: input.eventPublisher,
    });
    input.eventPublisher.publish(createLoopPhaseLog("reap", `${result.status} ${issue.id}`, issue.id));
    processedIssueIds.push(issue.id);
  }));

  return { readyIssueIds, skippedIssueIds: [], processedIssueIds };
}
```

```ts
function startAutoLoop(enabledAt: string | null) {
  if (enabledAt === null) {
    stopAutoLoop();
    return;
  }

  autoLoopEnabledAt = enabledAt;
  if (autoLoopTimer) {
    return;
  }

  const intervalMs = Math.max(1, resolvedConfig.thresholds.poll_interval_seconds) * 1000;
  autoLoopTimer = setInterval(() => {
    void runScheduledAutoLoopTick();
  }, intervalMs);
  autoLoopTimer.unref();
  void runScheduledAutoLoopTick();
}
```

- [ ] **Step 4: Re-run the auto-loop and lifecycle tests**

Run: `npm run test -- tests/integration/core/auto-loop-runner.test.ts tests/integration/cli/start-stop.test.ts`
Expected: PASS

- [ ] **Step 5: Commit the auto-loop runner**

```bash
git add src/core/auto-loop-runner.ts src/cli/start.ts tests/integration/core/auto-loop-runner.test.ts tests/integration/cli/start-stop.test.ts
git commit -m "feat: add backlog-sweeping auto loop runner"
```

### Task 4: Derive Olympus ready graph, selected issue, and queue depth from live state

**Files:**
- Modify: `olympus/src/App.tsx`
- Modify: `olympus/src/components/__tests__/app.test.tsx`
- Modify: `olympus/src/components/top-bar.tsx`
- Modify: `olympus/src/types/dashboard-state.ts`

- [ ] **Step 1: Start from the failing Olympus app test**

```tsx
it("hydrates the sidebar issue graph from ready queue data", async () => {
  setMockUseSse({ isConnected: true });
  setMockReadyIssues(["foundation.contract"]);

  render(<App />);

  await waitFor(() => {
    expect(screen.queryByText("No graph data")).toBeNull();
    expect(screen.getByText("Selected Issue")).toBeTruthy();
    expect(screen.getByText("Stage: ready")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the focused Olympus app test and verify it fails on placeholder state**

Run: `npm run test --workspace olympus -- src/components/__tests__/app.test.tsx`
Expected: FAIL because `App.tsx` still hardcodes `issueGraph=[]` and `selectedIssue=null`

- [ ] **Step 3: Replace the placeholder sidebar state with deterministic derivation from ready work and live sessions**

```tsx
function deriveSidebarIssueGraph(
  readyIssues: ReadyIssueSummary[],
  state: DashboardState | null,
): string[] {
  const orderedIssueIds = [
    ...readyIssues.map((issue) => issue.id),
    ...(state?.mergeQueue?.items ?? []).map((item) => item.issueId),
    ...Object.values(state?.sessions?.active ?? {}).map((session) => session.issueId),
    ...(state?.sessions?.recent ?? []).map((session) => session.issueId),
  ];

  return Array.from(new Set(orderedIssueIds));
}

function deriveSelectedIssue(
  readyIssues: ReadyIssueSummary[],
  state: DashboardState | null,
): SelectedIssue | null {
  const activeSession = Object.values(state?.sessions?.active ?? {})[0];
  if (activeSession) {
    return {
      id: activeSession.issueId,
      stage: activeSession.stage,
      summary: `${activeSession.caste} session ${activeSession.id}`,
    };
  }

  const readyIssue = readyIssues[0];
  return readyIssue
    ? {
        id: readyIssue.id,
        stage: "ready",
        summary: readyIssue.title ?? "Ready for dispatch",
      }
    : null;
}
```

```tsx
const [readyIssues, setReadyIssues] = useState<ReadyIssueSummary[]>([]);
const readyQueue = readyIssues.map((issue) => issue.id);
const sidebarIssueGraph = deriveSidebarIssueGraph(readyIssues, state);
const selectedIssue = deriveSelectedIssue(readyIssues, state);
```

- [ ] **Step 4: Re-run the Olympus app test**

Run: `npm run test --workspace olympus -- src/components/__tests__/app.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit the Olympus derivation patch**

```bash
git add olympus/src/App.tsx olympus/src/components/__tests__/app.test.tsx olympus/src/components/top-bar.tsx olympus/src/types/dashboard-state.ts
git commit -m "feat: derive olympus ready graph from live state"
```

### Task 5: Full verification, tracker parity, and sanity pass

**Files:**
- Modify: `plandocs/2026-04-03-aegis-mvp-tracker.md`
- Modify: `tests/integration/server/state-snapshot.test.ts`
- Modify: `tests/integration/server/operating-mode-routes.test.ts`

- [ ] **Step 1: Add route-level assertions for the new auto-mode behavior and queue visibility**

```ts
expect(status.mode).toBe("auto");
expect(status.queueDepth).toBeGreaterThanOrEqual(0);
```

```md
- 2026-04-12 parity: auto mode now sweeps the current ready backlog, continues polling for new Beads-ready work, and dispatches safe items up to configured concurrency.
```

- [ ] **Step 2: Run the focused backend and frontend verification bundle**

Run: `npm run test -- tests/integration/core/operating-mode.test.ts tests/integration/core/direct-command-runner.test.ts tests/integration/core/auto-loop-runner.test.ts tests/integration/server/sse-drain.test.ts tests/integration/server/state-snapshot.test.ts tests/integration/server/operating-mode-routes.test.ts`
Expected: PASS

Run: `npm run test --workspace olympus -- src/components/__tests__/app.test.tsx`
Expected: PASS

- [ ] **Step 3: Run the project gates and mock-run sanity checklist**

Run: `npm run lint`
Expected: PASS

Run: `npm run build`
Expected: PASS

Run: `npm run test`
Expected: PASS

Run: `npm run mock:seed`
Expected: PASS and `aegis-mock-run/` recreated

Run: `npm run mock:run -- node ../dist/index.js init`
Expected: PASS

Run: `npm run mock:run -- node ../dist/index.js start --port 43123 --no-browser`
Expected: PASS and server starts

Run: `curl http://127.0.0.1:43123/api/state`
Expected: JSON with live `status`, `spend`, `agents`, and expanded dashboard sections

Run: `curl --max-time 2 http://127.0.0.1:43123/api/events`
Expected: SSE headers and replayable event frames

Run: `npm run mock:run -- node ../dist/index.js stop`
Expected: PASS

- [ ] **Step 4: Close the Beads issue, refresh tracker parity, and push**

```bash
bd close aegis-80p --reason "Completed" --json
git add plandocs/2026-04-03-aegis-mvp-tracker.md tests/integration/server/state-snapshot.test.ts tests/integration/server/operating-mode-routes.test.ts
git commit -m "test: verify backlog-sweeping auto mode"
git pull --rebase
git push
git status
```

Expected: `git status` shows the branch is up to date with `origin/main`
