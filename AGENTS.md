# Agent Instructions

This project uses **bd** (beads) for issue tracking. Run `bd onboard` to get started.

## Project Overview

**Aegis** is a multi-agent swarm orchestrator built on Pi (coding agent SDK) and Beads (git-native issue tracker). Read `SPEC.md` for the full product specification. All architectural decisions must align with it.

### Key Architecture

- **Aegis** — The orchestrator. Node.js process with three layers: deterministic dispatch (Layer 1), Metis NL interpreter (Layer 2), Prometheus strategic planner (Layer 3).
- **Olympus** — React web dashboard served from Aegis's HTTP server. The primary user interface.
- **Oracles** — Scout agents. Cheap model, read-only. Explore and assess.
- **Titans** — Worker agents. Medium model, full tools. Implement beads issues in isolated Labors (git worktrees).
- **Sentinels** — Reviewer agents. Strong model, read-only. Review completed work.
- **Mnemosyne** — Learnings store (`.aegis/mnemosyne.jsonl`). Accumulated project knowledge.
- **Lethe** — Pruning mechanism for Mnemosyne.
- **Labors** — Git worktrees providing branch-isolated workspaces for Titan agents. Oracles and Sentinels do NOT use Labors — they operate read-only on the project root.

### Tech Stack

- TypeScript (strict mode, ES modules)
- Node.js >= 22.5.0
- Pi SDK (`@mariozechner/pi-ai`, `@mariozechner/pi-agent-core`, `@mariozechner/pi-coding-agent`)
- React 18+ with Tailwind CSS, Recharts, xterm.js (Olympus dashboard)
- Vite (dashboard build)
- Beads (`bd` CLI) for issue tracking
- Git worktrees for agent isolation

---

## Non-Interactive Shell Commands

**ALWAYS use non-interactive flags** with file operations to avoid hanging on confirmation prompts.

```bash
cp -f source dest           # NOT: cp source dest
mv -f source dest           # NOT: mv source dest
rm -f file                  # NOT: rm file
rm -rf directory            # NOT: rm -r directory
```

---

## Issue Tracking with bd (beads)

**IMPORTANT**: This project uses **bd (beads)** for ALL issue tracking. Do NOT use markdown TODOs, task lists, or other tracking methods.

### Quick Reference

```bash
bd ready --json             # Find unblocked work
bd show <id> --json         # View issue details
bd create "Title" --description="Details" -t task -p 1 --json
bd update <id> --claim --json
bd close <id> --reason "Done" --json
```

### Issue Types

- `bug` — Something broken
- `feature` — New functionality
- `task` — Work item (tests, docs, refactoring)
- `epic` — Large feature with subtasks
- `chore` — Maintenance (dependencies, tooling)

### Priorities

- `0` — Critical (broken builds, data loss)
- `1` — High (core features, important bugs)
- `2` — Medium (default)
- `3` — Low (polish, optimization)
- `4` — Backlog (future ideas)

### Workflow

1. Check ready work: `bd ready --json`
2. Claim your task: `bd update <id> --claim --json`
3. Implement, test, document
4. Discover new work? Create a linked issue:
   `bd create "Found issue" --description="Details" -p 1 --deps discovered-from:<parent-id> --json`
5. Complete: `bd close <id> --reason "Done" --json`

### Rules

- Always use `--json` flag for programmatic use
- Link discovered work with `discovered-from` dependencies
- Check `bd ready` before asking "what should I work on?"
- Do NOT create markdown TODO lists or external trackers

### Orchestrator Comment Conventions

The Aegis dispatch loop (Layer 1) uses comment prefixes to determine issue state and what to do next. These are **load-bearing conventions** — the orchestrator greps for them.

- **`SCOUTED:`** — Written by Oracle agents as their final action. Signals that an issue has been assessed and is ready for a Titan. Example: `bd comment <id> "SCOUTED: Config module is straightforward, ~50 lines, no deps beyond node:fs"`
- **`REVIEWED:`** — Written by Sentinel agents after reviewing completed work. Must start with `REVIEWED: PASS` or `REVIEWED: FAIL`. Example: `bd comment <id> "REVIEWED: PASS - Tests cover all branches, clean implementation"`

If you are building or modifying the poller/triage logic, these prefixes are how Layer 1 decides whether to dispatch an Oracle, Titan, or Sentinel for a given issue.

### Issue Statuses

Beads issues move through these statuses: `open`, `ready`, `in_progress`, `closed`. The triage logic depends on these being consistent — do not invent custom statuses.

---

## Git Workflow

### Branch Strategy

This project uses a **trunk-based workflow with worktree isolation**.

- `main` — The stable trunk. Agents never commit directly to main.
- `aegis/<issue-id>` — Feature branches created per beads issue. Each Titan works in a Labor (git worktree) on one of these branches.

### For Agents Working in a Labor (Worktree)

**Applies to Titan agents only.** Oracles and Sentinels work directly on the project root — they are read-only and do not use Labors.

If you are running inside a Labor directory (`.aegis/labors/`):

1. **Commit to your branch frequently.** Small, atomic commits with descriptive messages.
2. **Do NOT push to remote.** The orchestrator handles merging and the human handles pushing.
3. **Do NOT switch branches.** Stay on the branch you were given.
4. **Do NOT modify files outside your working directory.**
5. **Run tests before closing your issue.** Only close if tests pass.

