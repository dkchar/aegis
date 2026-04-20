# Aegis Phase L Tight-Scope Delivery Addendum Design

Date: 2026-04-20
Status: Active
Purpose: Expand Phase L from documentation packaging into final delivery slice that includes readable daemon terminal output, optional live agent-session terminals, and mock-run graph updates that deliver a working localhost React todo app.

## Scope and precedence

This addendum extends and narrows `docs/superpowers/specs/2026-04-16-aegis-real-pi-proof-design.md` for final delivery execution.

If this addendum conflicts with older Phase L wording that treats Phase L as documentation-only, this addendum wins.

Triage source of truth still applies:
- terminal-first runtime
- deterministic orchestration boundaries
- no Olympus/UI control plane
- no mandatory SSE transport in MVP

## Problem statement

Current `main` state after Phase K proves Janus conflict path, but final delivery still lacks:

- phase-tagged readable daemon output for full autonomous loop
- optional per-session live terminal views for running castes
- final seeded mock-run Beads graph that yields a fully working localhost todo UI from empty repo baseline
- final proof surface that demonstrates Aegis auto-run can drive seeded graph to working app outcome

## Goals

- keep default run simple: daemon logs only
- make daemon output legible by phase tags: `[POLL]`, `[TRIAGE]`, `[DISPATCH]`, `[MONITOR]`, `[REAP]`, `[MERGE]`, `[ERROR]`
- add `--view-agent-sessions` flag on `aegis start` that opens one terminal per active session, then exits window when session is reaped/fails/stops
- avoid standalone caste log tag; dispatch output already carries caste identity
- keep implementation terminal-first, inspectable, and deterministic
- update Beads graph in `../aegis-qa/aegis-mock-run` to prove parallelism while delivering complete React todo app
- ensure seeded empty mock repo can be auto-processed by Aegis to working localhost UI + README

## Non-goals

- no Olympus dashboard or browser control plane
- no mandatory SSE server/transport in this phase
- no new economics/quota systems
- no broad runtime abstraction rewrite

## Delivery outcomes

Final slice is complete only when all are true:

- `aegis start` default prints readable phase-tag daemon logs
- `aegis start --view-agent-sessions` opens live per-session terminals and those terminals close automatically when sessions finalize
- seeded `../aegis-qa/aegis-mock-run` graph contains explicit scaffold/dependency/UI/README/serve tasks and still proves parallel lane execution with gates
- Aegis autonomous run drives graph from empty seeded repo + initialized Beads to working React todo app
- resulting app can be served locally and renders working UI

## Design

### 1) Readable daemon phase logs

Add terminal formatter layer for daemon events.

Required line shape:
- prefix with phase tag (`[DISPATCH] ...`)
- include issue id when present
- include action and outcome
- include caste only on dispatch lines where dispatch already selects caste
- include session id when present

Examples:
- `[POLL] ready=2 running=1 outcome=ok`
- `[DISPATCH] issue=aegis-123 caste=titan action=launch outcome=running session=abc123`
- `[REAP] issue=aegis-123 action=finalize outcome=succeeded session=abc123`

Durable JSON phase logs remain canonical machine surface under `.aegis/logs/phases/`.

### 2) `--view-agent-sessions` flag behavior

Add `aegis start --view-agent-sessions` (default `false`).

When enabled:
- each newly launched agent session opens new terminal window
- terminal runs session stream view for that `sessionId`
- stream ends when runtime snapshot reaches terminal state (`succeeded` or `failed`) or daemon stops
- terminal window closes automatically after stream command exits

When disabled:
- no extra windows
- behavior unchanged from current default daemon flow

Failure handling:
- terminal-launch failure logs `[ERROR]` line but must not stop daemon loop

### 3) Session stream command surface

Extend stream CLI with explicit session target:
- `aegis stream session <session-id>`

Contract:
- prints live readable session events for single session
- exits once session finalized or timeout/shutdown condition reached
- reads durable session report artifacts and incremental session-event log

### 4) Session event persistence (SSE-ready but no SSE transport)

Persist session events as append-only JSONL under:
- `.aegis/logs/sessions/<session-id>.events.jsonl`

Each event record includes:
- `timestamp`
- `sessionId`
- `issueId`
- `caste`
- `eventType`
- `summary`
- optional `detail`

Reason:
- enables terminal streaming now
- keeps data shape usable for future Olympus/SSE work without building transport in this phase

### 5) Mock-run Beads graph update for final app delivery

Target workspace:
- `C:/dev/aegis-qa/aegis-mock-run`

Graph update principles:
- preserve parallel lanes + gate structure
- represent real delivery tasks needed for complete React app
- keep tracker semantics generic

Required task coverage:
- scaffold project (`npm create vite@latest` or equivalent deterministic scaffold)
- install and lock dependencies
- establish React/TypeScript app structure
- implement todo domain and storage behavior
- implement UI with add/list/complete interactions
- add README with setup/run commands
- verify localhost serving (`npm run dev`) and expected URL
- gate issue closes only after parallel lanes complete and verification task passes

### 6) Autonomous run contract

From seeded baseline repo and initialized Beads graph:
- operator runs `aegis start`
- daemon auto-loop performs poll/triage/dispatch/monitor/reap/merge cycles
- issues progress through Oracle/Titan/Sentinel/Janus as needed
- final gate closes only when app + README + serve verification evidence exist

No manual direct caste commands required for final proof path.

## Implementation boundaries

Do in this slice:
- daemon readable terminal formatter
- `--view-agent-sessions` flag and session terminal launcher/cleanup
- session stream command + event persistence
- mock-run manifest/seed updates for React delivery graph
- acceptance/update flow proving auto-run to working app

Do not do in this slice:
- SSE server endpoints
- Olympus UI integration
- unrelated restart/requeue redesign

## Verification

Deterministic tests:
- start flag parsing and default behavior
- daemon readable formatting by phase
- session terminal launch/close lifecycle (with mocked process launcher)
- stream session output parsing and completion conditions
- updated mock-run graph dependencies and ready-queue invariants

Live proof (operator/QA explicit, not CI default):
- seed mock-run workspace
- run `aegis start` with and without `--view-agent-sessions`
- verify parallel sessions visible when graph has independent lanes
- verify final repo serves localhost React todo UI and README matches commands

## Risks and controls

Risk: spawned terminal behavior differs by OS shell details.
Control: isolate launch adapter with Windows-safe `spawn`/`execFile` usage and deterministic unit tests.

Risk: noisy terminal output harms readability.
Control: enforce fixed phase-tag format and concise fields.

Risk: graph drift reduces parallel proof quality.
Control: assert lane/gate dependencies in seed tests.

Risk: app generation non-determinism.
Control: pin scaffold inputs, lockfile behavior, and minimal deterministic acceptance assertions.

## Success criteria

Phase L final delivery passes only when:
- readable phase-tag daemon logs exist in default run
- session windows are opt-in and auto-close on session completion
- updated mock-run graph still proves parallel lanes and gates
- autonomous run reaches completed tracker state for app delivery graph
- produced mock repo contains working React todo app, runnable localhost UI, and accurate README

## Self-review

Consistency checks:
- scope remains terminal-first and tight
- dispatch keeps caste visibility; no separate caste-level log tag required
- SSE transport explicitly deferred while event format remains future-compatible
- final proof target is working app delivery, not docs-only packaging
