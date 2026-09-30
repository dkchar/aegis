# Olympus Operator Console

Olympus is the local Aegis operator console. It reads Aegis truth planes and exposes deterministic controls through a local API that runs inside the Vite dev server (`olympus/server/`).

Olympus is not a separate orchestration truth plane. Terminal commands and `.aegis` state remain authoritative.

## Start

```bash
npm run olympus:dev
```

Open `http://127.0.0.1:4173/`. Select a workspace (an initialized Aegis project) from the Ops tab; the choice is remembered in `.aegis/olympus-state.json`.

## Layout

- **Header**: daemon status (live indicator), pid, uptime, adapter, event-stream state, latest loop activity, and Start/Stop controls. Start stays disabled until config is complete and saved.
- **KPI strip**: executable-ticket progress, ready work, active sessions, blocked tickets, pending merge candidates, failures, and adapter-reported spend when available.
- **Views**: Ops, Sessions, Chronos, Records, Config. Press `1`-`5` to switch; tabs show live counts.

## Ops

Workspace selection, the next recommended operator action, the Agora board (drag tickets between columns; runtime-owned tickets are locked), daemon phase events, and run health.

![Olympus Ops](screenshots/olympus-ops.png)

## Sessions

Durable agent session output rendered in a terminal, grouped by caste, with the selected session's issue, stage, adapter, model, usage (cost, tokens, turns), working directory, and transcript path. Sessions are linkable via `#agents/<session-id>`.

![Olympus Sessions](screenshots/olympus-sessions.png)

## Chronos

The flight recorder: event order across tickets, dispatch, sessions, artifacts, merges, and logs, plus the ticket/merge tree.

![Olympus Chronos](screenshots/olympus-chronos.png)

## Records

The attention queue (operational failures, merge failures, rejected artifacts), dispatch progress per issue, the merge queue, artifacts with expandable bodies, and daemon logs.

![Olympus Records](screenshots/olympus-records.png)

## Config

Edits `.aegis/config.json`. Fields are validated as you type with the same rules the daemon uses; invalid fields are highlighted and block saving, and the server validates again before writing. Model choices come from the selected adapter (Claude Code model list, the local Codex model cache, or the Pi model registry). Adapter-specific environment overrides (Claude, Pi) appear under Adapter and are passed to the daemon when Olympus starts it. Reset reloads the file from disk.

![Olympus Config](screenshots/olympus-config.png)

## Efficiency

The event stream rebuilds a snapshot every 1.5 s but only sends it when something changed. JSON files are re-parsed only when their size or mtime changes, directory listings are cached until the directory changes, and log tails read only the end of the file.

## Control Boundaries

Olympus can supervise and route supported commands (start, stop, ticket create and move, config save), but proof setup stays terminal-first. In particular, seeded mock graph setup remains command-only.
