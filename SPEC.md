# Product Specification: Aegis — Multi-Agent Swarm Orchestrator

**Status:** Active — Layer 1 implemented, architectural pivot in progress
**Last updated:** March 2026
**Author:** Human + Claude (collaborative design)

---

## 1. Executive Summary

Aegis is a lightweight, runtime-agnostic multi-agent swarm orchestrator that coordinates AI coding agents through a pluggable adapter layer and an external issue tracker. The orchestrator ships as a standalone npm package. The initial runtime adapter targets **Pi** (a minimal coding agent SDK by Mario Zechner), and the initial issue tracker integration targets **Beads** (a git-native issue tracker by Steve Yegge), but the architecture supports swapping either without touching orchestration logic.

The core thesis is that orchestration should be a thin, understandable layer — not an application framework. The issue tracker owns task metadata. The agent runtime owns execution. The orchestrator owns dispatch logic, agent lifecycle management, persistent dispatch state, Olympus (a web-based monitoring dashboard), and a natural language steering interface. The entire system should be readable, modifiable, and replaceable by a single developer.

### Design Principles

1. **Ship the minimum viable feature set.** No feature bloat. The system should fit in one developer's head.
2. **Dispatch state is the single source of truth for orchestration.** All dispatch decisions are driven by a persistent, structured state machine (`.aegis/dispatch-state.json`). If the orchestrator crashes and restarts, it recovers fully from dispatch state plus the issue tracker. No in-memory state that can't be reconstructed.
3. **The browser is the primary interface.** No tmux dependency. No terminal UI. Olympus runs in any browser on any OS. The terminal is just the orchestrator's log output.
4. **LLMs are expensive — use them only where they add value.** The dispatch loop is deterministic. The steering interpreter uses a cheap model. The strategic planner uses an expensive model only on explicit request. Agents are tiered by cost to match task complexity.
5. **Windows-first design.** Git Bash, PowerShell, and cmd are all valid launch environments.
6. **Conversational-first, autonomous-second.** Aegis starts idle and waits for direction. The human decides what to work on, which issues to scout, implement, or review. Autonomous background polling is an opt-in mode ("auto on"), not the default. The orchestrator is a tool you direct, not a daemon that runs unsupervised.
7. **Runtime-agnostic by design.** The orchestrator interacts with agent runtimes through an `AgentRuntime`/`AgentHandle` interface. Pi is the first adapter. Claude Code, Cursor, Ollama, and others can be added without modifying the dispatch loop, monitor, or dashboard. This enables mixed-model swarms where cheap local models handle scouting while expensive cloud models handle implementation.

---

## 2. System Architecture

### 2.1 High-Level Component Diagram

```
┌─────────────────────────────────────────────────────┐
│                 Olympus (Web Dashboard)              │
│             (React + Tailwind + xterm.js)            │
│                                                      │
│  ┌──────────────┐ ┌──────────┐ ┌───────┐ ┌───────┐ │
│  │ Command Bar  │ │ Agents   │ │ Issue │ │ Cost/ │ │
│  │ (Direct +NL) │ │ Overview │ │ Board │ │Charts │ │
│  └──────┬───────┘ └──────────┘ └───────┘ └───────┘ │
│         │               ↑ SSE                        │
└─────────┼───────────────┼────────────────────────────┘
          │               │
          ▼               │
┌─────────────────────────────────────────────────────┐
│                  Aegis (Node.js)                     │
│                                                      │
│  Layer 1: Deterministic Dispatch (no LLM)            │
│                                                      │
│  ┌──────────┐ ┌───────────┐ ┌───────────────────┐   │
│  │ Spawner  │ │ Monitor   │ │ Dispatch Store    │   │
│  │ (Runtime │ │ (budgets, │ │ (.aegis/dispatch- │   │
│  │  Adapter │ │  stuck    │ │  state.json)      │   │
│  │  Layer)  │ │  detect,  │ │                   │   │
│  │          │ │  kill)    │ │ Mnemosyne         │   │
│  │          │ │           │ │ (.aegis/          │   │
│  │          │ │           │ │  mnemosyne.jsonl) │   │
│  └────┬─────┘ └─────┬────┘ └───────────────────┘   │
└───────┼─────────────┼───────────────────────────────┘
        │             │
   ┌────┴────┐   ┌────┴────┐
   │ Runtime │   │  Issue  │
   │ Adapters│   │ Tracker │
   │(Pi,etc.)│   │(Beads,.)│
   └─────────┘   └─────────┘
```

### 2.2 Dependency Topology

The orchestrator has two categories of dependencies:

**Embedded (installed via npm, invisible to end users):**
- Runtime adapter packages (e.g., `@mariozechner/pi-coding-agent` for the Pi adapter)
- The adapter layer abstracts these — the orchestrator core never imports runtime-specific packages directly

**External (must be installed on the system):**
- An issue tracker CLI (default: `bd` / beads) — for task state management
- `git` — Required for worktree-based agent isolation
- `Node.js >= 22.5.0` — Runtime for the orchestrator

### 2.3 Runtime Adapter Layer

The orchestrator interacts with agent runtimes exclusively through two interfaces:

