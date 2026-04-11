# Qwen CLI Handoff: Olympus Operator Console Next Phase

Date: 2026-04-11

## Current Baseline

- Branch state: local `main` is clean and synced to `origin/main`.
- Latest merged work:
  - PR `#61` merged as `8dbf31e` on 2026-04-11.
  - PR `#62` merged as `adf0e39282f7932576e8c167615b163955ea4df0` on 2026-04-11.
- Open PRs: none.
- Local worktrees: cleaned up. Only the root checkout remains.

## Source of Truth

Read these first, in this order:

1. `SPECv2.md`
2. `plandocs/2026-04-03-aegis-mvp-tracker.md`
3. `plandocs/codebase-structure.md`
4. `docs/superpowers/specs/2026-04-10-aegis-startup-preflight-design.md`
5. `docs/superpowers/specs/2026-04-10-olympus-operator-workflow-design.md`
6. `docs/superpowers/specs/2026-04-10-live-execution-observability-design.md`
7. `docs/superpowers/specs/2026-04-10-mock-seed-operator-docs-design.md`
8. `docs/superpowers/plans/2026-04-11-aegis-startup-preflight.md`
9. `docs/superpowers/plans/2026-04-11-olympus-operator-workflow.md`
10. `docs/superpowers/plans/2026-04-11-live-execution-observability.md`
11. `docs/superpowers/plans/2026-04-11-mock-seed-operator-docs.md`

Important framing:

- The slice tracker in `plandocs/2026-04-03-aegis-mvp-tracker.md` is still the canonical tracker for the MVP slices and parity history.
- The remaining Olympus/operator-console work is best driven from the 2026-04-10 specs plus the 2026-04-11 plans above.
- Do not re-spec this work from scratch unless the user explicitly changes direction.

## What Landed In This Phase

### 1. Startup and preflight baseline is in

These pieces are now on `main` and should be treated as the starting point, not open design questions:

- `src/cli/startup-preflight.ts`
- `src/cli/start.ts`
- `src/config/package-json-aliases.ts`
- `src/config/init-project.ts`
- `tests/unit/cli/startup-preflight.test.ts`
- `tests/integration/cli/start-stop.test.ts`
- `tests/integration/config/init-project.test.ts`

What this means:

- `aegis start` now fail-closes on structured startup preflight checks.
- `aegis init` now adds repo-local `aegis:*` npm aliases conservatively.
- CI-sensitive startup tests no longer require a machine-level `bd` install when the test is not actually about live Beads behavior.

The startup/preflight plan is effectively the completed baseline for the next phase. Do not reopen it unless a regression appears.

### 2. Old Olympus follow-up branch is merged

The older UI/server follow-up work from PR `#61` is already on `main`. Relevant landed surfaces include:

- `/api/issues/ready`
- `/api/config`
- persisted config editing
- structured command composer
- the old `Start Run` follow-up flow

Relevant files:

- `src/server/http-server.ts`
- `src/server/routes.ts`
- `src/config/save-config.ts`
- `olympus/src/components/command-bar.tsx`
- `olympus/src/components/settings-panel.tsx`
- `olympus/src/components/start-run-dialog.tsx`

### 3. First operator-console shell slice is in

The first redesign slice from PR `#62` is also on `main`:

- `olympus/src/components/loop-panel.tsx`
- `olympus/src/App.tsx`
- `olympus/src/components/top-bar.tsx`

This is only the shell start, not the finished operator console.

## Actual Remaining Work

This is the critical distinction: some UI was merged, but the product still does not match the approved operator-console design.

### A. Olympus operator workflow is only partially implemented

Current state on `main`:

- `olympus/src/App.tsx` renders:
  - `LoopPanel`
  - `AgentGrid`
  - `CommandBar`
  - local command result cards
- `LoopPanel` exists, but it is fed with hardcoded `EMPTY_PHASE_LOGS`.
- There is no operator sidebar.
- There is no merge queue section.
- There are no terminal-like active session panes.
- There is no completed-session tray.
- There is no Janus popup terminal.

Concretely, these plan items remain open from `docs/superpowers/plans/2026-04-11-olympus-operator-workflow.md`:

- Task 2: queue/graph/selected-issue/steer sidebar
- Task 3: merge queue, active sessions, recent completions, Janus popup
- Task 4: final workflow verification and removal of legacy control conflicts

### B. Live execution and observability is still mostly unimplemented

Current state on `main`:

- `olympus/src/types/dashboard-state.ts` still only models basic `status`, `spend`, `agents`, and optional `config`.
- `olympus/src/lib/use-sse.ts` still primarily understands:
  - `orchestrator.state`
  - `control.command`
- `src/server/http-server.ts` serves state and SSE, but there is no dedicated dashboard-state store for:
  - phase logs
  - merge queue state
  - active session logs
  - recent completions
  - Janus popup state
- `App.tsx` still derives loop state from minimal dashboard status and does not consume real loop/session/merge event streams.

This means the approved execution-heavy console has not been wired yet. The observability plan in `docs/superpowers/plans/2026-04-11-live-execution-observability.md` is still the main body of remaining work.

