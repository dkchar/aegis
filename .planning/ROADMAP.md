# Roadmap: Aegis

## Overview

Layer 1 (the POLL → TRIAGE → DISPATCH → MONITOR → REAP loop with Oracle/Titan/Sentinel castes) is fully implemented. This roadmap covers the two remaining work streams: the dispatch-store architectural pivot (replacing fragile comment-based state with a persistent, typed state machine) and the Olympus dashboard (a React SPA providing real-time visibility and command input). The pivot comes first because the dashboard must display correct dispatch state data, not comment-parsed approximations.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Dispatch Store** - Persistent typed state machine replaces comment-based state; Config v2 schema (completed 2026-03-27)
- [ ] **Phase 2: Triage Pivot** - Triage reads dispatch store stages; crash recovery restores interrupted records
- [ ] **Phase 3: Conversational Mode** - Idle-first orchestrator with direct-command dispatch and auto on/off
- [ ] **Phase 4: Structured Outputs** - Oracle assessment and Sentinel verdict parsed and stored in dispatch state
- [ ] **Phase 5: Olympus Dashboard** - React SPA with agent cards, top bar, command bar, and first-run setup wizard

## Phase Details

### Phase 1: Dispatch Store
**Goal**: A persistent, typed dispatch state machine exists and Config v2 is in place
**Depends on**: Nothing (brownfield — builds on existing Layer 1)
**Requirements**: CONFIG-01, CONFIG-02, CONFIG-03, CONFIG-04, STORE-01, STORE-02, STORE-03, STORE-04, STORE-05
**Success Criteria** (what must be TRUE):
  1. `aegis init` writes a v2 config with `version: 2`, `runtime: "pi"`, and updated Oracle budgets; existing v1 configs are migrated on load
  2. `dispatch-state.json` exists in `.aegis/` after the first orchestrator tick and contains typed `DispatchRecord` entries
  3. All state file writes are atomic — a crash during write never leaves a corrupted file
  4. No module other than `dispatch-store.ts` reads or writes `dispatch-state.json` directly
  5. `DispatchRecord` contains `stage`, `oracle_assessment`, `sentinel_verdict`, `failure_count`, `last_failure_at`, `current_agent_id`, and timestamps
**Plans**: 3 plans
Plans:
- [ ] 01-PLAN-01.md — Config v2: types, migration, init gitignore, and tests
- [ ] 01-PLAN-02.md — dispatch-store.ts module with full API and test suite
- [ ] 01-PLAN-03.md — Stub dispatch-store transitions into aegis.ts dispatch and reap paths

### Phase 2: Triage Pivot
**Goal**: Triage drives dispatch from `DispatchRecord.stage` exclusively; crashed in-flight records recover cleanly
**Depends on**: Phase 1
**Requirements**: TRIAGE-01, TRIAGE-02, TRIAGE-03, CRASH-01, CRASH-02, CRASH-03
**Success Criteria** (what must be TRUE):
  1. Triage dispatches based on `DispatchRecord.stage` — no `SCOUTED:` or `REVIEWED:` comment parsing occurs anywhere in the triage path
  2. The old `SCOUTED:`/`REVIEWED:` prefix logic is removed from the codebase
  3. On startup after a crash, records stuck in `scouting`, `implementing`, or `reviewing` with no running agent are transitioned to `failed` and their issues are reopened in Beads
  4. Records at `stage=implemented` survive a crash and are picked up for Sentinel dispatch on the next tick without manual intervention
**Plans**: 2 plans
Plans:
- [ ] 02-01-PLAN.md — Rewrite triage.ts with stage-based dispatch rules and update triage.test.ts
- [ ] 02-02-PLAN.md — Update aegis.ts tick loop, remove comment-based logic, add crash recovery

### Phase 3: Conversational Mode
**Goal**: Orchestrator starts idle and responds to explicit commands; auto mode is opt-in
**Depends on**: Phase 2
**Requirements**: MODE-01, MODE-02, MODE-03, MODE-04, MODE-05, MODE-06, MODE-07, MODE-08
**Success Criteria** (what must be TRUE):
  1. Starting the orchestrator does not trigger any polling or agent dispatch — it waits for commands
  2. `auto on` activates the POLL → TRIAGE → DISPATCH → MONITOR → REAP loop; `auto off` or `pause` stops it and returns to idle
  3. `scout <issue-id>`, `implement <issue-id>`, `review <issue-id>`, and `process <issue-id>` each dispatch the correct agent caste for the specified issue
  4. `status` returns current agent state and queue depth to the caller
**Plans**: TBD

### Phase 4: Structured Outputs
**Goal**: Oracle assessments and Sentinel verdicts are parsed from agent output and persisted in dispatch state
**Depends on**: Phase 3
**Requirements**: OUTPUT-01, OUTPUT-02, OUTPUT-03, OUTPUT-04, OUTPUT-05, OUTPUT-06, OUTPUT-07
**Success Criteria** (what must be TRUE):
  1. After an Oracle completes, `dispatch-state.json` contains a valid `OracleAssessment` JSON object (`files_affected`, `estimated_complexity`, `decompose`, `ready`, optional `sub_issues`, `blockers`) or the record transitions to `stage=failed`
  2. After a Sentinel completes, `dispatch-state.json` contains a verdict (`pass` or `fail` with `summary`) and the stage transitions to `complete` or `failed` accordingly
  3. If Oracle returns `decompose=true`, sub-issues are created in Beads automatically
  4. If Oracle returns `estimated_complexity=complex`, an `orchestrator.complex_issue` event is emitted and conversational mode awaits confirmation before dispatching Titan
  5. A Sentinel that produces no valid verdict is treated as a Sentinel failure and the issue is re-queued for review
**Plans**: TBD

### Phase 5: Olympus Dashboard
**Goal**: Users can monitor and command the orchestrator through a browser UI with real-time agent state
**Depends on**: Phase 4
**Requirements**: DASH-01, DASH-02, DASH-03, DASH-04, DASH-05, DASH-06, DASH-07, DASH-08, DASH-09, SETUP-01, SETUP-02, SETUP-03, SETUP-04, SETUP-05, SETUP-06
**Success Criteria** (what must be TRUE):
  1. Opening the dashboard URL shows real-time agent cards — each card displays caste badge (color-coded: Oracle blue, Titan amber, Sentinel green), issue title, turn counter, token count, elapsed time, cost, and a kill button; completed cards remain visible for 30 seconds before fading
  2. The top bar shows orchestrator status (idle/running/auto), active agent count, total cost, uptime, queue depth, and an auto mode toggle
  3. The command bar accepts direct commands (`scout`, `implement`, `review`, `process`, `kill`, `pause`, `resume`, `auto on/off`, `status`, `restart`, `focus`, `add_learning`) without LLM routing and displays the response
  4. When no `.aegis/config.json` exists, the dashboard shows a setup wizard that collects API keys, model assignments, concurrency limits, and verifies `bd` and `git` are in PATH, then writes the config and transitions to the main dashboard
**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Dispatch Store | 3/3 | Complete   | 2026-03-27 |
| 2. Triage Pivot | 0/2 | Not started | - |
| 3. Conversational Mode | 0/TBD | Not started | - |
| 4. Structured Outputs | 0/TBD | Not started | - |
| 5. Olympus Dashboard | 0/TBD | Not started | - |
