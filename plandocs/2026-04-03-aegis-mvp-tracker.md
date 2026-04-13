# Aegis MVP Tracker

- Refreshed: 2026-04-13T17:25:00+01:00
- Source spec: SPECv2.md
- Design doc: docs/superpowers/specs/2026-04-03-aegis-mvp-slicing-design.md
- Plan doc: docs/superpowers/plans/2026-04-03-aegis-mvp-slice-plan.md
- Program epic: aegis-fjm
- Program status: blocked
- Program updated: 2026-04-08T14:33:48Z
- Operational queue: use `bd ready`; slice and program epics stay `blocked` as coordination units because Beads cannot model task-to-epic blockers.
- Planning view: `bd swarm validate` still reports epic-level waves and is advisory, not the executable queue.

## 2026-04-13 Mock-Run Fix and Olympus Control Actions

- Removed hardcoded `gemma-4-31b-it` from mock seed — now flows through `DEFAULT_AEGIS_CONFIG` (gemini-2.0-flash-exp for structured-output castes).
- Added `stop` binding to HTTP server — writes runtime-stop-request.json so the server's own poller triggers graceful shutdown (mirrors CLI `aegis stop` mechanism).
- Added `stop` route handler in routes.ts for the Olympus stop button.
- Verification on 2026-04-13: `npm run lint`; `npm run build`; `npm run test` (81 tests pass in key suites).
- Open items: realtime agent session logs still not streaming to active sessions (investigation ongoing — SSE eventIngress subscription confirmed wired, sessionId matching confirmed, may be timing/mock-run specific). Kill command for individual agents needs investigation (sent as `command` action, not control action).

## 2026-04-13 Runtime Tool-Call Failure Detection and Reaper Fix

- Closed non-epic follow-up in this batch: `aegis-vkh` (reaper declining Oracle sessions).
- Scope of the fix:
  - the reaper now detects `tool_call_failure` when a session completes but produces no structured output (no custom tool call AND no valid message fallback). This catches models with broken tool calling at runtime rather than relying on a static blocklist.
  - fatal monitor events now carry a `fatal` flag and actionable user message identifying the caste, the missing tool, and the recommendation to switch models.
  - the orchestrator kills the auto-loop immediately when it sees a fatal monitor event, preventing wasted retries on models that cannot invoke tools.
  - sentinel verification now has the same transitional message fallback as oracle and titan (checks message JSON when no tool call is found).
  - default models changed from `pi:default` to `google:gemini-2.0-flash-exp` — a model with confirmed tool-call reliability, free tier access, and good rate limits.
- Verification on 2026-04-13: `npm run lint`; `npm run build`; `npm run test` (1446 tests, 0 failed). New unit tests added for `tool_call_failure` detection and non-tool-call caste exclusion.
- Queue parity on 2026-04-13: `bd ready --json` returned 2 issues (`aegis-bv9`, `aegis-vkh`); `aegis-vkh` updated with root cause analysis.

## 2026-04-12 Auto-Loop Backlog Sweep Parity

- Closed non-epic follow-up in this batch: `aegis-80p`.
- Scope of the automation and observability fixes:
  - auto mode now sweeps the full current `bd ready` backlog when enabled, keeps polling for newly ready work, and no longer suppresses pre-existing ready issues behind a freshness gate.
  - the auto-loop dispatch path now fills available concurrency slots with multiple ready issues in parallel where capacity allows, while preserving the merge queue's serialized processing path.
  - live direct-command execution and auto-loop ticks now publish real runtime events into the HTTP server event bus, so Olympus receives active sessions, completed sessions, merge activity, and loop phase logs from the running orchestrator instead of placeholders.
  - Olympus now derives its issue graph, selected issue, and top-bar queue/agent counters from live ready issues, sessions, and merge state, so the operator console reflects real backlog and execution state after refreshes and new-ready changes.
  - mock-run seeding now retries transient Windows directory-lock failures, which restored the required disposable-repo sanity checks for this workflow.
- Verification on 2026-04-12: `npm run lint`; `npm run build`; `npm run test`; `npm run mock:seed`; `npm run mock:run -- node ../dist/index.js init`; `npm run mock:run -- node ../dist/index.js status`; `npm run mock:run -- node ../dist/index.js start --port 43123 --no-browser`; `GET /`; `GET /api/state`; `GET /api/events`; `npm run mock:run -- node ../dist/index.js stop`; `git -C aegis-mock-run status -sb`.
- Queue parity on 2026-04-12: `bd ready --json` returned `[]`.

## 2026-04-09 Follow-up Parity

- Closed non-epic black-box follow-ups: `aegis-xfk`, `aegis-9yr`, `aegis-p2n`, `aegis-7pg`, and `aegis-09n`.
- Scope of the follow-up fixes:
  - `aegis-xfk`: `aegis start` now validates Beads repository readiness instead of only probing CLI availability.
  - `aegis-9yr`: live `scout`/`implement`/`review`/`process` commands now execute the landed Oracle/Titan/merge/Sentinel pipeline.
  - `aegis-p2n`: CLI direct commands now forward to the running server, mutate live operating mode, and keep `.aegis/runtime-state.json` in sync.
  - `aegis-7pg`: configured per-caste model refs now flow through runtime spawn calls, including the Janus merge-worker path, and Pi resolves explicit model refs before session creation.
  - `aegis-09n`: CI now installs a compatible `bd` CLI, verifies required `bd init` flags, and runs mock-run seeder coverage.
- Verification on 2026-04-09: `npm run lint`; `npm run build`; `npm run test` all passed in the worktree after these fixes.
- Queue parity on 2026-04-09: `bd ready --json` returned `[]`; only coordination epics remain outside the executable queue.

## 2026-04-10 Olympus Bugfix Parity

- Closed non-epic follow-ups in this batch: `aegis-2c5`, `aegis-cgm`, `aegis-3by`, and `aegis-5ji`.
- Scope of the bugfixes:
  - `aegis-2c5`: Start Run now treats declined `scout` responses as errors and keeps the implement affordance hidden.
  - `aegis-cgm`: Proceed to Implement now surfaces declined `implement` responses as errors and keeps the dialog open.
  - `aegis-3by`: Olympus `status` now returns a meaningful live status summary instead of the generic scaffold acknowledgement.
  - `aegis-5ji`: Olympus now renders a single command-result surface and uses backend result text instead of duplicate placeholder success messaging.
