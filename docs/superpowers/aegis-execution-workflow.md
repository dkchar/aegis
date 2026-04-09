# Aegis MVP Execution Workflow

This is the operating loop for moving Aegis from zero to MVP without bloating a single Codex session. The queue unit is a ready child issue, not a slice epic.

## Rules

- `SPECv2.md` is the only product source of truth.
- `bd ready --json` is the executable queue.
- `bd list` is useful for inspection, not for choosing work.
- One terminal should own one child issue.
- Use `$aegis-beads-worker` for one child issue.
- Use `$aegis-slice-conductor` when you want Codex to coordinate a ready wave and parallelize lane children.
- A slice completes through `contract -> lane A and lane B -> gate`.

## One-Time Setup

1. Use the personal skills `$aegis-beads-worker` and `$aegis-slice-conductor`.
2. Pick a worktree home once if you want isolated or parallel lane sessions.
3. Keep `docs/superpowers/plans/2026-04-03-aegis-mvp-slice-plan.md` and `plandocs/2026-04-03-aegis-mvp-tracker.md` in view.

Recommended worktree default until the repo standardizes one:

- Use a global root such as `~/.config/superpowers/worktrees/aegis` so execution sessions do not depend on repo-local ignore churn.

## Mock Run Seeder

Use `npm run mock:seed` from `C:\dev\aegis` to recreate `aegis-mock-run\` from scratch with a deterministic todo-system issue graph.

After the seed completes:

- `cd aegis-mock-run`
- `bd ready --json`
- confirm only `foundation.contract` is ready
- process or close that issue
- run `bd ready --json` again and confirm both foundation lanes are now ready in parallel

## Two Modes

### Worker Mode

Use this when you want one terminal to own one child issue directly.

### Conductor Mode

Use this when you want one Codex session to inspect `bd ready`, decide the current wave, and dispatch one worker per ready child. This is the mode that gives you parallel lane execution without violating the one-child-per-worker boundary.

## Daily Loop

1. From `C:\dev\aegis`, run `bd ready --json`.
2. Pick the highest-priority ready child issue.
3. Open a fresh Codex terminal.
4. Prompt Codex with:

```text
Use $aegis-beads-worker to execute issue aegis-fjm.1.1 in C:\dev\aegis.
SPECv2.md is the only product source of truth.
Work only the named child issue, verify before closing, and report the next ready issue.
```

5. Let Codex claim the issue, implement only that scope, verify it, and close it.
6. Run `bd ready --json` again and repeat.

If you want Codex to manage the wave instead of you picking each child manually, use:

```text
Use $aegis-slice-conductor in C:\dev\aegis.
SPECv2.md is the only product source of truth.
Inspect bd ready, execute the next ready wave, delegate each child to $aegis-beads-worker, and report what is ready after the wave completes.
```

## Session Types

### Contract Session

- Use when the ready issue is the slice's `contract` child.
- Goal: lock the interfaces, fixtures, scaffolding, and tests that unblock both lanes.
- Exit condition: the contract child closes and both lane children become ready.

### Lane Session

- Use when the ready issue is `lane-a` or `lane-b`.
- Goal: implement only that lane's promised surface.
- Parallelism: run `lane-a` and `lane-b` in separate terminals once both are ready, or let `$aegis-slice-conductor` dispatch one worker per lane.
- Exit condition: the lane child closes; when both lanes are closed, the gate child becomes ready.

### Gate Session

- Use when the ready issue is `gate`.
- Goal: prove the slice, not extend it.
- Required work: run the slice's automated gate, perform the slice's manual gate, write evidence with `plandocs\set-mvp-gate-evidence.ps1`, refresh the tracker mirror with `plandocs\revise-mvp-tracker.ps1`, close the gate child, and close the slice epic.
- Exit condition: the slice epic closes and the next ready child appears.

## Practical Command Set

```powershell
bd ready --json
bd show aegis-fjm.1.1
bd update aegis-fjm.1.1 --claim --json
bd close aegis-fjm.1.1 --reason "Completed" --json --suggest-next
bd list --flat --limit 0
bd list --json --limit 0
```

Use `bd list --flat --limit 0` or `bd list --json --limit 0` when you need a full inspection view. Do not use bare `bd list` as your execution view.

Live tracker scripts:

- `plandocs\set-mvp-gate-evidence.ps1`
- `plandocs\revise-mvp-tracker.ps1`

## Prompt Templates

### Generic Child Issue

```text
Use $aegis-beads-worker to execute issue <issue-id> in C:\dev\aegis.
SPECv2.md is the only product source of truth.
Work only the named child issue, verify before closing, and report the next ready issue.
```

### Gate Issue

```text
Use $aegis-beads-worker to execute issue <issue-id> in C:\dev\aegis.
SPECv2.md is the only product source of truth.
This is a gate child: run the automated and manual gate, record evidence, refresh the tracker mirror, and close the slice if it passes.
```

### Conductor

```text
Use $aegis-slice-conductor in C:\dev\aegis.
SPECv2.md is the only product source of truth.
Inspect bd ready, execute the next ready wave, delegate each child to $aegis-beads-worker, and report what is ready after the wave completes.
```

## What Not To Do

- Do not tell Codex to "do the whole slice" unless you intentionally want one long session.
- Do not pick work from epics.
- Do not rely on `bd list` tree output for queue truth.
- Do not let gate sessions invent new feature scope unless they are fixing a truthful gate failure.

## Recommended Cadence

- One terminal for contract.
- Two terminals for lane A and lane B once both are ready.
- One terminal for gate.
- Then back to `bd ready --json`.
