# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Build
npm run build          # Compile TypeScript → dist/
npm run build:olympus  # Build React dashboard (Vite)
npm run build:all      # Both orchestrator and dashboard

# Test
npm test               # Run all tests once (Vitest)
npm run test:watch     # Watch mode
npx vitest run test/triage.test.ts  # Run a single test file

# Type check
npm run lint           # tsc --noEmit

# Development
npm run dev            # Run via tsx (no build required)
```

**External prerequisites** (must be in PATH):
- `bd` — Beads CLI (Go binary)
- `git` — Version control
- Node >= 22.5.0

## Architecture

Aegis is a multi-agent orchestrator that polls a Beads issue tracker, dispatches AI agents (via Pi SDK) to assess/implement/review issues, and surfaces real-time status through an HTTP/SSE dashboard.

### Dispatch Loop (aegis.ts)

The core tick is: **POLL → TRIAGE → DISPATCH → MONITOR → REAP → sleep → repeat**

`Aegis` is the central class. Each tick it:
1. Polls `beads.ts` for ready issues
2. Calls `triage.ts` (pure function) to decide the action per issue
3. Spawns agents via `spawner.ts`
4. Checks `monitor.ts` for stuck/budget-exceeded agents and kills them
5. Reaps completed agents (Mnemosyne post-processing, worktree merge)

### Agent Castes

Three agent types with different models, tools, and purposes:

| Caste | Role | Tools |
|-------|------|-------|
| **Oracle** | Scouting — assesses issue, writes `SCOUTED:` comment | Read-only |
| **Titan** | Implementation — writes code in isolated git worktree | Full (read/write/bash) |
| **Sentinel** | Review — validates Titan's work, writes `REVIEWED:` comment | Read-only |

### Triage Logic (triage.ts)

Pure function. Dispatch decisions are rule-based:
- No `SCOUTED:` comment → dispatch **Oracle** (if oracle slots free)
- Has `SCOUTED:` + issue open/ready → dispatch **Titan** (if titan slots free)
- Issue closed + no `REVIEWED:` comment → dispatch **Sentinel** (if sentinel slots free)
- Otherwise → SKIP

These `SCOUTED:` / `REVIEWED:` comment prefixes are load-bearing — they drive all state transitions.

### Key Module Responsibilities

| Module | Responsibility |
|--------|---------------|
| `index.ts` | CLI (`init`, `start`, `status`, `stop`) |
| `aegis.ts` | Orchestrator class, dispatch loop, concurrency enforcement |
| `triage.ts` | Stateless dispatch rules |
| `spawner.ts` | **Only** module that calls Pi SDK `createAgentSession()` |
| `beads.ts` | Thin wrapper over `bd` CLI (all Beads I/O) |
| `poller.ts` | Polls `bd ready --json`, diffs against running agents |
| `labors.ts` | Git worktree lifecycle for Titan isolation |
| `monitor.ts` | Stuck detection, budget enforcement, cost tracking |
| `mnemosyne.ts` | Learnings store (JSONL), domain-tagged, token-budgeted |
| `lethe.ts` | Prunes oldest Mnemosyne records when limit exceeded |
| `server.ts` | HTTP server: SSE events, REST API, static Olympus dashboard |

### Concurrency & Backoff

Concurrency limits from config: `max_agents`, `max_oracles`, `max_titans`, `max_sentinels`. Dispatch fails if any relevant cap is reached. Three spawn failures within 10 minutes triggers backoff for that issue.

### Git Worktrees (labors.ts)

Each Titan gets its own worktree at `.aegis/labors/<issue-id>/` on branch `aegis/<issue-id>`. After the Titan completes, `labors.ts` merges back to main and removes the worktree. Windows path normalization (backslash → forward slash) is applied throughout.

### Runtime State

- `.aegis/config.json` — Config with API keys (created by `aegis init`, gitignored)
- `.aegis/mnemosyne.jsonl` — Accumulated learnings across runs
- `.aegis/labors/` — Active Titan worktrees (gitignored)
- `.beads/` — Beads/Dolt database (gitignored)

### Dashboard (olympus/)

Separate Vite/React project. Served statically by `server.ts`. Connects via SSE for real-time agent events. The `/api/steer` endpoint accepts direct commands or natural-language commands (routed through Metis model).

## Testing

Vitest 4 with ES module mocks. Each source module has a corresponding test file. External dependencies (`bd` CLI, Pi SDK, filesystem) are mocked — tests do not require `bd` or API keys to run.