- Deferred follow-up: `aegis-aru` remains open. Live mock-run sanity still reproduced the Google Gemma thinking-budget failure after investigation, so that runtime fix was not included in this batch.
- Verification on 2026-04-10: `npm run lint`; `npm run build`; `npm run test` all passed in the worktree. Mock-run sanity also passed for `init`, `status`, `start`, `GET /`, `GET /api/state`, `POST /api/steer` with `action=status`, `GET /api/events`, `stop`, and clean `git status -sb` after cleanup.

## 2026-04-10 Remaining Bug Parity

- Closed remaining non-epic bug follow-ups in this batch: `aegis-r5s`, `aegis-p0m`, `aegis-aru`, and `aegis-vzn`.
- Scope of the bugfixes:
  - `aegis-r5s`: repaired the shared-server Beads tracker history so the local tracker again shares ancestry with origin and `bd dolt pull` / `bd dolt push` succeed.
  - `aegis-p0m`: Olympus settings now uses the visible overlay as the actual dialog root, so accessibility and automation target the visible bounds instead of a zero-height wrapper.
  - `aegis-aru`: Google Gemma Oracle sessions now suppress unsupported Pi reasoning metadata, and Oracle assessment parsing accepts fenced JSON output so seeded scout runs complete instead of failing.
  - `aegis-vzn`: `initProject()` and the mock-run baseline `.gitignore` now ignore `.aegis/oracle/`, so successful scout runs do not dirty the disposable mock repo.
- Verification on 2026-04-10: `npm run lint`; `npm run build`; `npm run test`; `bd dolt pull`; `bd dolt push`; `npm run mock:seed`; seeded mock-run scout via `executeProjectDirectCommand` returned `handled` with `ready for implementation`; `git status -sb` in `aegis-mock-run` stayed clean after the scout.
- Queue parity on 2026-04-10: `bd ready --json` returned `[]`.

## 2026-04-10 Olympus Delivery Parity

- Closed remaining non-epic follow-ups in this batch: `aegis-8lq`, `aegis-hnl`, `aegis-9y0`, `aegis-8po`, and `aegis-bmb`.
- Scope of the delivery work:
  - `aegis-8lq`: Olympus Start Run now loads the Beads ready queue from the server, lets the operator pick a ready issue, runs `scout`, shows the Oracle assessment, and only then exposes Proceed to Implement.
  - `aegis-hnl`: the remaining Olympus control-room UX issues were closed out in the delivered surface, including structured command submission, editable settings backed by real config reads and writes, and a real Start Run path instead of a read-only shell.
  - `aegis-9y0`: Olympus settings now edits persisted concurrency and per-caste budget limits through `/api/config`, including a one-click mock-run observation profile.
  - `aegis-8po`: the command bar is now a structured command composer with explicit issue and agent targeting, and the dashboard clearly states that natural-language Ask mode is not part of the MVP path.
  - `aegis-bmb`: the repo now ships `npm start` as the standard launch path for `dist/index.js`, including forwarded CLI args via `npm start -- ...`.
- Verification on 2026-04-10: focused server and Olympus tests for the new routes and controls passed; adjacent touched-surface tests passed; `npm run lint`; `npm run build`; `npm run test` all passed; mock-run sanity passed for `init`, `status`, `start`, `GET /`, `GET /api/state`, `GET /api/issues/ready`, `GET /api/config`, `POST /api/config`, `GET /api/events`, `stop`, and clean `git status -sb` in `aegis-mock-run`.
- Queue parity on 2026-04-10: `bd ready --json` returned `[]`; after this batch only the coordination epic `aegis-0yq` remains in progress.

## 2026-04-11 Olympus Operator Console Layout (Tasks 2 & 3)

- Closed operator-console layout tasks 2 and 3 from `docs/superpowers/plans/2026-04-11-olympus-operator-workflow.md`.
- Scope of this slice:
  - **Task 2 (sidebar + steer):** Added `OperatorSidebar` with ready queue, issue graph, selected-issue card, and `SteerPanel` (command input + reference cheat sheet). Wired into `App.tsx` as a left sidebar in a flex layout.
  - **Task 3 (execution sections):** Added `MergeQueuePanel`, `ActiveSessionsPanel`, `RecentSessionsTray`, and `JanusPopup` shell components. Wired into `App.tsx` main lane in the approved section order: Aegis Loop → Merge Queue → Active Agent Sessions → Completed Sessions → Agent Grid → Command Bar.
  - All components are typed, styled with existing Olympus tokens, and covered by unit tests.
  - Added app-level tests verifying the approved section order and confirming the legacy `Start Run` flow is absent.
- Components created: `operator-sidebar.tsx`, `steer-panel.tsx`, `merge-queue-panel.tsx`, `active-sessions-panel.tsx`, `recent-sessions-tray.tsx`, `janus-popup.tsx`.
- Tests created: `operator-sidebar.test.tsx`, `merge-queue-panel.test.tsx`, `active-sessions-panel.test.tsx`, plus 2 new `app.test.tsx` cases.
- Note: panels are wired with placeholder empty data. Real observability/SSE wiring is the next phase (`docs/superpowers/plans/2026-04-11-live-execution-observability.md`).
- Verification on 2026-04-11: `npm run lint`; `npm run build`; `npm run test` (85 files, 1371 tests, 11 todo) all passed.
- Committed as `97a47d8` on `main`, pushed to `origin/main`.

## Slice Epics

### S00 - Project Skeleton and Toolchain (aegis-fjm.1)