```typescript
interface AgentRuntime {
  spawn(opts: SpawnOptions): Promise<AgentHandle>;
}

interface AgentHandle {
  prompt(msg: string): Promise<void>;
  steer(msg: string): Promise<void>;
  abort(): Promise<void>;
  subscribe(listener: (event: AgentEvent) => void): () => void;
  getStats(): AgentStats;
}
```

`spawner.ts` reads the runtime identifier from config (e.g., `"pi"`, `"claude-code"`, `"ollama"`), instantiates the appropriate `AgentRuntime` adapter, and delegates. The rest of the orchestrator — `aegis.ts`, `monitor.ts`, `server.ts` — only touches `AgentHandle`. No runtime-specific imports leak into the core.

**Pi adapter** (`PiRuntime`) is the first implementation. It wraps `createAgentSession()`, `AuthStorage`, `ModelRegistry`, and `getModel()` from the Pi SDK packages. All Pi-specific code — including Windows spawn fixes (`C:\tmp` creation, MSYSTEM/SHELL overrides for Git Bash) — lives exclusively in this adapter.

**Future adapters** (post-MVP): `ClaudeCodeRuntime`, `OllamaRuntime`, `CursorRuntime`. The adapter interface is deliberately minimal to make new adapters easy to write.

### 2.4 Data Flow

```
User creates issues (manually or via planner)
         │
         ▼
    Issue tracker ready queue ← Orchestrator polls
         │
         ▼
    Triage: read dispatch state for each issue
    ├── stage=pending → dispatch Oracle
    ├── stage=scouted + ready=true → dispatch Titan
    ├── stage=implemented → dispatch Sentinel
    └── stage=complete → skip
         │
         ▼
    Runtime adapter spawns agent session
    Agent runs in Labor (git worktree) with caste-specific config
         │
         ├── Agent creates new issues → discovered work
         ├── Agent records learnings → POST /api/learning
         │
         ▼
    Agent finishes or is killed
    Orchestrator transitions dispatch state, merges Labor, reclaims slot
    Back to polling
```

---

## 3. The Three-Layer Orchestration Model

### 3.1 Layer 1: Deterministic Dispatch (No LLM)

This is the orchestrator's execution engine. It runs deterministic dispatch logic and never makes an LLM call. Layer 1 operates in two modes:

#### Conversational Mode (default)

On startup, Aegis is **idle**. It serves Olympus, accepts steering commands, and waits for the user to direct it. No polling, no automatic dispatch. The user explicitly tells Aegis what to do:

| User command | Action |
|-------------|--------|
| `scout <issue-id>` | Dispatch an Oracle for that specific issue |
| `implement <issue-id>` | Dispatch a Titan for that issue (bypasses Oracle if unscouted) |
| `review <issue-id>` | Dispatch a Sentinel for that closed issue |
| `process <issue-id>` | Run the full Oracle → Titan → Sentinel cycle for one issue |
| `status` | Report current agent state and queue |

These commands invoke the same triage → dispatch → monitor → reap pipeline as auto mode, but for a single explicitly-named issue. The user stays in control of which issues get worked on and when API credits are spent.

#### Auto Mode (opt-in)

When the user sends `auto on`, Aegis activates the autonomous poll loop:

POLL → TRIAGE → DISPATCH → MONITOR → REAP → POLL

This runs on a configurable interval (default: 5 seconds) and processes the ready queue without further user input. `auto off` (or `pause`) stops the loop and returns to conversational mode.

**POLL:** Query the issue tracker's ready queue. Parse the result into a list of ready issues. Diff against the set of currently running agents to identify new work.

**TRIAGE:** For each issue, read its `DispatchRecord` from the dispatch store and apply deterministic rules:

| Dispatch State | Action |
|----------------|--------|
| No record, or `stage=pending` | Dispatch an Oracle |
| `stage=scouted`, assessment `ready=true` | Dispatch a Titan |
| `stage=implemented`, no sentinel verdict | Dispatch a Sentinel |
| `stage=complete` | Skip (done) |
| `stage=failed`, verdict `fail` | Skip (fix issues filed) |
| `stage` is `scouting`, `implementing`, or `reviewing` | Skip (in progress) |
| Concurrency limit reached | Queue, dispatch when slot frees |

Dispatch decisions are driven entirely by the `DispatchRecord` stage machine. The orchestrator does not parse issue tracker comments to determine state.

**Important:** In auto mode, only issues that entered the ready queue *after* auto mode was activated are processed. Aegis does NOT retroactively scan all issues. Sentinel dispatch in auto mode is limited to issues whose Titan was dispatched by the current Aegis session (tracked in dispatch state, persisted across crashes).

**DISPATCH:** Transition dispatch state (e.g., `pending → scouting`). Create an agent session via the runtime adapter with caste-appropriate configuration (see Section 4). Set the agent's working directory to a Labor (git worktree) for Titans. Inject the issue details + relevant learnings into the initial prompt.

**MONITOR:** Subscribe to each agent's event stream via `AgentHandle.subscribe()`. Track turn count, token usage, elapsed time, and tool call activity. Forward events to Olympus via SSE. Enforce budgets in real-time (on each `turn_end` event, not just per-tick).

