# Olympus Operator Console

Olympus is the local Aegis operator console. It reads Aegis truth planes and exposes deterministic controls through the local Olympus API.

Olympus is not a separate orchestration truth plane. Terminal commands and `.aegis` state remain authoritative.

## Start

```bash
npm run olympus:dev
```

Open:

```text
http://127.0.0.1:4173/
```

## Ops

The Ops tab shows daemon status, workspace controls, the Agora board, event phase health, merge queue, and recent artifacts.

![Olympus Ops](screenshots/olympus-ops.png)

## Sessions

The Sessions tab streams durable agent session output. It is meant for live session inspection without repeatedly refreshing logs.

![Olympus Sessions](screenshots/olympus-sessions.png)

## Chronos

Chronos is the flight recorder. It visualizes event order and merge/ticket relationships with React Flow graph surfaces.

![Olympus Chronos](screenshots/olympus-chronos.png)

## Records

Records exposes artifacts, transcripts, logs, merge records, and other durable evidence.

![Olympus Records](screenshots/olympus-records.png)

## Config

Config edits `.aegis/config.json` through deterministic writes. Runtime models are resolved from local/runtime registries rather than hardcoded model IDs.

![Olympus Config](screenshots/olympus-config.png)

## Control Boundaries

Olympus can supervise and route supported commands, but proof setup stays terminal-first. In particular, seeded mock graph setup remains command-only.
