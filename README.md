# Aegis

Aegis is a terminal-first deterministic multi-agent orchestrator for software work.

It reads task truth from Agora, records orchestration truth in `.aegis`, runs scoped agents through runtime adapters, and lands work through a deterministic merge queue. The operator UI, Olympus, visualizes and supervises those truth planes; it does not replace them.

`docs/AEGIS.md` is the canonical source of truth for current product and architecture decisions.

![Olympus Ops](docs/screenshots/olympus-ops.png)

## What Aegis Is

Aegis coordinates many scoped agents without letting any one model own the control plane.

The core loop is:

```text
poll -> triage -> dispatch -> monitor -> reap
```

Agents can inspect, reason, edit, and test inside assigned scope. Aegis decides graph state, retry policy, merge routing, artifact acceptance, and durable completion semantics.

## Main Components

- **Agora**: lightweight ticket graph and task truth.
- **Aegis control loop**: poller, triage, dispatcher, monitor, and reaper.
- **Castes**: Oracle scouts, Titan implements, Sentinel gates, Janus resolves merge/integration failures.
- **Runtime adapters**: concrete implementations that launch and monitor live agent sessions.
- **Merge queue**: deterministic integration plane for candidate work.
- **Durable observability**: `.aegis/logs/`, transcripts, dispatch state, merge state, and caste artifacts.
- **Olympus**: local operator console for state, sessions, records, config, and Chronos graph views.

## Decisions Aegis Makes

Aegis makes mechanical decisions from typed state and artifacts:

- which Agora tickets are runnable
- whether scope overlap prevents parallel dispatch
- whether a session is running, complete, failed, exhausted, or recoverable
- whether Sentinel feedback reworks the owner or creates a typed blocker
- whether Janus can return work to the parent or needs an integration blocker
- whether root mutation or candidate diffs are in scope
- whether merge queue work can land
- whether the seeded proof has actually drained

Agents may propose and explain. Aegis validates and routes.

## Run It

Install dependencies:

```bash
npm install
```

Build the CLI:

```bash
npm run build
```

Initialize a project:

```bash
node dist/index.js init
```

Start the daemon:

```bash
node dist/index.js start
```

Inspect status and logs:

```bash
node dist/index.js status
node dist/index.js stream daemon
```

Run direct loop phases:

```bash
node dist/index.js poll
node dist/index.js dispatch
node dist/index.js monitor
node dist/index.js reap
```

Run Olympus:

```bash
npm run olympus:dev
```

Open:

```text
http://127.0.0.1:4173/
```

Seeded mock proof setup remains command-only:

```bash
npm run mock:seed
npm run mock:run
npm run mock:acceptance
```

## Documentation

- [Canonical source of truth](docs/AEGIS.md)
- [Overview](docs/overview.md)
- [Modules and truth planes](docs/modules.md)
- [Control loop and decisions](docs/control-loop.md)
- [Usage guide](docs/usage.md)
- [Olympus operator console](docs/olympus.md)
- [Screenshots](docs/screenshots.md)

## Screenshots

![Chronos graph](docs/screenshots/olympus-chronos.png)

More 16:9 screenshots are in [docs/screenshots.md](docs/screenshots.md).
