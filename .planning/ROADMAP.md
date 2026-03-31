# Roadmap: Aegis

## Overview

This roadmap turns the canonical PRD into a coarse five-phase delivery path. It front-loads bootstrap and evaluation, builds the deterministic core before integration complexity, then layers on the browser control room and advanced autonomy only after the lower layers are measurable and trustworthy.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions if reality forces them later

- [ ] **Phase 1: Bootstrap and Benchmark Backbone** - initialize Aegis, Olympus shell, config, and the first eval harness slices
- [ ] **Phase 2: Deterministic Dispatch Core** - build the explicit state machine, Pi adapter, labors, and restart-safe orchestration
- [ ] **Phase 3: Safe Integration and Messaging** - add the merge queue, Janus thresholds, typed messaging, and policy guardrails
- [ ] **Phase 4: Olympus Control Room** - turn Olympus into the live browser control surface for operators
- [ ] **Phase 5: Extensible Autonomy Layers** - add configurable pipelines, mixed-runtime support, bounded planning modes, and release-ready evaluation

## Phase Details

### Phase 1: Bootstrap and Benchmark Backbone
**Goal**: A new repository can initialize Aegis, launch a basic Olympus shell, and run repeatable benchmark scenarios from a stable local baseline.
**Depends on**: Nothing (first phase)
**Requirements**: [BOOT-01, BOOT-02, BOOT-03, EVAL-01]
**Canonical refs:** [SPECv2.md, package.json, .planning/PROJECT.md, .planning/research/SUMMARY.md]
**UI hint**: no
**Success Criteria** (what must be TRUE):
  1. Operator can run `aegis init` and get the required `.aegis` files plus a valid launch path.
  2. Missing prerequisites fail clearly on Windows and Unix-like development environments.
  3. Named eval scenarios can be executed twice and produce comparable result artifacts.
**Plans**: 3 plans

Plans:
- [ ] 01-01: Create CLI/bootstrap entrypoints and repository initialization flow
- [ ] 01-02: Establish config shape, local filesystem layout, and startup/shutdown behavior
- [ ] 01-03: Seed the eval harness, fixtures, and artifact schema

### Phase 2: Deterministic Dispatch Core
**Goal**: Aegis can deterministically scout and implement issues through Pi-backed agents, persisted state, isolated labors, and restart-safe orchestration.
**Depends on**: Phase 1
**Requirements**: [DISP-01, DISP-02, DISP-03, DISP-04, AGNT-01, AGNT-02, AGNT-03, LABR-01, MSG-02, MSG-03]
**Canonical refs:** [SPECv2.md, package.json, .planning/PROJECT.md, .planning/REQUIREMENTS.md, .planning/research/STACK.md, .planning/research/ARCHITECTURE.md]
**UI hint**: no
**Success Criteria** (what must be TRUE):
  1. Operator can dispatch work manually or through auto mode and see durable stage transitions from `pending` through `implemented`.
  2. Restarting the orchestrator preserves active and incomplete work state without reconstructing it from comments or memory.
  3. Titan runs in isolated worktrees and creates clarification artifacts instead of guessing when blocked.
  4. Mnemosyne stores useful learnings with pruning and prompt-budget rules applied.
**Plans**: 4 plans

Plans:
- [ ] 02-01: Implement dispatch-state persistence, poller, and deterministic triage
- [ ] 02-02: Build dispatcher, monitor, reaper, and direct command surface
- [ ] 02-03: Add runtime adapter contract plus Pi-backed Oracle/Titan/Sentinel lifecycle
- [ ] 02-04: Add labor management and Mnemosyne/Lethe basics

