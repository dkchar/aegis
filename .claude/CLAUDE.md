# CLAUDE.md — Aegis Agent Instructions

This file contains instructions specific to Claude Code agents working in the Aegis repo.

## Mock-Run Sanity Testing

The `aegis-mock-run/` directory (gitignored) is a disposable workspace for sanity-testing Aegis commands without starting a full mock run or dirtying the main repo. **Always use this for sanity checks** instead of running commands in the main repo.

### When to Use

- After modifying HTTP routes, SSE event shapes, or dashboard API contracts
- After changing `.gitignore` or `init-project.ts` to verify no untracked files leak
- Before claiming fixes for Olympus dashboard, API, or SSE issues
- When you need to validate `aegis init`, `aegis start`, `aegis status`, `aegis stop` end-to-end

### How to Use

```bash
# 1. Seed a fresh mock repo (creates aegis-mock-run/aegis-mock-<timestamp>/)
npm run mock:seed

# 2. Navigate to the seeded mock repo
cd aegis-mock-run/aegis-mock-<timestamp>/

# 3. Run sanity commands against the built dist/
node ../../../dist/index.js init
node ../../../dist/index.js status
node ../../../dist/index.js start --port <random-port> --no-browser
curl http://127.0.0.1:<port>/              # Verify Olympus bundle is served
curl http://127.0.0.1:<port>/api/state     # Verify dashboard state contract
curl --max-time 2 http://127.0.0.1:<port>/api/events  # Verify SSE stream
node ../../../dist/index.js stop

# 4. Verify no repo dirtying
git status -sb   # Should show clean — all .aegis/ generated files are gitignored

# 5. Clean up (the whole aegis-mock-run/ tree is gitignored, safe to delete)
```

### Sanity Test Checklist

A minimal sanity test should verify:

1. `npm run build` passes
2. `aegis init` succeeds and creates `.aegis/config.json`
3. `aegis status` works before and after a start/stop cycle
4. `aegis start` succeeds, `aegis stop` succeeds
5. `GET /` serves the real Olympus bundle (not the fallback shell)
6. `GET /api/state` returns the expected dashboard state shape (`{ status, spend, agents }`)
7. `GET /api/events` returns SSE with the expected event envelope (`{ type, data }`)
8. `git status -sb` shows no untracked `.aegis/` files after the cycle

### Important Notes

- **Do NOT start the full mock run** for sanity checks. The full mock run is for end-to-end swarm testing and takes much longer. Use the mock-run folder only for sanity testing CLI commands and API endpoints.
- **bd init in embedded mode** may fail with `embedded Dolt requires CGO; use server mode`. Use the mock seed script (`npm run mock:seed`) which invokes `bd init` with `--server --shared-server` flags.
- The mock-run directory is entirely gitignored. Any artifacts generated there are safe to leave behind and will not dirty the main repo.

### Full Mock Run vs Sanity Testing

| Concern | Sanity Testing | Full Mock Run |
|---------|---------------|---------------|
| Purpose | Verify CLI/API behavior, contracts, no repo dirtying | End-to-end swarm orchestration with agent dispatch |
| Duration | Seconds to a few minutes | Much longer (agent sessions, merge queue, etc.) |
| Commands | `init`, `status`, `start`, `stop`, `curl` | `npm run mock:seed` + mock runner script |
| Use when | After server/SSE/config changes, before gate claims | Before MVP landing, full regression testing |

## General Rules

- Follow all instructions in `AGENTS.md` at the repo root.
- Use `bd` (beads) for ALL issue tracking. Never use markdown TODOs.
- Always use `--json` flag with `bd` commands for programmatic use.
- Use `--parent <epic-id>` when creating child issues under an epic.
- Work is NOT complete until `git push` succeeds.
