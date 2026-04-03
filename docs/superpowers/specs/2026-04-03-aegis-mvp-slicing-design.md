# Aegis MVP Slicing Design

## Purpose

Turn `SPECv2.md` into a zero-to-MVP execution shape that is:

- faithful to the canonical product contract
- small enough for single-agent and subagent execution without context compaction
- parallelizable after each contract seam is established
- tracked in Beads with a local living mirror

## Source of Truth

This design uses `SPECv2.md` as the only product source of truth.

## MVP Boundary Recommendation

Recommended MVP boundary: complete `Phase 0` through `Phase 1.5` from `SPECv2.md`.

That means MVP ends only once Aegis can run the canonical path:

`Beads issue -> Oracle -> Titan in Labor -> Merge Queue -> Sentinel -> complete`

This boundary is still the right stopping point because it is the first point where:

1. the PRD's canonical post-merge Sentinel workflow exists end to end
2. the merge queue owns integration rather than direct-to-main merging
3. restart safety, manual gates, and benchmark evidence are part of the product rather than deferred cleanup

Excluded from MVP:

- `Phase 1.6` Beads-native messaging and event-ingest acceleration
- `Phase 2` Olympus maturity beyond the MVP dashboard contract
- `Phase 2.5` Metis and generic stage machinery
- `Phase 3` configurable pipelines and mixed-model swarms
- `Phase 4` Prometheus and semantic Mnemosyne retrieval

## Approach Options

### Option A: Vertical canonical MVP slices

Build thin end-to-end vertical slices that preserve final truth boundaries from day one, including the eval harness early and the merge queue before calling the product MVP.

Pros:

- matches the PRD's canonical workflow
- avoids retrofitting merge safety and restart logic later
- gives each slice a real automated gate and a local manual gate

Cons:

- requires tighter planning discipline up front
- some visible UI progress lands slightly later than a demo-first path

Recommendation: use this option.

### Option B: Dispatch-first fast path

Build CLI, dispatch, Oracle/Titan, and a thin dashboard first. Add evals and merge queue afterward.

Pros:

- fastest route to a demo
- lower short-term planning overhead

Cons:

- fights the PRD's "evaluate before scale" rule
- turns merge safety into retrofit work
- makes the MVP boundary blurry

### Option C: UI-first demo path

Lead with Olympus, SSE, mocked swarm cards, and command routing.

Pros:

- fastest browser feedback
- useful for visual validation

Cons:

- weak on truth boundaries
- does not reduce the highest-risk work: deterministic orchestration and integration safety

## Slicing Rules

Every slice in the tracker must obey these rules.

### 1. One durable seam per slice

A slice owns one primary subsystem boundary, for example config loading, Oracle assessment parsing, Sentinel verdict creation, queue admission, or Janus escalation.

### 2. Child tasks are the execution units

The slice epic is the coordination unit. The child tasks are the actual worker units.

Each child task should normally:

- touch one subsystem or one interface boundary
- modify at most 3-5 focused files
- add or update one automated test area
- finish inside one superpowers-guided implementation session without compaction

### 3. Parallelism starts after the contract task

Each slice should have:

- one contract or scaffolding child that establishes interfaces and fixtures
- two implementation children that can own disjoint files or boundaries
- one explicit verification child that runs the automated gate and records the manual gate

### 4. Epics must stay out of `bd ready`

The live tracker must be safe for execution. That means:

- slice and program epics are coordination units, not execution units
- Beads child tasks carry the real execution blockers: contract -> parallel lanes -> verification gate
- because Beads does not support task-to-epic blockers, slice epics and the program epic stay in status `blocked`
- only executable child tasks should surface in `bd ready`

### 5. Automated tests are mandatory inside the slice

A slice is not ready for manual checking until its own automated gate exists. The eval harness is not a replacement for unit and integration tests.

### 6. Manual gates stay slice-local

Manual gates should prove the behavior introduced by the slice, not the whole product. Full end-to-end MVP validation happens only in the final benchmark and release-gate slices.

## Proposed Codebase Topology

The slice plan assumes this top-level module layout:

```text
src/
  cli/
  config/
  core/
  tracker/
  runtime/
  castes/
  labor/
  merge/
  memory/
  server/
  events/
olympus/
  src/
tests/
  unit/
  integration/
evals/
  fixtures/
  scenarios/
  results/
```

This keeps the truth planes legible:

- tracker truth in `src/tracker/`
- orchestration truth in `src/core/` and `.aegis/`
- runtime boundary in `src/runtime/`
- merge safety in `src/merge/`
- operator visibility in `src/server/` and `olympus/`

## Slice Inventory

The refined MVP plan is split into 20 slices.