### Phase 3: Safe Integration and Messaging
**Goal**: Titan output lands only through a deterministic merge queue, failures become explicit artifacts, and operator guardrails are enforced visibly.
**Depends on**: Phase 2
**Requirements**: [LABR-02, LABR-03, LABR-04, MSG-01, SAFE-01, SAFE-02]
**Canonical refs:** [SPECv2.md, .planning/PROJECT.md, .planning/REQUIREMENTS.md, .planning/research/FEATURES.md, .planning/research/PITFALLS.md]
**UI hint**: no
**Success Criteria** (what must be TRUE):
  1. No Titan result merges directly to the target branch; every candidate enters the queue first.
  2. Queue failures produce explicit rework, conflict, or escalation artifacts that an operator can inspect.
  3. Janus only activates after configured integration thresholds and appears as a visible state transition.
  4. Budget, quota, retry, and policy guardrails suppress unsafe autonomous behavior before it runs.
**Plans**: 4 plans

Plans:
- [ ] 03-01: Implement merge-queue persistence, worker loop, and verification gates
- [ ] 03-02: Add conflict outcomes, Janus escalation policy, and preserved failure artifacts
- [ ] 03-03: Implement Beads-native message creation plus event-ingest freshness path
- [ ] 03-04: Wire economics, cooldowns, and safety suppression into dispatch and merge flows

### Phase 4: Olympus Control Room
**Goal**: Olympus becomes the primary operator interface for live state, commands, intervention, and observability.
**Depends on**: Phase 3
**Requirements**: [DASH-01, DASH-02, DASH-03, DASH-04]
**Canonical refs:** [SPECv2.md, .planning/PROJECT.md, .planning/REQUIREMENTS.md, .planning/research/STACK.md, .planning/research/ARCHITECTURE.md]
**UI hint**: yes
**Success Criteria** (what must be TRUE):
  1. Operator can view live swarm status, queue depth, uptime, and spend or quota state in the browser.
  2. Operator can issue direct commands and kill active agents from Olympus without terminal-only workflows.
  3. Browser refresh and reconnect preserve a correct read model because Olympus is derived from backend truth.
  4. Issue-board, timeline, budget, Mnemosyne, and eval panels expose enough state to supervise multiple agents safely.
**Plans**: 3 plans

Plans:
- [ ] 04-01: Build the Olympus shell, top bar, and active-agent cards over SSE
- [ ] 04-02: Add command bar, control actions, and safe UI-to-server command routing
- [ ] 04-03: Add issue-board, budget, event, Mnemosyne, and eval observability panels

### Phase 5: Extensible Autonomy Layers
**Goal**: Aegis adds configurable pipelines, mixed-model/runtime configuration, and bounded planning/steering layers without compromising deterministic core behavior.
**Depends on**: Phase 4
**Requirements**: [EVAL-02, EXTN-01, EXTN-02, EXTN-03]
**Canonical refs:** [SPECv2.md, .planning/PROJECT.md, .planning/REQUIREMENTS.md, .planning/research/SUMMARY.md, .planning/research/PITFALLS.md]
**UI hint**: no
**Success Criteria** (what must be TRUE):
  1. Alternate pipeline definitions and provider-prefixed model mappings work through configuration rather than code forks.
  2. Mixed-runtime operation preserves coherent budgeting, tracking, and stage semantics.
  3. Metis and Prometheus remain optional, bounded by direct commands and user confirmation rules.
  4. Release readiness can be evaluated against the benchmark suite and thresholded automatically.
**Plans**: 4 plans

Plans:
- [ ] 05-01: Generalize stage machinery for configurable pipelines
- [ ] 05-02: Add mixed-model and mixed-runtime mapping support
- [ ] 05-03: Add bounded Metis steering and Prometheus planning flows
- [ ] 05-04: Finalize release-gate evaluation and production-readiness checks

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Bootstrap and Benchmark Backbone | 0/3 | Not started | - |
| 2. Deterministic Dispatch Core | 0/4 | Not started | - |
| 3. Safe Integration and Messaging | 0/4 | Not started | - |
| 4. Olympus Control Room | 0/3 | Not started | - |
| 5. Extensible Autonomy Layers | 0/4 | Not started | - |
