# Aegis Agent Guide

## Caveman

Terse like caveman. Technical substance exact. Only fluff die.
Drop: articles, filler, pleasantries, hedging.
Fragments OK. Short synonyms. Code unchanged.
Pattern: `[thing] [action]. [reason]. [next step].`
Active until user says stop.

## Source Of Truth

Read only:

- `docs/AEGIS.md`

All older specs, addenda, plans, discovery logs, and deferred-item docs are historical. Do not use them for requirements, planning, or implementation authority.

If code, old docs, or comments conflict with `docs/AEGIS.md`, `docs/AEGIS.md` wins.

## Product Shape

Aegis = terminal-first deterministic multi-agent orchestrator.

Core loop:

- `poll -> triage -> dispatch -> monitor -> reap`

Truth planes:

- task truth: Agora
- orchestration truth: `.aegis/dispatch-state.json`
- merge truth: `.aegis/merge-queue.json`
- durable observability: `.aegis/logs/` plus caste artifacts
- runtime execution: adapter sessions

Current goal:

- prove one real adapter drains seeded animated React todo graph into working app
- Pi first
- Codex adapter fallback if Pi remains flaky under adapter contract
- Claude Code adapter (`runtime: "claude"`) approved under same contract. See `docs/runtime-adapters.md`.

## Current Boundary

Do:

- enforce adapter contract
- prove seeded React todo graph drain
- keep terminal-first proof
- keep deterministic control plane
- keep merge queue mechanical
- keep artifacts inspectable

Do not drift into:

- Olympus before Step 1 proof
- SSE/dashboard transport before session terminals
- economics / budgets / quotas
- Mnemosyne / Lethe
- tracker-native messaging
- eval harness / benchmark corpus
- extra tracker adapters
- broad pipeline systems

## Engineering Rules

- No in-place mutation of dispatch or merge state records. Return new objects.
- Use atomic writes for durable state and artifacts via tmp -> rename.
- Keep tracker semantics generic. Never infer orchestration meaning from issue naming.
- Keep code understandable at glance. Preserve clear boundaries for `poller`, `triage`, `dispatcher`, `monitor`, `reaper`, `runtime`, `merge`, `tracker`, and caste runners.
- Prefer Windows-safe path/process handling: `path.join()`, `spawnSync`, `execFile`, `execFileSync`.
- Do not reintroduce cut systems as compatibility code or stubs.
- Do not update ignored historical docs. Edit `docs/AEGIS.md` only for source-of-truth changes.

## Verification

- CI scope = deterministic seam testing only.
- User / QA proof happens through seeded mock-run live adapter flow.
- Prefer clean deterministic tests over brittle git/installable simulations.
- Do not claim pass without running relevant command and seeing pass.

## Agora Integration

This project uses Agora for issue tracking.

Common commands:

```bash
node packages/agora/dist/cli.js board --json
node packages/agora/dist/cli.js list --json
node packages/agora/dist/cli.js create --title "Title" --body "Details" --kind task --actor agent --json
node packages/agora/dist/cli.js move <id> done --reason "Completed" --actor agent --json
```

Rules:

- Use Agora for work tracking.
- Use `--json` for programmatic calls.
- Check `node packages/agora/dist/cli.js board --json` before selecting work.
- Link discovered blocking work through Agora dependencies.
- Do not create markdown TODO tracking.
- If Agora is unavailable, report it and continue only with explicitly requested non-Agora work.

## Session Completion

When closing work session:

1. File real follow-up Agora tickets if needed and available.
2. Run relevant verification.
3. Update issue status in Agora if available.
4. `git pull --rebase`
5. `git push`
6. Confirm branch up to date with origin.