**REAP:** When an agent finishes (session ends or budget exceeded):
- Verify the agent achieved its expected outcome (Oracle produced a valid assessment, Titan closed the issue, Sentinel produced a verdict)
- Transition dispatch state to the next stage on success, or to `failed` on failure
- If the agent failed or was killed: mark the issue back to open in the issue tracker, increment the dispatch failure counter in dispatch state
- If the agent completed successfully: reset the dispatch failure counter
- For Titans: merge the Labor back into main
- Reclaim the concurrency slot

**Dispatch failure backoff:** Three consecutive agent failures for the same issue within a 10-minute window causes that issue to be skipped until the window expires. Failure counts are stored in dispatch state (persisted across crashes). This prevents infinite respawn loops.

**Active priority filtering:** Layer 1 maintains an optional priority filter set by the user via steering (e.g., "focus on auth issues"). When active, only issues matching the filter are dispatched. This is a simple text match on issue title/description — no LLM needed.

### 3.2 Metis: Natural Language Interpreter (Post-MVP)

See `SPEC-FUTURE.md` for the Metis design. In the MVP, all user interaction happens through direct commands via Olympus's command bar or the `/api/steer` REST endpoint. Direct commands are pattern-matched deterministically — no LLM call needed.

### 3.3 Prometheus: Strategic Planner (Post-MVP)

See `SPEC-FUTURE.md` for the Prometheus design. In the MVP, issue decomposition is done manually by the user or via the Oracle's assessment (which can recommend decomposition).

---

## 4. Agent Castes

### 4.1 Overview

| Caste | Model Tier | Default Model | Tools | Turn Budget | Token Budget | Purpose |
|-------|-----------|---------------|-------|-------------|-------------|---------|
| Oracle | Cheap | claude-haiku-4-5 | read, bash (read-only), bd | 8–10 | 80k | Produce structured implementation plan, cost gate |
| Titan | Medium | claude-sonnet-4-6 | read, write, edit, bash, bd | 20 | 300k | Implement a single issue in an isolated Labor |
| Sentinel | Strong | claude-sonnet-4-6 | read, bash (read-only), bd | 8 | 100k | Review completed work, file fix issues |

Model assignments are configurable globally and per-caste via Olympus settings or the `.aegis/config.json` file. The `runtime` field in config determines which adapter handles each caste (enabling mixed-model swarms in the future).

### 4.2 Oracle Agents

**Purpose:** Oracles are the planning and cost-gating layer. They produce a **structured implementation assessment** that the Titan executes, and they serve as a circuit breaker for complex or underspecified issues.

**Trigger:** A new issue enters dispatch with no `DispatchRecord`, or a record with `stage=pending`.

**Tool restrictions:** Oracles cannot modify the codebase. Their bash access is restricted to non-destructive commands (ls, cat, find, grep, rg, git log, git diff, issue tracker commands). This is enforced via the runtime adapter's tool filter.

**Deliverable — `OracleAssessment`:**

```typescript
interface OracleAssessment {
  files_affected: string[];           // exact file paths
  estimated_complexity: "trivial" | "moderate" | "complex";
  decompose: boolean;                 // should this be split into sub-issues?
  sub_issues?: string[];              // suggested sub-issue titles
  blockers?: string[];                // prerequisite conditions
  ready: boolean;                     // go/no-go for Titan dispatch
}
```

**Initial prompt template:**
```
You are an Oracle agent. Your job is to explore and produce a structured
implementation plan — not to write code.

ISSUE: {issue_title}
DESCRIPTION: {issue_description}
PRIORITY: {issue_priority}

LEARNINGS (relevant to this domain):
{filtered_learnings}

INSTRUCTIONS:
1. Read the full issue details
2. Explore the relevant parts of the codebase
3. Identify the exact files that will need changes (full paths)
4. Assess complexity: trivial (< 50 lines, 1-2 files), moderate (50-200 lines,
   3-5 files), or complex (200+ lines or 6+ files)
5. Determine if the issue should be decomposed into smaller sub-issues
6. Check for blockers or prerequisites
7. If you discover additional work, create issues in the tracker
8. Produce your assessment as a JSON object with this schema:
   { files_affected: string[], estimated_complexity: "trivial"|"moderate"|"complex",
     decompose: boolean, sub_issues?: string[], blockers?: string[], ready: boolean }

Output ONLY the JSON assessment as your final message. Do NOT modify any files.
```

**Completion criteria:** The orchestrator parses the Oracle's final output for a valid `OracleAssessment` JSON object. On success, dispatch state transitions to `stage=scouted` with the assessment stored. On failure (no valid JSON, or turn budget exceeded), dispatch state transitions to `stage=failed` and the issue is re-queued.

**Cost gate:** If `estimated_complexity=complex`, the orchestrator emits an `orchestrator.complex_issue` event and (in conversational mode) waits for human confirmation before dispatching a Titan. In auto mode, complex issues are skipped unless the user has explicitly opted in via config.

**Decomposition:** If `decompose=true`, the orchestrator auto-creates sub-issues from `sub_issues[]` and links them as dependencies. The original issue remains open, blocked by its children.

