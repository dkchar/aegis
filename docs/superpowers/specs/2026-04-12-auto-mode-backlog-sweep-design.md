# Auto Mode Backlog Sweep Design

## Purpose

Replace the current Aegis-specific `new ready only after auto starts` rule with operator-friendly full automation.

When an operator reviews the current backlog and then enables auto mode, Aegis should:

- sweep the full current `bd ready` backlog immediately
- continue polling Beads for newly ready work afterward
- dispatch multiple ready issues in parallel when concurrency and scope safety allow
- surface the real ready set and loop activity in Olympus

This keeps Beads as task truth and makes auto mode behave like an actual swarm orchestrator instead of a gated sequential helper.

## Source of truth

- Product behavior: `SPECv2.md`
- Repo operating rules: `AGENTS.md`
- Existing operator workflow design: `docs/superpowers/specs/2026-04-10-olympus-operator-workflow-design.md`
- Existing observability design: `docs/superpowers/specs/2026-04-10-live-execution-observability-design.md`

## Goals

- Auto mode processes any issue that is currently in `bd ready` when auto is enabled.
- Auto mode keeps polling and picks up later-ready issues automatically.
- Dispatch fills available concurrency instead of walking one issue at a time when multiple safe issues are ready.
- Scope suppression and existing merge/dispatch safety remain in force.
- Olympus reflects the actual ready backlog, active dispatches, and most recent ready work.

## Non-goals

- Removing scope-overlap suppression.
- Removing per-caste or global concurrency limits.
- Replacing Beads readiness rules with an Aegis-owned queue.
- Creating a new task database inside Olympus or `.aegis/`.

## Contract change

### Previous contract

The current repo contract says auto mode only processes issues that became ready after auto mode was enabled.

That rule exists in:

- `SPECv2.md`
- `src/core/auto-loop.ts`
- `tests/fixtures/s07/operating-mode-contract.json`
- tests and docs that mirror the same policy

### New contract

The new contract is:

- `bd ready` is the authoritative set of work eligible for auto dispatch
- enabling auto mode sweeps the full current ready set immediately
- later polls continue to ingest newly ready issues as the Beads graph changes
- Aegis may dispatch multiple ready issues in the same cycle up to bounded concurrency
- unsafe overlap remains suppressed by the scope allocator

There is no separate `baseline ready` versus `fresh ready` distinction anymore.

## Auto-loop behavior

### Poll

On each poll cycle, Aegis should:

1. read `bd ready`
2. classify the ready set against dispatch state
3. remove issues already in active or waiting stages
4. run scope suppression on eligible implementation work
5. publish loop visibility for:
   - current ready count
   - dispatchable count
   - suppressed count
   - in-progress count

### Dispatch

Dispatch should be bounded, not sequential by default.

Per cycle, Aegis should:

- calculate available slots from configured global concurrency and any per-caste caps
- rank eligible work using the existing ready ordering from Beads plus current deterministic safety rules
- dispatch as many safe items as fit in the available slots
- leave overflow ready work visible as queued-ready backlog, not hidden

This means if three safe ready issues exist and the system has three free Titan-capable slots, Aegis should dispatch all three in the same cycle rather than one-at-a-time.

### Continuous polling

After the initial backlog sweep, later poll cycles should continue to:

- notice newly unblocked issues from Beads
- include them in the next dispatch decision
- prefer recently surfaced higher-priority work only through the normal deterministic ordering rules, not ad hoc preemption

## Safety boundaries

The backlog sweep must not weaken the existing correctness boundaries.

The following remain binding:

- Beads owns ready/work truth
- dispatch state owns orchestration stage truth
- scope allocator suppresses unsafe parallel Titan work
- merge queue remains the only normal route to landing code
- cooldown and budget gates may still refuse or delay dispatch

If auto mode cannot dispatch a ready issue because of overlap, cooldown, or budget guardrails, Olympus must surface the reason instead of silently appearing idle.

## Olympus implications

Olympus should stop presenting empty placeholder state when real ready work exists.

Required derived behavior:

- top bar queue depth reflects the actual current ready set
- sidebar ready queue comes from the live ready set
- sidebar issue graph is derived from current ready work plus active/recent work, not hardcoded empty data
- selected issue defaults to the most relevant real issue:
  - active session issue first
  - otherwise merge-queue head
  - otherwise first ready issue
- loop phase panels show poll/dispatch/monitor/reap activity from real loop events
- active and completed session panels update for both manual commands and auto-loop dispatches

## Eventing implications

Two event paths must behave the same way from Olympus' perspective:

1. manual direct command execution from CLI or Olympus
2. background auto-loop execution

Both paths must publish into the same live event stream and dashboard state store so Olympus does not show blank sections simply because work was started through a different control path.

## Implementation shape

### Server/runtime wiring

- the HTTP server should own a real live-event ingress path for externally produced orchestration/runtime events
- direct command execution from `start.ts` must publish into that same live event path instead of a noop publisher
- background auto-loop execution must also publish poll/dispatch/session events into that same path

### Auto-loop runner

Introduce or refactor a dedicated auto-loop runner that:

- reads the current ready queue on every cycle
- chooses all dispatchable items up to available capacity
- executes deterministic stage advancement for those items
- records loop-phase activity for operator visibility

### Parallel dispatch

Parallelism should be bounded by existing config rather than hardcoded to one.

At minimum:

- fill available global slots up to `concurrency.max_agents`
- respect any narrower caste-specific capacity
- do not exceed scope-safe dispatchable items

## Error handling

- If a poll cycle fails, publish an error phase log and keep the loop alive for the next cycle unless the failure is fatal to the process.
- If Beads read fails transiently, Olympus should show the last known state plus fresh error logs rather than reverting to empty placeholders.
- If no safe work is dispatchable, the loop should log the reason category:
  - no ready work
  - all ready work already in progress
  - suppressed by scope overlap
  - blocked by budget/cooldown

## Files expected to change

Spec and docs:

- `SPECv2.md`
- `plandocs/2026-04-03-aegis-mvp-tracker.md` if parity notes mention the old rule
- `tests/fixtures/s07/operating-mode-contract.json`
- any Olympus/operator docs that describe `new ready only`

Implementation:

- `src/core/auto-loop.ts`
- new or updated auto-loop execution module under `src/core/`
- `src/cli/start.ts`
- `src/server/http-server.ts`
- `olympus/src/App.tsx`
- any affected Olympus state/reducer types

Tests:

- operating-mode and auto-loop tests
- direct-command and SSE integration tests
- Olympus app tests covering ready graph/selection and queue depth

## Manual validation

- Seed a repo with a non-empty ready queue, start Aegis, enable auto mode, and confirm existing ready issues dispatch immediately.
- Close blockers while auto mode is already running and confirm newly ready issues are picked up on later polls.
- Seed multiple safe ready issues and confirm Aegis dispatches more than one when concurrency allows.
- Seed overlapping safe/unsafe issues and confirm only the non-overlapping set dispatches while Olympus shows suppression visibility.
- Verify manual `scout` or `process` commands also populate Olympus session and loop panes.
