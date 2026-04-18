# Phase L Full MVP Proof Package Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver Phase L from spec: publish final runbook and proof package so human/QA can execute and verify real all-caste orchestration end-to-end from terminal output and `.aegis` artifacts.

**Spec anchor:** `docs/superpowers/specs/2026-04-16-aegis-real-pi-proof-design.md` (Phase L required outcomes + exit proof).

**Architecture:** Standardize one operator runbook + one artifact checklist + one proof summary format. Keep CI deterministic and cheap; keep live proof explicit and manual.

**Tech stack:** Markdown runbooks, existing mock-run scripts, deterministic tests, optional helper script for proof bundle summary.

---

### Task 1: Define canonical live proof runbook

**Files:**
- Create: `docs/superpowers/runbooks/full-mvp-live-proof.md`
- Modify: `docs/superpowers/specs/2026-04-16-aegis-real-pi-proof-design.md`

- [ ] **Step 1: Write single canonical command sequence covering Oracle/Titan/Sentinel/Janus/merge**
- [ ] **Step 2: Add required preflight checks (auth/model, clean workspace, bd status)**
- [ ] **Step 3: Add explicit pass/fail checkpoints per stage**
- [ ] **Step 4: Add absolute artifact paths expected after run**
- [ ] **Step 5: Add troubleshooting section for common live failures**

### Task 2: Standardize proof artifact bundle shape

**Files:**
- Create: `docs/superpowers/runbooks/full-mvp-artifact-checklist.md`
- Modify: `src/mock-run/acceptance.ts`
- Modify: `tests/unit/mock-run/acceptance.test.ts`

- [ ] **Step 1: Define required bundle surfaces (`dispatch-state`, `merge-queue`, caste artifacts, logs, transcripts policy)**
- [ ] **Step 2: Add helper output summary from acceptance flow with artifact refs**
- [ ] **Step 3: Ensure checklist covers both happy path and Janus path evidence**
- [ ] **Step 4: Add deterministic tests for summary shape**

### Task 3: Freeze CI as seam-only and document policy

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `package.json`
- Modify: `docs/superpowers/specs/2026-04-13-aegis-emergency-mvp-triage-design.md`

- [ ] **Step 1: Verify CI remains `lint + test + build` only**
- [ ] **Step 2: Add explicit docs note that live proof is operator/QA only**
- [ ] **Step 3: Ensure no acceptance/live scripts are part of default CI path**
- [ ] **Step 4: Add/adjust tests asserting this policy where applicable**

### Task 4: Final acceptance rehearsal and proof capture

**Files:**
- Modify: `docs/superpowers/runbooks/full-mvp-live-proof.md`
- Create: `docs/superpowers/runbooks/full-mvp-proof-template.md`

- [ ] **Step 1: Execute one full rehearsal on seeded mock-run**
- [ ] **Step 2: Populate proof template with command outputs, artifact refs, and dates**
- [ ] **Step 3: Confirm evidence supports all success criteria from spec**
- [ ] **Step 4: Record open risks and explicitly out-of-scope items**

### Task 5: Phase L verification and close-out

- [ ] **Step 1: Run deterministic suite**
- [ ] **Step 2: Run full default suite**
- [ ] **Step 3: Run lint + build**
- [ ] **Step 4: Confirm runbook steps execute without undocumented manual fixes**
- [ ] **Step 5: Confirm docs are internally consistent across triage + real-pi addendum**

Run:
```bash
npm run test
npm run lint
npm run build
```

**Exit proof gate (must be true):**
- QA/human can run one documented flow and verify all-caste real orchestration from artifacts.
- Runbook includes exact commands, expected outputs, and artifact checks.
- Proof package includes both merge-success and Janus-conflict evidence paths.
- CI stays deterministic seam-only with no paid-token live runs.

## Self-review

- Scope stays Phase L packaging/documentation/proof standardization.
- No new runtime behavior should be introduced unless required to close proofability gaps.
- Final deliverable optimized for repeatable QA inspection, not for CI automation.