### 4.3 Titan Agents

**Trigger:** A `DispatchRecord` with `stage=scouted` and `oracle_assessment.ready=true`.

**Tool access:** Full — read, write, edit, bash, and issue tracker commands. Titans operate in an isolated Labor (see Section 7).

**Initial prompt template:**
```
You are a Titan agent. Implement the assigned issue.

ISSUE: {issue_title} ({issue_id})
DESCRIPTION: {issue_description}

ORACLE ASSESSMENT:
- Files to modify: {assessment.files_affected}
- Complexity: {assessment.estimated_complexity}
- Blockers: {assessment.blockers || "none"}

LEARNINGS (relevant to this domain):
{filtered_learnings}

INSTRUCTIONS:
1. Claim the issue in the tracker
2. Review the Oracle's file list and assessment
3. Implement the change
4. Run tests: {test_command}
5. If tests pass, commit your changes with a descriptive message
6. Close the issue with a reason
7. If you discover additional work, create new issues in the tracker
8. Record codebase learnings (conventions, patterns, gotchas):
   curl -s -X POST http://localhost:{port}/api/learning \
     -H 'Content-Type: application/json' \
     -d '{"domain":"...","type":"convention|pattern|failure","text":"..."}'

If tests fail, fix and retry. Do NOT close the issue until tests pass.
Focus on {issue_id} only.
```

**Completion criteria:** The orchestrator checks that the issue status is `closed` in the tracker. If the Titan finished without closing, dispatch state transitions to `failed` and the issue is re-opened. On success, dispatch state transitions to `stage=implemented`. The Labor is merged back to main.

### 4.4 Sentinel Agents

**Trigger:** A `DispatchRecord` with `stage=implemented`.

**Tool restrictions:** Read-only access, same as Oracles.

**Initial prompt template:**
```
You are a Sentinel agent. Review completed work for correctness and quality.

ISSUE: {issue_title} ({issue_id})
DESCRIPTION: {issue_description}

ORACLE ASSESSMENT:
- Files modified: {assessment.files_affected}
- Complexity: {assessment.estimated_complexity}

INSTRUCTIONS:
1. Read the issue description and Oracle assessment to understand intent
2. Examine the changes (git diff against the base branch)
3. Check that tests cover the change
4. Check for bugs, security issues, and quality problems
5. Produce your verdict as a JSON object:
   { "verdict": "pass" | "fail", "summary": "...", "issues"?: ["..."] }
6. If issues are found, create fix issues in the tracker

Output ONLY the JSON verdict as your final message.
Be thorough but proportional. Minor style issues are not worth failing a review.
```

**Completion criteria:** The orchestrator parses the Sentinel's final output for a verdict JSON. On `pass`, dispatch state transitions to `stage=complete`. On `fail`, dispatch state transitions to `stage=failed` with `sentinel_verdict=fail`, and fix issues enter the dispatch queue. If no valid verdict is produced, the Sentinel is considered failed and the issue is re-queued for another review.

---

## 5. Dispatch State

### 5.1 Design Rationale

The orchestrator needs to track where each issue is in the Oracle → Titan → Sentinel pipeline. The previous design used in-memory maps and parsed issue tracker comments for `SCOUTED:` / `REVIEWED:` prefixes. This was fragile (text grep on unstructured comments), ephemeral (lost on crash), and coupled to the issue tracker's comment format.

The new design uses a persistent, structured state file owned by a dedicated module (`dispatch-store.ts`). Dispatch decisions are driven entirely by typed records, not comment parsing.

### 5.2 Storage

File location: `.aegis/dispatch-state.json` (gitignored — this is runtime state, not project knowledge).

Persistence: atomic JSON file writes (write to `.tmp`, rename over target). The in-memory `Map<string, DispatchRecord>` is the primary data structure. The file is its crash-safe shadow. Written on every state transition.

### 5.3 DispatchRecord

```typescript
interface DispatchRecord {
  issue_id: string;
  stage: "pending" | "scouting" | "scouted" | "implementing"
       | "implemented" | "reviewing" | "complete" | "failed";
  oracle_assessment: OracleAssessment | null;
  sentinel_verdict: "pass" | "fail" | null;
  failure_count: number;
  last_failure_at: number | null;
  current_agent_id: string | null;
  created_at: number;
  updated_at: number;
}
```

### 5.4 Module: `dispatch-store.ts`

This is the **only** module that reads or writes `.aegis/dispatch-state.json`. Exports:

- `load(projectRoot)` — read from disk on startup
- `save()` — atomic write current state to disk
- `get(issueId)` — read a single record
- `set(issueId, record)` — upsert + save
- `transition(issueId, newStage, data?)` — stage change + save
- `recordFailure(issueId)` — increment failure_count + save
- `resetFailures(issueId)` — clear failure count on success
- `all()` — all records (for triage loop and crash recovery)

### 5.5 State Machine

```
pending ──→ scouting ──→ scouted ──→ implementing ──→ implemented ──→ reviewing ──→ complete
   │            │            │             │                │              │
   └── failed ◄─┘            └── failed ◄──┘                └── failed ◄───┘
         │                        │                               │
         └──── (reopen issue, increment failure_count) ◄──────────┘
```

