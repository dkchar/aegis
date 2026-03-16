# Product Specification: Aegis — Multi-Agent Swarm Orchestrator for Pi + Beads

**Status:** Pre-implementation design document
**Last updated:** March 2026
**Author:** Human + Claude (collaborative design)

---

## 1. Executive Summary

This document specifies a lightweight, Windows-friendly multi-agent swarm orchestrator that coordinates AI coding agents through two existing open-source systems: **Pi** (a minimal coding agent SDK by Mario Zechner) as the agent runtime, and **Beads** (a git-native issue tracker by Steve Yegge) as the persistent task and memory layer. The orchestrator is shipped as a standalone npm package with Pi embedded as a dependency and Beads as an external system prerequisite.

The core thesis is that orchestration should be a thin, understandable layer — not an application framework. Beads owns task state. Pi owns agent execution. The orchestrator owns dispatch logic, agent lifecycle management, Olympus (a web-based monitoring dashboard), and a natural language steering interface. The entire system should be readable, modifiable, and replaceable by a single developer.

### Design Principles

1. **Pi's philosophy applied to orchestration.** Ship the minimum viable feature set. No feature bloat. The system should fit in one developer's head.
2. **Beads is the single source of truth.** All task state lives in beads. If the orchestrator crashes and restarts, it recovers by reading beads. No in-memory state that can't be reconstructed.
3. **The browser is the primary interface.** No tmux dependency. No terminal UI. Olympus runs in any browser on any OS. The terminal is just the orchestrator's log output.
4. **LLMs are expensive — use them only where they add value.** The dispatch loop is deterministic. The steering interpreter uses a cheap model. The strategic planner uses an expensive model only on explicit request. Agents are tiered by cost to match task complexity.
5. **Windows-first design.** Git Bash, PowerShell, and cmd are all valid launch environments. Pi's TUI limitations on Windows are irrelevant because the orchestrator uses Pi's SDK, not its CLI.

---

## 2. System Architecture

### 2.1 High-Level Component Diagram

```
┌─────────────────────────────────────────────────────┐
│                 Olympus (Web Dashboard)                   │
│             (React + Tailwind + xterm.js)            │
│                                                      │
│  ┌──────────────┐ ┌──────────┐ ┌───────┐ ┌───────┐ │
│  │ Command Bar  │ │ Agents   │ │ Beads │ │ Cost/ │ │
│  │ (NL + modes) │ │ Overview │ │ Board │ │Charts │ │
│  └──────┬───────┘ └──────────┘ └───────┘ └───────┘ │
│         │               ↑ SSE                        │
└─────────┼───────────────┼────────────────────────────┘
          │               │
          ▼               │
┌─────────────────────────────────────────────────────┐
│                  Aegis (Node.js)                         │
│                                                      │
│  Prometheus: Strategic Planner (Opus/Sonnet, on-demand)│
│  Metis: NL Interpreter        (Haiku, per-command)    │
│  Layer 1: Deterministic Loop (no LLM, continuous)    │
│                                                      │
│  ┌──────────┐ ┌───────────┐ ┌───────────────────┐   │
│  │ Spawner  │ │ Monitor   │ │ Mnemosyne         │   │
│  │ (Pi SDK  │ │ (budgets, │ │ (.aegis/          │   │
│  │  + git  │ │  stuck    │ │  mnemosyne.jsonl) │   │
│  │  labor) │ │  detect,  │ │                   │   │
│  │          │ │  kill)    │ │                   │   │
│  └────┬─────┘ └─────┬────┘ └───────────────────┘   │
└───────┼─────────────┼───────────────────────────────┘
        │             │
   ┌────┴────┐   ┌────┴────┐
   │ Pi SDK  │   │  Beads  │
   │sessions │   │  (bd)   │
   └─────────┘   └─────────┘
```

### 2.2 Dependency Topology

The orchestrator has two categories of dependencies:

**Embedded (installed via npm, invisible to end users):**
- `@mariozechner/pi-ai` — Unified multi-provider LLM API
- `@mariozechner/pi-agent-core` — Agent loop with tool calling and state management
- `@mariozechner/pi-coding-agent` — Full coding agent runtime (read, write, edit, bash tools, session persistence, compaction)

These are the same packages that power OpenClaw. The end user never installs Pi separately, never interacts with Pi's TUI, and never configures `~/.pi/agent/`. The orchestrator imports `createAgentSession()` and manages everything programmatically.

