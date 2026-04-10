# Aegis Live Execution and Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Olympus stub state with a real derived snapshot and SSE stream that drive the phase table, merge queue pane, active session terminals, Janus popup, and recent-completions tray.

**Architecture:** Introduce a dedicated dashboard-state store on the server side that owns the expanded `/api/state` snapshot and consumes normalized live events. Expand the live event contract with loop phase logs, session lifecycle events, merge queue logs, and Janus lifecycle events, then wire Olympus `useSse()` to maintain the richer client state safely across refresh and reconnect.

**Tech Stack:** TypeScript, existing event bus and SSE transport, Node in-memory state, React, Vitest

---

### Task 1: Expand the shared dashboard and live-event contracts

**Files:**
- Modify: `src/events/event-bus.ts`
- Modify: `olympus/src/types/dashboard-state.ts`
- Modify: `olympus/src/types/sse-events.ts`
- Create: `tests/unit/events/event-bus-dashboard-contract.test.ts`

- [ ] **Step 1: Write the failing event-contract test**

```ts
import { describe, expect, it } from "vitest";

import { getLiveEventPayloadFields } from "../../../src/events/event-bus.js";

describe("dashboard live event contract", () => {
  it("exposes the expanded loop, session, merge, and janus event fields", () => {
    expect(getLiveEventPayloadFields("loop.phase_log")).toEqual([
      "phase",
      "line",
      "level",
      "issueId",
      "agentId",
    ]);

    expect(getLiveEventPayloadFields("agent.session_started")).toEqual([
      "sessionId",
      "caste",
      "issueId",
      "stage",
      "model",
    ]);
  });
});
```

- [ ] **Step 2: Run the failing contract test**

Run: `npm run test -- tests/unit/events/event-bus-dashboard-contract.test.ts`
Expected: FAIL because the new live event types do not exist yet

- [ ] **Step 3: Expand the shared types**

```ts
export const LIVE_EVENT_TYPES = [
  "orchestrator.state",
  "launch.sequence",
  "control.command",
  "scope.suppression",
  "merge.queue_state",
  "merge.outcome",
  "merge.janus_escalation",
  "loop.phase_log",
  "agent.session_started",
  "agent.session_log",
  "agent.session_stats",
  "agent.session_ended",
  "merge.queue_log",
  "janus.session_started",
  "janus.session_log",
  "janus.session_ended",
  "issue.stage_changed",
] as const;
```

- [ ] **Step 4: Re-run the event-contract test**

Run: `npm run test -- tests/unit/events/event-bus-dashboard-contract.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/events/event-bus.ts olympus/src/types/dashboard-state.ts olympus/src/types/sse-events.ts tests/unit/events/event-bus-dashboard-contract.test.ts
git commit -m "feat: expand dashboard live event contract"
```

### Task 2: Add a server-side dashboard state store for snapshots and replay-safe derived state

**Files:**
- Create: `src/server/dashboard-state-store.ts`
- Create: `tests/unit/server/dashboard-state-store.test.ts`
- Modify: `src/server/http-server.ts`

- [ ] **Step 1: Write the failing dashboard state store test**

```ts
import { describe, expect, it } from "vitest";

import { createDashboardStateStore } from "../../../src/server/dashboard-state-store.js";

describe("createDashboardStateStore", () => {
  it("tracks phase logs, active sessions, merge queue state, and recent completions", () => {
    const store = createDashboardStateStore();

    store.apply({
      id: "evt-1",
      type: "loop.phase_log",
      timestamp: "2026-04-11T10:00:00.000Z",
      sequence: 1,
      payload: { phase: "dispatch", line: "oracle -> foundation.contract", level: "info", issueId: "foundation.contract", agentId: null },
    });

    const snapshot = store.snapshot();
    expect(snapshot.loop.phaseLogs.dispatch[0]).toContain("oracle -> foundation.contract");
  });
});
```

- [ ] **Step 2: Run the failing state-store test**

Run: `npm run test -- tests/unit/server/dashboard-state-store.test.ts`
Expected: FAIL with `Cannot find module '../../../src/server/dashboard-state-store.js'`

