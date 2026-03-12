# Aegis — Phased Implementation Plan

**Purpose:** This document defines the build order for Aegis. Agents filing beads issues should follow the stage and priority ordering here. Each stage has a gate — the gate must pass before work in the next stage begins.

---

## Stage 1: Foundation Modules (Ant-Colony / Automated Agents)

Isolated, independently testable modules. No integration wiring. Each module has a clear interface, takes typed inputs, returns typed outputs. Agents work these in parallel via ant-colony or Aegis's own dispatch once available.

### P0 — No Dependencies (file first, work first)

| Module | File | Description | Test file |
|--------|------|-------------|-----------|
| Config | `src/config.ts` | Load and validate `.aegis/config.json`. Export typed `AegisConfig`. Handle missing file, bad JSON, missing fields with clear errors. Use `node:fs` only. | `test/config.test.ts` |
| Beads | `src/beads.ts` | Thin wrapper over `bd` CLI. Functions: `ready()`, `show(id)`, `create(opts)`, `update(id, opts)`, `close(id, reason)`, `comment(id, text)`, `list()`. All return parsed JSON. Handle bd not found, non-zero exit, malformed output. Shell out via `node:child_process`. | `test/beads.test.ts` |
| Types | `src/types.ts` | Already scaffolded. Expand: tighten `BeadsIssue.status` to `"open" \| "ready" \| "in_progress" \| "closed"` union. Add any missing interfaces discovered during module implementation. | N/A (compile-time only) |

### P0 — Depends on Config and/or Beads

| Module | File | Depends On | Description | Test file |
|--------|------|------------|-------------|-----------|
| Mnemosyne | `src/mnemosyne.ts` | config | Read/write/filter `.aegis/mnemosyne.jsonl`. Functions: `load()`, `append(record)`, `filter(domain, tokenBudget)`, `postProcess(agentId, issueId)`. Handle missing file, malformed lines, token budget truncation. | `test/mnemosyne.test.ts` |
| Lethe | `src/lethe.ts` | mnemosyne | Prune mnemosyne when over `max_records`. Oldest first, conventions get 2x longevity. Function: `prune(records, max)` → pruned records. Pure function, no I/O. | `test/lethe.test.ts` |
| Labors | `src/labors.ts` | config | Git worktree lifecycle. Functions: `create(issueId)` → worktree path, `merge(issueId)` → success/conflict, `cleanup(issueId)`. Shell out to `git`. Handle merge conflicts by aborting and returning conflict info. Normalize paths for Windows. | `test/labors.test.ts` |
| Poller | `src/poller.ts` | beads | Poll `bd ready --json` on interval. Diff against known running set. Emit new-work events. Functions: `poll()` → `BeadsIssue[]`, `diff(ready, running)` → new issues. | `test/poller.test.ts` |
| Triage | (inside `src/poller.ts` or `src/triage.ts`) | beads, poller | Deterministic dispatch rules. Given an issue + its comments, decide: dispatch Oracle, dispatch Titan, dispatch Sentinel, or skip. Grep for `SCOUTED:` and `REVIEWED:` prefixes. Pure function: `triage(issue, runningAgents, concurrencyLimits)` → action. | `test/triage.test.ts` |

### P1 — Depends on Foundation

| Module | File | Depends On | Description | Test file |
|--------|------|------------|-------------|-----------|
| Spawner | `src/spawner.ts` | config, labors, mnemosyne | Create Pi SDK agent sessions per caste. Functions: `spawnOracle(issue, learnings)`, `spawnTitan(issue, learnings)`, `spawnSentinel(issue, learnings)`. Build system prompts from templates. Configure tool restrictions per caste. Inject AGENTS.md content. | `test/spawner.test.ts` |
| Monitor | `src/monitor.ts` | config | Track agent lifecycle. Subscribe to Pi session events. Track turns, tokens, cost, last tool call timestamp. Detect stuck agents (no tool call for N seconds, repeated tool calls). Functions: `track(session)`, `checkStuck(agent)`, `checkBudget(agent)`. Emit events for dashboard. | `test/monitor.test.ts` |

### Stage 1 Gate

All modules compile (`npx tsc --noEmit`), all tests pass (`npm test`), each module's exported interface matches what `aegis.ts` will need to import. No integration wiring yet — modules are standalone.

---

## Stage 2: Integration Wiring (Interactive — Human + Pi, one session)

This is the critical path. One focused session wires the modules together into a working dispatch loop. Do NOT automate this stage — it requires holding the full system model in context.

### Tasks (sequential, single session)

1. **`src/aegis.ts`** — Core orchestrator class. Imports poller, triage, spawner, monitor, mnemosyne, lethe, labors, beads, config. Implements the Layer 1 loop: `poll → triage → dispatch → monitor → reap → poll`. Manages concurrency slots. Handles agent completion callbacks. Merges labors on Titan completion. Post-processes mnemosyne entries on reap.