- Status: closed
- Updated: 2026-04-07T18:57:13Z
- Depends on: none
- Outcome: Node, TypeScript, Vitest, and Olympus workspace skeleton build cleanly.
- Automated gate: npm run build; npm run test -- tests/unit/bootstrap/project-skeleton.test.ts
- Manual gate: Fresh clone installs and builds on Windows PowerShell and one Unix-like shell.
- Automated evidence: passed: npm run test; npm run lint; npm run build:all; npm pack --dry-run
- Manual evidence: passed: fresh clone installs and builds on Windows PowerShell and Git Bash on 2026-04-03
- Evidence notes: S00 finalized on feat/s00-project-skeleton after review-driven fixes for linked CLI execution, Vitest project isolation, package publish boundaries, Vite alignment, and the Node engine contract.
- Evidence updated: 2026-04-03T20:38:22+01:00
- Children:
  - contract: aegis-fjm.1.1 [closed] updated 2026-04-07T18:57:13Z
  - lane_a: aegis-fjm.1.2 [closed] updated 2026-04-07T18:57:14Z
  - lane_b: aegis-fjm.1.3 [closed] updated 2026-04-07T18:57:14Z
  - gate: aegis-fjm.1.4 [closed] updated 2026-04-07T18:57:15Z

### S01 - Config and Filesystem Contracts (aegis-fjm.2)

- Status: closed
- Updated: 2026-04-07T18:57:17Z
- Depends on: S00
- Outcome: The `.aegis` layout, config schema, defaults, and init path are deterministic and idempotent.
- Automated gate: npm run test -- tests/unit/config/load-config.test.ts tests/integration/config/init-project.test.ts
- Manual gate: `aegis init` creates required files without clobbering existing local config.
- Automated evidence: passed: npm run test -- tests/unit/config/load-config.test.ts tests/integration/config/init-project.test.ts (2 files, 13 tests); npm run test -- tests/unit/bootstrap/project-skeleton.test.ts (1 file, 5 tests); npm run build on 2026-04-04
- Manual evidence: passed: built CLI and ran node dist/index.js init in a temp repo; first run created .aegis/config.json, dispatch-state.json, merge-queue.json, mnemosyne.jsonl, .aegis/labors/, and .aegis/evals/ with .gitignore updates; second run preserved a custom .aegis/config.json and did not duplicate ignore entries on 2026-04-04
- Evidence notes: S01 gate fixes now include CLI init wiring, malformed-config context, numeric range validation, and centralized config section keys before final review.
- Evidence updated: 2026-04-04T01:12:04+01:00
- Children:
  - contract: aegis-fjm.2.1 [closed] updated 2026-04-07T18:57:17Z
  - lane_a: aegis-fjm.2.2 [closed] updated 2026-04-07T18:57:18Z
  - lane_b: aegis-fjm.2.3 [closed] updated 2026-04-07T18:57:18Z
  - gate: aegis-fjm.2.4 [closed] updated 2026-04-07T18:57:18Z

### S02 - Eval Harness Foundation (aegis-fjm.3)

- Status: closed
- Updated: 2026-04-07T18:57:21Z
- Depends on: S06
- Outcome: Aegis can run named scenarios and persist comparable result artifacts.
- Automated gate: npm run test -- tests/unit/evals/result-schema.test.ts tests/integration/evals/run-scenario.test.ts
- Manual gate: Running the same scenario twice yields comparable artifacts under `.aegis/evals/`, and a simulated failed run still records a clean failure artifact.
- Automated evidence: passed: npm run test -- tests/unit/evals/result-schema.test.ts tests/integration/evals/run-scenario.test.ts (2 files, 75 tests, 4 todo); npm run test (10 files, 111 tests, 4 todo); npm run build on 2026-04-04
- Manual evidence: passed: ran scenario twice yielding comparable artifacts under .aegis/evals/; failed run produced clean failure artifact; score summary comparison showed no regressions on 2026-04-04
- Evidence notes: S02 gate passed after independent code review. 2 critical path-traversal fixes, 4 important metric/validation fixes applied and re-reviewed to consensus.
- Evidence updated: 2026-04-04T19:36:41+01:00
- Children:
  - contract: aegis-fjm.3.1 [closed] updated 2026-04-07T18:57:21Z
  - lane_a: aegis-fjm.3.2 [closed] updated 2026-04-07T18:57:21Z
  - lane_b: aegis-fjm.3.3 [closed] updated 2026-04-07T18:57:22Z
  - gate: aegis-fjm.3.4 [closed] updated 2026-04-07T18:57:22Z

### S03 - Fixture Repos and Benchmark Corpus (aegis-fjm.4)

- Status: closed
- Updated: 2026-04-07T18:57:24Z
- Depends on: S02
- Outcome: The MVP benchmark corpus has resettable fixture repos and named scenarios.
- Automated gate: npm run test -- tests/integration/evals/fixture-sanity.test.ts
- Manual gate: Each fixture can be reset and run manually without hidden preconditions.
- Automated evidence: passed: npm run test (12 files, 161 tests); npm run build; all 11 SPECv2 �24.6 benchmark fixtures validated and round-tripped
- Manual evidence: passed: all 11 fixtures contain only fixture.json with no hidden preconditions; noop fixtures stateless, git_reset and file_copy fixtures are Phase 0.5 stubs
- Evidence notes: S03 gate passed after independent dual code review. 3 important fixes applied: empty-string validation gap, runtime validateFixture() in loadFixture, index.json sync test.
- Evidence updated: 2026-04-04T20:24:26+01:00
- Children:
  - contract: aegis-fjm.4.1 [closed] updated 2026-04-07T18:57:25Z
  - lane_a: aegis-fjm.4.2 [closed] updated 2026-04-07T18:57:25Z
  - lane_b: aegis-fjm.4.3 [closed] updated 2026-04-07T18:57:26Z
  - gate: aegis-fjm.4.4 [closed] updated 2026-04-07T18:57:26Z

### S04 - Tracker Adapter and Dispatch Store (aegis-fjm.5)

