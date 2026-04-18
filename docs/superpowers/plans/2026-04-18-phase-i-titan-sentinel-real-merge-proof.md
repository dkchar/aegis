# Phase I Titan, Sentinel, and Real Merge Proof Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver Phase I from the real Pi proof spec: Titan runs live in labor git worktrees, merge queue performs real merge in mock-run repo, Sentinel runs live strictly post-merge, and artifacts include changed-files plus diff references.

**Spec anchor:** `docs/superpowers/specs/2026-04-16-aegis-real-pi-proof-design.md` (Phase I required outcomes + exit proof).

**Architecture:** Keep CI deterministic. Add artifact enrichment at caste/merge boundaries, keep queue policy deterministic, and run live proof only through explicit operator/QA commands on seeded mock-run.

**Tech stack:** TypeScript, Vitest seam tests, existing `aegis merge next` pipeline, Pi runtime, mock-run seed flow.

## Plan augmentation (2026-04-18)

- Enforce `labor.base_path` as runtime source of truth for labor/worktree placement (no hardcoded `.aegis/labors` usage in planner/runner paths).
- Set seeded mock-run live default labor root to `scratchpad/` to satisfy Phase I labor-worktree proof while keeping labor placement config-driven.
- Add deterministic seam proving `runtime: "pi"` chooses real git merge path (with scripted Sentinel to avoid token usage in CI).
- Harden Titan/Sentinel/Janus prompts to require strict JSON-schema outputs and reduce live parser drift.
- Enforce Oracle-style function-tool contracts for Titan/Sentinel/Janus in Pi runtime so live runs emit machine-parseable artifacts without relying on free-text JSON compliance.

---

### Task 1: Lock Phase I artifact contract in deterministic tests

**Files:**
- Modify: `tests/unit/core/caste-runner.test.ts`
- Modify: `tests/unit/merge/merge-next.test.ts`
- Create: `tests/unit/core/titan-artifact-session.test.ts`
- Create: `tests/unit/merge/merge-artifact-proof.test.ts`

- [ ] **Step 1: Add failing Titan artifact assertions**
- [ ] **Step 2: Add failing merge result artifact assertions**
- [ ] **Step 3: Add failing Sentinel post-merge ordering assertion**
- [ ] **Step 4: Run targeted tests and confirm RED**

Run:
```bash
npm run test -- tests/unit/core/caste-runner.test.ts tests/unit/merge/merge-next.test.ts tests/unit/core/titan-artifact-session.test.ts tests/unit/merge/merge-artifact-proof.test.ts
```

### Task 2: Persist Titan and Janus git proof artifacts

**Files:**
- Modify: `src/core/caste-runner.ts`
- Modify: `src/core/artifact-store.ts`
- Create: `src/core/git-proof.ts`

- [ ] **Step 1: Capture pre-run git status snapshot for Titan/Janus**
- [ ] **Step 2: Capture post-run git status + changed-files manifest**
- [ ] **Step 3: Persist diff artifact reference (`git diff` text artifact or path ref)**
- [ ] **Step 4: Embed refs under Titan/Janus structured artifacts**
- [ ] **Step 5: Re-run targeted tests and confirm GREEN**

### Task 3: Harden real merge execution path in mock-run

**Files:**
- Modify: `src/merge/merge-next.ts`
- Modify: `src/merge/merge-state.ts`
- Modify: `src/mock-run/acceptance.ts`
- Modify: `tests/unit/mock-run/acceptance.test.ts`

- [ ] **Step 1: Ensure `merge next` uses real git merge in mock-run repo**
- [ ] **Step 2: Persist queue item merge result details (tier/result/target branch)**
- [ ] **Step 3: Keep Sentinel strictly post-merge only**
- [ ] **Step 4: Add acceptance helper assertions for real merge evidence**
- [ ] **Step 5: Re-run queue + acceptance unit tests**

Run:
```bash
npm run test -- tests/unit/merge/merge-next.test.ts tests/unit/mock-run/acceptance.test.ts
```

### Task 4: Live proof script for ready->reviewed slice

**Files:**
- Modify: `src/mock-run/acceptance.ts`
- Create: `docs/superpowers/runbooks/phase-i-live-proof.md`

- [ ] **Step 1: Document explicit Phase I live commands**
- [ ] **Step 2: Include artifact inspection checklist (Titan, merge, Sentinel)**
- [ ] **Step 3: Keep script opt-in only (never default CI)**

Live proof command sequence:
```bash
npm run build
npm run mock:seed
npm run mock:run -- node ../dist/index.js scout <issue-id>
npm run mock:run -- node ../dist/index.js implement <issue-id>
npm run mock:run -- node ../dist/index.js process <issue-id>
npm run mock:run -- node ../dist/index.js merge next
```

### Task 5: Phase I verification and handoff

- [ ] **Step 1: Run deterministic suite**
- [ ] **Step 2: Run full default suite**
- [ ] **Step 3: Run lint + build**
- [ ] **Step 4: Run one explicit live mock-run proof**
- [ ] **Step 5: Record artifact locations and observed output in runbook**

Run:
```bash
npm run test
npm run lint
npm run build
```

**Exit proof gate (must be true):**
- Titan live run writes real file edits inside configured labor worktree.
- `merge next` produces real merge result in mock-run repo.
- Sentinel executes only after merge success and closes passing issue.
- Titan/Janus artifacts include changed-files and diff references.
- No paid-model token tests added to CI workflows.

## Self-review

- Scope stays Phase I only.
- No UI/SSE/economics drift.
- CI remains deterministic seam-only.
