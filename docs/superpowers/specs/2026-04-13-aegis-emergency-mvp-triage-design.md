# Aegis Emergency MVP Triage Design

Date: 2026-04-13
Status: Active
Purpose: Define the emergency recovery contract for rewriting Aegis into a working, terminal-first MVP after severe architectural drift.

## Recovery progress

- Phase A complete on 2026-04-13.
- Phase B complete on 2026-04-13.
- Phase C complete on 2026-04-13.
- Phases D through G remain open.

## Scope and source of truth

This design becomes the active source of truth for the emergency recovery effort.

It supersedes the older spec direction anywhere they conflict, especially on:
- Olympus as primary interface
- economics and budget enforcement
- Beads-native messaging
- Mnemosyne
- eval harness and benchmark corpus
- browser/SSE-led observability
- conversational/idle mode as a first-class operating posture

Emergency recovery rule:
- this document is the active source of truth for the stripped MVP rewrite
- future planning should continue through focused addenda plus a Q&A appendix pattern like the discovery log captured for this design
- older product/spec direction should be treated as historical context, not as a competing authority

Reference context:
- discovery log: `docs/superpowers/specs/2026-04-13-aegis-emergency-triage-discovery.md`
- deferred items list: `docs/superpowers/specs/2026-04-13-aegis-emergency-deferred-items.md`

## Problem statement

The current repository has accumulated severe drift:
- repo instructions still reference deleted planning documents
- startup and observability have been pulled toward HTTP/SSE/UI control paths
- ready work and recent commits indicate repeated fixing around Olympus and runtime tool-calling symptoms rather than proving the core orchestrator path
- the product may be feature-rich on paper but is not trusted to work end to end

The recovery goal is not to stabilize the current feature surface.
The recovery goal is to aggressively remove pollutant subsystems, reassert the true orchestration boundaries, and restore one working end-to-end multi-agent terminal loop.

## Goals

- restore a working deterministic terminal-first orchestrator loop
- preserve the intended core architecture: `poll -> triage -> dispatch -> monitor -> reap`
- keep Beads as task truth and `.aegis` state as orchestration truth
- preserve Oracle, Titan, Sentinel, and Janus as real working castes
- preserve bounded concurrency as part of MVP proof
- make the system observable through terminal output, durable structured logs, and structured artifacts
- make failures easy for a QA agent to inspect without needing UI state
- make the code understandable at a glance

## Non-goals

- preserving UI code for future convenience
- preserving economics, quota, or cost tracking in MVP
- preserving Mnemosyne/Lethe
- preserving message-issue coordination
- preserving eval harness code or scenario corpus
- preserving compatibility code for removed systems
- adding project-specific verification gates to the merge queue
- broad command JSON surfaces unless later proven necessary

## Hard deletion targets

These are explicit recovery targets, not soft deprecations:

- `olympus/` workspace
- UI components and UI-specific tests
- SSE/dashboard client transport and related server behavior
- browser-first runtime assumptions
- economics/budget/quota code, config, and tests
- Mnemosyne/Lethe code, config, storage, and tests
- Beads-native messaging flows
- eval harness, benchmark corpus, scenario runners, and related tests/config
- compatibility scaffolding that exists only to support the removed systems

Deletion rule:
- if a subsystem is cut, remove its code paths, config, runtime assumptions, fixtures, and tests
- do not leave inert remnants that still distort the architecture

## Emergency MVP product shape

The stripped MVP target is a terminal-only orchestrator that a human or QA agent can inspect fully through:
- live terminal output
- `.aegis/logs/`
- `.aegis/dispatch-state.json`
- `.aegis/merge-queue.json`
- structured caste artifacts
- failure-only transcripts when required

The daemon is the main runtime surface:
- `aegis start`
- `aegis status`
- `aegis stop`

The daemon normally runs in auto-processing posture.
Manual control and debugging come from explicit phase commands now, with caste and merge commands returning in later phases.

As of completed Phase D work, the live operator commands are:
- `aegis init`
- `aegis start`
- `aegis status`
- `aegis stop`
- `aegis poll`
- `aegis dispatch`
- `aegis monitor`
- `aegis reap`

## Truth planes