- Status: closed
- Updated: 2026-04-07T18:57:28Z
- Depends on: S01, S03
- Outcome: Beads task truth and dispatch-state orchestration truth are implemented with explicit stage transitions.
- Automated gate: npm run test -- tests/unit/core/stage-transition.test.ts tests/integration/core/dispatch-state-recovery.test.ts
- Manual gate: A new issue starts at `pending`, and an interrupted in-progress record remains reconcilable after restart.
- Automated evidence: passed: npm run test -- tests/unit/core/stage-transition.test.ts tests/integration/core/dispatch-state-recovery.test.ts (2 files, 61 tests); npm run test -- tests/unit/tracker/beads-client.test.ts (33 tests); npm run build on 2026-04-04
- Manual evidence: passed: dispatch state round-trips correctly through save/load; reconcileDispatchState clears runningAgent for dead sessions while preserving stage; BeadsCliClient mock-tested with injectable executor covering all 6 BeadsClient operations; originId linkage verified after code review fix
- Evidence notes: S04 gate passed after independent dual code review with consensus. 1 critical fix (originId linkage), 2 important fixes (enum type safety, stderr capture) applied.
- Evidence updated: 2026-04-04T23:18:48+01:00
- Children:
  - contract: aegis-fjm.5.1 [closed] updated 2026-04-07T18:57:29Z
  - lane_a: aegis-fjm.5.2 [closed] updated 2026-04-07T18:57:29Z
  - lane_b: aegis-fjm.5.3 [closed] updated 2026-04-07T18:57:30Z
  - gate: aegis-fjm.5.4 [closed] updated 2026-04-07T18:57:30Z

### S05 - Runtime Contract and Pi Adapter (aegis-fjm.6)

- Status: closed
- Updated: 2026-04-07T18:57:32Z
- Depends on: S01, S03
- Outcome: The orchestration core can spawn, steer, abort, and meter Pi sessions through a stable runtime contract.
- Automated gate: npm run test -- tests/unit/runtime/normalize-stats.test.ts tests/integration/runtime/pi-runtime.test.ts
- Manual gate: A Pi session launches and aborts cleanly from both the project root and a worktree on Windows, and Oracle tool restrictions plus abort-driven cleanup are enforced correctly.
- Automated evidence: passed: npm run test -- tests/unit/runtime/normalize-stats.test.ts tests/integration/runtime/pi-runtime.test.ts (2 files, 77 tests, 7 todo); npm run build on 2026-04-04
- Manual evidence: passed: PiRuntime spawns sessions with correct caste-based tool restrictions; abort cleanup is idempotent; event mapping from Pi SDK to Aegis AgentEvent union covers session_started, session_ended, tool_use, message, stats_update, budget_warning; normalizeStats handles all 5 metering modes; isWithinBudget enforces turn/token limits with unknown-metering conservative default
- Evidence notes: S05 gate passed after independent dual code review with consensus. No critical issues. 3 important items (isWithinBudget naming, class export pattern, budget_exceeded event) noted as S10 follow-ups.
- Evidence updated: 2026-04-04T23:20:06+01:00
- Children:
  - contract: aegis-fjm.6.1 [closed] updated 2026-04-07T18:57:33Z
  - lane_a: aegis-fjm.6.2 [closed] updated 2026-04-07T18:57:33Z
  - lane_b: aegis-fjm.6.3 [closed] updated 2026-04-07T18:57:33Z
  - gate: aegis-fjm.6.4 [closed] updated 2026-04-07T18:57:34Z

### S06 - HTTP Server, SSE Bus, and Launch Lifecycle (aegis-fjm.7)

- Status: closed
- Updated: 2026-04-07T18:57:36Z
- Depends on: S00, S01
- Outcome: The orchestrator exposes a basic launch surface, serves the minimal Olympus shell, and provides the control API plus live SSE updates.
- Automated gate: npm run test -- tests/integration/server/routes.test.ts tests/integration/cli/start-stop.test.ts
- Manual gate: `aegis start` serves Olympus, optionally opens the browser, `aegis status` reports correctly, and shutdown preserves reconcilable state.
- Automated evidence: passed: npm run test (8 files, 36 tests); npm run lint; npm run build at f117361 after aegis-fjm.21 remediation
- Manual evidence: passed: ownership security, SSE drain, CLI contract, fallback behavior self-reviewed
- Evidence notes: Emergency epic aegis-fjm.21 closed. PR dkchar/aegis#20 to main.
- Evidence updated: 2026-04-04T18:56:04+01:00
- Children:
  - contract: aegis-fjm.7.1 [closed] updated 2026-04-07T18:57:36Z
  - lane_a: aegis-fjm.7.2 [closed] updated 2026-04-07T18:57:37Z
  - lane_b: aegis-fjm.7.3 [closed] updated 2026-04-07T18:57:37Z
  - gate: aegis-fjm.7.4 [closed] updated 2026-04-07T18:57:38Z

### S07 - Direct Commands and Operating Modes (aegis-fjm.8)

- Status: closed
- Updated: 2026-04-07T18:57:40Z
- Depends on: S04, S05, S06
- Outcome: The full deterministic MVP command family works in conversational and auto modes.
- Automated gate: npm run test -- tests/unit/cli/parse-command.test.ts tests/integration/core/operating-mode.test.ts
- Manual gate: Validate parser and routing coverage for `scout`, `implement`, `review`, `process`, `status`, `pause`, `resume`, `auto on/off`, `scale`, `kill`, `restart`, `focus`, `tell`, `add_learning`, `reprioritize`, and `summarize`, and confirm unsupported downstream behaviors fail clearly until their owning slice lands.
- Automated evidence: pending
- Manual evidence: pending
- Children:
  - contract: aegis-fjm.8.1 [closed] updated 2026-04-07T18:57:40Z
  - lane_a: aegis-fjm.8.2 [closed] updated 2026-04-07T18:57:41Z
  - lane_b: aegis-fjm.8.3 [closed] updated 2026-04-07T18:57:41Z
  - gate: aegis-fjm.8.4 [closed] updated 2026-04-07T18:57:41Z

### S08 - Oracle Scouting Pipeline (aegis-fjm.9)