**External (must be installed on the system):**
- `bd` (beads CLI) — Go binary, installed via curl/PowerShell one-liner or Homebrew. Required for task state management. Cannot be bundled as an npm dependency.
- `git` — Required for worktree-based agent isolation.
- `Node.js >= 22.5.0` — Runtime for the orchestrator and Pi SDK.

### 2.3 Data Flow

```
User creates beads issues (manually or via planner)
         │
         ▼
    bd ready --json ← Orchestrator polls every N seconds
         │
         ▼
    Triage: what does this issue need?
    ├── Unscouted → dispatch Oracle (cheap model, read-only)
    ├── Scouted + ready → dispatch Titan (medium model, full tools)
    └── Closed + unreviewed → dispatch Sentinel (strong model, read-only)
         │
         ▼
    Pi SDK createAgentSession()
    Agent runs in Labor (git worktree) with caste-specific config
         │
         ├── Agent calls bd create → new beads issues discovered
         ├── Agent calls bd update → claims/closes issues
         ├── Agent writes learnings → .aegis/mnemosyne.jsonl
         │
         ▼
    Agent finishes or is killed
    Orchestrator verifies beads state, reclaims slot
    Back to polling
```

---

## 3. The Three-Layer Orchestration Model

### 3.1 Layer 1: Deterministic Dispatch (No LLM)

This is the orchestrator's heartbeat. It runs continuously on a configurable interval (default: 5 seconds) and never makes an LLM call.

**The loop:**

```
POLL → TRIAGE → DISPATCH → MONITOR → REAP → POLL
```

**POLL:** Execute `bd ready --json`. Parse the result into a list of ready issues. Diff against the set of currently running agents to identify new work.

**TRIAGE:** For each new ready issue, apply deterministic rules:

| Condition | Action |
|-----------|--------|
| Issue has no oracle comment | Dispatch an Oracle |
| Issue has oracle comment, status is open/ready | Dispatch a Titan |
| Issue status is closed, no sentinel comment | Dispatch a Sentinel |
| Issue status is closed with passing review | Skip (complete) |
| Concurrency limit reached | Queue, dispatch when slot frees |

"Oracle comment" and "sentinel comment" are identified by convention — scouts and Sentinels write `bd comment <id> "SCOUTED: ..."` or `bd comment <id> "REVIEWED: ..."` as their final action. The orchestrator greps for these prefixes.

**DISPATCH:** Create a Pi agent session via the SDK with caste-appropriate configuration (see Section 4). Set the agent's working directory to a Labor (git worktree). Inject the beads issue details + relevant learnings into the initial prompt.

**MONITOR:** Subscribe to each agent session's event stream. Track turn count, token usage, elapsed time, and tool call activity. Forward events to Olympus via SSE.

**REAP:** When an agent finishes (session ends or turn/token budget exceeded):
- Verify beads state matches expected outcome (Titan should have closed the issue, Oracle should have left a comment, etc.)
- If the agent failed or was killed: mark the issue back to open, record a failure learning
- Clean up the Labor
- Reclaim the concurrency slot

**Active priority filtering:** Layer 1 maintains an optional priority filter set by the user via steering (e.g., "focus on auth issues"). When active, only issues matching the filter are dispatched. This is a simple text match on issue title/description — no LLM needed.

### 3.2 Metis: Natural Language Interpreter (Haiku)

This layer activates only when the user sends a message through Olympus's command bar in Steer or Ask mode. It translates natural language intent into structured actions that Layer 1 can execute.

**Model:** Claude Haiku (or equivalent cheap/fast model). Target cost: < $0.001 per interaction.

**System prompt (~500 tokens):** Describes the orchestrator's available actions as a JSON schema. Includes current swarm state summary (active agents, beads queue size, active filters). Instructs the model to output a JSON array of actions.

**Available action types:**

```typescript
type SteerAction =
  | { type: "pause" }
  | { type: "resume" }
  | { type: "scale", concurrency: number }
  | { type: "focus", filter: string }  // text match on issues
  | { type: "clear_focus" }
  | { type: "rush", issue_id: string }  // bypass Oracle, dispatch Titan immediately
  | { type: "kill", agent_id: string }
  | { type: "restart", issue_id: string }
  | { type: "tell_agent", agent_id: string, message: string }
  | { type: "tell_all", message: string }  // steering message to all active agents
  | { type: "add_learning", domain: string, text: string }
  | { type: "dispatch_oracle", target: string, note: string }
  | { type: "reprioritize", issue_id: string, priority: number }
  | { type: "summarize" }  // read-only, return status summary
  | { type: "noop", explanation: string }  // understood but no action needed
```

