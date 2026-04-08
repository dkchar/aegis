# Aegis - Codebase Structure Reference

**Source of truth:** `SPECv2.md`  
**Tracker:** `plandocs/2026-04-03-aegis-mvp-tracker.md`  
**Generated:** 2026-04-08

---

## Slice Progress Summary

| Slice | Name | Status |
|-------|------|--------|
| S00 | Project Skeleton and Toolchain | closed |
| S01 | Config and Filesystem Contracts | closed |
| S02 | Eval Harness Foundation | closed |
| S03 | Fixture Repos and Benchmark Corpus | closed |
| S04 | Tracker Adapter and Dispatch Store | closed |
| S05 | Runtime Contract and Pi Adapter | closed |
| S06 | HTTP Server, SSE Bus, and Launch Lifecycle | closed |
| S07 | Direct Commands and Operating Modes | closed |
| S08 | Oracle Scouting Pipeline | closed |
| S09 | Titan Pipeline and Labors | closed |
| S09A | Sentinel Review Pipeline | closed |
| S10 | Monitor, Reaper, Cooldown, and Recovery | closed |
| S11 | Mnemosyne and Lethe Baseline | closed |
| S12 | Olympus MVP Shell | closed |
| S13 | Merge Queue Admission and Persistence | closed |
| S14 | Mechanical Merge Execution and Outcome Artifacts | closed |
| S15A | Scope Allocator | closed; merged to main (#42 / ecdec32) |
| S15B | Janus Escalation Path | closed |
| S16A | Benchmark Scenario Wiring | closed |
| S16B | Release Metrics and Evidence Gate | closed in Beads; follow-up bug `aegis-75i` open |

**Current execution posture:** All canonical MVP slice epics through S16B are closed in Beads, but `bd ready --json` now surfaces `aegis-75i` on 2026-04-08. That bug captures post-close S16B review findings around evidence persistence, metric fail-closed behavior, and checked-in release-report generation, so the project is in remediation rather than "nothing left to do."

---

## What Aegis Is

Aegis is a thin, deterministic multi-agent orchestrator for software work. It coordinates AI coding agents through a runtime adapter layer, uses Beads (`bd`) as tracker truth, persists orchestration truth in `.aegis/`, and exposes a browser dashboard called Olympus.

The five truth planes from `SPECv2.md` are:

- Task truth -> Beads
- Orchestration truth -> `.aegis/dispatch-state.json`
- Learned project knowledge -> `.aegis/mnemosyne.jsonl`
- Merge queue truth -> `.aegis/merge-queue.json`
- UI live state -> Olympus via SSE, derived only

---

## Top-Level Layout

```text
aegis/
|-- src/                  # Orchestrator source
|-- olympus/              # React/Vite dashboard workspace
|-- tests/                # Unit, integration, and manual tests
|-- evals/                # Scenario fixtures and manifests
|-- plandocs/             # Tracker mirror, spec, and project docs
|-- docs/                 # Design and plan docs
|-- dist/                 # Compiled orchestrator output
|-- .aegis/               # Runtime state (created by aegis init, ignored)
|-- SPECv2.md             # Canonical PRD
|-- package.json          # Root workspace and scripts
|-- tsconfig.json         # Node/orchestrator TS config
|-- tsconfig.tests.json   # Test TS config
|-- vitest.config.ts      # Test runner config
```

---

## `src/` - Orchestrator Source

### `src/index.ts`
CLI entrypoint. Dispatches `init`, `start`, `status`, and `stop`, and exports the bootstrap manifest used by tests.

### `src/shared/paths.ts`
Pure path resolver for repo root, `src/`, and `dist/`.

### `src/config/`
Configuration layer from S01.

- `schema.ts`: canonical config shape, key lists, `.aegis` directory constants, runtime state filenames.
- `defaults.ts`: default `AegisConfig`.
- `load-config.ts`: config loader, partial validation, and merge-with-defaults helpers.
- `init-project.ts`: idempotent `.aegis` initializer and `.gitignore` updater.

### `src/core/`
Deterministic orchestration core. No runtime-specific imports.

- `stage-transition.ts`: canonical dispatch stage enum, transition table, and immutable transition helper.
- `dispatch-state.ts`: load/save/reconcile logic for `.aegis/dispatch-state.json`; writes atomically via temp-file rename.
- `operating-mode.ts`: S07 contract for conversational vs auto mode state plus pause/resume helpers.
- `auto-loop.ts`: S07 contract for "new ready only" auto-mode freshness gating.
- `command-executor.ts`: S07 contract for parsed-command routing and execution result shape.
- `triage.ts`: S15A scope-aware dispatch decisions for scouted issues before Titan launch.
- `scope-allocator.ts`: S15A deterministic file-scope overlap detection and suppression rules.
- `overlap-visibility.ts`: S15A Olympus-facing overlap summaries and suppression formatting.
- `run-oracle.ts`: Oracle runtime dispatch, strict assessment parsing, artifact persistence, complexity gating, and derived-issue materialization.
- `run-titan.ts`: Titan runtime dispatch inside a labor, handoff and clarification artifact emission, and stage transitions.
- `run-sentinel.ts`: Sentinel review dispatch, verdict persistence, and corrective-fix issue creation.
- `run-janus.ts`: Janus integration-resolution dispatch and requeue/manual-decision/fail transitions.
- `poller.ts`: ready-queue polling and dispatch classification.
- `recovery.ts`, `monitor.ts`, `reaper.ts`, `reaper-impl.ts`: restart, monitoring, and session-finalization logic.

### `src/tracker/`
Beads tracker surface.

- `issue-model.ts`: internal issue classes, priorities, statuses, and mutation contracts.
- `beads-client.ts`: `bd` CLI adapter and JSON mapping layer.
- `create-derived-issues.ts`: S08 helper that turns Oracle decomposition output into linked `CreateIssueInput` records.

### `src/runtime/`
Runtime abstraction and Pi adapter.

- `agent-runtime.ts`: minimal runtime contract.
- `agent-events.ts`: normalized `AgentEvent` union.
- `normalize-stats.ts`: metering normalization and budget checks.
- `pi-runtime.ts`: Pi SDK adapter. This is the only place Pi imports belong.

### `src/castes/oracle/`
S08 contract files for Oracle scouting.

- `oracle-prompt.ts`: read-only prompt contract for an issue plus exact JSON output schema.
- `oracle-parser.ts`: strict `OracleAssessment` parser and typed parse errors.

### `src/castes/titan/`
Titan prompt contract for labor-bound execution.

- `titan-prompt.ts`: prompt sections, rules, and prompt-contract generator for a labor-bound Titan session.

### `src/castes/sentinel/`
Sentinel review prompt and strict verdict parsing.

- `sentinel-prompt.ts`: review prompt contract and read-only tool policy.
- `sentinel-parser.ts`: strict `SentinelVerdict` parser.

### `src/castes/janus/`
Janus integration-resolution prompt and strict artifact parsing.

- `janus-prompt.ts`: escalation prompt contract for preserved-labor integration work.
- `janus-parser.ts`: strict `JanusResolutionArtifact` parser.

### `src/labor/`
S09 contract files for labor lifecycle planning.

- `create-labor.ts`: deterministic labor path and branch naming plus `LaborCreationPlan`.
- `cleanup-labor.ts`: cleanup policy contract keyed by merge/failure/conflict/manual-recovery outcome.

### `src/events/`
Live event infrastructure from S06.

- `event-bus.ts`: in-memory replayable event publisher.
- `sse-stream.ts`: SSE formatter and replay transport.

### `src/server/`
HTTP surface from S06.

- `routes.ts`: route definitions and API handler bindings.
- `http-server.ts`: static Olympus serving, SSE connection management, lifecycle start/stop/status.

### `src/cli/`
CLI implementations.

- `start.ts`: prerequisite checks, dispatch-state reconciliation, HTTP server startup, browser launch, and stop-file polling.
- `stop.ts`: graceful stop signaling and fallback force-kill.
- `status.ts`: runtime status snapshotting and formatting.
- `runtime-state.ts`: runtime-state and stop-request file helpers.
- `parse-command.ts`: S07 deterministic direct-command parser for the canonical MVP command family.

### `src/evals/`
Eval harness foundation plus wired MVP scenario runners.

- `fixture-schema.ts`: scenario fixture schema and validation.
- `result-schema.ts`: eval run artifact schema, score summary type, and per-issue evidence model.
- `schema-helpers.ts`: shared validation constants/helpers.
- `validate-result.ts`: result artifact validator.
- `run-scenario.ts`: scenario runner with wired MVP live-module paths plus fixture fallback for unwired scenarios.
- `write-result.ts`: result artifact persistence.
- `compute-score-summary.ts`: per-scenario score summary derived from release metrics.
- `compute-metrics.ts`: suite-level release metric aggregation across MVP scenario results.
- `release-gate.ts`: release-threshold evaluation and evidence-linked report generation.
- `compare-runs.ts`: regression comparison helper.
- `wire-mvp-scenarios.ts`: canonical MVP scenario manifest and lane split bindings.
- `mvp-scenario-runners/`: shared harness plus lane-specific MVP scenario runners.

### `src/merge/`
Merge queue, merge worker, Janus integration, and merge artifact plumbing.

- `merge-queue-store.ts`: queue persistence and restart reconciliation.
- `enqueue-candidate.ts`, `admission-workflow.ts`: implemented -> queued_for_merge admission path.
- `queue-worker.ts`: merge queue processing and Janus escalation integration.
- `apply-merge.ts`, `run-gates.ts`, `emit-outcome-artifact.ts`, `preserve-labor.ts`: merge execution and durable outcome artifacts.
- `janus-integration.ts`, `janus-outcome-artifact.ts`, `tiered-conflict-policy.ts`: Janus requeue/manual-decision handling and escalation policy.

---

## `olympus/` - Dashboard Workspace

Olympus is the landed MVP dashboard shell from S12.

- `src/App.tsx`: Olympus root and state composition.
- `src/main.tsx`: React bootstrap.
- `index.html`, `vite.config.ts`, `package.json`, `tsconfig.json`: workspace plumbing.
- `dist/`: committed build output served by the HTTP server when present.
- `src/components/`: top bar, settings panel, agent cards, and command bar.
- `src/lib/use-sse.ts`: SSE client with retry/backoff behavior.

---

## `tests/` - Test Suite

### Fixtures

- `tests/fixtures/bootstrap/workspace-contract.json`: workspace/tooling contract.
- `tests/fixtures/config/*.json`: config defaults and init layout contracts.
- `tests/fixtures/s06/*.json`: control API, live-event, and launch-sequence contracts.
- `tests/fixtures/s07/direct-command-contract.json`: canonical S07 command list and required issue-id command subset.
- `tests/fixtures/s07/operating-mode-contract.json`: S07 operating mode defaults and state transition expectations.

### Unit Tests

- `tests/unit/bootstrap/project-skeleton.test.ts`
- `tests/unit/bootstrap/github-workflows.test.ts`
- `tests/unit/config/load-config.test.ts`
- `tests/unit/core/stage-transition.test.ts`
- `tests/unit/core/triage.test.ts`
- `tests/unit/core/scope-allocator.test.ts`
- `tests/unit/core/overlap-visibility.test.ts`
- `tests/unit/cli/runtime-ownership.test.ts`
- `tests/unit/cli/stop.test.ts`
- `tests/unit/cli/browser-and-stop-contract.test.ts`
- `tests/unit/cli/parse-command.test.ts`: S07 parser contract.
- `tests/unit/runtime/normalize-stats.test.ts`
- `tests/unit/evals/fixture-schema.test.ts`
- `tests/unit/evals/result-schema.test.ts`
- `tests/unit/evals/compute-metrics.test.ts`
- `tests/unit/tracker/beads-client.test.ts`
- `tests/unit/tracker/beads-client-create-issue-classes.test.ts`
- `tests/unit/castes/oracle/oracle-parser.test.ts`: S08 strict assessment parsing contract.
- `tests/unit/castes/janus/janus-parser.test.ts`: S15B strict Janus artifact parsing contract.
- `tests/unit/labor/create-labor.test.ts`: S09 labor path/branch/cleanup planning contract.

### Integration Tests

- `tests/integration/config/init-project.test.ts`
- `tests/integration/core/dispatch-state-recovery.test.ts`
- `tests/integration/core/operating-mode.test.ts`: S07 mode-state and auto-loop contract behavior.
- `tests/integration/core/run-oracle.test.ts`: S08 prompt, derived-issue, and complexity-pause contract.
- `tests/integration/core/run-titan.test.ts`: S09 handoff and clarification artifact contract.
- `tests/integration/core/scope-allocation.test.ts`: S15A dispatch suppression and force-dispatch coverage.
- `tests/integration/core/run-janus.test.ts`: Janus dispatch and stage-transition integration contract.
- `tests/integration/cli/start-stop.test.ts`
- `tests/integration/server/routes.test.ts`
- `tests/integration/server/sse-drain.test.ts`
- `tests/integration/runtime/pi-runtime.test.ts`
- `tests/integration/evals/fixture-sanity.test.ts`
- `tests/integration/evals/run-scenario.test.ts`
- `tests/integration/evals/mvp-scenario-wiring.test.ts`
- `tests/integration/evals/lane-a-mvp-scenario-runners.test.ts`
- `tests/integration/evals/lane-b-scenario-runners.test.ts`
- `tests/integration/evals/release-gate.test.ts`
- `tests/integration/merge/janus-escalation.test.ts`

### Manual Tests

- `tests/manual/s02-gate-check.ts`: Phase 0.5 eval smoke test.

---

## `evals/` - Benchmark Corpus

### `evals/fixtures/`
Scenario directories for the benchmark corpus, including:

- `single-clean-issue/`
- `complex-pause/`
- `decomposition/`
- `clarification/`
- `restart-during-implementation/`
- `restart-during-merge/`
- `hard-merge-conflict/`
- `stale-branch-rework/`
- `janus-escalation/`
- `janus-human-decision/`
- `polling-only/`

### `evals/scenarios/`

- `index.json`: master fixture list.
- `core-suite.json`: the current scenario manifest and expected outcomes.
- `mvp-gate.json`: canonical full-suite manifest used by the S16B release gate.

---

## `plandocs/` - Planning and Tracking

- `SPECv2.md`: canonical PRD mirror.
- `2026-04-03-aegis-mvp-tracker.md`: markdown tracker mirror.
- `2026-04-03-aegis-mvp-tracker-data.json`: machine-readable tracker mirror.
- `codebase-structure.md`: this file.
- `revise-mvp-tracker.ps1`: tracker refresh script that syncs markdown/data from Beads.
- `set-mvp-gate-evidence.ps1`: gate evidence writer and tracker refresher.
- `enhancement-spec-2026.md`: future-looking ideas; not canonical for MVP.

---

## `docs/` - Design and Plan Docs

- `docs/mvp-release-checklist.md`: static operator checklist mirrored by the S16B release gate.
- `docs/superpowers/plans/2026-04-03-aegis-mvp-slice-plan.md`: slice execution plan.
- `docs/superpowers/specs/2026-04-03-aegis-mvp-slicing-design.md`: design for slice structure and tracker layout.
- `docs/superpowers/specs/2026-04-05-completed-slices-cleanup-design.md`: cleanup design for already-landed slices.
- `docs/superpowers/aegis-execution-workflow.md`: execution workflow guidance for slice workers.

---

## `.aegis/` - Runtime Directory

Created by `aegis init` and ignored from git.

- `config.json`: project config overrides.
- `dispatch-state.json`: orchestration truth.
- `merge-queue.json`: merge queue state.
- `mnemosyne.jsonl`: learning store placeholder until S11.
- `runtime-state.json`: active server state when `aegis start` is running.
- `runtime-stop-request.json`: stop signal file.
- `labors/`: labor roots for Titan worktrees.
- `evals/`: scenario result artifacts.

---

## Key Wiring

```text
CLI (src/index.ts)
  |-- init   -> src/config/init-project.ts
  |-- start  -> src/cli/start.ts
  |             |-- loadConfig()
  |             |-- reconcileDispatchState()
  |             `-- createHttpServerController()
  |-- stop   -> src/cli/stop.ts
  `-- status -> src/cli/status.ts

Direct commands (S07)
  parse-command.ts -> command-executor.ts
                     |-- operating-mode.ts
                     `-- auto-loop.ts

Oracle (S08)
  oracle-prompt.ts -> run-oracle.ts -> create-derived-issues.ts
  oracle-parser.ts /

Titan (S09)
  create-labor.ts -> titan-prompt.ts -> run-titan.ts -> cleanup-labor.ts

Sentinel (S09A)
  sentinel-prompt.ts -> run-sentinel.ts -> create-fix-issue.ts
  sentinel-parser.ts /

Merge queue + Janus (S13-S15B)
  admission-workflow.ts -> merge-queue-store.ts -> queue-worker.ts
                                              |-- run-gates.ts / apply-merge.ts
                                              `-- run-janus.ts -> janus-integration.ts

Eval wiring (S16A)
  wire-mvp-scenarios.ts -> mvp-scenario-runners/* -> run-scenario.ts
                                                 `-> result artifacts + score summaries

Release gate (S16B)
  mvp-gate.json -> run-scenario.ts / compute-score-summary.ts -> compute-metrics.ts -> release-gate.ts
                                                                       `-> docs/mvp-release-checklist.md

Scope Allocator (S15A)
  triage.ts -> allocateScope() -> scope-allocator.ts
               |-- computeOverlap()
               |-- seedFileScope() / narrowFileScope()
               `-- forceDispatch override
  overlap-visibility.ts -> SSE events + HTTP /api/scope/status
```

---

## What Is Not Yet Built

The canonical MVP workflow slices through S16B are implemented, but S16B has an open post-review remediation bug (`aegis-75i`) before the release evidence path should be treated as fully accepted. The remaining intentional gaps in this reference are otherwise post-MVP areas from `SPECv2.md`, including broader caste families, richer operator/reporting surfaces beyond the MVP release checklist/report, and future workflow expansion outside the shipped zero-to-MVP scope.

Keep the distinction clear:

- Landed slice -> implementation, tests, and recorded gate evidence exist.
- Planned slice -> tracker and design docs exist, but implementation is still intentionally absent.