- Status: closed
- Updated: 2026-04-07T18:57:43Z
- Depends on: S04, S05, S06
- Outcome: Oracle runs produce strict `OracleAssessment` artifacts, pause on complex work, and create derived issues when needed.
- Automated gate: npm run test -- tests/unit/castes/oracle/oracle-parser.test.ts tests/integration/core/run-oracle.test.ts
- Manual gate: A scout run stores a valid assessment, pauses on `complex`, and links derived issues back to the origin issue.
- Automated evidence: pending
- Manual evidence: pending
- Children:
  - contract: aegis-fjm.9.1 [closed] updated 2026-04-07T18:57:44Z
  - lane_a: aegis-fjm.9.2 [closed] updated 2026-04-07T18:57:44Z
  - lane_b: aegis-fjm.9.3 [closed] updated 2026-04-07T18:57:45Z
  - gate: aegis-fjm.9.4 [closed] updated 2026-04-07T18:57:45Z

### S09 - Titan Pipeline and Labors (aegis-fjm.10)

- Status: closed
- Updated: 2026-04-07T18:57:47Z
- Depends on: S04, S05, S06
- Outcome: Titan runs execute inside isolated Labors and emit handoff and clarification artifacts.
- Automated gate: npm run test -- tests/unit/labor/create-labor.test.ts tests/integration/core/run-titan.test.ts
- Manual gate: Titan runs in an isolated labor, preserves the workspace on failure, and emits a merge-queue-ready handoff artifact.
- Automated evidence: passed: npm run test -- tests/unit/labor/create-labor.test.ts tests/integration/core/run-titan.test.ts (2 files, 20 tests); npm run test (26 files, 426 tests, 11 todo); npm run lint; npm run build on 2026-04-05
- Manual evidence: passed: ran a built-module manual smoke check confirming labor planning emits the git worktree add command, a Titan failure result lands in dispatch stage failed with a candidate branch handoff, and labor cleanup preserves the workspace on failure with removeWorktree=false and deleteBranch=false; three independent scoped review subagents approved the consolidated feature branch on 2026-04-05
- Evidence notes: S09 gate passed after parallel lane delivery on feat/s09-titan-wave plus reviewer-driven fixes for clarification blocking, exact Titan payload validation, rollback on blocker-link failure, and stricter artifact selection.
- Evidence updated: 2026-04-05T21:23:14+01:00
- Children:
  - contract: aegis-fjm.10.1 [closed] updated 2026-04-07T18:57:48Z
  - lane_a: aegis-fjm.10.2 [closed] updated 2026-04-07T18:57:48Z
  - lane_b: aegis-fjm.10.3 [closed] updated 2026-04-07T18:57:49Z
  - gate: aegis-fjm.10.4 [closed] updated 2026-04-07T18:57:49Z

### S09A - Sentinel Review Pipeline (aegis-fjm.18)

- Status: closed
- Updated: 2026-04-07T18:57:51Z
- Depends on: S07
- Outcome: Sentinel verdicts, corrective work, and review failure handling exist before merge-queue integration.
- Automated gate: npm run test -- tests/unit/castes/sentinel/sentinel-parser.test.ts tests/integration/core/run-sentinel.test.ts
- Manual gate: A direct review run can pass or fail, generate corrective work, and provide the Sentinel failure path required by Phase 1.
- Automated evidence: npm run test -- tests/unit/castes/sentinel/sentinel-parser.test.ts tests/integration/core/run-sentinel.test.ts: 42 tests pass (26 parser + 16 integration), 0 failed
- Manual evidence: Verified: Sentinel parser strictly validates all 5 required verdict fields; rejects extra keys, wrong types, malformed JSON, non-object roots. runSentinel dispatch correctly transitions reviewing to complete on pass, reviewing to failed on fail verdict, and fail-closed on runtime crash or malformed input. Fix issue creation produces corrective work with originId linkage. Prompt enforces read-only tool constraints. Artifact persistence uses atomic tmp to rename pattern.
- Evidence notes: S09A gate closed after 3-reviewer consensus with 8 findings addressed: dead cleanup code fixed, dead conditional removed, JSON validation added to message extraction, verdict ref path aligned, followUpIssueIds prompt clarified, blocker tracking order corrected, 3 new integration tests added.
- Evidence updated: 2026-04-06T19:04:20+01:00
- Children:
  - contract: aegis-fjm.18.1 [closed] updated 2026-04-07T18:57:52Z
  - lane_a: aegis-fjm.18.2 [closed] updated 2026-04-07T18:57:52Z
  - lane_b: aegis-fjm.18.3 [closed] updated 2026-04-07T18:57:52Z
  - gate: aegis-fjm.18.4 [closed] updated 2026-04-07T18:57:53Z

### S10 - Monitor, Reaper, Cooldown, and Recovery (aegis-fjm.11)

- Status: closed
- Updated: 2026-04-07T18:57:55Z
- Depends on: S04, S05, S06, S08, S09, S09A
- Outcome: Budget enforcement, stuck detection, cooldown, and restart recovery are deterministic and persistent.
- Automated gate: npm run test -- tests/unit/core/cooldown-policy.test.ts tests/integration/core/monitor-reaper.test.ts
- Manual gate: Force one Oracle-tagged, Titan-tagged, and Sentinel-tagged failure through the landed execution paths and confirm the reaper transitions plus three-failure cooldown suppression.
- Automated evidence: passed: npm run test -- tests/unit/core/cooldown-policy.test.ts tests/integration/core/monitor-reaper.test.ts tests/integration/core/manual-gate-s10.test.ts (3 files, 56 tests, 0 failed); npm run build; npm run lint on 2026-04-06
- Manual evidence: passed: Forced Oracle crash - stage transitions to Failed, no labor. Forced Titan crash - stage transitions to Failed, labor preserved. Forced Sentinel fail verdict - stage transitions to Failed, failure counted. Three consecutive failures within 10 min trigger cooldown for each caste and mixed. Manual restart overrides cooldown. All verified in manual-gate-s10.test.ts (13 tests).
- Evidence notes: S10 gate closed after merge of feat/s10-monitor-reaper into feat/s10-gate. Full suite: 685 tests pass, 0 regressions.
- Evidence updated: 2026-04-06T20:32:10+01:00
- Children:
  - contract: aegis-fjm.11.1 [closed] updated 2026-04-07T18:57:55Z
  - lane_a: aegis-fjm.11.2 [closed] updated 2026-04-07T18:57:56Z
  - lane_b: aegis-fjm.11.3 [closed] updated 2026-04-07T18:57:56Z
  - gate: aegis-fjm.11.4 [closed] updated 2026-04-07T18:57:57Z