On failure at any stage, the issue is reopened in the tracker and `failure_count` is incremented. After 3 consecutive failures within 10 minutes, the issue is skipped until the window expires.

### 5.6 Crash Recovery

On startup, `recover()` loads `dispatch-state.json`:
- Records with stage `scouting`, `implementing`, or `reviewing` and no running agent → transition to `failed`, reopen issue
- Records with stage `implemented` → survive the crash, picked up by triage for Sentinel dispatch
- Fallback: also scans the issue tracker for `in_progress` issues not in dispatch state (catches issues claimed outside Aegis)

This fixes the previous design's latent bug where `titanDispatchedIssues` was lost on crash, causing unreviewed issues to never receive their Sentinel.

---

## 6. Mnemosyne: Learnings Store

### 6.1 Design Rationale

Agents start every session from zero. Mnemosyne accumulates **codebase knowledge** — conventions, patterns, and gotchas — that makes each successive agent more effective. It is explicitly *not* a place for agent execution telemetry (failure tracking lives in dispatch state).

### 6.2 Storage Format

File location: `.aegis/mnemosyne.jsonl` (committed to git — this is project knowledge, shared across the team).

Each line is a JSON record:

```json
{
  "id": "l-a1b2c3",
  "type": "convention | pattern | failure",
  "domain": "string (e.g., 'testing', 'auth', 'components')",
  "text": "Human-readable description of the learning",
  "source": "agent-N | human | planner",
  "issue": "issue-id | null",
  "ts": 1741500000
}
```

Three record types:
- **convention** — "Always do X in this project" (e.g., "use barrel exports")
- **pattern** — "This codebase does X this way" (e.g., "auth uses refresh tokens stored in httpOnly cookies")
- **failure** — "X doesn't work / causes problems in this codebase" (e.g., "jest.mock doesn't work with ESM imports in this project")

