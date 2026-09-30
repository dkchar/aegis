# Aegis Modules And Truth Planes

`docs/AEGIS.md` is the canonical source of truth. This document maps the implementation.

## Truth Planes

| Plane | Storage | Purpose |
| --- | --- | --- |
| Task truth | `.agora/tickets.json`, `.agora/events.jsonl` | Agora ticket graph, dependencies, columns, leases |
| Orchestration truth | `.aegis/dispatch-state.json` | Current stage, running agent, artifacts, failure state |
| Merge truth | `.aegis/merge-queue.json` | Candidate integration queue and merge outcomes |
| Observability | `.aegis/logs/`, `.aegis/transcripts/`, caste artifact dirs | Durable event, terminal, transcript, and review evidence |
| Runtime execution | adapter sessions | Live model/tool execution |

State records are never mutated in place: every transition returns a new record, and every durable file is written through `src/shared/atomic-write.ts` (unique temp file, then rename).

## Source Map

| Path | Responsibility |
| --- | --- |
| `src/index.ts` | CLI entry and help |
| `src/cli/` | `start`/`stop`/`status`/`stream`, startup preflight and probes, daemon routing for direct commands |
| `src/config/` | schema, defaults, validation, `init` |
| `src/core/poller.ts` | reads ready work from the tracker |
| `src/core/triage.ts` | picks Oracle or Titan per ready issue within capacity and scope-overlap limits |
| `src/core/dispatcher.ts` | launches sessions and records `runningAgent` |
| `src/core/monitor.ts` | observes sessions, warns and kills stuck ones |
| `src/core/reaper.ts` | turns settled sessions into stage transitions or failure accounting |
| `src/core/loop-runner.ts` | one daemon cycle: dispatch pipeline, monitor, reap, pre-merge review, merge enqueue |
| `src/core/dispatch-recovery.ts` | deterministic recovery from durable artifacts after polls |
| `src/core/failure-policy.ts` | cooldowns, retry ceiling, failure classification and transitions |
| `src/core/control-plane-policy.ts` | mutation policy: blocker creation, reuse, requeue, scope expansion |
| `src/core/caste-runner.ts` | stage dispatcher for caste commands |
| `src/core/caste/` | per-caste runners (`scout`, `implement`, `review`, `janus`), prompts, artifact readers, policy proposals, recovery |
| `src/core/git-proof.ts`, `titan-session-validation.ts` | git snapshots, candidate advancement, scope and root-cleanliness checks, root-commit adoption |
| `src/castes/` | strict artifact parsers, Pi tool contracts, prompt/description markers |
| `src/runtime/` | adapter contract, registry, dispatch runtime, Claude/Codex/Pi/scripted adapters, process supervision |
| `src/merge/` | merge queue state, auto-enqueue, tier policy, merge executor |
| `src/tracker/` | generic tracker boundary and the Agora client |
| `src/labor/` | git worktree labors per issue |
| `src/shared/` | atomic writes, JSON, git, file scope helpers |
| `src/mock-run/` | seeded animated React todo proof |
| `olympus/` | operator console (React) and its local Vite API |
| `packages/agora/` | embedded Agora ticket board |

## Core Loop Modules

### Tracker

Keeps Aegis generic. Agora is the active backend, but orchestration code never infers meaning from issue names. Coordination tickets (`role:coordination`) are never dispatched.

### Poller

Reads task truth and returns ready work. It observes; it does not invent semantics.

### Triage

Turns ready issues and dispatch records into decisions: dispatch Oracle, dispatch Titan, or skip (`capacity`, `cooldown`, `in_progress`, `already_progressed`, `operational_failure_limit`, `scope_overlap`).

### Dispatcher

Launches scoped runtime sessions and records their ownership. A launch error fails the rest of the pass closed.

### Monitor

Reads session reports. Sessions older than `stuck_kill_seconds` are terminated.

### Reaper

Completes settled sessions. Success advances the stage after checking stage invariants and hydrating durable artifact refs; failure applies retry accounting. If the caste command already recorded a failure, its accounting is preserved.

## Runtime Adapters

See [runtime adapters](runtime-adapters.md). Current posture:

- Pi is the first real adapter under test.
- Codex is the approved fallback if Pi violates the adapter contract or remains flaky.
- Claude Code is approved under the same contract.
- The scripted runtime is for deterministic seam tests, not final MVP proof.

## Castes

- **Oracle** scouts scope, risk, and checks.
- **Titan** implements in assigned scope.
- **Sentinel** gates candidate work with typed findings.
- **Janus** handles merge and integration failures.

## Merge

The merge module owns deterministic candidate integration. Titan does not merge. Sentinel gates before merge, and Janus only enters after repeated merge failures. A merge attempt that throws, or a Janus session that fails, marks the queue item failed and applies retry accounting instead of stranding it in `merging`.

## Olympus

Olympus reads Aegis truth planes through a local Vite API and renders the Ops board, session terminals, Chronos, records, and config. It is an operator surface, not a new source of truth. See [Olympus](olympus.md).