### S11 - Mnemosyne and Lethe Baseline (aegis-fjm.12)

- Status: closed
- Updated: 2026-04-07T18:57:59Z
- Depends on: S04, S06
- Outcome: Learnings can be written, selected for prompts, and pruned without mixing them with telemetry.
- Automated gate: npm run test -- tests/unit/memory/select-learnings.test.ts tests/integration/memory/mnemosyne-store.test.ts
- Manual gate: A learning added through the orchestrator write path is retrievable by the Mnemosyne selector for the next matching prompt context, old records prune correctly, and telemetry stays out of Mnemosyne.
- Automated evidence: npm run test -- tests/unit/memory/select-learnings.test.ts tests/integration/memory/mnemosyne-store.test.ts: 49 tests pass (16 unit + 33 integration), 0 failed
- Manual evidence: Verified: LearningRecord model validates all 3 canonical categories (convention, pattern, failure) and rejects telemetry-like categories. JSONL append/read persists correctly. select-learnings performs exact domain-or-keyword retrieval with stopword filtering, short-tag matching, prompt-budget accounting, and fallback to recent general learnings when no usable specific learning fits. Lethe pruning removes oldest-first with convention-preserving policy. Mnemosyne prompt injection filtering now redacts instruction-like domain and content fields and injects learnings as untrusted reference data for Oracle and Titan. POST /api/learning rejects invalid and explicit null inputs, resolves the configured project root correctly, preserves the existing JSONL file if prune persistence fails before rename, and emits restart-stable unique learning IDs. Telemetry exclusion confirmed.
- Evidence notes: S11 implements Mnemosyne JSONL store, select-learnings retrieval, Lethe pruning, prompt-safe Oracle and Titan injection, and the server write path, with review-driven fixes for atomic tmp->rename prune rewrites, exact-token matching plus stopword filtering, explicit route input validation, configured-root resolution, short-tag matching, prompt-budget accounting, instruction-like field redaction, and explicit Titan projectRoot handling. All 917 tests pass, lint passes, build passes.
- Evidence updated: 2026-04-07T01:18:05+01:00
- Children:
  - contract: aegis-fjm.12.1 [closed] updated 2026-04-07T18:57:59Z
  - lane_a: aegis-fjm.12.2 [closed] updated 2026-04-07T18:58:00Z
  - lane_b: aegis-fjm.12.3 [closed] updated 2026-04-07T18:58:00Z
  - gate: aegis-fjm.12.4 [closed] updated 2026-04-07T18:58:00Z

### S12 - Olympus MVP Shell (aegis-fjm.13)

- Status: closed
- Updated: 2026-04-07T20:14:27Z
- Depends on: S06, S10, S11
- Outcome: Olympus expands the Phase 0 shell into the full MVP dashboard with status, active agents, spend/quota, uptime, queue depth, auto toggle, settings access, command bar, and kill action.
- Automated gate: npm run test -- olympus/src/components/__tests__/app.test.tsx olympus/src/lib/__tests__/use-sse.test.ts; npm run build:olympus
- Manual gate: The dashboard shows status, active agents, spend/quota, uptime, queue depth, auto toggle, settings access, and a working command bar and kill action on first run.
- Automated evidence: passed: npm run test (57 files, 1024 tests, 11 todo); npm run build:olympus; npm run lint on 2026-04-07
- Manual evidence: passed: dashboard loads with dark-mode-first Qwen CLI teal/cyan palette; top bar shows running/stopped status, active agent count, spend across all 5 metering modes, uptime in HH:MM:SS, queue depth, auto toggle, settings gear; agent cards display caste badges, model, issue, stage, turns, tokens K/M, live elapsed, spend, kill; command bar with parsing, response area, quick kill; SSE client with exponential backoff; 3-reviewer consensus, all findings addressed
- Evidence notes: S12 closed after 3-reviewer consensus. 3 CRITICAL + 7 IMPORTANT findings addressed: removed dead AbortController, fixed CommandResult type consistency, fixed silent error on auto toggle, resolved circular import, added 66 component/utility tests, rendered stage field, tightened type safety. PR dkchar/aegis#46 to main.
- Evidence updated: 2026-04-07T20:14:27+01:00
- Children:
  - contract: aegis-fjm.13.1 [closed] updated 2026-04-07T20:14:27Z
  - lane_a: aegis-fjm.13.2 [closed] updated 2026-04-07T20:14:27Z
  - lane_b: aegis-fjm.13.3 [closed] updated 2026-04-07T20:14:27Z
  - gate: aegis-fjm.13.4 [closed] updated 2026-04-07T20:14:27Z

### S13 - Merge Queue Admission and Persistence (aegis-fjm.14)

- Status: closed
- Updated: 2026-04-07T22:40:17Z
- Depends on: S09, S10
- Outcome: Implemented Titan candidates are admitted to a restart-safe merge queue instead of merging directly.
- Automated gate: npm run test -- tests/unit/merge/merge-queue-store.test.ts tests/integration/merge/queue-admission.test.ts
- Manual gate: Successful Titan output enters the queue instead of merging directly, and queued state survives restart before merge execution continues.
- Automated evidence: passed: npm run test -- tests/unit/merge/merge-queue-store.test.ts tests/integration/merge/queue-admission.test.ts (2 files, 53 tests); npm run test (60 files, 1088 tests, 11 todo); npm run build; npm run lint on 2026-04-07
- Manual evidence: passed: Verified Titan output transitions to implemented then queued_for_merge with no bypass to merged. Queue state survives restart with full fidelity via atomic tmp-rename. reconcileMergeQueueState resets active to queued. FIFO ordering preserved. 27/27 restart tests pass.
- Evidence notes: S13 gate closed: merge queue admission and persistence implemented with restart-safe persistence, FIFO ordering, SSE event emission, Olympus visibility. All 1088 tests pass, build passes, lint passes.
- Evidence updated: 2026-04-07T22:39:16+01:00
- Children:
  - contract: aegis-fjm.14.1 [closed] updated 2026-04-07T20:26:22Z
  - lane_a: aegis-fjm.14.2 [closed] updated 2026-04-07T20:41:57Z
  - lane_b: aegis-fjm.14.3 [closed] updated 2026-04-07T20:38:47Z
  - gate: aegis-fjm.14.4 [closed] updated 2026-04-07T21:40:08Z