### C. Mock seed and operator docs are still outstanding

Current state on `main`:

- `src/mock-run/seed-mock-run.ts` still seeds the old deterministic todo app baseline.
- `src/mock-run/todo-manifest.ts` still writes:
  - `README.md`
  - `package.json`
  - `tsconfig.json`
  - `src/**`
  - `tests/**`
- This directly conflicts with the agreed direction that mock-run should be a scratchpad repo with a predictable Beads graph, not a special product experience.
- Operator-facing docs such as quickstart, Olympus guide, steer reference, and mock-seed guide still do not exist as first-class docs.

This remaining work is defined in `docs/superpowers/plans/2026-04-11-mock-seed-operator-docs.md`.

## Recommended Execution Order

Do the remaining work in this order:

1. Finish Olympus operator workflow layout and control model.
2. Wire real observability and SSE-driven execution state.
3. Simplify mock seed and add operator-facing docs.

Reason:

- The UI shell needs its final structure before wiring deep live state into it.
- The observability work is easier once the UI sections are stable.
- Mock seeding and docs should reflect the final operator model, not the pre-rework shell.

## Qwen-Specific Guidance

This handoff is written for Qwen CLI. Play to its strengths:

- Prefer the existing plan docs over freeform redesign.
- Work task-by-task with explicit file ownership.
- Keep changes local and deterministic.
- Run targeted tests before full-suite verification.
- Avoid broad opportunistic refactors while closing the planned gaps.

Recommended superpowers skill sequence:

1. `using-superpowers`
2. `executing-plans`
3. `test-driven-development`
4. `systematic-debugging` whenever a test or behavior diverges
5. `verification-before-completion`
6. `requesting-code-review` before landing a substantial slice

Conditional skill:

- `subagent-driven-development`

Use it only if the work is split into genuinely disjoint write scopes, for example:

- one worker owns Olympus layout/components
- one worker owns server/dashboard-state store and SSE event publication

Do not default to delegation just because multiple tasks exist. Qwen will likely perform better here by executing the plan serially unless the write sets are clearly independent.

## Exact Next Starting Point

Start with `docs/superpowers/plans/2026-04-11-olympus-operator-workflow.md`, Task 2.

Before editing, inspect these files:

- `olympus/src/App.tsx`
- `olympus/src/components/loop-panel.tsx`
- `olympus/src/components/command-bar.tsx`
- `olympus/src/components/top-bar.tsx`
- `olympus/src/types/dashboard-state.ts`
- `olympus/src/lib/use-sse.ts`

The key implementation rule for this next slice:

- do not preserve the old `Start Run` / manual lifecycle mental model as the primary UX
- do not add mock-specific UX
- keep Olympus as the primary operator console and visibility surface

## Workflow So Far

This is the sequence that produced the current baseline:

1. The operator-console redesign was broken into four ordered specs:
   - startup/preflight
   - Olympus operator workflow
   - live execution and observability
   - mock seed and operator docs
2. Matching implementation plans were written for those four specs.
3. Startup/preflight was implemented first.
4. The first Olympus loop-shell slice was implemented.
5. A separate older Olympus follow-up branch existed and had not yet been merged.
6. That older branch was merged first as PR `#61`.
7. The operator-console branch was then rebased/merged onto the new `main`, CI-fixed, and merged as PR `#62`.
8. Local worktrees were removed and the repo was returned to a single clean `main` checkout.

This matters because:

- `main` now contains both the old follow-up work and the first redesign slice.
- The next worker should not spend time recovering branch history or re-merging old PRs.

## Verification Pattern To Keep

For any remaining slice, use this rhythm:

1. Run the most local targeted tests first.
2. Run `npm run lint`.
3. Run `npm run build`.
4. Run `npm run test`.
5. If the touched surface includes Olympus server/API/SSE behavior, run mock-run sanity:
   - `npm run mock:seed`
   - `node ..\\dist\\index.js init`
   - `node ..\\dist\\index.js status`
   - `node ..\\dist\\index.js start --port <port> --no-browser`
   - probe `GET /`, `GET /api/state`, `GET /api/events`, and any touched endpoints
   - `node ..\\dist\\index.js stop`
   - confirm clean `git status -sb` inside the seeded repo

Important note:

- when probing `/api/events`, a short timeout after headers is normal because SSE is a streaming endpoint

## Guardrails

- Do not invent a mock-specific operator path. The mock repo must remain arbitrary from Aegis' perspective.
- Do not regress startup/preflight behavior that is now landed.
- Do not leave Olympus in a split-brain state where loop control, manual start-run flow, and steer all compete as first-class entrypoints.
- Do not claim the operator console is done until the dispatch loop, merge queue, live agent sessions, and Janus escalations are directly visible in the UI.

## Definition Of Done For The Next Phase

The next phase is complete when:

- Olympus matches the approved operator-console layout
- the UI is driven by real derived execution state and SSE logs
- active agent sessions render as terminal-like panes
- completed sessions collapse into a tray
- Janus escalations appear as popup terminal sessions and collapse on completion
- mock seed creates a scratchpad repo, not a toy app baseline
- operator docs exist so the product is understandable without source diving

