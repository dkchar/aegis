## Source of Truth

- **`SPECv2.md`** — canonical PRD. If anything conflicts with this, SPECv2 wins.
- **`plandocs/2026-04-03-aegis-mvp-tracker.md`** — slice tracker. Shows which slices are closed, blocked, and what their gates require.
- **`plandocs/codebase-structure.md`** — file-by-file structure reference. Read this before exploring the codebase.

## Online Documentation Rule

**ALWAYS check official online docs before implementing changes to external dependencies.**
Do not guess API signatures, model names, or config formats from memory.

When working with:
- **Pi SDK** (`@mariozechner/pi-ai`, `@mariozechner/pi-coding-agent`): use `getProviders()`/`getModels()` at runtime to discover models — never hardcode model IDs. Check `github.com/badlogic/pi-mono` for latest API changes.
- **Beads CLI** (`bd`): check `docs/QUICKSTART.md` and `README.md` in the project.
- **Any npm package**: check the npm page or GitHub repo for current API.
- **context7 MCP**: use `context7` tool to fetch current docs for any library. Invoke it before writing code that depends on external APIs.

Use web search or web fetch to get current docs when:
- Adding new model references (Pi SDK model catalog is updated every release)
- Changing provider configurations
- Using a package API you haven't looked at recently
- Any time you're uncertain about an external dependency's current behavior

**Hardcoding external model IDs, provider names, or API endpoints is forbidden.** Always resolve dynamically from the SDK, config, or runtime API.

## What Aegis Is

A thin, deterministic multi-agent orchestrator. It coordinates AI coding agents (Pi SDK first) through a pluggable runtime adapter, uses Beads (`bd` CLI) as the issue tracker, persists orchestration state locally under `.aegis/`, and serves a browser dashboard called Olympus.

## Five Truth Planes — Never Blur These

| Concern | Owner |
|---------|-------|
| Task definitions, ready queue | Beads (`bd` CLI) |
| Orchestration stage per issue | `.aegis/dispatch-state.json` |
| Learned project knowledge | `.aegis/mnemosyne.jsonl` |
| Merge queue state | `.aegis/merge-queue.json` |
| UI live state | Olympus via SSE (derived, never authoritative) |

## Slice Structure

Every slice has four Beads children: `contract`, `lane_a`, `lane_b`, `gate`. Work flows contract → lanes in parallel → gate. The gate child closes the slice epic. Never skip the gate.

## Key Conventions

- **No mutations** — `transitionStage()`, `reconcileDispatchState()`, etc. return new objects. Never mutate records in place.
- **Atomic writes** — dispatch state is written via tmp→rename. Do not use direct `writeFileSync` to `dispatch-state.json`.
- **No runtime leakage** — Pi SDK imports live only in `src/runtime/pi-runtime.ts`. The orchestration core imports only from `src/runtime/agent-runtime.ts`.
- **No informal parsing** — orchestration stage is never inferred from Beads comments or text. Only `dispatch-state.json` is authoritative.
- **Idempotent init** — `initProject()` never clobbers existing files. `seedFile()` is a no-op if the target exists.
- **Windows-first** — path handling, spawn behavior, and shell commands must work on Git Bash and PowerShell. Use `path.join()`, not string concatenation. Use `spawnSync`/`execFile`, not shell strings.

## Test Gates

Each slice has an automated gate command in the tracker. Run it before closing a gate child. The full suite is `npm run test`. Lint is `npm run lint`. Build is `npm run build`.

Do not claim a gate passes without running the command and seeing it pass.

## Mock-Run Sanity Testing

The `aegis-mock-run/` directory (gitignored) is a disposable workspace for sanity-testing Aegis commands without starting a full mock run or dirtying the main repo. Use it to verify CLI behavior, HTTP endpoints, and SSE contracts before committing changes.

### When to Use

- After modifying HTTP routes, SSE event shapes, or dashboard API contracts
- After changing `.gitignore` or `init-project.ts` to verify no untracked files leak
- Before claiming fixes for Olympus dashboard, API, or SSE issues
- When you need to validate `aegis init`, `aegis start`, `aegis status`, `aegis stop` end-to-end

### How to Use

```bash
# 1. Seed a fresh mock repo (deletes any previous one)
npm run mock:seed

# 2. Run aegis commands in the mock repo
npm run mock:run -- node ../dist/index.js init
npm run mock:run -- node ../dist/index.js status
npm run mock:run -- node ../dist/index.js start --port <random-port> --no-browser

# 3. Probe HTTP endpoints
curl http://127.0.0.1:<port>/              # Verify Olympus bundle is served
curl http://127.0.0.1:<port>/api/state     # Verify dashboard state contract
curl --max-time 2 http://127.0.0.1:<port>/api/events  # Verify SSE stream

# 4. Stop the server
npm run mock:run -- node ../dist/index.js stop

# 5. Verify no repo dirtying
cd aegis-mock-run && git status -sb   # Should show clean
```

### Sanity Test Checklist

A minimal sanity test should verify:

1. `npm run build` passes
2. `npm run mock:seed` succeeds and creates `aegis-mock-run/`
3. `npm run mock:run -- node ../dist/index.js init` succeeds
4. `npm run mock:run -- node ../dist/index.js status` works before and after start/stop
5. `npm run mock:run -- node ../dist/index.js start` succeeds, then `stop` succeeds
6. `GET /` serves the real Olympus bundle (not the fallback shell)
7. `GET /api/state` returns the expected dashboard state shape (`{ status, spend, agents }`)
8. `GET /api/events` returns SSE with the expected event envelope (`{ type, data }`)
9. `cd aegis-mock-run && git status -sb` shows no untracked `.aegis/` files after the cycle

### Important Notes

