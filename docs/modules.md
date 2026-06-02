# Aegis Modules And Truth Planes

`docs/AEGIS.md` is the canonical source of truth. This document expands the implementation map.

## Truth Planes

| Plane | Storage | Purpose |
| --- | --- | --- |
| Task truth | `.agora/tickets.json`, `.agora/events.jsonl` | Agora ticket graph, dependencies, columns, leases |
| Orchestration truth | `.aegis/dispatch-state.json` | Current stage, running agent, artifacts, failure state |
| Merge truth | `.aegis/merge-queue.json` | Candidate integration queue and merge outcomes |
| Observability | `.aegis/logs/`, `.aegis/transcripts/`, caste artifact dirs | Durable event, terminal, transcript, and review evidence |
| Runtime execution | adapter sessions | Live model/tool execution |

## Core Modules

### Tracker

The tracker module keeps Aegis generic. Agora is the current active adapter, but orchestration code should not infer meaning from issue names or tracker-specific quirks.

### Poller

Poller reads task truth and refreshes runnable work. It should observe, not invent semantics.

### Triage

Triage turns observed task and dispatch state into next orchestration stages. It decides whether work is ready, blocked, cooling down, exhausted, or recoverable.

### Dispatcher

Dispatcher launches scoped runtime sessions. It must respect file scope, dependency state, concurrency, and scope overlap.

### Monitor

Monitor reads runtime/session state and durable logs. It advances records only when the adapter contract and artifacts support the transition.

### Reaper

Reaper completes sessions, persists final artifacts, and converts runtime output into dispatch state transitions.

### Runtime Adapters

Runtime adapters are concrete implementations for live agent execution. A valid adapter must support spawn, abort, status, transcript events, cwd jail behavior, and final result capture.

Current adapter posture:

- Pi is the first real adapter under test.
- Codex is the approved fallback if Pi violates the adapter contract or remains flaky.
- Scripted runtime is for deterministic seam tests, not final MVP proof.

### Castes

- **Oracle** scouts scope, risk, and checks.
- **Titan** implements in assigned scope.
- **Sentinel** gates candidate work with typed findings.
- **Janus** handles merge and integration failures.

### Merge

The merge module owns deterministic candidate integration. Titan does not merge. Sentinel gates before merge, and Janus only enters after merge/integration failure.

### Olympus

Olympus reads Aegis truth planes through a local Vite API and renders:

- Ops board and workspace controls
- live session terminals
- Chronos timeline and merge graph
- records and artifacts
- editable config fields

It is an operator surface, not a new source of truth.