2. **`src/server.ts`** — HTTP server. SSE endpoint for real-time events (`/api/events`). REST endpoints for steering commands (`POST /api/steer`), status (`GET /api/status`), config (`GET /api/config`). Serves static Olympus files from `olympus/dist/`. Wires SSE to orchestrator event emitter.

3. **`src/index.ts`** — CLI entry point. Parse `init`, `start`, `status`, `stop` commands. `start` creates the Aegis instance, starts the server, opens the browser. `stop` triggers graceful shutdown. `init` creates `.aegis/` directory and template config.

4. **End-to-end smoke test** — Create a trivial beads issue by hand. Run `aegis start`. Verify the poller picks it up, triage dispatches an Oracle, the Oracle runs and leaves a `SCOUTED:` comment, triage then dispatches a Titan, the Titan implements and closes, triage dispatches a Sentinel, the Sentinel reviews. Full cycle. Fix whatever breaks.

### Stage 2 Gate

`aegis start` runs. The Layer 1 loop dispatches agents. At least one full Oracle → Titan → Sentinel cycle completes against a real beads issue. SSE events stream to the server endpoint. Graceful shutdown works (Ctrl+C stops cleanly).

---

## Stage 3: Self-Hosting (Aegis builds itself)

From this point, stop using ant-colony. File the remaining work as beads issues and let Aegis dispatch agents to build them. Every bug Aegis hits while building itself is a bug you'd hit in production.

### P2 — Metis + Prometheus

| Module | File | Description |
|--------|------|-------------|
| Metis | `src/metis.ts` | Layer 2 NL interpreter. Takes user input + swarm state summary. Calls Haiku. Returns `SteerAction[]`. System prompt describes available actions as JSON schema. |
| Prometheus | `src/prometheus.ts` | Layer 3 strategic planner. Takes user input + codebase summary + beads state + learnings. Calls Sonnet/Opus. Returns `bd create` / `bd update` commands. Orchestrator executes them. |

### P2 — Olympus Dashboard

| Component | File | Description |
|-----------|------|-------------|
| Project init | `olympus/` | Vite + React + Tailwind + Recharts + xterm.js. Separate `package.json`. Build output served by `server.ts`. |
| SSE hook | `olympus/src/hooks/useSSE.ts` | Connect to `/api/events`. Parse and dispatch to React state. Auto-reconnect. |
| Command Bar | `olympus/src/components/CommandBar.tsx` | Mode selector (Steer/Plan/Ask/Direct). Text input. Posts to `/api/steer`. Shows response. |
| Agent Cards | `olympus/src/components/AgentCard.tsx` | Per-agent card with caste badge, issue info, turn/token/cost counters, mini-terminal. Click to expand full xterm.js output. |
| Beads Board | `olympus/src/components/BeadsBoard.tsx` | Kanban: Ready → Divining → Forging → Sentinel Review → Done. Dependency lines. Click for detail overlay. |
| Cost Panel | `olympus/src/components/CostPanel.tsx` | Recharts: cumulative cost, cost by caste, token burn rate, per-issue cost table. |
| Event Timeline | `olympus/src/components/EventTimeline.tsx` | Scrolling event log with timestamps. |
| Mnemosyne Panel | `olympus/src/components/MnemosynePanel.tsx` | Filterable learnings list. Add new learnings inline. |
| Setup Wizard | `olympus/src/components/SetupWizard.tsx` | First-run: API keys, model assignment, concurrency, beads/git checks. |

### P3 — Polish

| Task | Description |
|------|-------------|
| Graceful shutdown | Full implementation per spec section 9.2. Inject wrap-up messages, wait 60s, kill stragglers, mark issues open, clean labors. |
| `aegis init` wizard | Interactive CLI setup (TTY detection, prompts for API keys, creates config). |
| npm packaging | `bin` entry, shebang, `prepublishOnly` script builds both core and Olympus. |
| README.md | Installation, prerequisites, quick start, architecture overview. |

### Stage 3 Gate

Aegis runs continuously, dispatches all three castes, Olympus is functional in a browser, steering works via command bar, costs are tracked, and the project is publishable to npm.

---

## Filing Issues

When filing beads issues from this plan:

- Use the stage number as a tag prefix in the title: `[S1]`, `[S2]`, `[S3]`
- Set priorities matching this plan: P0/P1 for Stage 1, P1 for Stage 2, P2 for Stage 3 features, P3 for polish
- Set `blocked-by` dependencies matching the "Depends On" columns above
- One issue per module. One issue per Olympus component. Do not bundle.
- Include the module's function signatures and test file name in the issue description
- Reference `SPEC.md` sections by number where applicable (e.g., "See SPEC §5 for Mnemosyne format")