Note: these record types describe **codebase** failures (things that don't work in the project), not agent execution failures (an agent crashed or was killed). Agent failure tracking is handled by dispatch state, not Mnemosyne.

### 6.3 Reading Learnings

When the orchestrator builds an agent's initial prompt, it loads learnings relevant to the agent's assigned issue:

1. Parse all records from the JSONL file
2. Filter by domain if the issue has identifiable domain tags (extracted from title/description keywords)
3. Sort by timestamp descending (newest first)
4. Truncate to a configurable token budget (default: 1000 tokens)
5. Inject into the agent's prompt as a "LEARNINGS" section

If no domain match is found, include the N most recent learnings regardless of domain (they're likely still relevant for general project conventions).

**Future improvement:** When the store exceeds ~200 records, keyword filtering becomes unreliable. A RAG-based approach using local embeddings (via Ollama) for semantic similarity retrieval is planned for post-MVP.

### 6.4 Writing Learnings

Agents record learnings via a dedicated HTTP endpoint:

**`POST /api/learning`**
```
Body: { domain: string, type: "convention"|"pattern"|"failure", text: string }
Headers: X-Agent-Id (optional, for attribution)
Returns: 201 with completed record
```

The orchestrator enriches the record with `id`, `source` (from agent ID), `issue` (from the agent's assigned issue), and `ts`, then appends atomically via `mnemosyne.append()`.

Agent prompts include the curl template:
```bash
curl -s -X POST http://localhost:$AEGIS_PORT/api/learning \
  -H 'Content-Type: application/json' \
  -d '{"domain":"testing","type":"convention","text":"vitest mocks must be hoisted before imports"}'
```

**Guidance for agents — what to record:**
- YES: "This project uses barrel exports for all modules"
- YES: "Auth tokens are stored in httpOnly cookies, not localStorage"
- YES: "jest.mock does not work with ESM imports — use vi.mock instead"
- NO: "I encountered an error running tests" (that's agent telemetry, not codebase knowledge)
- NO: "I was stuck for 3 turns on the config module" (execution detail, not project knowledge)

Users can also add learnings via the Olympus command bar (`add_learning <domain> <text>`).

### 6.5 Lethe: Pruning

When the JSONL file exceeds a configurable size (default: 500 records), the orchestrator prunes on a recency basis — oldest records are removed first, with `convention` type records given 2x longevity (they're more likely to remain relevant). Pruning runs as a background task during the REAP phase.

---

## 7. Labors: Git Worktree Isolation

### 7.1 Rationale

Multiple Titan agents editing the same repository simultaneously will create conflicts. Git worktrees provide lightweight, branch-based isolation without cloning the entire repo.

### 7.2 Labor Lifecycle

**Creation (during DISPATCH for Titans only):**
```bash
git worktree add .aegis/labors/labor-{issue_id} -b aegis/{issue_id}
```
This creates a new directory with a checkout on a new branch named `aegis/{issue_id}`, branching from the current HEAD.

The Titan agent's session is configured with this Labor directory as its working directory. The Titan operates on its own branch in its own directory, fully isolated from other agents.

Oracles and Sentinels do not need Labors — they are read-only and operate on the main working directory.

**Merge (during REAP for completed Titans):**
```bash
git checkout main
git merge aegis/{issue_id} --no-edit
```

If the merge succeeds cleanly, the orchestrator proceeds to cleanup. If there are conflicts:
1. Abort the merge: `git merge --abort`
2. Create an issue: `"Merge conflict: aegis/{issue_id}"` with priority 1
3. Preserve the Labor and branch for manual resolution or a future agent attempt
4. Emit a `labor.conflict` event to the SSE timeline

**Cleanup (after successful merge):**
```bash
git worktree remove .aegis/labors/labor-{issue_id}
git branch -d aegis/{issue_id}
```

### 7.3 Windows Compatibility

Git worktrees are a core git feature and work identically on Windows. The orchestrator must:
- Use forward slashes in paths passed to git commands (git handles this on Windows)
- Handle both forward-slash and backslash paths in git output parsing
- Normalize paths when constructing worktree directories

---

## 8. Olympus Dashboard

### 8.1 Technology Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Framework | React 18+ | Component model for complex interactive UI |
| Styling | Tailwind CSS | Utility-first, fast iteration, consistent design |
| Charts | Recharts | Lightweight, React-native charting (post-MVP) |
| Terminal output | xterm.js | Terminal emulator for agent output (post-MVP) |
| Real-time data | Server-Sent Events (SSE) | Simpler than WebSocket, auto-reconnects |
| Build | Vite | Fast dev server with HMR, small production bundle |
| Serving | Static files from orchestrator's HTTP server | No separate frontend server needed |

Olympus is bundled as static assets inside the npm package. On `aegis start`, the Node.js HTTP server serves both the API endpoints and the static Olympus files. The user's browser connects to `http://localhost:{port}`.

### 8.2 MVP Dashboard Layout

The MVP is a single-page application with a top bar and two main areas. Build this **before** Metis — direct commands are sufficient for the MVP.

**Top Bar:**
- Orchestrator status indicator (running / paused / auto)
- Global stats: active agents, total cost, uptime, queue depth
- Auto mode toggle
- Settings gear icon → opens config overlay

**Swarm Overview (main area):**

A card for each active agent:
- **Card header:** Agent ID, caste badge (Oracle/Titan/Sentinel), model name
- **Card body:** Assigned issue ID and title, turn counter (e.g., "7/20"), token count, elapsed time, cost so far
- **Card actions:** Kill button
- Color-coded by caste: Oracles blue, Titans amber, Sentinels green
- Cards for completed agents remain visible for 30 seconds before fading

**Command Bar (always visible, fixed at bottom):**
- ⚡ **Direct** mode only in MVP — pattern-matches deterministic commands (scout, implement, review, process, kill, pause, resume, scale, auto on/off, restart, focus, tell, add_learning, reprioritize, summarize)
- Text input field + Enter to submit
- Response area showing command result

### 8.3 Post-MVP Dashboard Features

These are planned for after the MVP dashboard ships:

- **Issue Board:** Kanban-style view (Ready → Scouting → Implementing → Reviewing → Done)
- **Cost & Performance panel:** Recharts line/bar charts for cost over time, cost by caste, token burn rate
- **Event Timeline & Mnemosyne sidebar:** Scrolling event log + filterable learnings list
- **xterm.js agent output:** Click-to-expand full streaming terminal per agent
- **Mode selector:** Steer (Metis), Plan (Prometheus), Ask modes alongside Direct
- **First-run setup wizard**

### 8.4 First-Run Setup

On the first launch (no `.aegis/config.json` present), Olympus shows a setup wizard:
1. API Key Configuration (Anthropic required, others optional)
2. Model Assignment per caste
3. Concurrency Limit slider
4. Prerequisite checks (issue tracker CLI, git)
5. Confirmation → "Start Orchestrating"

---

## 9. Configuration

### 9.1 File: `.aegis/config.json`

```json
{
  "version": 2,
  "runtime": "pi",
  "auth": {
    "anthropic": "sk-ant-...",
    "openai": null,
    "google": null
  },
  "models": {
    "oracle": "claude-haiku-4-5",
    "titan": "claude-sonnet-4-6",
    "sentinel": "claude-sonnet-4-6",
    "metis": "claude-haiku-4-5",
    "prometheus": "claude-sonnet-4-6"
  },
  "concurrency": {
    "max_agents": 3,
    "max_oracles": 2,
    "max_titans": 3,
    "max_sentinels": 1
  },
  "budgets": {
    "oracle_turns": 10,
    "oracle_tokens": 80000,
    "titan_turns": 20,
    "titan_tokens": 300000,
    "sentinel_turns": 8,
    "sentinel_tokens": 100000
  },
  "timing": {
    "poll_interval_seconds": 5,
    "stuck_warning_seconds": 90,
    "stuck_kill_seconds": 150
  },
  "mnemosyne": {
    "max_records": 500,
    "context_budget_tokens": 1000
  },
  "labors": {
    "base_path": ".aegis/labors"
  },
  "olympus": {
    "port": 3847,
    "open_browser": true
  }
}
```

Notable changes from v1:
- `version: 2` (breaking: dispatch state replaces comment conventions)
- `runtime: "pi"` (new: identifies which adapter to use)
- Oracle budgets increased to 10 turns / 80k tokens (structured assessment requires deeper exploration)

### 9.2 File: `.aegis/dispatch-state.json`

See Section 5 for format. Gitignored — runtime state, per-machine.

### 9.3 File: `.aegis/mnemosyne.jsonl`

See Section 6 for format. Committed to git. Shared across the team.

### 9.4 File: Project's `AGENTS.md`

The orchestrator reads the project's existing AGENTS.md (if present) and injects it into every agent's session. The orchestrator does not create or modify this file.

The orchestrator additionally injects caste-specific instructions into each agent's context (see Section 4 prompt templates). These are appended after AGENTS.md content.

### 9.5 `.gitignore` Additions

The orchestrator's `init` command appends to `.gitignore`:

```
.aegis/config.json          # Contains API keys
.aegis/labors/              # Temporary agent workspaces
.aegis/dispatch-state.json  # Runtime dispatch state
```

The learnings file (`.aegis/mnemosyne.jsonl`) is NOT gitignored — it should be committed and shared.

---

## 10. CLI Interface

The orchestrator exposes a minimal CLI for setup and launch. All ongoing interaction happens through Olympus.

```
Usage: aegis <command> [options]

Commands:
  init          Initialize .aegis/ directory and run first-time setup
  start         Start the orchestrator and open Olympus
  status        Print current swarm state to terminal (for scripting)
  stop          Gracefully stop (finish in-flight agents, then exit)

Options for 'start':
  --port <N>            Olympus port (default: 3847)
  --concurrency <N>     Max simultaneous agents (overrides config)
  --model <model>       Default model for all castes (overrides config)
  --no-browser          Don't auto-open Olympus
  --verbose             Print full agent event stream to terminal
```

### 10.1 Launch Sequence

When `aegis start` is executed:

1. Read `.aegis/config.json`. If missing, print error and suggest `aegis init`.
2. Verify issue tracker CLI is in PATH. If missing, print install instructions and exit.
3. Verify issue tracker is initialized in the project. If not, suggest initialization.
4. Verify git repo. If not a git repo, print error and exit (required for Labor isolation).
5. Load dispatch state from `.aegis/dispatch-state.json` and run crash recovery.
6. Start the HTTP server on the configured port.
7. Serve the static Olympus files.
8. Open the browser to `http://localhost:{port}` (unless `--no-browser`).
9. Aegis is now idle in conversational mode, waiting for user commands.
10. Print: "Aegis running at http://localhost:3847 — Ctrl+C to stop"

### 10.2 Graceful Shutdown

On SIGINT (Ctrl+C) or SIGTERM:

1. Stop polling for new work.
2. Inject a steering message to all active agents: "Wrap up your current action and stop."
3. Wait up to 60 seconds for agents to finish.
4. Kill any agents still running after timeout.
5. Mark any `in_progress` issues back to open.
6. Clean up Labors.
7. Save final dispatch state.
8. Print final cost summary to terminal.
9. Exit.

---

## 11. Agent Session Management

### 11.1 Spawning via Runtime Adapter

Each agent is created through the `AgentRuntime` interface:

```typescript
const runtime = getRuntime(config.runtime);  // e.g., PiRuntime

const handle = await runtime.spawn({
  caste,
  cwd: laborPath ?? projectRoot,
  model: casteModel,
  systemPrompt: buildSystemPrompt(caste, issue, learnings, agentsMd),
  tools: casteToolFilter(caste),
});

handle.subscribe((event) => {
  // Forward to dashboard via SSE
  // Track turn count, tokens, tool calls
  // Real-time budget enforcement on turn_end
});

await handle.prompt(initialPrompt);
```

Key decisions:
- **Ephemeral sessions:** Agents are short-lived. Persistent session state is unnecessary since dispatch state and the issue tracker are the durable layers.
- **Tool filtering:** Oracles and Sentinels receive a restricted tool set. Enforced via the adapter, not via prompt instructions alone (defense in depth).
- **Working directory:** Titans get their Labor path. Oracles and Sentinels get the project root.
- **Real-time budget enforcement:** Budget checks run on every `turn_end` event in the subscribe callback, not just during the poll tick. This prevents agents from overshooting their budget between ticks.

### 11.2 Stuck Detection

The monitor tracks each agent's last tool call timestamp. Detection thresholds are configurable:

| Threshold | Action |
|-----------|--------|
| No tool call for `stuck_warning_seconds` (default: 90s) | Inject steering message via `handle.steer()` |
| No tool call for `stuck_kill_seconds` (default: 150s) | Kill via `handle.abort()`. Transition dispatch state to failed. |
| Agent repeats the same tool call 3+ times in a row | Inject steering message suggesting a different approach. |
| Turn budget exceeded | Kill session. |
| Token budget exceeded | Kill session. |

### 11.3 Cost Tracking

The runtime adapter reports token usage via `handle.getStats()`. The orchestrator accumulates these per-agent and per-issue:

```typescript
interface AgentCost {
  agent_id: string;
  caste: "oracle" | "titan" | "sentinel";
  issue_id: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  estimated_cost_usd: number;
  model: string;
}
```

Cost estimation uses per-model pricing tables embedded in the orchestrator. Total cost is the sum across all agents plus any Metis/Prometheus LLM calls. Cumulative cost persists in dispatch state so it survives process restarts.

---

## 12. End-User Installation & Setup

### 12.1 Prerequisites

| Prerequisite | Version | Install |
|-------------|---------|---------|
| Node.js | >= 22.5.0 | https://nodejs.org or `nvm install 22` |
| git | any recent | https://git-scm.com |
| Issue tracker CLI | latest | Depends on tracker (default: Beads `bd`) |

### 12.2 Installation

```bash
npm install -g aegis
```

This installs the orchestrator CLI and all dependencies (including the default runtime adapter packages) globally.

### 12.3 Project Setup

```bash
cd your-project

# Initialize issue tracker (if not already done)
bd init

# Initialize the orchestrator
aegis init
```

The `aegis init` command:
1. Creates `.aegis/` directory
2. If running in a terminal with TTY: runs an interactive setup wizard
3. If running non-interactively: creates a template `config.json` and prints instructions
4. Appends `.aegis/config.json`, `.aegis/labors/`, and `.aegis/dispatch-state.json` to `.gitignore`
5. Creates empty `.aegis/mnemosyne.jsonl`
6. Prints next steps

### 12.4 First Run

```bash
aegis start
```

Opens Olympus in the default browser. If no issues exist, Olympus shows the empty state with guidance.

---

## 13. Post-MVP Roadmap

These features are designed but not yet implemented. See `SPEC-FUTURE.md` for detailed designs of Metis and Prometheus.

### Configurable Dispatch Pipelines

Make the dispatch stage sequence user-configurable instead of hardcoded Oracle → Titan → Sentinel:

```json
"pipelines": {
  "default": ["oracle", "titan", "sentinel"],
  "chore": ["titan"],
  "security": ["oracle", "titan", "sentinel", "security-review"]
}
```

The dispatch state machine walks the configured pipeline for each issue's type. This is a genuine differentiator — every other orchestrator hardcodes their pipeline.

### Mixed-Model Swarms

Different castes on different runtimes in the same swarm. Oracles and Sentinels on local Qwen 2.5 Coder 32B via Ollama (cheap, good enough for read-only analysis). Titans on Claude Sonnet via cloud API. Requires `OllamaRuntime` adapter and uniform budget tracking normalized to USD.

### RAG-Based Mnemosyne Retrieval

Replace keyword-based domain matching with semantic similarity search using local embeddings via Ollama. Activates when the store exceeds ~200 records and keyword filtering becomes unreliable.

### Metis (Layer 2) & Prometheus (Layer 3)

Natural language steering interpreter and strategic planner. See `SPEC-FUTURE.md`.

---

## 14. Glossary

| Term | Definition |
|------|-----------|
| **Aegis** | The orchestrator. Coordinates agents, manages lifecycle, maintains dispatch state, serves Olympus. |
| **Olympus** | The web dashboard. Browser-based UI for monitoring agents, steering the swarm, and tracking costs. |
| **Oracle** | Scout-class agent. Cheap model, read-only tools. Produces a structured `OracleAssessment` with implementation plan, complexity estimate, and go/no-go signal. |
| **Titan** | Worker-class agent. Medium model, full tools. Implements a single issue in an isolated Labor. |
| **Sentinel** | Reviewer-class agent. Strong model, read-only tools. Reviews completed work, produces a pass/fail verdict. |
| **Mnemosyne** | The learnings store. Codebase-specific knowledge accumulated by agents and humans. Stored in `.aegis/mnemosyne.jsonl`. Committed to git. |
| **Lethe** | The pruning mechanism for Mnemosyne. Removes old learnings when the store exceeds its configured budget. |
| **Dispatch State** | Persistent state machine tracking each issue through the Oracle → Titan → Sentinel pipeline. Stored in `.aegis/dispatch-state.json`. Gitignored. |
| **DispatchRecord** | A single record in dispatch state. Tracks stage, Oracle assessment, Sentinel verdict, failure count. |
| **Labor** | A git worktree providing a branch-isolated workspace for a Titan agent. Created on dispatch, merged on completion. |
| **Runtime Adapter** | An implementation of the `AgentRuntime` interface for a specific agent SDK (Pi, Claude Code, Ollama, etc.). |
| **AgentHandle** | The interface through which the orchestrator interacts with a running agent session. Runtime-agnostic. |
| **Layer 1** | The deterministic dispatch loop. No LLM. Polls issues, reads dispatch state, triages, dispatches, monitors, reaps. |
| **Steering** | User commands that adjust Aegis behavior (focus, pause, kill, reprioritize, message agents). |
| **Reap** | The phase where Aegis processes a finished agent: verifies outcomes, transitions dispatch state, merges Labor, reclaims slot. |
| **Turn budget** | Maximum number of LLM ↔ tool round-trips an agent can make before forced termination. |
| **Token budget** | Maximum token expenditure per agent before forced termination. |
| **Prometheus** | Layer 3 strategic planner (post-MVP). Decomposes high-level goals into issues. |
| **Metis** | Layer 2 natural language interpreter (post-MVP). Translates user steering into structured actions. |
