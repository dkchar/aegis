# Aegis MVP Slice Planning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first canonical Aegis MVP from zero to a restart-safe `Beads -> Oracle -> Titan in Labor -> Merge Queue -> Sentinel` workflow with evidence from automated tests, manual gates, and benchmark artifacts.

**Architecture:** The plan preserves the PRD's truth boundaries from the start: Beads owns task truth, dispatch state owns orchestration truth, the runtime adapter owns execution, and Olympus owns visibility. Execution work happens at the child-task level; slice epics are coordination units, stay in status `blocked`, and must stay out of `bd ready`.

**Tech Stack:** Node.js, TypeScript, Vitest, React, Vite, Server-Sent Events, Beads, git worktrees, Pi runtime adapter.

## Current Status

- `2026-04-03`: `S00` is complete on `feat/s00-project-skeleton`.
- `bd ready --json` now surfaces `aegis-fjm.2.1` (`[S01] Contract seed`) as the next executable child.
- The local tracker mirror in `plandocs/2026-04-03-aegis-mvp-tracker.md` was refreshed after the S00 gate evidence update.

---

## File Structure Map

The slices below assume this file ownership pattern:

- `src/cli/` for startup, shutdown, status, and command entrypoints
- `src/config/` for config schema, defaults, and filesystem layout
- `src/core/` for dispatch loop, triage, monitor, reaper, recovery, and scope allocation
- `src/tracker/` for Beads integration and issue-domain mapping
- `src/runtime/` for `AgentRuntime`, Pi adapter, and stats normalization
- `src/castes/` for Oracle, Titan, Sentinel, and Janus prompt contracts
- `src/labor/` for worktree lifecycle
- `src/merge/` for queue state, merge gates, and Janus escalation handling
- `src/memory/` for Mnemosyne and Lethe
- `src/server/` and `src/events/` for HTTP, SSE, and live event transport
- `olympus/src/` for the dashboard
- `tests/unit/`, `tests/integration/`, and `evals/` for verification

## Slice Tasks

### Task S00: Project Skeleton and Toolchain

