# Olympus Operator Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current manual `Start Run` dashboard shell with the approved Olympus operator-console workflow: unified loop controls, phase-table main lane, merge queue section, active session terminals, recent completions tray, and a lighter queue/graph sidebar.

**Architecture:** Break Olympus into focused presentation components that consume a richer typed dashboard state. Keep `App.tsx` as the composition root, move the loop controls into a dedicated loop panel, create dedicated components for merge queue, active sessions, recent completions, and sidebar steer/queue context, and remove the old competing `Start Run` versus `Auto` control model.

**Tech Stack:** React, TypeScript, existing Olympus workspace/theme tokens, Vitest, Testing Library

---

### Task 1: Replace the competing `Start Run` and `Auto` controls with one loop-control shell

**Files:**
- Create: `olympus/src/components/loop-panel.tsx`
- Modify: `olympus/src/App.tsx`
- Modify: `olympus/src/components/top-bar.tsx`
- Modify: `olympus/src/components/__tests__/app.test.tsx`
- Create: `olympus/src/components/__tests__/loop-panel.test.tsx`

- [ ] **Step 1: Write the failing loop-shell tests**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LoopPanel } from "../loop-panel";

describe("LoopPanel", () => {
  it("renders Start when the loop is idle and does not render Start Run", () => {
    render(
      <LoopPanel
        loopState="idle"
        phaseLogs={{ poll: [], dispatch: [], monitor: [], reap: [] }}
        onStart={async () => {}}
        onPause={async () => {}}
        onResume={async () => {}}
        onStop={async () => {}}
      />,
    );

    expect(screen.getByRole("button", { name: "Start" })).toBeTruthy();
    expect(screen.queryByText("Start Run")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the failing UI tests**

Run: `npm run test --workspace olympus -- src/components/__tests__/loop-panel.test.tsx src/components/__tests__/app.test.tsx`
Expected: FAIL because `LoopPanel` does not exist and `App` still renders the old shell

- [ ] **Step 3: Implement the loop-control panel and wire it into `App.tsx`**

```tsx
export function LoopPanel(props: LoopPanelProps): JSX.Element {
  const { loopState, phaseLogs, onStart, onPause, onResume, onStop } = props;

  return (
    <section aria-label="Aegis Loop">
      <header>
        <h2>Aegis Loop</h2>
        {loopState === "idle" && <button onClick={() => void onStart()}>Start</button>}
        {loopState === "running" && <button onClick={() => void onPause()}>Pause</button>}
        {loopState === "paused" && <button onClick={() => void onResume()}>Resume</button>}
        {loopState !== "idle" && <button onClick={() => void onStop()}>Stop</button>}
      </header>
      <div className="phase-table">
        <PhaseColumn title="Poll" lines={phaseLogs.poll} />
        <PhaseColumn title="Dispatch" lines={phaseLogs.dispatch} />
        <PhaseColumn title="Monitor" lines={phaseLogs.monitor} />
        <PhaseColumn title="Reap" lines={phaseLogs.reap} />
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Re-run the loop-shell tests**

Run: `npm run test --workspace olympus -- src/components/__tests__/loop-panel.test.tsx src/components/__tests__/app.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add olympus/src/components/loop-panel.tsx olympus/src/App.tsx olympus/src/components/top-bar.tsx olympus/src/components/__tests__/loop-panel.test.tsx olympus/src/components/__tests__/app.test.tsx
git commit -m "feat: add unified olympus loop controls"
```

### Task 2: Build the queue, graph, selected-issue, and steer sidebar

**Files:**
- Create: `olympus/src/components/operator-sidebar.tsx`
- Create: `olympus/src/components/steer-panel.tsx`
- Modify: `olympus/src/components/command-bar.tsx`
- Modify: `olympus/src/components/__tests__/command-bar.test.tsx`
- Create: `olympus/src/components/__tests__/operator-sidebar.test.tsx`

- [ ] **Step 1: Write the failing sidebar and steer tests**

```tsx
it("renders ready queue, issue graph, selected issue, and steer reference", () => {
  render(
    <OperatorSidebar
      readyQueue={["foundation.contract", "foundation.lane_a"]}
      issueGraph={["todo-system", "foundation", "foundation.contract"]}
      selectedIssue={{ id: "foundation.contract", stage: "implementing", summary: "safe" }}
      steerReference={["status", "pause", "resume", "focus <issue>", "kill <agent>"]}
      onCommand={async () => {}}
    />,
  );

  expect(screen.getByText("Ready Queue")).toBeTruthy();
  expect(screen.getByText("Issue Graph")).toBeTruthy();
  expect(screen.getByText("Selected Issue")).toBeTruthy();
  expect(screen.getByText("focus <issue>")).toBeTruthy();
});
```

- [ ] **Step 2: Run the sidebar tests to verify they fail**

Run: `npm run test --workspace olympus -- src/components/__tests__/operator-sidebar.test.tsx src/components/__tests__/command-bar.test.tsx`
Expected: FAIL because `OperatorSidebar` does not exist and the old command bar still presents the wrong primary model

- [ ] **Step 3: Implement the lighter sidebar and deterministic steer panel**

```tsx
export function SteerPanel(props: SteerPanelProps): JSX.Element {
  return (
    <section aria-label="Steer">
      <input aria-label="Steer command" value={props.value} onChange={props.onChange} />
      <button onClick={() => void props.onSubmit()}>Send</button>
      <ul aria-label="Steer Reference">
        {props.reference.map((command) => <li key={command}>{command}</li>)}
      </ul>
      <ResultSurface result={props.result} />
    </section>
  );
}
```

- [ ] **Step 4: Re-run the sidebar tests**

Run: `npm run test --workspace olympus -- src/components/__tests__/operator-sidebar.test.tsx src/components/__tests__/command-bar.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add olympus/src/components/operator-sidebar.tsx olympus/src/components/steer-panel.tsx olympus/src/components/command-bar.tsx olympus/src/components/__tests__/operator-sidebar.test.tsx olympus/src/components/__tests__/command-bar.test.tsx
git commit -m "feat: add olympus operator sidebar and steer panel"
```

### Task 3: Add merge queue, active session terminals, recent completions, and Janus popup shells

**Files:**
- Create: `olympus/src/components/merge-queue-panel.tsx`
- Create: `olympus/src/components/active-sessions-panel.tsx`
- Create: `olympus/src/components/recent-sessions-tray.tsx`
- Create: `olympus/src/components/janus-popup.tsx`
- Create: `olympus/src/components/__tests__/merge-queue-panel.test.tsx`
- Create: `olympus/src/components/__tests__/active-sessions-panel.test.tsx`

- [ ] **Step 1: Write the failing session and merge-panel tests**

```tsx
it("renders the approved section order", () => {
  render(<App />);

  const headings = screen.getAllByRole("heading").map((node) => node.textContent);
  expect(headings).toEqual(expect.arrayContaining([
    "Aegis Loop",
    "Merge Queue",
    "Active Agent Sessions",
    "Completed Sessions",
  ]));
});

it("renders Janus as a popup terminal anchored to the merge queue section", () => {
  render(
    <MergeQueuePanel
      queueLength={2}
      currentItem="foundation.contract"
      lines={["> merge pending"]}
      janusSession={{ id: "janus-1", issueId: "foundation.contract", lines: ["> resolving integration"] }}
    />,
  );

  expect(screen.getByText("Janus Escalation")).toBeTruthy();
});
```

- [ ] **Step 2: Run the failing session and merge tests**

Run: `npm run test --workspace olympus -- src/components/__tests__/merge-queue-panel.test.tsx src/components/__tests__/active-sessions-panel.test.tsx src/components/__tests__/app.test.tsx`
Expected: FAIL because the sections and popup shells do not exist yet

- [ ] **Step 3: Implement the merge panel, session terminals, recent tray, and Janus popup**

```tsx
export function RecentSessionsTray(props: RecentSessionsTrayProps): JSX.Element {
  return (
    <section aria-label="Completed Sessions">
      {props.sessions.map((session) => (
        <button key={session.id} className="recent-session-pill">
          {session.id} completed {session.closedAgo}
        </button>
      ))}
    </section>
  );
}
```

- [ ] **Step 4: Re-run the session and merge tests**

Run: `npm run test --workspace olympus -- src/components/__tests__/merge-queue-panel.test.tsx src/components/__tests__/active-sessions-panel.test.tsx src/components/__tests__/app.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add olympus/src/components/merge-queue-panel.tsx olympus/src/components/active-sessions-panel.tsx olympus/src/components/recent-sessions-tray.tsx olympus/src/components/janus-popup.tsx olympus/src/components/__tests__/merge-queue-panel.test.tsx olympus/src/components/__tests__/active-sessions-panel.test.tsx olympus/src/components/__tests__/app.test.tsx
git commit -m "feat: add olympus execution sections and recent sessions tray"
```

### Task 4: Run the Olympus workflow verification bundle

**Files:**
- Modify: `olympus/src/components/__tests__/app.test.tsx`
- Modify: `olympus/src/components/__tests__/top-bar.test.tsx`

- [ ] **Step 1: Add a final app-shell test that asserts the old `Start Run` flow is gone**

```tsx
it("does not render the legacy Start Run dialog or conflicting auto toggle flow", () => {
  render(<App />);
  expect(screen.queryByText("Start Run")).toBeNull();
});
```

- [ ] **Step 2: Run the workflow bundle**

Run: `npm run test --workspace olympus -- src/components/__tests__/app.test.tsx src/components/__tests__/top-bar.test.tsx src/components/__tests__/loop-panel.test.tsx src/components/__tests__/operator-sidebar.test.tsx src/components/__tests__/merge-queue-panel.test.tsx src/components/__tests__/active-sessions-panel.test.tsx`
Expected: PASS

- [ ] **Step 3: Run the Olympus build**

Run: `npm run build --workspace olympus`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add olympus/src/components/__tests__/app.test.tsx olympus/src/components/__tests__/top-bar.test.tsx
git commit -m "test: verify olympus operator workflow shell"
```

