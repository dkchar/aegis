# Manual Run Steps — Aegis Mock-Run

Quick reference for end-to-end sanity testing of the Aegis orchestr via the
disposable mock repo. Use this after code changes that touch the server, SSE
contracts, reaper, mock-run seed, or Olympus dashboard.

## Prerequisites

1. `npm run build` passes
2. Dolt server is running: `bd dolt start`
3. Pi SDK credentials configured in `.pi/settings.json`

## Step 1 — Seed the mock repo

```bash
npm run mock:seed
```

This creates `aegis-mock-run/` with:
- `git init` + `bd init --server --shared-server`
- `aegis init` with uncapped concurrency/budgets profile
- **5 slices × 3 lanes** (15 executable issues) with overlapping file ownership
- Only `foundation.contract` is initially ready

## Step 2 — Init and status

```bash
npm run mock:run -- node ../dist/index.js init
npm run mock:run -- node ../dist/index.js status
```

Expected: server starts in `conversational` mode, ready queue shows 1 issue
(`foundation.contract`).

## Step 3 — Start the server

```bash
npm run mock:run -- node ../dist/index.js start --port 43123 --no-browser
```

Wait for: `Server listening on http://127.0.0.1:43123`

## Step 4 — Probe HTTP endpoints

```bash
# Olympus bundle served
curl -s http://127.0.0.1:43123/ | head -5

# Dashboard state shape
curl -s http://127.0.0.1:43123/api/state | python -m json.tool

# Beads ready issues
curl -s http://127.0.0.1:43123/api/issues/ready | python -m json.tool

# SSE event stream (2-second timeout)
curl --max-time 2 -N http://127.0.0.1:43123/api/events
```

Expected `/api/state` shape:
```json
{
  "status": { "mode": "conversational", "isRunning": false, ... },
  "spend": { "metering": "unknown", "totalInputTokens": 0, ... },
  "agents": [],
  "loop": { "phaseLogs": { "poll": [], "dispatch": [], "monitor": [], "reap": [] } },
  "sessions": { "active": {}, "recent": [] },
  "mergeQueue": { "items": [], "logs": [] },
  "janus": { "active": {}, "recent": [] }
}
```

## Step 5 — Scout a ready issue

```bash
npm run mock:run -- node ../dist/index.js scout <foundation.contract-id>
```

Get the issue ID from `bd ready --json` inside `aegis-mock-run/`.

Expected: Oracle assessment returned with `files_affected`, `estimated_complexity`,
`ready` fields. Assessment persisted to `.aegis/oracle/`.

## Step 6 — Auto-loop run (optional, full swarm)

```bash
npm run mock:run -- node ../dist/index.js start --port 43123 --no-browser
# In another terminal, enable auto mode:
npm run mock:run -- node ../dist/index.js auto on
```

Watch Olympus at `http://127.0.0.1:43123` for:
- Active session terminals with scrollable logs
- Phase log columns (Poll/Dispatch/Monitor/Reap) as terminal boxes
- Completed sessions as clickable expandable cards
- Grid layout showing multiple sessions side-by-side

## Step 7 — Stop the server

```bash
npm run mock:run -- node ../dist/index.js stop
```

## Step 8 — Verify no repo dirtying

```bash
cd aegis-mock-run && git status -sb
```

Expected: clean working tree, no untracked `.aegis/` files.

## Step 9 — Cleanup

The mock-run directory is gitignored and safe to leave behind. To reset:

```bash
npm run mock:seed   # recreates from scratch
```

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `bd init` fails with "embedded Dolt requires CGO" | Use `--server --shared-server` flags (seed script does this) |
| Seed fails with directory-lock error | Retry; Windows sometimes holds locks on `.dolt/` |
| SSE events not arriving | Check server logs for event bus errors; verify `/api/events` returns `text/event-stream` |
| Oracle returns non-JSON | Check Pi SDK model supports JSON output; try `gemma-4-31b-it` |
| Reaper declines sessions | Verify agent called `submit_assessment`/`submit_handoff`/`submit_verdict` tool (not raw JSON message) |