**Files:**
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/index.ts`
- Create: `src/shared/paths.ts`
- Create: `olympus/package.json`
- Create: `olympus/vite.config.ts`
- Test: `tests/unit/bootstrap/project-skeleton.test.ts`

- [x] **Contract seed:** establish the TypeScript, test, and workspace skeleton so later slices inherit one build and test path.
- [x] **Parallel lane A:** scaffold the Node entrypoint, shared path helpers, and baseline scripts.
- [x] **Parallel lane B:** scaffold the Olympus workspace and frontend build shell.
- [x] **Verification:** add bootstrap smoke tests and wire `npm run build`, `npm run test`, and Olympus build scripts.

**Automated gate**
- `npm run build`
- `npm run test -- tests/unit/bootstrap/project-skeleton.test.ts`

**Manual gate**
- Fresh clone installs and builds on Windows PowerShell and one Unix-like shell.

### Task S01: Config and Filesystem Contracts

**Files:**
- Create: `src/config/schema.ts`
- Create: `src/config/defaults.ts`
- Create: `src/config/load-config.ts`
- Create: `src/config/init-project.ts`
- Test: `tests/unit/config/load-config.test.ts`
- Test: `tests/integration/config/init-project.test.ts`

- [ ] **Contract seed:** define the canonical `.aegis` layout and config schema from `SPECv2.md`.
- [ ] **Parallel lane A:** implement config parsing, defaults, and validation.
- [ ] **Parallel lane B:** implement idempotent init behavior, filesystem creation, and `.gitignore` updates.
- [ ] **Verification:** add invalid-config, round-trip, and init idempotency tests.

**Automated gate**
- `npm run test -- tests/unit/config/load-config.test.ts tests/integration/config/init-project.test.ts`

**Manual gate**
- `aegis init` creates the required files without clobbering existing local config.

### Task S02: Eval Harness Foundation

**Files:**
- Create: `src/evals/run-scenario.ts`
- Create: `src/evals/result-schema.ts`
- Create: `src/evals/write-result.ts`
- Create: `evals/scenarios/index.json`
- Test: `tests/unit/evals/result-schema.test.ts`
- Test: `tests/integration/evals/run-scenario.test.ts`

- [ ] **Contract seed:** define benchmark result schema and output directory rules.
- [ ] **Parallel lane A:** implement the scenario runner and artifact writer.
- [ ] **Parallel lane B:** implement score summary generation and comparable run metadata.
- [ ] **Verification:** add schema and repeatability tests for successful and failed runs.

**Automated gate**
- `npm run test -- tests/unit/evals/result-schema.test.ts tests/integration/evals/run-scenario.test.ts`

**Manual gate**
- Running the same scenario twice yields comparable artifacts under `.aegis/evals/`, and a simulated failed run still records a clean failure artifact.

### Task S03: Fixture Repos and Benchmark Corpus

**Files:**
- Create: `evals/fixtures/clean-issue/`
- Create: `evals/fixtures/restart-during-implementation/`
- Create: `evals/fixtures/merge-conflict/`
- Create: `evals/scenarios/core-suite.json`
- Test: `tests/integration/evals/fixture-sanity.test.ts`

- [ ] **Contract seed:** define fixture naming, reset rules, and scenario manifests.
- [ ] **Parallel lane A:** create clean, complex, and restart fixtures.
- [ ] **Parallel lane B:** create merge-failure, conflict, and polling-only fixtures.
- [ ] **Verification:** add fixture sanity tests and validate scenario coverage against the MVP benchmark list.

**Automated gate**
- `npm run test -- tests/integration/evals/fixture-sanity.test.ts`

**Manual gate**
- Each fixture can be reset and run manually without hidden preconditions.

### Task S04: Tracker Adapter and Dispatch Store

**Files:**
- Create: `src/tracker/beads-client.ts`
- Create: `src/tracker/issue-model.ts`
- Create: `src/core/dispatch-state.ts`
- Create: `src/core/stage-transition.ts`
- Test: `tests/unit/core/stage-transition.test.ts`
- Test: `tests/integration/core/dispatch-state-recovery.test.ts`

- [ ] **Contract seed:** encode the canonical stage model and persisted dispatch record shape.
- [ ] **Parallel lane A:** implement Beads reads and structured issue creation/update helpers.
- [ ] **Parallel lane B:** implement dispatch-state load/save/reconcile behavior with explicit transitions.
- [ ] **Verification:** add transition, persistence, and restart recovery tests.

**Automated gate**
- `npm run test -- tests/unit/core/stage-transition.test.ts tests/integration/core/dispatch-state-recovery.test.ts`

**Manual gate**
- A newly created issue begins at `pending`, and an interrupted in-progress record remains reconcilable after restart.

### Task S05: Runtime Contract and Pi Adapter

**Files:**
- Create: `src/runtime/agent-runtime.ts`
- Create: `src/runtime/agent-events.ts`
- Create: `src/runtime/pi-runtime.ts`
- Create: `src/runtime/normalize-stats.ts`
- Test: `tests/unit/runtime/normalize-stats.test.ts`
- Test: `tests/integration/runtime/pi-runtime.test.ts`

- [ ] **Contract seed:** define the runtime boundary and normalized stats contract.
- [ ] **Parallel lane A:** implement the Pi session lifecycle and event subscription path.
- [ ] **Parallel lane B:** implement stats normalization across auth modes and session states.
- [ ] **Verification:** add contract and spawn-abort integration tests, including Windows-safe launch behavior.

**Automated gate**
- `npm run test -- tests/unit/runtime/normalize-stats.test.ts tests/integration/runtime/pi-runtime.test.ts`

**Manual gate**
- A Pi session launches and aborts cleanly from both the project root and a worktree on Windows, and Oracle tool restrictions plus abort-driven cleanup are enforced correctly.

### Task S06: HTTP Server, SSE Bus, and Launch Lifecycle

**Files:**
- Create: `src/cli/start.ts`
- Create: `src/cli/status.ts`
- Create: `src/cli/stop.ts`
- Create: `src/server/http-server.ts`
- Create: `src/server/routes.ts`
- Create: `src/events/event-bus.ts`
- Create: `src/events/sse-stream.ts`
- Test: `tests/integration/server/routes.test.ts`
- Test: `tests/integration/cli/start-stop.test.ts`

- [ ] **Contract seed:** define launch-sequence rules, live event payloads, and the control API surface.
- [ ] **Parallel lane A:** implement `aegis start`, `aegis status`, `aegis stop`, prerequisite checks, browser-open behavior, graceful shutdown, and serving the minimal Olympus shell required for Phase 0.
- [ ] **Parallel lane B:** implement REST endpoints, SSE publish/replay transport, and event serialization.
- [ ] **Verification:** add route, start-stop, and SSE tests, including restart-safe shutdown behavior.

**Automated gate**
- `npm run test -- tests/integration/server/routes.test.ts tests/integration/cli/start-stop.test.ts`

**Manual gate**
- `aegis start` serves Olympus, optionally opens the browser, `aegis status` reports correctly, and `aegis stop` or shutdown preserves reconcilable state.

### Task S07: Direct Commands and Operating Modes

**Files:**
- Create: `src/cli/parse-command.ts`
- Create: `src/core/operating-mode.ts`
- Create: `src/core/auto-loop.ts`
- Create: `src/core/command-executor.ts`
- Test: `tests/unit/cli/parse-command.test.ts`
- Test: `tests/integration/core/operating-mode.test.ts`

- [ ] **Contract seed:** codify the full deterministic MVP action family and mode state machine.
- [ ] **Parallel lane A:** implement direct command parsing and execution routing.
- [ ] **Parallel lane B:** implement conversational versus auto mode behavior, including new-ready-only auto semantics.
- [ ] **Verification:** add command table tests and mode transition tests.

**Automated gate**
- `npm run test -- tests/unit/cli/parse-command.test.ts tests/integration/core/operating-mode.test.ts`

**Manual gate**
- Validate that the parser and router resolve `scout`, `implement`, `review`, `process`, `status`, `pause`, `resume`, `auto on/off`, `scale`, `kill`, `restart`, `focus`, `tell`, `add_learning`, `reprioritize`, and `summarize`, and that commands whose backing slice has not landed yet fail clearly rather than dispatching ambiguous behavior.

### Task S08: Oracle Scouting Pipeline

**Files:**
- Create: `src/castes/oracle/oracle-prompt.ts`
- Create: `src/castes/oracle/oracle-parser.ts`
- Create: `src/core/run-oracle.ts`
- Create: `src/tracker/create-derived-issues.ts`
- Test: `tests/unit/castes/oracle/oracle-parser.test.ts`
- Test: `tests/integration/core/run-oracle.test.ts`

- [ ] **Contract seed:** define the `OracleAssessment` contract and failure semantics.
- [ ] **Parallel lane A:** implement prompt construction and strict result parsing.
- [ ] **Parallel lane B:** implement scouting dispatch, complexity gates, and decomposition issue creation.
- [ ] **Verification:** add parser, pause-on-complex, and derived-issue-linking tests.

**Automated gate**
- `npm run test -- tests/unit/castes/oracle/oracle-parser.test.ts tests/integration/core/run-oracle.test.ts`

**Manual gate**
- A scout run stores a valid assessment, pauses on `complex`, and links derived issues back to the origin issue.

### Task S09: Titan Pipeline and Labors

**Files:**
- Create: `src/labor/create-labor.ts`
- Create: `src/labor/cleanup-labor.ts`
- Create: `src/castes/titan/titan-prompt.ts`
- Create: `src/core/run-titan.ts`
- Test: `tests/unit/labor/create-labor.test.ts`
- Test: `tests/integration/core/run-titan.test.ts`

- [ ] **Contract seed:** define the Titan handoff artifact and labor lifecycle rules.
- [ ] **Parallel lane A:** implement worktree creation, cleanup, and preservation behavior.
- [ ] **Parallel lane B:** implement Titan prompt execution, clarification artifact generation, and success or failure transition mapping against the contract-seeded labor interface.
- [ ] **Verification:** add worktree lifecycle and clarification-path tests.

**Automated gate**
- `npm run test -- tests/unit/labor/create-labor.test.ts tests/integration/core/run-titan.test.ts`

**Manual gate**
- Titan runs in an isolated labor, preserves its workspace on failure, and produces a handoff artifact consumable by the merge queue.

### Task S09A: Sentinel Review Pipeline

**Files:**
- Create: `src/castes/sentinel/sentinel-prompt.ts`
- Create: `src/castes/sentinel/sentinel-parser.ts`
- Create: `src/core/run-sentinel.ts`
- Create: `src/tracker/create-fix-issue.ts`
- Test: `tests/unit/castes/sentinel/sentinel-parser.test.ts`
- Test: `tests/integration/core/run-sentinel.test.ts`

- [ ] **Contract seed:** define the Sentinel verdict contract and corrective-work rules.
- [ ] **Parallel lane A:** implement prompt construction, strict verdict parsing, and fix-issue generation.
- [ ] **Parallel lane B:** implement review dispatch, tracker state transitions, and failure handling.
- [ ] **Verification:** add verdict, corrective-work, and forced-failure tests.

**Automated gate**
- `npm run test -- tests/unit/castes/sentinel/sentinel-parser.test.ts tests/integration/core/run-sentinel.test.ts`

**Manual gate**
- A direct review run can pass or fail, generate corrective work, and provide the Sentinel failure path required by Phase 1.

### Task S10: Monitor, Reaper, Cooldown, and Recovery

**Files:**
- Create: `src/core/monitor.ts`
- Create: `src/core/reaper.ts`
- Create: `src/core/cooldown-policy.ts`
- Create: `src/core/recovery.ts`
- Test: `tests/unit/core/cooldown-policy.test.ts`
- Test: `tests/integration/core/monitor-reaper.test.ts`

- [ ] **Contract seed:** define event-driven budget enforcement, stuck detection, cooldown persistence, and recovery behavior.
- [ ] **Parallel lane A:** implement monitor logic, warnings, kills, and live stats updates.
- [ ] **Parallel lane B:** implement reaper transitions, failure accounting, and restart reconciliation.
- [ ] **Verification:** add failure-window, budget, stuck, and restart tests.

**Automated gate**
- `npm run test -- tests/unit/core/cooldown-policy.test.ts tests/integration/core/monitor-reaper.test.ts`

**Manual gate**
- Force one Oracle-tagged, Titan-tagged, and Sentinel-tagged failure through the landed execution paths and confirm the reaper transitions plus three-failure cooldown suppression.

### Task S11: Mnemosyne and Lethe Baseline

**Files:**
- Create: `src/memory/mnemosyne-store.ts`
- Create: `src/memory/select-learnings.ts`
- Create: `src/memory/lethe.ts`
- Create: `src/server/learning-route.ts`
- Test: `tests/unit/memory/select-learnings.test.ts`
- Test: `tests/integration/memory/mnemosyne-store.test.ts`

- [ ] **Contract seed:** define learning record shape, selection rules, and pruning longevity policy.
- [ ] **Parallel lane A:** implement JSONL append/read and server-side write paths for Mnemosyne records.
- [ ] **Parallel lane B:** implement prompt injection filtering and Lethe pruning.
- [ ] **Verification:** add store, fallback retrieval, and prune-priority tests.

**Automated gate**
- `npm run test -- tests/unit/memory/select-learnings.test.ts tests/integration/memory/mnemosyne-store.test.ts`

**Manual gate**
- A learning added through the orchestrator write path is retrievable by the Mnemosyne selector for the next matching prompt context, old records prune correctly, and telemetry stays out of Mnemosyne.

### Task S12: Olympus MVP Shell

**Files:**
- Create: `olympus/src/App.tsx`
- Create: `olympus/src/components/top-bar.tsx`
- Create: `olympus/src/components/settings-panel.tsx`
- Create: `olympus/src/components/agent-card.tsx`
- Create: `olympus/src/components/command-bar.tsx`
- Create: `olympus/src/lib/use-sse.ts`
- Test: `olympus/src/components/__tests__/app.test.tsx`
- Test: `olympus/src/lib/__tests__/use-sse.test.ts`

- [ ] **Contract seed:** define the MVP dashboard state model and server payload contract.
- [ ] **Note:** `S00` plus `S06` already deliver the basic Olympus shell required for Phase 0. This slice expands that stub into the full MVP dashboard contract.
- [ ] **Parallel lane A:** implement status, spend/quota, uptime, queue depth, auto toggle, and settings access.
- [ ] **Parallel lane B:** implement agent cards, SSE client state, direct command bar, response area, and kill action.
- [ ] **Verification:** add component and live-state tests, including kill-button targeting.

**Automated gate**
- `npm run test -- olympus/src/components/__tests__/app.test.tsx olympus/src/lib/__tests__/use-sse.test.ts`
- `npm run build:olympus`

**Manual gate**
- The dashboard shows status, active agents, spend/quota, uptime, queue depth, auto toggle, settings access, and a working command bar and kill action on first run.

### Task S13: Merge Queue Admission and Persistence

**Files:**
- Create: `src/merge/merge-queue-store.ts`
- Create: `src/merge/enqueue-candidate.ts`
- Create: `src/merge/queue-worker.ts`
- Create: `src/events/merge-events.ts`
- Test: `tests/unit/merge/merge-queue-store.test.ts`
- Test: `tests/integration/merge/queue-admission.test.ts`

- [ ] **Contract seed:** define queue item shape and `implemented -> queued_for_merge` admission semantics.
- [ ] **Parallel lane A:** implement queue persistence and restart-safe reads and writes plus worker skeleton.
- [ ] **Parallel lane B:** implement candidate admission and queue visibility through events or Olympus state.
- [ ] **Verification:** add ordering, persistence, and admission tests.

**Automated gate**
- `npm run test -- tests/unit/merge/merge-queue-store.test.ts tests/integration/merge/queue-admission.test.ts`

**Manual gate**
- Successful Titan output enters the queue instead of merging directly, and queued state survives restart before merge execution continues.

### Task S14: Mechanical Merge Execution and Outcome Artifacts

**Files:**
- Create: `src/merge/run-gates.ts`
- Create: `src/merge/apply-merge.ts`
- Create: `src/merge/emit-outcome-artifact.ts`
- Create: `src/merge/preserve-labor.ts`
- Test: `tests/unit/merge/run-gates.test.ts`
- Test: `tests/integration/merge/merge-outcomes.test.ts`

- [ ] **Contract seed:** define the canonical merge gates, merge outcomes, and preserved-labor rules.
- [ ] **Parallel lane A:** implement the clean merge path and mechanical gate runner.
- [ ] **Parallel lane B:** implement preserved labor, artifact serialization, and post-merge Sentinel trigger wiring against the contract-seeded merge outcome model.
- [ ] **Verification:** add clean-merge, failed-gate, conflict-artifact, and restart-during-merge tests.

**Automated gate**
- `npm run test -- tests/unit/merge/run-gates.test.ts tests/integration/merge/merge-outcomes.test.ts`

**Manual gate**
- A clean candidate lands, a failing candidate emits `MERGE_FAILED`, a conflicting candidate emits `REWORK_REQUEST` with preserved labor, and restart during merge processing remains safe.

### Task S15A: Scope Allocator

**Files:**
- Create: `src/core/scope-allocator.ts`
- Create: `src/core/overlap-visibility.ts`
- Test: `tests/unit/core/scope-allocator.test.ts`
- Test: `tests/integration/core/scope-allocation.test.ts`

- [ ] **Contract seed:** define overlap inputs, suppression outputs, and operator visibility rules.
- [ ] **Parallel lane A:** implement overlap detection from Oracle assessment and in-flight assignments.
- [ ] **Parallel lane B:** implement suppression visibility and operator-facing deferral reasons.
- [ ] **Verification:** add overlap, non-overlap, and visibility tests.

**Automated gate**
- `npm run test -- tests/unit/core/scope-allocator.test.ts tests/integration/core/scope-allocation.test.ts`

**Manual gate**
- Overlapping ready issues are suppressed before Titan dispatch and surfaced clearly to the operator.

### Task S15B: Janus Escalation Path

**Files:**
- Create: `src/castes/janus/janus-prompt.ts`
- Create: `src/castes/janus/janus-parser.ts`
- Create: `src/core/run-janus.ts`
- Create: `src/merge/tiered-conflict-policy.ts`
- Test: `tests/unit/castes/janus/janus-parser.test.ts`
- Test: `tests/integration/merge/janus-escalation.test.ts`

- [ ] **Contract seed:** define the Janus resolution contract and escalation thresholds.
- [ ] **Parallel lane A:** implement Janus dispatch, result parsing, and `resolving_integration` transitions.
- [ ] **Parallel lane B:** implement safe requeue behavior and human-decision artifact generation for semantic ambiguity.
- [ ] **Verification:** add Janus invocation, requeue, and human-decision-artifact tests.

**Automated gate**
- `npm run test -- tests/unit/castes/janus/janus-parser.test.ts tests/integration/merge/janus-escalation.test.ts`

**Manual gate**
- One Tier 3 integration case requeues safely after Janus success, and one semantic-ambiguity case emits a human-decision artifact instead of unsafe auto-resolution.

### Task S16A: Benchmark Scenario Wiring

**Files:**
- Create: `src/evals/wire-mvp-scenarios.ts`
- Create: `evals/scenarios/mvp-gate.json`
- Test: `tests/integration/evals/mvp-scenario-wiring.test.ts`

- [ ] **Contract seed:** define the exact MVP scenario set and fixture-to-pipeline mapping.
- [ ] **Parallel lane A:** wire clean-issue, complex-pause, decomposition, clarification, and restart-during-implementation scenarios to the live pipeline.
- [ ] **Parallel lane B:** wire stale-branch rework, hard merge conflict, Janus escalation, Janus human-decision, restart-during-merge, and polling-only scenarios to the live pipeline.
- [ ] **Verification:** add scenario wiring and artifact completeness tests.

**Automated gate**
- `npm run test -- tests/integration/evals/mvp-scenario-wiring.test.ts`

**Manual gate**
- The designated MVP scenario set runs end to end against the real orchestration pipeline.

### Task S16B: Release Metrics and Evidence Gate

**Files:**
- Create: `src/evals/compute-metrics.ts`
- Create: `src/evals/release-gate.ts`
- Create: `docs/mvp-release-checklist.md`
- Test: `tests/unit/evals/compute-metrics.test.ts`
- Test: `tests/integration/evals/release-gate.test.ts`

- [ ] **Contract seed:** define the metric schema, release thresholds, and evidence report shape.
- [ ] **Parallel lane A:** implement metric computation and score summary generation.
- [ ] **Parallel lane B:** implement release-threshold evaluation and evidence report generation.
- [ ] **Verification:** add metric, threshold, and report tests.

**Automated gate**
- `npm run test -- tests/unit/evals/compute-metrics.test.ts tests/integration/evals/release-gate.test.ts`

**Manual gate**
- The release report shows pass or fail against the PRD thresholds and links to the scenario artifacts that justify the decision.

## Execution Order

Recommended epic order:

1. `S00 -> S01 -> S06`
2. `S06` completes the Phase 0 path: init, prerequisite checks, basic HTTP server, and opening the minimal Olympus shell.
3. `S06 -> S02 -> S03`
4. `S01, S03 -> S04, S05`
5. `S04, S05, S06 -> S07, S08, S09`
6. `S07 -> S09A`
7. `S04, S05, S06, S08, S09, S09A -> S10`
8. `S04, S06 -> S11`
9. `S06, S10, S11 -> S12`
10. `S09, S10 -> S13`
11. `S13, S09A -> S14`
12. `S04, S07, S08 -> S15A`
13. `S14 -> S15B`
14. `S03, S11, S12, S14, S15A, S15B -> S16A`
15. `S02, S16A -> S16B`

## Verification Rules

- Do not close a slice epic until its automated gate passes and its manual gate is recorded.
- Execution units are the child tasks, not the epics.
- Inside each slice, dependencies must enforce `contract -> lane A/lane B -> verification gate`.
- Because Beads does not support task-to-epic blockers, slice epics and the program epic stay in status `blocked`; `bd ready` is the operational queue and should only surface executable child work.
- `bd swarm validate` remains useful for epic-wave planning, but it is not the execution queue.
- Prefer parallel child tasks only after the slice's contract seed lands, so subagents do not race on unstable interfaces.