- **Do NOT start the full mock run** (`npm run mock:seed` followed by the mock runner script) for sanity checks. The full mock run is for end-to-end swarm testing and takes much longer.
- **bd init in embedded mode** may fail with `embedded Dolt requires CGO; use server mode`. Use the mock seed script which invokes `bd init` with `--server --shared-server` flags.
- The mock-run directory is entirely gitignored. Any artifacts generated there are safe to leave behind and will not dirty the main repo.

### Full Mock Run vs Sanity Testing

| Concern | Sanity Testing | Full Mock Run |
|---------|---------------|---------------|
| Purpose | Verify CLI/API behavior, contracts, no repo dirtying | End-to-end swarm orchestration with agent dispatch |
| Duration | Seconds to a few minutes | Much longer (agent sessions, merge queue, etc.) |
| Commands | `init`, `status`, `start`, `stop`, `curl` | `npm run mock:seed` + mock runner script |
| Use when | After server/SSE/config changes, before gate claims | Before MVP landing, full regression testing |

## Config Validation

`loadConfig()` validates against `CONFIG_TOP_LEVEL_KEYS` and all sub-key arrays in `src/config/schema.ts`. If you add a new config field, add it to the schema, the defaults, and the validator — all three, atomically.

## What Does Not Exist Yet

No files for: Oracle, Titan, Sentinel, Janus castes; full CLI command family; monitor/reaper; Mnemosyne/Lethe; merge queue; scope allocator; full Olympus dashboard. Do not create stubs for these unless the owning slice is open.

## ONLY FOR QWEN

Do NOT credit yourself or qwen coder github user on any commit or co authoring. When the commits are visible on github they should be from the local git credentials.

## BEADS INTEGRATION:
This project uses **bd** (beads) for issue tracking. Run `bd onboard` to get started.

## Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work atomically
bd close <id>         # Complete work
```

## Non-Interactive Shell Commands

**ALWAYS use non-interactive flags** with file operations to avoid hanging on confirmation prompts.

Shell commands like `cp`, `mv`, and `rm` may be aliased to include `-i` (interactive) mode on some systems, causing the agent to hang indefinitely waiting for y/n input.

**Use these forms instead:**
```bash
# Force overwrite without prompting
cp -f source dest           # NOT: cp source dest
mv -f source dest           # NOT: mv source dest
rm -f file                  # NOT: rm file

# For recursive operations
rm -rf directory            # NOT: rm -r directory
cp -rf source dest          # NOT: cp -r source dest
```

**Other commands that may prompt:**
- `scp` - use `-o BatchMode=yes` for non-interactive
- `ssh` - use `-o BatchMode=yes` to fail instead of prompting
- `apt-get` - use `-y` flag
- `brew` - use `HOMEBREW_NO_AUTO_UPDATE=1` env var

**Policy:** dependencies in Beads using `--deps blocks:<parent>` when creating issues. Verify with `bd ready` that only unblocked issues appear.
Always run bd ready to see if the first issue in the chain of dependencies is the correct one in logical ordering to verify the dependency chain is correct.
If the output shows the last logical issue, you've reversed it. Try a different way and verify until correct order is confirmed.

<!-- BEGIN BEADS INTEGRATION -->
## Issue Tracking with bd (beads)

**IMPORTANT**: This project uses **bd (beads)** for ALL issue tracking. Do NOT use markdown TODOs, task lists, or other tracking methods.

### Why bd?

- Dependency-aware: Track blockers and relationships between issues
- Version-controlled: Built on Dolt with cell-level merge
- Agent-optimized: JSON output, ready work detection, discovered-from links
- Prevents duplicate tracking systems and confusion

### Quick Start

**Check for ready work:**

```bash
bd ready --json
```

**Create new issues:**

```bash
bd create "Issue title" --description="Detailed context" -t bug|feature|task -p 0-4 --json
bd create "Issue title" --description="What this issue is about" -p 1 --deps discovered-from:bd-123 --json
```

**Claim and update:**

```bash
bd update <id> --claim --json
bd update bd-42 --priority 1 --json
```

**Complete work:**

```bash
bd close bd-42 --reason "Completed" --json
```

### Issue Types

- `bug` - Something broken
- `feature` - New functionality
- `task` - Work item (tests, docs, refactoring)
- `epic` - Large feature with subtasks
- `chore` - Maintenance (dependencies, tooling)

### Priorities

- `0` - Critical (security, data loss, broken builds)
- `1` - High (major features, important bugs)
- `2` - Medium (default, nice-to-have)
- `3` - Low (polish, optimization)
- `4` - Backlog (future ideas)

### Workflow for AI Agents

1. **Check ready work**: `bd ready` shows unblocked issues
2. **Claim your task atomically**: `bd update <id> --claim`
3. **Work on it**: Implement, test, document
4. **Discover new work?** Create linked issue:
   - `bd create "Found bug" --description="Details about what was found" -p 1 --deps discovered-from:<parent-id>`
5. **Complete**: `bd close <id> --reason "Done"`

### Auto-Sync

bd automatically syncs with git:

- Exports to `.beads/issues.jsonl` after changes (5s debounce)
- Imports from JSONL when newer (e.g., after `git pull`)
- No manual export/import needed!

### Important Rules

- ✅ Use bd for ALL task tracking
- ✅ Always use `--json` flag for programmatic use
- ✅ Link discovered work with `discovered-from` dependencies
- ✅ Check `bd ready` before asking "what should I work on?"
- ❌ Do NOT create markdown TODO lists
- ❌ Do NOT use external issue trackers
- ❌ Do NOT duplicate tracking systems

For more details, see README.md and docs/QUICKSTART.md.

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds

**IMPORTANT**: Update the project slice tracker in plandocs to parity with completion reflected in beads and based on work done.