- [ ] **Step 3: Implement the in-memory dashboard state store and wire `http-server.ts` to use it**

```ts
export function createDashboardStateStore(): DashboardStateStore {
  const state: DashboardStateSnapshot = createEmptyDashboardState();

  return {
    snapshot() {
      return structuredClone(state);
    },
    apply(event) {
      switch (event.type) {
        case "loop.phase_log":
          state.loop.phaseLogs[event.payload.phase].unshift(event.payload.line);
          state.loop.phaseLogs[event.payload.phase] = state.loop.phaseLogs[event.payload.phase].slice(0, 50);
          break;
        case "agent.session_started":
          state.sessions.active[event.payload.sessionId] = {
            id: event.payload.sessionId,
            caste: event.payload.caste,
            issueId: event.payload.issueId,
            stage: event.payload.stage,
            model: event.payload.model,
            lines: [],
          };
          break;
        case "agent.session_ended":
          moveSessionToRecent(state, event.payload.sessionId, event.payload.outcome);
          break;
      }
    },
  };
}
```

- [ ] **Step 4: Re-run the state-store test**

Run: `npm run test -- tests/unit/server/dashboard-state-store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/dashboard-state-store.ts src/server/http-server.ts tests/unit/server/dashboard-state-store.test.ts
git commit -m "feat: add dashboard state store for olympus"
```

### Task 3: Publish real loop-phase, session, merge, and Janus events from the runtime and orchestration paths

**Files:**
- Create: `src/events/dashboard-events.ts`
- Modify: `src/core/direct-command-runner.ts`
- Modify: `src/core/run-oracle.ts`
- Modify: `src/core/run-titan.ts`
- Modify: `src/core/run-sentinel.ts`
- Modify: `src/merge/queue-worker.ts`
- Modify: `tests/integration/core/run-oracle.test.ts`
- Modify: `tests/integration/core/run-titan.test.ts`
- Modify: `tests/integration/merge/merge-outcomes.test.ts`

- [ ] **Step 1: Add failing integration assertions for emitted dashboard events**

```ts
expect(publishedEvents.some((event) =>
  event.type === "loop.phase_log"
  && event.payload.phase === "dispatch"
  && event.payload.line.includes("oracle ->")
)).toBe(true);

expect(publishedEvents.some((event) =>
  event.type === "agent.session_started"
  && event.payload.caste === "oracle"
)).toBe(true);
```

- [ ] **Step 2: Run the focused integration tests to verify they fail**

Run: `npm run test -- tests/integration/core/run-oracle.test.ts tests/integration/core/run-titan.test.ts tests/integration/merge/merge-outcomes.test.ts`
Expected: FAIL because the runtime and merge paths do not emit the new dashboard events

- [ ] **Step 3: Introduce event helpers and emit them from the real execution paths**

```ts
export function createLoopPhaseLog(
  sequence: number,
  phase: "poll" | "dispatch" | "monitor" | "reap",
  line: string,
): AegisLiveEvent {
  return {
    id: `evt-${sequence}`,
    type: "loop.phase_log",
    timestamp: new Date().toISOString(),
    sequence,
    payload: { phase, line, level: "info", issueId: null, agentId: null },
  };
}
```

- [ ] **Step 4: Re-run the focused integration tests**

Run: `npm run test -- tests/integration/core/run-oracle.test.ts tests/integration/core/run-titan.test.ts tests/integration/merge/merge-outcomes.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/events/dashboard-events.ts src/core/direct-command-runner.ts src/core/run-oracle.ts src/core/run-titan.ts src/core/run-sentinel.ts src/merge/queue-worker.ts tests/integration/core/run-oracle.test.ts tests/integration/core/run-titan.test.ts tests/integration/merge/merge-outcomes.test.ts
git commit -m "feat: publish real dashboard execution events"
```

### Task 4: Consume the expanded snapshot and SSE stream in Olympus

