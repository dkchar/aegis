# Phase J Oracle and Visible Parallelism Proof Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver Phase J from spec: Oracle runs live on seeded graph, daemon visibly runs independent ready issues in parallel, monitor/reap remain readable under concurrency, and gate issues unblock only after prerequisite lanes complete.

**Spec anchor:** `docs/superpowers/specs/2026-04-16-aegis-real-pi-proof-design.md` (Phase J required outcomes + exit proof).

**Architecture:** Reuse existing seeded coordination graph (`contract`, `lane_a`, `lane_b`, `gate`). Strengthen runtime-state and phase-log observability so active parallel sessions are explicit in terminal + durable logs.

**Tech stack:** TypeScript, Vitest deterministic scheduler tests, daemon auto mode, mock-run seeded Beads graph.

---

### Task 1: Lock parallel orchestration contract in tests

**Files:**
- Modify: `tests/unit/core/triage.test.ts`
- Modify: `tests/unit/core/dispatcher.test.ts`
- Modify: `tests/unit/core/monitor.test.ts`
- Create: `tests/unit/core/parallel-lane-scheduling.test.ts`

- [ ] **Step 1: Add failing test for two independent ready lanes dispatched concurrently**
- [ ] **Step 2: Add failing test for gate issue staying blocked until lane completion**
- [ ] **Step 3: Add failing monitor/reap readability assertions for multi-session state**
- [ ] **Step 4: Run targeted tests and confirm RED**

Run:
```bash
npm run test -- tests/unit/core/triage.test.ts tests/unit/core/dispatcher.test.ts tests/unit/core/monitor.test.ts tests/unit/core/parallel-lane-scheduling.test.ts
```

### Task 2: Strengthen terminal + durable visibility for active parallel runs

**Files:**
- Modify: `src/cli/status.ts`
- Modify: `src/cli/runtime-state.ts`
- Modify: `src/core/phase-log.ts`
- Modify: `src/core/dispatcher.ts`
- Modify: `src/core/monitor.ts`

- [ ] **Step 1: Extend status output with active issue/caste/model/workdir snapshot**
- [ ] **Step 2: Ensure runtime-state carries enough in-flight details for two+ sessions**
- [ ] **Step 3: Emit correlation-ready phase logs for each parallel issue path**
- [ ] **Step 4: Re-run scheduler + status tests and confirm GREEN**

### Task 3: Mock-run live parallel proof harness

**Files:**
- Modify: `src/mock-run/acceptance.ts`
- Modify: `tests/unit/mock-run/acceptance.test.ts`
- Create: `docs/superpowers/runbooks/phase-j-live-proof.md`

- [ ] **Step 1: Add explicit Phase J live flow targeting seeded lane issues**
- [ ] **Step 2: Add artifact checks for parallel launch evidence in logs/state**
- [ ] **Step 3: Add assertion that gate issue unblocks only after both lanes finish**
- [ ] **Step 4: Keep live flow opt-in only (not CI default)**

Suggested live flow:
```bash
npm run build
npm run mock:seed
npm run mock:run -- node ../dist/index.js start
npm run mock:run -- node ../dist/index.js status
npm run mock:run -- node ../dist/index.js stop
```

### Task 4: Phase J verification and evidence capture

- [ ] **Step 1: Run deterministic tests for scheduling/observability**
- [ ] **Step 2: Run full default suite**
- [ ] **Step 3: Run lint + build**
- [ ] **Step 4: Run one explicit live daemon proof and collect logs**
- [ ] **Step 5: Record proof evidence paths in runbook**

Run:
```bash
npm run test
npm run lint
npm run build
```

**Exit proof gate (must be true):**
- At least two independent lane issues visibly run in parallel.
- Oracle sessions are live (not scripted) in that flow.
- Monitor/reap output stays readable and issue-specific during concurrency.
- Gate issue remains blocked until prerequisites complete, then becomes dispatchable.
- Evidence visible in terminal plus `.aegis/` logs/state artifacts.

## Self-review

- Scope stays Phase J only.
- No merge-tier redesign here (already Phase F/I concern).
- CI remains deterministic; live parallel proof remains explicit QA/operator run.
