# Phase K Janus Live Conflict Proof Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver Phase K from spec: seeded mock-run produces real T3 conflict, Janus runs live with preserved merge context, and Janus outcome is either safe requeue or correct manual-decision artifact.

**Spec anchor:** `docs/superpowers/specs/2026-04-16-aegis-real-pi-proof-design.md` (Phase K required outcomes + exit proof).

**Architecture:** Keep deterministic tier policy. Add deterministic conflict-seed fixtures so live merge path can reproduce T3 escalation on demand without brittle ad hoc setup.

**Tech stack:** TypeScript, git merge mechanics, Janus artifact parser/runner, seeded mock-run issue graph, deterministic seam tests.

---

### Task 1: Lock T3 Janus conflict contract in tests

**Files:**
- Modify: `tests/unit/merge/tier-policy.test.ts`
- Modify: `tests/unit/merge/merge-next.test.ts`
- Modify: `tests/unit/castes/janus-parser.test.ts`
- Create: `tests/unit/merge/janus-conflict-proof.test.ts`

- [ ] **Step 1: Add failing test for deterministic T3 escalation on conflict threshold**
- [ ] **Step 2: Add failing test for Janus live path outcome handling (requeue/manual_decision)**
- [ ] **Step 3: Add failing artifact validation assertions for preserved labor + conflict summary**
- [ ] **Step 4: Run targeted tests and confirm RED**

Run:
```bash
npm run test -- tests/unit/merge/tier-policy.test.ts tests/unit/merge/merge-next.test.ts tests/unit/castes/janus-parser.test.ts tests/unit/merge/janus-conflict-proof.test.ts
```

### Task 2: Seed reproducible real conflict path in mock-run

**Files:**
- Modify: `src/mock-run/todo-manifest.ts`
- Modify: `src/mock-run/seed-mock-run.ts`
- Modify: `tests/unit/mock-run/seed-mock-run.test.ts`

- [ ] **Step 1: Add conflict-producing issue pair to seeded graph**
- [ ] **Step 2: Ensure both branches touch same hunk deterministically**
- [ ] **Step 3: Keep issue dependency wiring generic and inspectable**
- [ ] **Step 4: Re-run mock seed tests and confirm GREEN**

### Task 3: Enrich Janus live artifact and queue transitions

**Files:**
- Modify: `src/core/caste-runner.ts`
- Modify: `src/merge/merge-next.ts`
- Modify: `src/merge/merge-state.ts`
- Modify: `tests/unit/core/caste-runner.test.ts`

- [ ] **Step 1: Persist merge conflict context refs for Janus input**
- [ ] **Step 2: Persist Janus output with resolution strategy and next action**
- [ ] **Step 3: On Janus requeue, update queue item deterministically**
- [ ] **Step 4: On Janus manual decision, fail-close queue item with artifact ref**
- [ ] **Step 5: Re-run queue/caste tests and confirm GREEN**

### Task 4: Phase K live runbook and proof script

**Files:**
- Create: `docs/superpowers/runbooks/phase-k-live-proof.md`
- Modify: `src/mock-run/acceptance.ts`
- Modify: `tests/unit/mock-run/acceptance.test.ts`

- [ ] **Step 1: Document explicit conflict-creation and merge-next command sequence**
- [ ] **Step 2: Add acceptance helper assertions for Janus invocation evidence**
- [ ] **Step 3: Validate both acceptable outcomes (requeue or manual_decision artifact)**
- [ ] **Step 4: Keep run explicit/manual only, not CI default**

Suggested live flow:
```bash
npm run build
npm run mock:seed
npm run mock:run -- node ../dist/index.js process <conflict-issue-id>
npm run mock:run -- node ../dist/index.js merge next
npm run mock:run -- node ../dist/index.js merge next
npm run mock:run -- node ../dist/index.js merge next
```

### Task 5: Phase K verification and evidence handoff

- [ ] **Step 1: Run deterministic Janus/merge suites**
- [ ] **Step 2: Run full default suite**
- [ ] **Step 3: Run lint + build**
- [ ] **Step 4: Execute one explicit live conflict proof**
- [ ] **Step 5: Record Janus artifact and queue state evidence paths**

Run:
```bash
npm run test
npm run lint
npm run build
```

**Exit proof gate (must be true):**
- Seeded scenario reliably reaches T3 conflict.
- Janus executes live with preserved labor and merge context.
- Outcome is either deterministic requeue or correct manual-decision artifact.
- Terminal + `.aegis` artifacts let QA verify full path without hidden state.

## Self-review

- Scope stays Phase K only.
- No new CI token gates.
- Conflict reproducibility prioritized over ad hoc environment-dependent merges.