```bash
# Good: commit your work
git add -A
git commit -m "feat: implement poller module for beads ready queue"

# Bad: never do these in a Labor
git push                    # NO — orchestrator handles this
git checkout main           # NO — stay on your branch
git merge main              # NO — orchestrator handles this
```

### For Interactive Sessions (Human + Pi)
 
When working interactively on main (not in a Labor):
 
1. Commit frequently with descriptive messages.
2. Push when you reach a stable point — not after every commit.
 
```bash
# When ready to push
git add -A
git commit -m "chore: scaffold project structure"
git pull --rebase
git push
```

### Commit Message Convention

Use conventional commits:

```
feat: add poller module with bd ready integration
fix: handle empty bd ready response in triage
refactor: extract caste config into separate module
test: add unit tests for triage logic
chore: update Pi SDK to 0.57.2
docs: add inline docs for Labor lifecycle
```

---

## Code Conventions

### TypeScript

- Strict mode enabled. No `any` types — use `unknown` and narrow.
- ES modules throughout (`import`/`export`, not `require`).
- Prefer `interface` over `type` for object shapes.
- Use `const` by default. `let` only when reassignment is needed.
- Explicit return types on exported functions.
- Error handling: never swallow errors silently. Log and propagate.

### Project Structure

```
aegis/
├── src/
│   ├── index.ts              # Entry point, CLI arg parsing
│   ├── aegis.ts              # Core orchestrator class
│   ├── poller.ts             # Beads polling + triage logic
│   ├── spawner.ts            # Pi SDK session creation per caste
│   ├── monitor.ts            # Agent lifecycle, stuck detection, budgets
│   ├── metis.ts              # Layer 2 NL interpreter
│   ├── prometheus.ts         # Layer 3 strategic planner
│   ├── mnemosyne.ts          # Learnings store read/write
│   ├── lethe.ts              # Learnings pruning
│   ├── labors.ts             # Git worktree management
│   ├── beads.ts              # Thin abstraction over bd CLI
│   ├── server.ts             # HTTP server + SSE
│   ├── config.ts             # Config loading and validation
│   └── types.ts              # Shared type definitions
├── olympus/                  # Dashboard (React + Vite)
│   ├── src/
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   ├── components/
│   │   │   ├── CommandBar.tsx
│   │   │   ├── AgentCard.tsx
│   │   │   ├── BeadsBoard.tsx
│   │   │   ├── CostPanel.tsx
│   │   │   ├── EventTimeline.tsx
│   │   │   └── MnemosynePanel.tsx
│   │   ├── hooks/
│   │   │   └── useSSE.ts
│   │   └── types.ts
│   ├── index.html
│   ├── vite.config.ts
│   ├── tailwind.config.ts
│   └── package.json
├── test/
│   ├── poller.test.ts
│   ├── triage.test.ts
│   ├── spawner.test.ts
│   ├── monitor.test.ts
│   ├── mnemosyne.test.ts
│   ├── lethe.test.ts
│   ├── labors.test.ts
│   └── beads.test.ts
├── SPEC.md                   # Full product specification
├── AGENTS.md                 # This file
├── package.json
├── tsconfig.json
└── .aegis/
    ├── config.json           # API keys and settings (gitignored)
    ├── mnemosyne.jsonl       # Learnings store (committed)
    └── labors/               # Worktree directories (gitignored)
```

### Module Boundaries

Each source file exports a focused interface. Modules communicate through typed interfaces, not direct imports of internals.

- `beads.ts` wraps all `bd` CLI calls. No other module shells out to `bd` directly.
- `labors.ts` wraps all `git worktree` operations. No other module runs git worktree commands.
- `spawner.ts` is the only module that calls `createAgentSession()`.
- `server.ts` is the only module that handles HTTP/SSE.
- `config.ts` is the only module that reads `.aegis/config.json`.

### Testing

- Test framework: Vitest (or Node test runner)
- Tests live in `test/` directory, mirroring `src/` module names
- Use real filesystem and real git repos in temp directories for integration tests
- Mock the Pi SDK and bd CLI calls — never make real LLM or beads calls in tests
- Every module should have tests before being considered complete

```bash
npm test                    # Run all tests
npm run test:watch          # Watch mode during development
```

---

## Mnemosyne (Learnings)

When you discover something worth remembering — a convention, a pattern, a gotcha — record it:

```bash
echo '{"type":"convention","domain":"typescript","text":"All exported functions must have explicit return types"}' >> .aegis/mnemosyne.jsonl
```

Valid types: `convention`, `pattern`, `failure`

The orchestrator will post-process entries to add `id`, `source`, `issue`, and `ts` fields. You just need `type`, `domain`, and `text`.

---

## Session Completion

When ending a work session:

### If Working in a Labor (Worktree)

1. Run tests. Only proceed if they pass.
2. Commit all changes with a descriptive message.
3. Close your beads issue: `bd close <id> --reason "Done"`
4. **Stop.** Do not push. Do not merge. The orchestrator handles that.

### If Working Interactively on Main
 
1. File beads issues for any remaining or discovered work.
2. Run quality gates: tests, lint, build.
3. Update beads issue status for anything in progress.
4. Commit and push:
   ```bash
   git add -A
   git commit -m "describe what was done"
   git pull --rebase
   git push
   ```
5. Verify: `git status` should show up to date with origin.