**Example interactions:**

| User input | Mode | Interpreted actions |
|------------|------|-------------------|
| "the auth module seems like a mess" | Steer | `dispatch_oracle` for auth + `add_learning` |
| "kill that stuck worker" | Steer | `kill` (identifies stuck agent from context) |
| "let's wrap up for today" | Steer | `pause` |
| "how's it going?" | Ask | `summarize` (no state changes) |
| "scale up, there's a lot of work" | Steer | `scale` with increased concurrency |
| "stop touching package.json" | Steer | `tell_all` with the instruction |

The interpreter LLM call includes the current swarm state (list of active agents, their issue assignments, queue depth) so it can resolve references like "that stuck worker" to a specific agent ID.

### 3.3 Prometheus: Strategic Planner (Sonnet/Opus)

This layer activates only when the user sends a message in Plan mode. It is the most expensive operation and runs at most once per invocation.

**Model:** Claude Sonnet 4.6 by default, Opus 4.6 available for complex planning. Configurable.

**Purpose:** Decompose high-level goals into concrete beads issues with dependency chains. The planner has access to:
- The user's input (PRD, feature description, refactoring goal, etc.)
- A codebase summary (generated by an oracle or read from a pre-existing overview file)
- Current beads state (`bd list --json`)
- The learnings store

**Output:** The planner's response is parsed into `bd create` and `bd update` commands that the orchestrator executes directly. The planner does not dispatch agents — it populates beads, and Layer 1's normal polling picks up the new issues.

**Example:** User types in Plan mode: "We need to migrate from REST to GraphQL for the user service."

The planner reads the codebase, understands the current REST implementation, and emits a series of beads issues: "Define GraphQL schema for User type" (P1), "Create resolvers for user queries" (P1, blocked by schema), "Create resolvers for user mutations" (P2, blocked by schema), "Update client to use GraphQL" (P2, blocked by resolvers), "Remove old REST endpoints" (P3, blocked by client update), "Update integration tests" (P2, blocked by resolvers). Layer 1 sees the new issues on its next poll and begins dispatching oracles.

---

## 4. Agent Castes

### 4.1 Overview

| Caste | Model Tier | Default Model | Tools | Turn Budget | Token Budget | Purpose |
|-------|-----------|---------------|-------|-------------|-------------|---------|
| Oracle | Cheap | claude-haiku-4-5 | read, bash (read-only), bd | 5 | 50k | Explore, assess, discover work |
| Titan | Medium | claude-sonnet-4-6 | read, write, edit, bash, bd | 20 | 300k | Implement a single beads issue |
| Sentinel | Strong | claude-sonnet-4-6 | read, bash (read-only), bd | 8 | 100k | Review completed work, create fix issues |

Model assignments are configurable globally and per-caste via Olympus settings or the `.aegis/config.json` file.

### 4.2 Oracle Agents

**Trigger:** A beads issue enters the ready queue with no oracle comment.

**Tool restrictions:** Oracles cannot modify the codebase. Their bash access is restricted to non-destructive commands (ls, cat, find, grep, rg, git log, git diff, bd commands). This is enforced by the orchestrator injecting a tool filter into the Pi session configuration.

**Initial prompt template:**
```
You are an Oracle agent. Your job is to explore and assess, not implement.

ISSUE: {issue_title}
DESCRIPTION: {issue_description}
PRIORITY: {issue_priority}

LEARNINGS (relevant to this domain):
{filtered_learnings}

INSTRUCTIONS:
1. Run `bd show {issue_id} --json` for full issue details
2. Explore the relevant parts of the codebase
3. Assess complexity and identify files that will need changes
4. If you discover additional work needed, create beads issues: `bd create "description" -p N -t type`
5. Set dependency relationships if applicable: `bd update <new-id> --blocked-by {issue_id}`
6. Write your assessment as a comment: `bd comment {issue_id} "SCOUTED: <your assessment>"`

Do NOT modify any files. Do NOT write code. Explore and report only.
```