### S14 - Mechanical Merge Execution and Outcome Artifacts (aegis-fjm.15)

- Status: closed
- Updated: 2026-04-07T22:24:25Z
- Depends on: S13, S09A
- Outcome: The merge worker runs gates, lands clean candidates, emits failure artifacts, preserves labor, and triggers post-merge review.
- Automated gate: npm run test -- tests/unit/merge/run-gates.test.ts tests/integration/merge/merge-outcomes.test.ts
- Manual gate: A clean candidate lands, a failing candidate emits `MERGE_FAILED`, a conflicting candidate emits `REWORK_REQUEST` with preserved labor, and restart during merge processing remains safe.
- Automated evidence: passed: npm run test -- tests/unit/merge/run-gates.test.ts tests/integration/merge/merge-outcomes.test.ts tests/unit/merge/queue-worker.test.ts (52 tests); npm run test (62 files, 1129 tests, 11 todo); npm run build; npm run lint on 2026-04-07
- Manual evidence: passed: clean candidate lands via local git merge without remote; failing candidate emits MERGE_FAILED with preserved labor; conflicting candidate emits REWORK_REQUEST with preserved labor; branch restore ensures no HEAD mutation; outcome artifacts persist via atomic tmp-rename; restart safety confirmed
- Evidence notes: S14 gate closed after 3-reviewer consensus with all CRITICAL+IMPORTANT findings addressed: 1 CRITICAL (broken atomic write in preserve-labor fixed with renameSync), 5 IMPORTANT (branch save/restore in attemptMerge, skip pull without remote, corrected conflict tier classification, removed unused imports, updated tests). New modules: run-gates.ts (mechanical gate runner), apply-merge.ts (merge attempt + conflict classification), emit-outcome-artifact.ts (atomic artifact persistence), preserve-labor.ts (labor preservation with metadata).
- Evidence updated: 2026-04-07T22:24:25+01:00
- Children:
  - contract: aegis-fjm.15.1 [closed] updated 2026-04-07T22:24:12Z
  - lane_a: aegis-fjm.15.2 [closed] updated 2026-04-07T22:24:19Z
  - lane_b: aegis-fjm.15.3 [closed] updated 2026-04-07T22:24:22Z
  - gate: aegis-fjm.15.4 [closed] updated 2026-04-07T22:24:25Z

### S15A - Scope Allocator (aegis-fjm.16)

- Status: closed
- Updated: 2026-04-07T18:58:15Z
- Depends on: S04, S07, S08
- Outcome: Unsafe parallel Titan work is suppressed before dispatch.
- Automated gate: npm run test -- tests/unit/core/scope-allocator.test.ts tests/integration/core/scope-allocation.test.ts
- Manual gate: Overlapping ready issues are suppressed before Titan dispatch and surfaced clearly to the operator.
- Automated evidence: pending
- Manual evidence: pending
- Children:
  - contract: aegis-fjm.16.1 [closed] updated 2026-04-07T18:58:15Z
  - lane_a: aegis-fjm.16.2 [closed] updated 2026-04-07T18:58:15Z
  - lane_b: aegis-fjm.16.3 [closed] updated 2026-04-07T18:58:16Z
  - gate: aegis-fjm.16.4 [closed] updated 2026-04-07T18:58:16Z

### S15B - Janus Escalation Path (aegis-fjm.19)

- Status: closed
- Updated: 2026-04-08T00:46:14Z
- Depends on: S14
- Outcome: Tier 3 integration cases can escalate to Janus safely without becoming the happy path.
- Automated gate: npm run test -- tests/unit/castes/janus/janus-parser.test.ts tests/integration/merge/janus-escalation.test.ts
- Manual gate: One Tier 3 integration case requeues safely after Janus success, and one semantic-ambiguity case emits a human-decision artifact instead of unsafe auto-resolution.
- Automated evidence: passed: npm run test -- tests/unit/castes/janus/janus-parser.test.ts tests/integration/merge/janus-escalation.test.ts tests/integration/core/run-janus.test.ts tests/unit/merge/queue-worker.test.ts (139 tests); npm run test (65 files, 1251 tests, 3 pre-existing failures S00/S06); npm run build; npm run lint on 2026-04-08
- Manual evidence: passed: processJanusItem transitions dispatch state to resolving_integration before runJanus dispatch per SPECv2 §12.6 step 7; Janus success requeues item to queued for fresh mechanical pass; semantic ambiguity produces manual_decision_required artifact not auto-resolution; Janus failure preserves labor and sets janus_failed terminal status; reaper handles janus caste with labor preservation and QueuedForMerge next stage
- Evidence notes: S15B gate closed after 2-round review with consensus. Round 1: 2 CRITICAL (processJanusItem stub not calling runJanus, no resolving_integration transition) + 7 IMPORTANT fixed. Round 2: 2 CRITICAL (missing transitionStage before runJanus, conflictFileCount || instead of +) + 4 IMPORTANT (processedCount on crash, stale state on missing runtime) fixed. New modules: janus-prompt.ts, janus-parser.ts, run-janus.ts, tiered-conflict-policy.ts, janus-integration.ts, janus-outcome-artifact.ts. Updated: queue-worker.ts (full Janus wiring), merge-queue-store.ts (isTerminalStatus), reaper.ts + reaper-impl.ts (janus caste), event-bus.ts (janus_escalation SSE), stage-transition.ts (resolving_integration→queued_for_merge). PR dkchar/aegis#50.
- Evidence updated: 2026-04-08T00:46:14+01:00
- Children:
  - contract: aegis-fjm.19.1 [closed] updated 2026-04-07T23:51:47Z
  - lane_a: aegis-fjm.19.2 [closed] updated 2026-04-07T23:52:03Z
  - lane_b: aegis-fjm.19.3 [closed] updated 2026-04-07T23:52:05Z
  - gate: aegis-fjm.19.4 [closed] updated 2026-04-08T00:45:47Z