| Slice | Name | Primary outcome |
|---|---|---|
| `S00` | Project Skeleton and Toolchain | Node, TypeScript, Vitest, and Olympus workspace skeleton build cleanly |
| `S01` | Config and Filesystem Contracts | `.aegis` layout, config schema, init flow, and local filesystem rules are deterministic |
| `S02` | Eval Harness Foundation | scenario runner, result schema, and artifact persistence exist from the start |
| `S03` | Fixture Repos and Benchmark Corpus | repeatable fixture repos and MVP scenario manifests exist |
| `S04` | Tracker Adapter and Dispatch Store | Beads task truth and dispatch-state orchestration truth are explicit |
| `S05` | Runtime Contract and Pi Adapter | the orchestration core can spawn, steer, abort, and meter Pi sessions |
| `S06` | HTTP Server, SSE Bus, and Launch Lifecycle | basic HTTP serving, launch, prerequisite checks, browser open, control API, SSE, status, and graceful shutdown are owned explicitly |
| `S07` | Direct Commands and Operating Modes | the full deterministic MVP command family and auto-mode semantics are owned and testable |
| `S08` | Oracle Scouting Pipeline | Oracle produces strict assessment artifacts and decomposition outputs |
| `S09` | Titan Pipeline and Labors | Titan runs in isolated Labors and emits handoff and clarification artifacts |
| `S09A` | Sentinel Review Pipeline | Sentinel verdicts, corrective work, and review failure handling exist before merge-queue integration |
| `S10` | Monitor, Reaper, Cooldown, and Recovery | budget kills, stuck detection, cooldown, and restart reconciliation are deterministic |
| `S11` | Mnemosyne and Lethe Baseline | learnings can be written, injected, pruned, and kept separate from telemetry |
| `S12` | Olympus MVP Shell | the dashboard expands the Phase 0 stub into the full MVP shell contract, not just live agent cards |
| `S13` | Merge Queue Admission and Persistence | implemented candidates enter a restart-safe queue instead of merging directly |
| `S14` | Mechanical Merge Execution and Outcome Artifacts | clean merges, failure artifacts, preserved labor, and post-merge review trigger are explicit |
| `S15A` | Scope Allocator | unsafe parallel Titan work is suppressed before dispatch |
| `S15B` | Janus Escalation Path | Tier 3 integration cases can escalate safely without becoming the happy path |
| `S16A` | Benchmark Scenario Wiring | MVP benchmark scenarios are wired to the real orchestration pipeline |
| `S16B` | Release Metrics and Evidence Gate | MVP metrics, thresholds, and evidence reporting are computed and enforced |

## Dependency and Wave Model

Phase 0 in `SPECv2.md` requires the minimal open-Olympus path, not the later fully featured dashboard. This plan satisfies that by landing the Olympus workspace stub in `S00` and the served/openable shell path in `S06`; `S12` is the later expansion to the full operator dashboard.

### Wave 0: Phase 0 bootstrap

- `S00`
- `S01`
- `S06`

### Wave 0.5: Eval harness and corpus

- `S02`
- `S03`

### Wave 1: Deterministic core

- `S04`
- `S05`
- `S07`
- `S08`
- `S09`
- `S09A`
- `S10`
- `S11`

### Wave 2: Canonical MVP path

- `S12`
- `S13`
- `S14`
- `S15A`
- `S15B`

### Wave 3: MVP proof

- `S16A`
- `S16B`

The live tracker enforces phase sequencing with slice proxies:

- `S06` is the Phase 0 completion proxy before `S02` and `S03`
- `S03` is the Phase 0.5 completion proxy before Phase 1 slices start

For Phase 1.5, the merge-queue slices wait on the deterministic-core slices they actually consume. `S12` is intentionally not a hard gate for `S13` or `S15A`, because `SPECv2.md` allows queue visibility through Olympus or the event stream and the fuller dashboard shell should not delay the highest-risk workflow work.

## Tracker Strategy

Use Beads as the authoritative planning tracker for this work, with:

- one program epic for the full zero-to-MVP effort
- one epic per slice
- child tasks under each slice epic for contract setup, two implementation lanes, and verification
- explicit task-level blocking dependencies inside each slice
- slice and program epics held in status `blocked` so `bd ready` only exposes executable child work
- `bd swarm validate` treated as an epic-wave planning view, not the operational queue

Mirror the structure into a gitignored markdown file under `plandocs/` and provide a refresh script that updates:

- epic status
- child status
- last-updated timestamps
- gate evidence fields preserved in tracker data so work logs do not get overwritten on refresh

## Review Criteria For Subagents

The review pass must verify that:

1. the slice map covers the real MVP boundary and not post-MVP scope
2. every slice includes both automated and manual verification
3. each child task is small enough for non-compacting agent execution
4. parallel work inside slices is real rather than decorative
5. the tracker shape matches the prompt: epic per slice with child tasks/issues
6. the live tracker is safe for `bd ready` execution even with Beads' task-to-epic dependency limitation
