<!-- GSD:project-start source:PROJECT.md -->
## Project

**Aegis**

Aegis is a Windows-first, runtime-agnostic multi-agent orchestrator for software work. It uses Beads as task truth, local `.aegis` state as orchestration truth, Pi as the first runtime adapter, and Olympus as the browser control room so a single developer can supervise a small swarm without turning the system into a black box.

**Core Value:** A human can safely supervise multi-agent software work without losing determinism, truth boundaries, or recovery visibility.

### Constraints

- **Tech stack**: Node.js `>=22.5.0` and TypeScript ESM - the current repository already targets this runtime baseline.
- **Runtime**: Pi first - the adapter layer must ship with Pi before additional runtimes are introduced.
- **Tracker**: Beads is authoritative - Aegis must never invent a second task-truth plane.
- **Portability**: Windows-first path, shell, and worktree handling - PowerShell, cmd, and Git Bash all need to work.
- **Control surface**: Olympus is primary - terminal commands remain useful, but the browser is the main operator interface.
- **Reliability**: Polling, persistence, cooldowns, and restart recovery are mandatory - the deterministic core cannot depend on LLM interpretation.
- **Economics**: Budget, quota, and retry guardrails are first-class product behavior - expensive autonomy must become a visible decision point.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

## Recommended Stack
### Core Technologies
| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Node.js | 22 LTS+ | Orchestrator runtime, process control, filesystem access, HTTP/SSE | Matches the current repo baseline and gives stable Windows process APIs plus straightforward local server support |
| TypeScript | 5.9.x | Strongly typed contracts for dispatch state, adapters, prompts, and UI/server boundaries | The spec depends on crisp interfaces and deterministic data structures; the repo already targets 5.9.3 |
| Pi runtime packages | 0.57.1 baseline, track upstream 0.64.x intentionally | First agent runtime for Oracle, Titan, Sentinel, and Janus sessions | Pi is already the launch runtime in the PRD and the current package baseline is present in `package.json` |
| Git worktree | Git 2.4+ | Labor isolation and merge-candidate workspaces | Official Git support for linked worktrees is the cleanest mechanical isolation model for this product |
### Supporting Libraries
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@mariozechner/pi-agent-core` | 0.57.1 | Runtime session primitives | Use for the runtime adapter boundary and lifecycle management |
| `@mariozechner/pi-ai` | 0.57.1 | Provider/model integration under Pi | Use when wiring model selection, stats, and auth-plan-aware metering |
| `@mariozechner/pi-coding-agent` | 0.57.1 | Coding-agent behaviors on top of Pi | Use for the first Oracle/Titan/Sentinel implementation path |
| React + Vite | Current stable pair at implementation time | Olympus browser UI | Use when building the separate operator dashboard shell and SSE-driven control room |
| Vitest | 4.x | Unit, integration, and scenario regression tests | Use for dispatch logic, queue gates, restart recovery, and eval harness support |
### Development Tools
| Tool | Purpose | Notes |
|------|---------|-------|
| `tsc` | Type-checking and production build | Keep contracts for config, dispatch state, and agent artifacts explicit |
| `tsx` | Fast local execution during development | Good fit for bootstrapping CLI/server slices before full packaging |
| `git worktree` | Branch-isolated labor management | Build labor lifecycle around explicit add/list/remove/repair operations |
| npm scripts | Consistent local entrypoints | Keep bootstrap, Olympus build, test, and eval commands in version control |
## Installation
# Core runtime baseline
# Olympus UI
# Dev dependencies
## Alternatives Considered
| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Pi-first adapter | Direct provider SDK integration in the orchestrator | Only if Pi cannot expose a required runtime capability cleanly |
| SSE for Olympus live state | WebSockets | Use WebSockets only if the UI later needs heavy bidirectional streaming beyond commands plus server push |
| Git worktree labors | In-place branches or ad hoc temp clones | Only for trivial experiments; the production design should stay worktree-based |
## What NOT to Use
| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Runtime-specific logic in core dispatch modules | Locks the orchestrator to one provider/runtime and breaks the adapter promise | Keep all runtime quirks behind adapter modules |
| Direct-to-main Titan integration | Hides merge risk and bypasses explicit queue outcomes | Use the deterministic merge queue |
| WebSocket-heavy dashboard architecture by default | Adds unnecessary protocol and reconnect complexity for a read-mostly operator UI | Start with SSE and layer commands over HTTP |
| A second task database | Creates truth-plane drift with Beads | Keep task truth in Beads only |
## Stack Patterns by Variant
- Keep the runtime contract minimal
- Optimize for deterministic orchestration and good Pi telemetry capture
- Use provider-prefixed model IDs in config
- Select adapters mechanically from config instead of prompt logic
- Use SSE plus explicit command endpoints
- Avoid adding bidirectional transport complexity before it is needed
## Version Compatibility
| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| Node.js `>=22.5.0` | TypeScript 5.9.x | Matches the current repository engine declaration |
| `@mariozechner/pi-agent-core@0.57.1` | `@mariozechner/pi-ai@0.57.1` | Keep Pi package versions aligned |
| `@mariozechner/pi-agent-core@0.57.1` | `@mariozechner/pi-coding-agent@0.57.1` | Upgrade as a set, not independently |
| React/Vite current stable pair | Node 22 LTS+ | Use the stable pair current at implementation time for Olympus |
## Sources
- `SPECv2.md` - canonical architecture, workflows, and implementation ordering
- `package.json` - current repo runtime and dependency baseline
- https://nodejs.org/download/release/v22.19.0/docs/api/child_process.html - Windows process behavior and subprocess lifecycle
- https://git-scm.com/docs/git-worktree - linked worktree behavior and commands
- https://shittycodingagent.ai/ - Pi runtime model, modes, and package philosophy
- https://github.com/andygeiss/beads - Beads tracker capabilities and CLI-oriented workflow
- https://react.dev/learn/add-react-to-an-existing-project - current React guidance for existing projects
- https://vite.dev/guide/ - Vite baseline for a modern dashboard shell
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd:quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd:debug` for investigation and bug fixing
- `/gsd:execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd:profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
