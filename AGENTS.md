# Aegis Agent Guide

## Project

Aegis is a Windows-first, runtime-agnostic multi-agent orchestrator for software work. It uses Beads as task truth, local `.aegis` state as orchestration truth, Pi as the first runtime adapter, and Olympus as the browser control room so a single developer can supervise a small swarm without turning the system into a black box.

**Core value:** A human can safely supervise multi-agent software work without losing determinism, truth boundaries, or recovery visibility.

### Constraints

- Node.js `>=22.5.0` and TypeScript ESM
- Pi is the first runtime; keep runtime-specific logic behind adapters
- Beads is authoritative for task truth
- Windows-first path, shell, and worktree handling is required
- Olympus is the primary operator interface
- Polling, persistence, cooldowns, and restart recovery are mandatory
- Budget and quota guardrails are product behavior, not optional polish

## Working Rules

- Treat `SPECv2.md` as the canonical product and implementation document.
- Treat `.planning/PROJECT.md` as current project context.
- Treat `.planning/REQUIREMENTS.md` as the contract for scope and traceability.
- Treat `.planning/ROADMAP.md` as the current phase structure.
- Treat `.planning/STATE.md` as the short-term execution memory.
- Preserve truth boundaries: Beads for tasks, `.aegis` files for orchestration, Mnemosyne for learned knowledge, Olympus for visibility only.
- Keep merge behavior mechanical by default; Janus is escalation-only.

## Recommended Stack

- Node.js 22 LTS+
- TypeScript 5.9.x
- `@mariozechner/pi-agent-core`, `@mariozechner/pi-ai`, `@mariozechner/pi-coding-agent`
- Git worktrees for labors
- React + Vite for Olympus
- Vitest for unit, integration, and scenario coverage

## Workflow Enforcement

- Start implementation work through a GSD workflow so planning artifacts stay in sync.
- Use `$gsd-plan-phase <n>` or `$gsd-discuss-phase <n>` before substantial phase work.
- Use `$gsd-quick` only for small changes that do not justify phase planning.
- Do not bypass `.planning/` updates when work changes roadmap, requirements, or state.

## Source Files

- `SPECv2.md`
- `.planning/PROJECT.md`
- `.planning/research/SUMMARY.md`
- `.planning/REQUIREMENTS.md`
- `.planning/ROADMAP.md`
- `.planning/STATE.md`