**Completion criteria:** The orchestrator checks for a comment starting with "SCOUTED:" on the issue. If present, the oracle succeeded. If the oracle hit its turn budget without leaving a comment, the orchestrator logs a failure and re-queues for another oracle attempt.

### 4.3 Titan Agents

**Trigger:** A beads issue has a oracle comment and is in the ready queue (all dependencies resolved).

**Tool access:** Full — read, write, edit, bash, and bd commands. Titans operate in an isolated Labor (see Section 6).

**Initial prompt template:**
```
You are a Titan agent. Implement the assigned beads issue.

ISSUE: {issue_title} ({issue_id})
DESCRIPTION: {issue_description}
ORACLE ASSESSMENT: {scout_comment}

LEARNINGS (relevant to this domain):
{filtered_learnings}

INSTRUCTIONS:
1. Claim the issue: `bd update {issue_id} --claim`
2. Read the Oracle assessment and relevant code
3. Implement the change
4. Run tests: {test_command from AGENTS.md or default}
5. If tests pass, commit your changes with a descriptive message
6. Close the issue: `bd close <id> --reason "Done"`
7. If you discover additional work needed during implementation, create beads issues
8. Record any learnings: conventions discovered, gotchas encountered, patterns worth remembering

If tests fail, fix and retry. Do NOT close the issue until tests pass.
Do NOT work on other issues. Focus on {issue_id} only.
```

**Completion criteria:** The orchestrator checks that the beads issue status is `closed`. If the titan finished without closing, the issue is marked back to open and logged as a failure. The git worktree is merged back (see Section 6: Labors).

### 4.4 Sentinel Agents

**Trigger:** A beads issue status is `closed` but has no sentinel comment.

**Tool restrictions:** Same as scouts — read-only access. Cannot modify code.

**Initial prompt template:**
```
You are a Sentinel agent. Review completed work for correctness and quality.

ISSUE: {issue_title} ({issue_id})
DESCRIPTION: {issue_description}
ORACLE ASSESSMENT: {scout_comment}

INSTRUCTIONS:
1. Read the issue description and oracle assessment to understand intent
2. Examine the changes made (use git diff against the base branch)
3. Check that tests cover the change
4. Check for obvious bugs, security issues, and code quality problems
5. If the work is acceptable:
   `bd comment {issue_id} "REVIEWED: PASS - <brief summary>"`
6. If issues are found:
   - Create beads issues for each problem: `bd create "Fix: <problem>" -p 2 -t bug`
   - Link them: `bd update <fix-id> --blocked-by {issue_id}`
   - `bd comment {issue_id} "REVIEWED: FAIL - <summary of problems found>"`

Be thorough but proportional. Minor style issues are not worth failing a review.
```

**Completion criteria:** The orchestrator checks for a comment starting with "REVIEWED:". If PASS, the issue is considered fully complete. If FAIL, the new fix issues will enter the ready queue and be processed normally.

---

## 5. Mnemosyne: Learnings Store (Simplified Mulch)

### 5.1 Design Rationale

Mulch (from the os-eco project) solves a real problem — agents start every session from zero — but overbuilds the solution with six record types, three classification tiers, Ajv schema validation, advisory file locks, and a full programmatic API. Our implementation collapses this to a single JSONL file managed by the orchestrator.

### 5.2 Storage Format

File location: `.aegis/mnemosyne.jsonl` (in the project root, committed to git).

Each line is a JSON record:

```json
{
  "id": "l-a1b2c3",
  "type": "convention | pattern | failure",
  "domain": "string (e.g., 'testing', 'auth', 'components')",
  "text": "Human-readable description of the learning",
  "source": "agent-N | human | planner",
  "issue": "bd-XXXX | null",
  "ts": 1741500000
}
```

Three record types only:
- **convention** — "Always do X in this project" (e.g., "use barrel exports")
- **pattern** — "This codebase does X this way" (e.g., "auth uses refresh tokens stored in httpOnly cookies")
- **failure** — "X doesn't work / causes problems" (e.g., "jest.mock doesn't work with ESM imports in this project")

### 5.3 Reading Learnings

When the orchestrator builds an agent's initial prompt, it loads learnings relevant to the agent's assigned issue:

