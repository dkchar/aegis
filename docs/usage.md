# Usage Guide

Operator commands. `docs/AEGIS.md` remains the canonical source of truth.

## Install And Build

```bash
npm install
npm run build
```

`npm run build` compiles Agora and the CLI into `dist/`. Run `node dist/index.js help` for the command list.

## Initialize A Project

In the git repository Aegis should work on:

```bash
node dist/index.js init --runtime claude   # or codex, pi
```

This creates `.aegis/` state files and adds Aegis paths to `.gitignore`; it never touches `package.json`. `--runtime` seeds the config with that adapter and its default models. Without it the config uses `scripted`, the deterministic test runtime that fakes agent work, and `aegis start` warns about it. An existing `.aegis/config.json` is never rewritten; edit it to change the runtime or models (see [configuration](configuration.md)).

## Choose A Runtime

| Runtime | Setup |
| --- | --- |
| `claude` | `npm install -g @anthropic-ai/claude-code`, run `claude` once to sign in, set models to `anthropic:<model-id>` |
| `codex` | install the Codex CLI and sign in |
| `pi` | configure providers in `.pi/settings.json` or `~/.pi/agent/settings.json` |
| `scripted` | nothing; deterministic tests only |

`aegis start` runs a preflight that reports exactly what is missing (git repo, tracker, config, adapter CLI, model refs, state paths) with a suggested fix.

## Create Work

Aegis reads tickets from Agora:

```bash
node packages/agora/dist/cli.js create --title "Add dark mode" --body "..." --scope src/theme.ts,src/App.tsx --column ready --actor human --json
node packages/agora/dist/cli.js board --json
```

`--scope` declares the files the ticket owns; Titan edits are validated against it.

## Start And Stop

```bash
node dist/index.js start
node dist/index.js stop
```

The daemon runs one cycle every `poll_interval_seconds`: poll, triage, dispatch, monitor, reap, launch Sentinel reviews and Janus resolutions, enqueue passed candidates, then drain the merge queue.

## Status And Logs

```bash
node dist/index.js status | jq
node dist/index.js stream
```

Use these before trusting UI state. Terminal output and `.aegis` files are the authority.

`status` prints one JSON object:

| Field | Meaning |
| --- | --- |
| `server_state`, `mode`, `uptime_ms` | daemon lifecycle |
| `active_agents`, `queue_depth` | running sessions and ready Agora tickets |
| `sessions` | live sessions: issue, caste, stage, `idle_seconds`, and `last_activity` (latest adapter line) |
| `stages` | dispatch record count per stage |
| `merge_queue` | merge items per status |
| `terminal_operational_failures` | issues that exhausted operational retries |

`stream` follows the daemon log, phase events, and live session activity. Session lines are labelled `[session <issue>/<caste>]` and interleaved by timestamp, so concurrent agents can be watched from one terminal.

## Direct Phase Commands

```bash
node dist/index.js poll
node dist/index.js dispatch
node dist/index.js monitor
node dist/index.js reap
```

## Direct Caste Commands

```bash
node dist/index.js scout AG-0001
node dist/index.js implement AG-0001
node dist/index.js review AG-0001
node dist/index.js process AG-0001
```

`process` advances the issue one step from its current stage. Run locally, a caste command prints live session activity to stderr and the JSON result to stdout. When a daemon is running, direct commands are handed to it through `.aegis/runtime-commands/` so they never race the daemon over state; the command waits for the daemon's answer.

## Merge

```bash
node dist/index.js merge next
```

`merge next` attempts one queued candidate. A T3 escalation returns `status: "escalated"` and leaves the issue in `resolving_integration`; the daemon launches Janus, or run `node dist/index.js process <issue>` to run it directly.

## Olympus

```bash
npm run olympus:dev
```

Open `http://127.0.0.1:4173/` (design system gallery at `/design.html`). See [Olympus](olympus.md).

```bash
npm run olympus:screenshots   # regenerate docs/screenshots after npm run build
```

## Seeded Mock Proof Commands

Seeding remains command-only.

```bash
AEGIS_MOCK_RUN_RUNTIME=claude npm run mock:seed   # or scripted, codex, pi
npm run mock:run -- node dist/index.js start
npm run mock:acceptance
```

The seed writes a fresh repository under `../aegis-qa/aegis-mock-run`. `AEGIS_MOCK_RUN_MODEL_REFERENCE` overrides the model for every caste.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Preflight blocked | run `node dist/index.js start` and follow the `fix:` lines |
| Issue never dispatches | `status`; triage skips issues in cooldown, over capacity, overlapping another Titan's scope, or past the retry ceiling |
| Session killed | idle past `stuck_kill_seconds` (see `.aegis/logs/session-streams/<session>.log`), adapter inactivity timeout, or a forbidden dev server in the transcript |
| Daemon stopped in `paused` mode | a provider usage limit was hit; wait for the reset, then start again |
| Merge keeps failing | `.aegis/merge-queue.json` `lastError`, then Janus artifacts under `.aegis/janus/` |

## Verification

```bash
npm run lint
npm test
npm run build
npm run olympus:check
```

Do not claim proof completion without checking command output, dispatch state, merge state, artifacts, and generated app behavior.