**Files:**
- Create: `olympus/src/lib/dashboard-state-reducer.ts`
- Modify: `olympus/src/lib/use-sse.ts`
- Modify: `olympus/src/App.tsx`
- Modify: `olympus/src/components/loop-panel.tsx`
- Modify: `olympus/src/components/merge-queue-panel.tsx`
- Modify: `olympus/src/components/active-sessions-panel.tsx`
- Modify: `olympus/src/components/recent-sessions-tray.tsx`
- Modify: `olympus/src/lib/__tests__/use-sse.test.ts`

- [ ] **Step 1: Write the failing `useSse()` test for live session and phase updates**

```ts
import { reduceDashboardLiveEvent } from "../dashboard-state-reducer";

it("routes loop, session, merge, and recent-session events into dashboard state", () => {
  const next = reduceDashboardLiveEvent(createEmptyDashboardState(), {
    id: "evt-1",
    type: "loop.phase_log",
    timestamp: "2026-04-11T10:00:00.000Z",
    sequence: 1,
    payload: { phase: "dispatch", line: "oracle -> foundation.contract", level: "info", issueId: "foundation.contract", agentId: null },
  });

  expect(next.loop.phaseLogs.dispatch[0]).toContain("oracle -> foundation.contract");
});
```

- [ ] **Step 2: Run the failing frontend observability tests**

Run: `npm run test --workspace olympus -- src/lib/__tests__/use-sse.test.ts src/components/__tests__/app.test.tsx`
Expected: FAIL because the SSE hook only understands the old stub state

- [ ] **Step 3: Update the SSE hook and component wiring**

```ts
export function reduceDashboardLiveEvent(
  state: DashboardState,
  event: ServerLiveEventEnvelope,
): DashboardState {
  switch (event.type) {
    case "loop.phase_log":
      return appendPhaseLine(state, event.payload);
    case "agent.session_started":
      return upsertActiveSession(state, event.payload);
    case "agent.session_ended":
      return moveSessionToRecent(state, event.payload);
    default:
      return state;
  }
}

es.addEventListener("loop.phase_log", (rawEvent) => {
  const envelope = JSON.parse((rawEvent as MessageEvent).data) as ServerLiveEventEnvelope;
  setState((prev) => reduceDashboardLiveEvent(prev!, envelope));
});
```

- [ ] **Step 4: Re-run the frontend observability tests**

Run: `npm run test --workspace olympus -- src/lib/__tests__/use-sse.test.ts src/components/__tests__/app.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add olympus/src/lib/dashboard-state-reducer.ts olympus/src/lib/use-sse.ts olympus/src/App.tsx olympus/src/components/loop-panel.tsx olympus/src/components/merge-queue-panel.tsx olympus/src/components/active-sessions-panel.tsx olympus/src/components/recent-sessions-tray.tsx olympus/src/lib/__tests__/use-sse.test.ts
git commit -m "feat: drive olympus from real execution state"
```

### Task 5: Run the observability verification bundle

**Files:**
- Modify: `tests/integration/server/routes.test.ts`
- Modify: `tests/integration/server/sse-drain.test.ts`

- [ ] **Step 1: Add a route test that asserts the expanded snapshot shape**

```ts
expect(response.body).toMatchObject({
  status: expect.any(Object),
  loop: { phaseLogs: expect.any(Object) },
  mergeQueue: expect.any(Object),
  sessions: expect.any(Object),
});
```

- [ ] **Step 2: Run the backend and frontend verification bundle**

Run: `npm run test -- tests/unit/events/event-bus-dashboard-contract.test.ts tests/unit/server/dashboard-state-store.test.ts tests/integration/server/routes.test.ts tests/integration/server/sse-drain.test.ts tests/integration/core/run-oracle.test.ts tests/integration/core/run-titan.test.ts tests/integration/merge/merge-outcomes.test.ts`
Expected: PASS

- [ ] **Step 3: Run full build and test**

Run: `npm run build`
Expected: PASS

Run: `npm run test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add tests/integration/server/routes.test.ts tests/integration/server/sse-drain.test.ts
git commit -m "test: verify olympus observability contracts"
```