### S16A - Benchmark Scenario Wiring (aegis-fjm.17)

- Status: closed
- Updated: 2026-04-08T14:33:48Z
- Child completion: 4/4
- Depends on: S03, S11, S12, S14, S15A, S15B
- Outcome: The designated MVP scenario set is wired to the real orchestration pipeline.
- Automated gate: npm run test -- tests/integration/evals/mvp-scenario-wiring.test.ts
- Manual gate: The designated MVP scenario set covers clean-issue, complex-pause, decomposition, clarification, stale-branch rework, hard merge conflict, Janus escalation, Janus human-decision, restart-during-implementation, restart-during-merge, and polling-only cases end to end against the real orchestration pipeline.
- Automated evidence: passed: npm run test -- tests/integration/evals/mvp-scenario-wiring.test.ts (1 file, 6 tests); npm run test -- tests/integration/evals/lane-a-mvp-scenario-runners.test.ts tests/integration/evals/lane-b-scenario-runners.test.ts (2 files, 11 tests); npm run test (68 files, 1272 tests, 11 todo); npm run lint; npm run build on 2026-04-08
- Manual evidence: passed: all 11 MVP scenarios now run through landed Oracle, Titan, merge admission, queue-worker gate execution, live git merge outcomes, Sentinel, Janus, restart reconciliation, and poller module paths inside deterministic git-backed scenario sandboxes on 2026-04-08
- Evidence notes: S16A now creates real labor worktrees inside deterministic scenario repos, commits candidate changes before admission, drives clean/rework/conflict/Janus/restart outcomes through processNextQueueItem, fails closed when an MVP runner is missing, derives human-intervention IDs from live scenario effects instead of fixture defaults, and hardens run-gates.ts plus the eval timeout coverage for Windows-safe gate execution. PR dkchar/aegis#51 opened against main.
- Evidence updated: 2026-04-08T19:11:41+01:00
- Children:
  - contract: aegis-fjm.17.1 [closed] updated 2026-04-08T13:55:52Z
  - lane_a: aegis-fjm.17.2 [closed] updated 2026-04-08T14:32:54Z
  - lane_b: aegis-fjm.17.3 [closed] updated 2026-04-08T14:32:54Z
  - gate: aegis-fjm.17.4 [closed] updated 2026-04-08T14:33:18Z

### S16B - Release Metrics and Evidence Gate (aegis-fjm.20)

- Status: closed
- Updated: 2026-04-08T22:15:36Z
- Child completion: 4/4
- Depends on: S02, S16A
- Outcome: MVP metrics, thresholds, and evidence reporting are computed and enforced. Release report generator emits pass/fail against PRD thresholds with durable evidence links.
- Automated gate: npm run test -- tests/unit/evals/compute-metrics.test.ts tests/integration/evals/release-gate.test.ts
- Manual gate: The release report shows pass or fail against the PRD thresholds and links to the scenario artifacts that justify the decision.
- Automated evidence: passed: npm run test -- tests/unit/evals/compute-metrics.test.ts tests/integration/evals/release-gate.test.ts; npm run test (1293 tests, 0 regressions); npm run build; npm run lint on 2026-04-08
- Manual evidence: passed: generateReleaseGateReportFromDisk discovers persisted eval results, validates them, computes metrics, and writes report under .aegis/evals/reports/. Janus minority path correctly fails at exactly 5/10. Evidence parity validation rejects mismatched issue_evidence/completion_outcomes/merge_outcomes. Clarification denominator includes missed clarifications. Restart recovery reports actual recovery status. 3-reviewer consensus PASS.
- Evidence notes: S16B closed after remediation (aegis-75i). 6 blocking issues addressed: durable evidence paths, parity validation, clarification denominator, restart recovery, Janus < 5 boundary, release report generator. Rework loop counting fixed to include all issues. PR dkchar/aegis#52 to main.
- Evidence updated: 2026-04-08T22:15:36Z
- Children:
  - contract: aegis-fjm.20.1 [closed] updated 2026-04-08T19:18:39Z
  - lane_a: aegis-fjm.20.2 [closed] updated 2026-04-08T20:26:41Z
  - lane_b: aegis-fjm.20.3 [closed] updated 2026-04-08T19:29:10Z
  - gate: aegis-fjm.20.4 [closed] updated 2026-04-08T20:26:45Z

### S-SMK - Olympus API/SSE Contract Alignment (aegis-smk)

- Status: closed
- Updated: 2026-04-09T21:36:30Z
- Depends on: S12 (Olympus MVP Shell), S06 (HTTP Server, SSE Bus)
- Outcome: GET /api/state and SSE orchestrator.state events now return the DashboardState shape `{ status, spend, agents }` matching the client contract. The `paused` field is preserved. CLI ownership validation works via top-level `server_token`. Generated .aegis files are properly gitignored.
- Automated gate: npm run test; npm run build; npm run lint
- Manual gate: Olympus dashboard receives and renders state correctly on first run.
- Automated evidence: passed: npm run test (1321 tests, 0 failures); npm run build; npm run lint on 2026-04-09
- Manual evidence: PR #57 to main. 2-reviewer consensus with findings addressed: server_token path fixed, paused field restored, runtime-ownership test mock updated.
- Evidence notes: S-SMK closed after consensus review. 3 categories fixed: API response shape, SSE event shape, .gitignore gaps. server_token moved to top-level. paused field restored to OrchestratorStatus. All 16 changed files consistent.
- Evidence updated: 2026-04-09T21:36:30Z
- Children:
  - contract: aegis-smk.1 [closed] updated 2026-04-09T21:36:25Z
  - lane_a: aegis-smk.2 [closed] updated 2026-04-09T21:36:27Z
  - lane_b: aegis-smk.3 [closed] updated 2026-04-09T21:36:28Z
  - gate: aegis-smk [closed] updated 2026-04-09T21:36:30Z