Emergency MVP truth planes are intentionally reduced:

| Concern | Owner |
|---|---|
| task definitions, blockers, ready queue | Beads |
| orchestration stage per issue | `.aegis/dispatch-state.json` |
| merge queue runtime state | `.aegis/merge-queue.json` |
| durable observability | `.aegis/logs/` plus stage/caste artifacts |

Removed truth planes:
- Mnemosyne
- dashboard live state
- message-issue coordination state
- eval result truth

## Architectural shell to preserve

The rewrite should preserve these top-level module boundaries:
- `poller`
- `triage`
- `dispatcher`
- `monitor`
- `reaper`
- `runtime`
- `merge`
- `tracker`

Internals may be rewritten aggressively, but the code should still be understandable at a glance and split along clear responsibilities.

## Core operating loop

Canonical emergency MVP execution spine:

`poll -> triage -> dispatch -> monitor -> reap`

The loop remains deterministic.
No LLM decides what the next orchestrator action is.

### Poll

Responsibilities:
- read ready work from Beads
- inspect dispatch state and merge queue state
- emit structured `poll` logs
- remain generic to tracker graph shape

Not allowed:
- slice-specific orchestration logic
- naming-based heuristics

### Triage

Responsibilities:
- apply deterministic eligibility rules
- suppress work already in flight or not currently dispatchable
- preserve bounded concurrency and queue fairness

Not allowed:
- LLM reasoning
- tracker-specific naming assumptions

### Dispatch

Responsibilities:
- choose the next valid caste or queue action from explicit state
- spawn runtime sessions through `AgentRuntime`
- write stage transitions explicitly

### Monitor

Responsibilities:
- supervise in-flight sessions
- detect timeout/stuck/liveness failures
- collect failure classification inputs
- trigger global fail-closed behavior for clearly systemic runtime/provider/configuration failures

Removed responsibilities:
- economics
- exact-dollar or quota accounting
- UI-driven session state

### Reap

Responsibilities:
- finalize session outcomes
- verify required structured artifacts
- clear running session ownership
- reclaim concurrency
- move the issue to the next deterministic stage or failed state
- preserve inspectable workspace state by default

## Runtime and tracker boundaries

### Runtime

Preserve the minimal `AgentRuntime` abstraction.

Emergency MVP rule:
- Pi is the only real runtime adapter
- a tiny deterministic fake runtime is allowed only if it materially improves CI seam testing
- do not widen the runtime contract beyond stripped-MVP needs

Phase D note:
- the rebuilt loop shell may still use a tiny deterministic `phase_d_shell` runtime for seam tests and mock-run proof
- real Pi-backed caste execution still returns in Phase E

### Tracker

Preserve the minimal tracker abstraction.

Emergency MVP rule:
- Beads is the only real tracker implementation
- a tiny deterministic fake tracker is allowed only if it materially improves CI seam testing
- do not hardcode orchestration semantics to Beads naming patterns

Phase D note:
- the rebuilt loop shell keeps Beads bootstrap probes and tracker access close to the daemon entrypoints
- richer tracker-shell separation can continue to tighten in later phases without reintroducing naming heuristics

## Command surface

### Current Phase D command surface

Live now:
- `aegis init`
- `aegis start`
- `aegis status`
- `aegis stop`
- `aegis poll`
- `aegis dispatch`
- `aegis monitor`
- `aegis reap`

This is the supported operator surface for the rebuilt Phase D loop shell.

### Future Phase Command Targets

Planned later:

- `aegis merge next`
- `aegis scout <issue-id>`
- `aegis implement <issue-id>`
- `aegis review <issue-id>`
- `aegis process <issue-id>`
- `aegis restart <issue-id>`
- `aegis requeue <issue-id>`

### Routing rule

- when the daemon is running, mutating commands route through the daemon automatically
- when the daemon is not running, the same commands may operate directly against repo state

This keeps one execution authority when live, while preserving testability and standalone debugging.

## Operating posture

Emergency MVP simplifies operating modes:
- no first-class conversational/idle mode
- daemon defaults to auto-processing posture
- manual control happens through explicit commands

## Oracle behavior

Oracle remains a real planning/scouting caste.