1. Parse all records from the JSONL file
2. Filter by domain if the issue has identifiable domain tags (extracted from title/description keywords)
3. Sort by timestamp descending (newest first)
4. Truncate to a configurable token budget (default: 1000 tokens)
5. Inject into the agent's prompt as a "LEARNINGS" section

If no domain match is found, include the N most recent learnings regardless of domain (they're likely still relevant for general project conventions).

### 5.4 Writing Learnings

Agents record learnings in two ways:

1. **Via bash during their session:** The agent's prompt instructs it to record learnings. It runs a command like `echo '{"type":"convention","domain":"testing","text":"Always mock fs in unit tests"}' >> .aegis/mnemosyne.jsonl`. The orchestrator post-processes this on reap to add `id`, `source`, `issue`, and `ts` fields.

2. **Via Olympus command bar:** The user types a learning in any mode, and Metis interprets it as an `add_learning` action. The orchestrator writes it directly.

### 5.5 Lethe: Pruning

When the JSONL file exceeds a configurable size (default: 500 records), the orchestrator prunes on a recency basis — oldest records are removed first, with `convention` type records given 2x longevity (they're more likely to remain relevant). Pruning runs as a background task during the REAP phase.

---

## 6. Labors: Git Worktree Isolation

### 6.1 Rationale

Multiple Titan agents editing the same repository simultaneously will create conflicts. Git worktrees provide lightweight, branch-based isolation without cloning the entire repo.

### 6.2 Labor Lifecycle

**Creation (during DISPATCH for workers only):**
```bash
git worktree add .aegis/labors/agent-{N} -b aegis/{issue_id}
```
This creates a new directory at `.aegis/labors/agent-{N}` with a checkout on a new branch named `aegis/{issue_id}`, branching from the current HEAD.

The Titan agent's session is configured with this Labor directory as its working directory. The Titan operates on its own branch in its own directory, fully isolated from other agents.

Oracles and Sentinels do not need Labors — they are read-only and operate on the main working directory.

**Merge (during REAP for completed workers):**
```bash
git checkout main  # or whatever the primary branch is
git merge aegis/{issue_id} --no-edit
```

If the merge succeeds cleanly, the orchestrator proceeds to cleanup. If there are conflicts:
1. Abort the merge: `git merge --abort`
2. Create a beads issue: `bd create "Merge conflict: aegis/{issue_id}" -p 1 -t bug`
3. Preserve the Labor and branch for manual resolution or a future agent attempt
4. Log the conflict details to the event timeline

**Cleanup (after successful merge):**
```bash
git worktree remove .aegis/labors/agent-{N}
git branch -d aegis/{issue_id}
```

### 6.3 Windows Compatibility

Git worktrees are a core git feature and work identically on Windows. The orchestrator must:
- Use forward slashes in paths passed to git commands (git handles this on Windows)
- Handle both forward-slash and backslash paths in git output parsing
- Use `path.posix.join` or normalize paths when constructing worktree directories

---

## 7. Olympus Dashboard

### 7.1 Technology Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Framework | React 18+ | Component model for complex interactive UI |
| Styling | Tailwind CSS | Utility-first, fast iteration, consistent design |
| Charts | Recharts | Lightweight, React-native charting |
| Terminal output | xterm.js | Industry-standard terminal emulator for browsers |
| Real-time data | Server-Sent Events (SSE) | Simpler than WebSocket for one-directional server→client streaming, auto-reconnects |
| Build | Vite | Fast dev server with HMR, small production bundle |
| Serving | Static files from orchestrator's HTTP server | No separate frontend server needed; Vite builds to a `dist/` directory that the orchestrator serves |

Olympus is bundled as static assets inside the npm package. On `aegis start`, the Node.js HTTP server serves both the API endpoints (for SSE, REST commands) and the static Olympus files. The user's browser connects to `http://localhost:{port}`.

### 7.2 Dashboard Layout

Olympus is a single-page application with a persistent top bar and four main panels arranged in a responsive grid.

**Top Bar:**
- Orchestrator status indicator (running / paused / error)
- Global stats: active agents, total cost, uptime, beads queue depth
- Settings gear icon → opens config overlay (API keys, model assignments, concurrency limits)

**Command Bar (always visible, fixed at bottom or top):**
- Mode selector dropdown on the left:
  - 💬 **Steer** — routes to Metis (Haiku interpreter → structured actions)
  - 📋 **Plan** — routes to Prometheus (Sonnet/Opus → beads issue generation)
  - 🔍 **Ask** — routes to read-only Haiku call (summarize state, no actions taken)
  - ⚡ **Direct** — bypasses LLM, pattern-matches deterministic commands for instant execution (kill, pause, scale, restart)
- Text input field
- Send button / Enter to submit
- Response area below the input showing the orchestrator's interpretation and actions taken

Each mode implicitly selects the cost tier and model. The user never needs to choose a model directly — the mode implies it.

### 7.3 Panel: Swarm Overview

The primary panel. Shows a card for each active agent:

- **Card header:** Agent ID, caste badge (Oracle/Titan/Sentinel), model name
- **Card body:** Assigned beads issue ID and title, turn counter (e.g., "7/20"), token count, elapsed time, cost so far
- **Card footer:** Mini-terminal showing last 3-5 tool calls and their results (collapsed by default)
- **Click to expand:** Full streaming terminal output via xterm.js, showing the agent's complete session in real-time
- **Card actions:** Kill button, send steering message button

Cards are color-coded by caste: Oracles are blue/cool tones, Titans are amber/warm tones, Sentinels are green/neutral tones. Cards pulse gently when the agent is actively making tool calls, and dim when idle.

Cards for recently completed agents remain visible for 30 seconds with a completion indicator (checkmark or X) before fading out, so the user can see what just finished.

### 7.4 Panel: Beads Board

A kanban-style view of the beads issue lifecycle:

**Columns:** Ready → Divining → Forging → Sentinel Review → Done

Each issue card shows: ID, title, priority badge, type badge (task/bug/feature), and an indicator of which agent (if any) is currently assigned.

Dependency lines are drawn between cards where `blocked-by` relationships exist. Blocked issues appear grayed out in the Ready column with a lock icon.

Clicking an issue card opens a detail overlay showing: full description, all comments (including oracle assessments and review results), dependency graph, and which agents have worked on it.

The board auto-updates via SSE as agents change issue states.

### 7.5 Panel: Cost & Performance

A secondary panel (collapsible) with Recharts-powered visualizations:

- **Running cost:** Line chart of cumulative cost over time
- **Cost by caste:** Stacked bar chart showing spend per caste (Oracle vs Titan vs Sentinel)
- **Token burn rate:** Line chart of tokens/minute over time
- **Per-issue cost:** Table showing cost attributed to each beads issue (sum of all agents that touched it)

### 7.6 Panel: Event Timeline & Mnemosyne

A combined sidebar (collapsible) with two tabs:

**Event Timeline tab:** Scrolling log of all orchestrator events with timestamps:
- Agent spawned / completed / killed
- Issue state changes
- Merge successes and conflicts
- Steering commands and their interpretations
- Errors and warnings

**Mnemosyne tab:** List of all entries in `.aegis/mnemosyne.jsonl`, filterable by domain and type. Each entry shows source (which agent or "human"), associated issue, and timestamp. A text input at the top allows adding new learnings directly.

### 7.7 First-Run Setup

On the first launch (no `.aegis/config.json` present), Olympus shows a setup wizard instead of the main UI:

1. **API Key Configuration:** Input fields for Anthropic API key (required) and optionally OpenAI, Google, etc. Keys are stored in `.aegis/config.json` with restrictive file permissions (0600). These are passed to Pi's SDK auth layer.
2. **Model Assignment:** Dropdowns for each caste's default model, pre-populated with sensible defaults.
3. **Concurrency Limit:** Slider for max simultaneous agents (default: 3).
4. **Beads Check:** Verifies `bd` is installed and `.beads/` exists in the project. If not, shows install instructions.
5. **Git Check:** Verifies git is available and the project is a git repo.
6. **Confirmation:** Summary of settings, "Start Orchestrating" button.

After first run, settings are accessible via the gear icon in the top bar.

---

## 8. Configuration

### 8.1 File: `.aegis/config.json`

```json
{
  "version": 1,
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
    "oracle_turns": 5,
    "oracle_tokens": 50000,
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

### 8.2 File: `.aegis/mnemosyne.jsonl`

See Section 5 for format. Committed to git. Shared across the team.

### 8.3 File: Project's `AGENTS.md`

The orchestrator reads the project's existing AGENTS.md (if present) and injects it into every agent's session. This is standard Pi/Claude Code behavior. The orchestrator does not create or modify this file — it's the developer's responsibility.

The orchestrator additionally injects beads-specific instructions into each agent's context (see Section 4 prompt templates). These are appended after the project's AGENTS.md content.

### 8.4 `.gitignore` Additions

The orchestrator's `init` command appends to `.gitignore`:

```
.aegis/config.json    # Contains API keys
.aegis/labors/     # Temporary agent workspaces
```

The learnings file (`.aegis/mnemosyne.jsonl`) is NOT gitignored — it should be committed and shared.

---

## 9. CLI Interface

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

### 9.1 Launch Sequence

When `aegis start` is executed:

1. Read `.aegis/config.json`. If missing, print error and suggest `aegis init`.
2. Verify `bd` is in PATH. If missing, print install instructions and exit.
3. Verify `.beads/` exists. If missing, suggest `bd init`.
4. Verify git repo. If not a git repo, print error and exit (required for Labor isolation).
5. Start the HTTP server on the configured port.
6. Serve the static Olympus files.
7. Open the browser to `http://localhost:{port}` (unless `--no-browser`).
8. Begin the Layer 1 polling loop.
9. Print a one-line status to the terminal: "Aegis running at http://localhost:3847 — Ctrl+C to stop"

### 9.2 Graceful Shutdown

On SIGINT (Ctrl+C) or SIGTERM:

1. Stop polling for new work.
2. Inject a steering message to all active agents: "Wrap up your current action and stop."
3. Wait up to 60 seconds for agents to finish.
4. Kill any agents still running after timeout.
5. Mark any `in_progress` beads issues back to open.
6. Clean up Labors.
7. Print final cost summary to terminal.
8. Exit.

---

## 10. Agent Session Management

### 10.1 Spawning via Pi SDK

Each agent is created using Pi's embedded SDK:

```typescript
import {
  createAgentSession,
  SessionManager,
  AuthStorage,
  ModelRegistry,
} from "@mariozechner/pi-coding-agent";
import { getModel } from "@mariozechner/pi-ai";

// Build auth storage: file-backed so Pi subscription tokens (~/.pi/agent/auth.json)
// are discovered automatically; explicit API keys from config override at runtime.
const authStorage = AuthStorage.create(join(agentDir, "auth.json"));
if (config.auth.anthropic) authStorage.setRuntimeApiKey("anthropic", config.auth.anthropic);

const modelRegistry = new ModelRegistry(authStorage);
const model = getModel("anthropic", casteModel);  // e.g. "claude-sonnet-4-6"

const { session } = await createAgentSession({
  cwd: worktreePath ?? projectRoot,  // Titan gets Labor path; Oracle/Sentinel get project root
  agentDir,                          // ~/.pi/agent — Pi loads extensions from here
  sessionManager: SessionManager.inMemory(),  // No persistent sessions needed
  authStorage,
  modelRegistry,
  model,
  tools: casteToolFilter(caste),     // Restrict tools per caste
  systemPrompt: buildSystemPrompt(caste, issue, learnings, agentsMd),
});

session.subscribe((event) => {
  // Forward to dashboard via SSE
  // Track turn count, tokens, tool calls
  // Detect stuck agents
});

await session.prompt(buildInitialPrompt(caste, issue));
```

Key decisions:
- **In-memory sessions:** Agents are ephemeral. We don't need Pi's JSONL session persistence since beads is the persistent state. This keeps overhead minimal.
- **Auth storage:** The orchestrator uses `AuthStorage.create(agentDir + "/auth.json")` so Pi subscription tokens written by `/login` are discovered automatically. Explicit API keys from `.aegis/config.json` are applied as runtime overrides via `setRuntimeApiKey()` — they take highest priority but are never written to disk.
- **Tool filtering:** Oracles and Sentinels receive a restricted tool set. This is configured via Pi's session options, not via prompt instructions alone (defense in depth).
- **Working directory (`cwd`):** Titans get their git Labor path. Oracles and Sentinels get the project root. The parameter is `cwd`, not `workingDirectory`.

### 10.2 Stuck Detection

The monitor tracks each agent's last tool call timestamp. Detection thresholds are configurable:

| Threshold | Action |
|-----------|--------|
| No tool call for `stuck_warning_seconds` (default: 90s) | Inject steering message: "You appear stuck. Summarize your current state and what's blocking you." |
| No tool call for `stuck_kill_seconds` (default: 150s) | Kill the session. Mark beads issue back to open. Log failure. |
| Agent repeats the same tool call 3+ times in a row | Inject steering message: "You're repeating the same action. Try a different approach." |
| Turn budget exceeded | Session auto-terminates (Pi SDK enforced). |
| Token budget exceeded | Orchestrator kills session. |

### 10.3 Cost Tracking

Pi's SDK emits token usage events with each LLM response. The orchestrator accumulates these per-agent and per-issue:

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

Cost estimation uses per-model pricing tables embedded in the orchestrator (updated with package releases). Total cost is the sum across all agents plus any Metis/Prometheus LLM calls for steering and planning.

---

## 11. End-User Installation & Setup

### 11.1 Prerequisites

| Prerequisite | Version | Install |
|-------------|---------|---------|
| Node.js | >= 22.5.0 | https://nodejs.org or `nvm install 22` |
| git | any recent | https://git-scm.com |
| Beads (`bd`) | latest | `irm https://raw.githubusercontent.com/steveyegge/beads/main/install.ps1 \| iex` (Windows) or `curl -fsSL https://raw.githubusercontent.com/steveyegge/beads/main/scripts/install.sh \| bash` (macOS/Linux) |

### 11.2 Installation

```bash
npm install -g aegis
```

This installs the orchestrator CLI and all dependencies (including Pi SDK packages) globally. No separate Pi installation needed.

### 11.3 Project Setup

```bash
cd your-project

# Initialize beads (if not already done)
bd init

# Initialize the orchestrator
aegis init
```

The `aegis init` command:
1. Creates `.aegis/` directory
2. If running in a terminal with TTY: runs an interactive setup wizard (API keys, model selection, concurrency)
3. If running non-interactively: creates a template `config.json` with placeholder API key and prints instructions
4. Appends `.aegis/config.json` and `.aegis/labors/` to `.gitignore`
5. Creates an empty `.aegis/mnemosyne.jsonl`
6. Prints next steps

### 11.4 First Run

```bash
aegis start
```

Opens Olympus in the default browser. If no beads issues exist, Olympus shows the empty state with a prompt: "Create some beads issues to get started, or use Plan mode to decompose a goal."

---

## 12. Glossary

| Term | Definition |
|------|-----------|
| **Aegis** | The orchestrator. The top-level system that coordinates all agents, manages lifecycle, and serves Olympus. |
| **Olympus** | The web dashboard. The browser-based UI for monitoring agents, viewing beads state, steering the swarm, and tracking costs. |
| **Oracle** | Scout-class agent. Cheap model, read-only tools. Explores the codebase, assesses issues, discovers new work. |
| **Titan** | Worker-class agent. Medium model, full tools. Implements a single beads issue in an isolated Labor. |
| **Sentinel** | Reviewer-class agent. Strong model, read-only tools. Reviews completed work, creates fix issues if problems found. |
| **Prometheus** | Layer 3 strategic planner. Sonnet/Opus-class LLM. Decomposes high-level goals into beads issues. On-demand only. |
| **Metis** | Layer 2 natural language interpreter. Haiku-class LLM. Translates user steering into structured actions. |
| **Mnemosyne** | The learnings store. Project-specific knowledge accumulated by agents and humans. Stored in `.aegis/mnemosyne.jsonl`. |
| **Lethe** | The pruning mechanism for Mnemosyne. Removes old learnings when the store exceeds its configured budget. |
| **Labor** | A git worktree providing a branch-isolated workspace for a Titan agent. Created on dispatch, merged on completion. |
| **Beads** | Steve Yegge's git-native issue tracker. The single source of truth for all task state. External dependency. |
| **Pi SDK** | The `@mariozechner/pi-coding-agent` npm package. Provides `createAgentSession()` for programmatic agent creation. Embedded dependency. |
| **Layer 1** | The deterministic dispatch loop. No LLM. Runs continuously. Polls beads, triages, dispatches, monitors, reaps. |
| **Steering** | User commands that adjust Aegis behavior (focus, pause, kill, reprioritize, message agents). Interpreted by Metis. |
| **Reap** | The phase where Aegis processes a finished agent: verifies outcomes, merges Labor, reclaims concurrency slot. |
| **Turn budget** | Maximum number of LLM ↔ tool round-trips an agent can make before forced termination. |
| **Token budget** | Maximum token expenditure per agent before forced termination. |
