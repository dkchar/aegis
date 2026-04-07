# Aegis - Codebase Structure Reference

**Source of truth:** `SPECv2.md`  
**Tracker:** `plandocs/2026-04-03-aegis-mvp-tracker.md`  
**Generated:** 2026-04-05

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
| S07 | Direct Commands and Operating Modes | blocked; contract seed landed, lanes open |
| S08 | Oracle Scouting Pipeline | blocked; contract seed landed, lanes open |
| S09 | Titan Pipeline and Labors | blocked; contract seed landed, lanes open |
| S09A | Sentinel Review Pipeline | blocked; not started |
| S10 | Monitor, Reaper, Cooldown, and Recovery | closed |
| S11 | Mnemosyne and Lethe Baseline | closed |
| S12 | Olympus MVP Shell | closed |
| S13 | Merge Queue Admission and Persistence | blocked; not started |
| S14 | Mechanical Merge Execution and Outcome Artifacts | blocked; not started |
| S15A | Scope Allocator | closed; PR #42 pending merge |
| S15B | Janus Escalation Path | blocked; not started |
| S16A | Benchmark Scenario Wiring | blocked; not started |
| S16B | Release Metrics and Evidence Gate | blocked; not started |

**Current execution posture:** S15A complete. Next ready: S11 contract (aegis-fjm.12.1) or S15B contract after S14 dependency clears.

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
- `run-oracle.ts`: S08 pure Oracle runner; builds the prompt, parses the strict assessment, derives sub-issue inputs, and surfaces `requiresHumanApproval` for complex work.
- `run-titan.ts`: S09 pure Titan handoff contract; defines handoff artifact, clarification artifact, and lifecycle rules without yet wiring runtime execution.

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
S09 contract files for Titan execution.

- `titan-prompt.ts`: prompt sections, rules, and prompt-contract generator for a labor-bound Titan session.

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
Eval harness foundation from S02 and S03.

- `fixture-schema.ts`: scenario fixture schema and validation.
- `result-schema.ts`: eval run artifact schema and score summary type.
- `schema-helpers.ts`: shared validation constants/helpers.
- `validate-result.ts`: result artifact validator.
- `run-scenario.ts`: deterministic fixture-driven scenario runner.
- `write-result.ts`: result artifact persistence.
- `compute-score-summary.ts`: metric computation from run artifacts.
- `compare-runs.ts`: regression comparison helper.

---

## `olympus/` - Dashboard Workspace

The dashboard is still Phase 0 shell only.

- `src/App.tsx`: placeholder Olympus root.
- `src/main.tsx`: React bootstrap.
- `index.html`, `vite.config.ts`, `package.json`, `tsconfig.json`: workspace plumbing.
- `dist/`: committed build output served by the HTTP server when present.

Full MVP dashboard work remains owned by S12.

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
- `tests/unit/cli/runtime-ownership.test.ts`
- `tests/unit/cli/stop.test.ts`
- `tests/unit/cli/browser-and-stop-contract.test.ts`
- `tests/unit/cli/parse-command.test.ts`: S07 parser contract.
- `tests/unit/runtime/normalize-stats.test.ts`
- `tests/unit/evals/fixture-schema.test.ts`
- `tests/unit/evals/result-schema.test.ts`
- `tests/unit/tracker/beads-client.test.ts`
- `tests/unit/tracker/beads-client-create-issue-classes.test.ts`
- `tests/unit/castes/oracle/oracle-parser.test.ts`: S08 strict assessment parsing contract.
- `tests/unit/labor/create-labor.test.ts`: S09 labor path/branch/cleanup planning contract.

### Integration Tests

- `tests/integration/config/init-project.test.ts`
- `tests/integration/core/dispatch-state-recovery.test.ts`
- `tests/integration/core/operating-mode.test.ts`: S07 mode-state and auto-loop contract behavior.
- `tests/integration/core/run-oracle.test.ts`: S08 prompt, derived-issue, and complexity-pause contract.
- `tests/integration/core/run-titan.test.ts`: S09 handoff and clarification artifact contract.
- `tests/integration/cli/start-stop.test.ts`
- `tests/integration/server/routes.test.ts`
- `tests/integration/server/sse-drain.test.ts`
- `tests/integration/runtime/pi-runtime.test.ts`
- `tests/integration/evals/fixture-sanity.test.ts`
- `tests/integration/evals/run-scenario.test.ts`

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

- `docs/superpowers/plans/2026-04-03-aegis-mvp-slice-plan.md`: slice execution plan.
- `docs/superpowers/specs/2026-04-03-aegis-mvp-slicing-design.md`: design for slice structure and tracker layout.
- `docs/superpowers/specs/2026-04-05-completed-slices-cleanup-design.md`: cleanup design for already-landed slices.
- `docs/superpowers/aegis-execution-workflow.md`: execution workflow guidance for slice workers.

---

## `.aegis/` - Runtime Directory

Created by `aegis init` and ignored from git.

- `config.json`: project config overrides.
- `dispatch-state.json`: orchestration truth.
- `merge-queue.json`: merge queue state placeholder until S13.
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

Direct commands (S07 contract)
  parse-command.ts -> command-executor.ts
                     |-- operating-mode.ts
                     `-- auto-loop.ts

Oracle (S08 contract)
  oracle-prompt.ts -> run-oracle.ts -> create-derived-issues.ts
  oracle-parser.ts /

Titan (S09 contract)
  create-labor.ts -> titan-prompt.ts -> run-titan.ts -> cleanup-labor.ts

Scope Allocator (S15A)
  triage.ts -> allocateScope() -> scope-allocator.ts
               |-- computeOverlap()
               |-- seedFileScope() / narrowFileScope()
               `-- forceDispatch override
  overlap-visibility.ts -> SSE events + HTTP /api/scope/status
```

---

## What Is Not Yet Built

The following areas are still incomplete even though some contract files now exist:

- S07 lane logic: no real command routing implementation yet beyond parser and execution contracts.
- S08 lane logic: no runtime-backed Oracle dispatch or tracker mutation wiring yet beyond pure contracts.
- S09 lane logic: no real labor creation/cleanup shelling or Titan runtime integration yet beyond planning artifacts.
- S09A: no Sentinel prompt/parser/review pipeline files yet.
- S11: no Mnemosyne/Lethe source files yet.
- S12: Olympus is still the minimal shell, not the MVP dashboard.
- S13-S16B: merge queue, Janus, scenario wiring, and release gate modules are still absent.
- S15A scope allocator: implemented (PR #42 pending merge) — `src/core/scope-allocator.ts`, `src/core/overlap-visibility.ts`, `src/core/triage.ts` wired with forceDispatch, seedFileScope, narrowFileScope.

Keep the distinction clear:

- Contract seed landed -> interfaces, scaffolding, and tests exist.
- Lane not landed -> behavior is still intentionally incomplete.
- Gate not landed -> slice evidence is still pending.
