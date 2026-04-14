# Aegis Agent Guide

## Current Source of Truth

- `docs/superpowers/specs/2026-04-13-aegis-emergency-mvp-triage-design.md`
  Current emergency MVP recovery contract.
- `docs/superpowers/specs/2026-04-13-aegis-emergency-triage-discovery.md`
  Q&A and decision log behind the recovery contract.
- `docs/superpowers/specs/2026-04-13-aegis-emergency-deferred-items.md`
  Flat list of removed or postponed work.

If older code or docs conflict with the emergency MVP triage design, the triage design wins until the stripped terminal-first MVP rewrite is complete.

## Product Shape

Aegis is currently being rewritten as a terminal-first deterministic multi-agent orchestrator.

Target core loop:
- `poll -> triage -> dispatch -> monitor -> reap`

Target truth planes:
- task truth: Beads
- orchestration truth: `.aegis/dispatch-state.json`
- merge queue truth: `.aegis/merge-queue.json`
- durable observability: `.aegis/logs/`, with structured caste artifacts returning in later phases

Current Phase A-C surface:
- `aegis init`
- `aegis start`
- `aegis status`
- `aegis stop`
- `.aegis/runtime-state.json`
- daemon lifecycle logs under `.aegis/logs/`

Out of scope unless explicitly reopened:
- Olympus UI
- SSE/dashboard transport
- economics, budgets, quota tracking
- Mnemosyne / Lethe
- Beads-native messaging
- eval harness / benchmark corpus

## Engineering Rules

- No in-place mutation of dispatch or merge state records. Return new objects.
- Use atomic writes for durable state and artifacts via tmp -> rename.
- Keep tracker semantics generic. Never infer orchestration meaning from issue naming.
- Keep the code understandable at a glance. Phase A-C is intentionally limited to the stripped bootstrap surface. Preserve clear boundaries for `poller`, `triage`, `dispatcher`, `monitor`, `reaper`, `runtime`, `merge`, and `tracker` as those modules return in later phases.
- Prefer Windows-safe path/process handling: `path.join()`, `spawnSync`, `execFile`, and `execFileSync`.
- Do not reintroduce cut systems as compatibility code or stubs.

## Verification

- CI scope is deterministic seam testing only.
- User and QA proof happens through the seeded mock-run flow.
- Prefer clean deterministic tests over brittle git/installable simulations.
- Do not claim a behavior or gate passes without running the relevant command and seeing it pass.

## Current Phase A-C Available Commands

Current stripped-base commands:

```bash
aegis init
aegis start
aegis status
aegis stop
```

During Phase A-C, treat anything else as future work, not as a supported operator path.

## Future Phase Command Targets

These commands belong to later loop-rebuild phases and are not part of the current stripped bootstrap base:

```bash
aegis poll
aegis dispatch
aegis monitor
aegis reap
aegis merge next
aegis scout <issue-id>
aegis implement <issue-id>
aegis review <issue-id>
aegis process <issue-id>
aegis restart <issue-id>
aegis requeue <issue-id>
```

## Mock Run

Use `aegis-mock-run/` as the stripped bootstrap proof surface during Phase A-C.

Current proof scope:
- stripped config and repo initialization
- daemon start, status, and stop behavior
- runtime-state persistence
- daemon lifecycle logs

Deferred to later phases:
- full `poll -> triage -> dispatch -> monitor -> reap` proof
- bounded concurrency proof
- Janus and merge-queue proof

Typical flow:

```bash
npm run mock:seed
npm run mock:run -- node ../dist/index.js start
npm run mock:run -- node ../dist/index.js status
npm run mock:run -- node ../dist/index.js stop
```

Successful mock runs may clean up failure-only transcripts, but retained artifacts and worktrees should remain inspectable unless the active task says otherwise.

## Beads Integration

This project uses `bd` for all issue tracking.

Common commands:

```bash
bd ready --json
bd show <id>
bd update <id> --claim --json
bd close <id> --reason "Completed" --json
bd create "Title" --description "Details" --deps discovered-from:<id> --json
```

Rules:
- Use `bd` for all task tracking.
- Use `--json` for programmatic calls.
- Check `bd ready` before selecting work.
- Link discovered work with `discovered-from` dependencies.
- Do not create markdown TODO tracking.
- When creating dependency chains, verify the ordering with `bd ready`.

## Non-Interactive Shell Commands

Always use non-interactive flags for file operations.

Examples:

```bash
cp -f source dest
mv -f source dest
rm -f file
rm -rf directory
cp -rf source dest
```

## Session Completion

When closing out a work session:

1. File any follow-up `bd` issues that are genuinely needed.
2. Run the relevant verification for the changes you made.
3. Update issue status in `bd`.
4. `git pull --rebase`
5. `git push`
6. Confirm the branch is up to date with origin.