It may:
- assess readiness
- classify complexity
- discover blockers or prerequisites
- create derived child work
- block the parent on derived children

Complexity handling rule:
- in auto mode, complex work should normally decompose rather than dispatch straight to Titan
- human pause/escalation remains available only when Oracle cannot safely decompose or requirements remain genuinely ambiguous

Parent issue rule:
- when Oracle decomposes, the parent stays open and becomes blocked on the children

## Handoff and artifact contract

Emergency MVP handoff contract is:
- tool-first when reliable
- strict final JSON artifact fallback as the canonical backup path

This choice is based on model reality, not idealized tool-call support.

Each caste must produce a structured artifact sufficient for the next deterministic stage.

Required artifact families:
- Oracle assessment artifact
- Titan handoff artifact or clarification artifact
- Sentinel verdict artifact and follow-up fix outputs when needed
- Janus resolution artifact or manual-decision artifact

Artifact verification, not process exit alone, determines success.

## Failure handling

### Default issue policy

When a caste fails:
- dispatch record becomes failed
- originating Beads issue stays open
- the same issue may be retried when failure is operational/transient rather than semantic

Generated follow-up issues are reserved for workflow-significant outcomes:
- Oracle decomposition/prerequisites
- Titan clarification
- Sentinel fix work
- Janus-related explicit follow-up work when required

### Retry policy

Retry handling is hybrid and failure-class aware:
- narrow automatic retry for clearly transient operational failures
- fail closed for systemic runtime/provider/configuration failures

Systemic failures include cases such as:
- invalid model references
- bad auth
- provider-level failures likely to poison the rest of the run

Global failure rule:
- when such a systemic failure is detected, stop new dispatches globally

### Failure transcripts

Raw transcripts are failure-only artifacts.

Persist them only when:
- a caste run fails
- artifact parsing fails
- handoff validation fails

In mock runs they should be treated as ephemeral and cleaned up after successful completion where possible.

## Logging and observability

### Live surface

- human-readable terminal logs

### Durable surface

- structured logs under `.aegis/logs/`

### Current Phase D observability

The rebuilt loop shell currently guarantees:
- terminal output for `init`, `start`, `status`, `stop`, `poll`, `dispatch`, `monitor`, and `reap`
- persisted `.aegis/runtime-state.json`
- persisted `.aegis/dispatch-state.json`
- persisted structured phase logs under `.aegis/logs/`

Real caste artifacts and provider-backed session telemetry are still deferred to later phases.

### Future Observability Target

When Phase E/F capability returns, durable logs must include:

Minimum:
- timestamp
- phase
- issueId
- caste when applicable
- sessionId when applicable
- stage before/after or equivalent transition context
- action
- outcome
- error class/category when applicable
- artifact references when applicable

Preferred if easy:
- runtime/provider/model details
- retry metadata
- queue item ids
- correlation ids spanning the full run

Primary machine-queryable surfaces are the durable logs and `.aegis` state/artifact files.
A broad command-level JSON surface is not required for MVP.

## Merge queue behavior

The merge queue remains deterministic and mechanical.

Emergency MVP queue rules:
- preserve tiered merge handling
- `T1` and `T2` remain automatic where safe
- `T3` escalates to Janus
- do not run project-specific verification commands before merge in MVP
- do not depend on UI or message-issue coordination

Janus acceptance rule:
- Janus counts as working if it either safely requeues a merge candidate for a fresh mechanical pass or emits a correct manual-decision artifact when ambiguity is real

Sentinel rule:
- Sentinel remains strictly post-merge

## Worktree and labor retention

Successful labors/worktrees should be retained by default in the emergency MVP.

Reason:
- post-run inspectability is more valuable than aggressive cleanup during recovery

A later cleanup command or retention policy may automate removals once the stripped loop is proven stable.

## Testing strategy

### CI

CI should run deterministic tests only.

Keep CI coverage for:
- startup and preflight behavior
- dispatch-state transitions
- poll/triage/dispatch/monitor/reap core behavior
- artifact parsing and enforcement for Oracle/Titan/Sentinel/Janus
- merge queue deterministic policy and state transitions
- command routing with and without daemon ownership
- global fail-closed behavior for systemic failures
- minimal runtime/tracker seam tests

Avoid:
- tests requiring live installables in CI
- brittle git-conflict simulation that violates normal code conventions
- noisy tests that do not protect the stripped loop

If merge-tier testing becomes messy in CI, keep CI to:
- tier classification
- queue state transitions
- Janus escalation decisions

Real conflict behavior belongs in mock-run acceptance instead.

### User and QA proof

### Current Phase D proof scope

The seeded mock-run flow currently proves the Phase D loop shell:
- daemon starts and is observable from the terminal
- direct phase commands reuse the same loop code as the daemon
- stripped config, runtime-state files, dispatch-state files, and phase logs are written correctly
- the deterministic `phase_d_shell` runtime can drive ready work to the explicit `phase_d_complete` placeholder stage without requiring browser/UI infrastructure

It does not yet prove real Pi-backed caste execution, artifact enforcement, merge behavior, or Janus behavior.

### Full MVP proof target

Once later phases are complete, the seeded mock-run flow becomes the main end-to-end proving ground.

A passing emergency MVP should demonstrate:
- daemon starts and is observable entirely from the terminal
- ready work is processed generically from Beads truth
- bounded concurrency is visible
- Oracle can decompose complex work
- parent issues remain open and blocked on children
- Titan emits strict handoff artifacts
- merge queue handles `T1/T2`
- `T3` escalates to Janus
- Janus either requeues safely or emits a manual-decision artifact
- Sentinel runs post-merge
- successful reviewed work closes in Beads
- transient failures remain retryable on the same open issue
- systemic failures stop new dispatches globally

## Acceptance artifacts

After a successful or failed mock run, a QA agent should be able to inspect:
- `.aegis/logs/`
- `.aegis/dispatch-state.json`
- `.aegis/merge-queue.json`
- final Beads issue state
- Oracle assessment artifacts
- Titan handoff/clarification artifacts
- Sentinel verdict/fix artifacts
- Janus artifacts when applicable
- retained labors/worktrees

Failure-only:
- raw transcripts for failed or invalid sessions

## Recovery sequence

### Phase A: Source-of-truth reset

Status:
- complete on 2026-04-13

- write this emergency MVP design/addendum
- maintain the discovery log as the Q&A appendix for this design
- maintain one flat deferred-items list

### Phase B: Hard purge

Status:
- complete on 2026-04-13

- delete Olympus and UI/SSE/dashboard code
- delete economics/budgeting
- delete Mnemosyne/Lethe
- delete message-issue flows
- delete eval harness and scenario corpus
- delete tests/config tied only to removed systems

### Phase C: Skeleton stabilization

Status:
- complete on 2026-04-13

- hard-strip config
- preserve only runtime/tracker abstractions that still matter
- keep Pi and Beads as the only real implementations

### Phase D: Core loop rebuild

- rebuild `poller`, `triage`, `dispatcher`, `monitor`, and `reaper`
- make each phase legible and separately loggable
- make daemon and direct commands share execution paths

### Phase E: Caste and artifact enforcement

- rebuild Oracle, Titan, Sentinel, and Janus around strict artifacts
- implement tool-first with strict JSON fallback
- make artifacts the phase-completion contract

### Phase F: Merge queue rebuild

- keep queue logic deterministic
- preserve `T1/T2` automatic and `T3 -> Janus`
- keep Sentinel post-merge

### Phase G: Proof reset

- reduce CI to deterministic seam tests
- move end-to-end proof to seeded mock-run acceptance

## Deferred work management

All cut or postponed work should be tracked only in:

`docs/superpowers/specs/2026-04-13-aegis-emergency-deferred-items.md`

That file should stay intentionally minimal and should not become a second planning system.

## Self-review

This design intentionally removes or overrides several major `SPECv2.md` themes.
That is deliberate, not accidental.

Consistency checks:
- one terminal-first product shape
- one reduced persistence model
- one deterministic loop
- no UI/economics/eval/message side systems competing with the core
- no contradiction between keeping concurrency/Janus and stripping non-essential features

Scope check:
- focused on restoring a working orchestrator loop
- explicitly defers everything that is not needed to prove that loop
