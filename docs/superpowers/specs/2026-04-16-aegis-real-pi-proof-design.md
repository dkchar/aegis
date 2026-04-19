# Aegis Real Pi Proof Design

## Scope and relationship to existing source of truth

This addendum extends emergency MVP rewrite after Phase F and planned Phase G proof-reset work.

It exists because current MVP rewrite proves deterministic orchestration and scripted end-to-end behavior, but does not yet prove real model-driven agent labor from Aegis config.

This addendum follows rule from emergency triage design that future planning should continue through focused addenda rather than reopening older broad product specs.

Assumption:
- `phase-g-proof-reset` or equivalent Phase G proof-reset changes land before work in this addendum starts

If this addendum conflicts with older expectations that scripted proof is sufficient for MVP completion, this addendum wins.

## Problem statement

Current stripped MVP proves:
- Beads-backed orchestration truth
- dispatch-state and merge-queue persistence
- deterministic daemon and direct-command behavior
- deterministic merge queue semantics
- deterministic Janus escalation semantics
- terminal-first observability

Current stripped MVP does not yet prove:
- configured per-caste Pi model selection is truly used at runtime
- configured provider is authenticated and usable before live work begins
- real Oracle, Titan, Sentinel, and Janus sessions can operate on seeded Beads issues
- real issue implementation in observable mock-run labor git worktrees
- visible parallel live-agent execution across multiple ready issues

Real agentic execution is part of MVP. Scripted runtime alone is not sufficient end-state proof.

## Goals

- prove real all-caste agentic execution in mock-run surface
- keep proof terminal-first and fully inspectable by human or observing agent
- drive live caste sessions from Aegis config, not hidden Pi defaults
- use exact configured provider/model refs for each caste
- allow all castes to use `openai-codex:gpt-5.4-mini` with `medium` thinking as initial default
- execute real work against seeded Beads issue graph that visibly demonstrates bounded parallelism
- implement work inside mock-run labor git worktrees so changed files, branches, and merges are inspectable
- avoid automated proof tests that spend paid model tokens in CI

## Non-goals

- no attempt to make paid-model proof part of default CI
- no Olympus/dashboard work
- no SSE transport work
- no economics or quota systems
- no reopening Mnemosyne, Lethe, or Beads-native messaging
- no broad runtime-provider abstraction rewrite beyond what live proof requires

## Design principles

- keep seam tests deterministic and cheap
- keep live proof explicit, operator-run, and artifact-rich
- fail fast when configured model cannot run with current authenticated provider set
- make live agent behavior obvious from terminal output and durable artifacts
- preserve generic tracker semantics and Phase F merge queue semantics
- add minimum config needed to select model and thinking level per caste

## Current state snapshot

As of this addendum:
- `main` has Phase F complete
- Phase G proof reset exists as pending follow-on work and should land first
- `runtime: "pi"` exists, but current Pi runtime path does not yet prove that Aegis per-caste configured model refs drive live sessions end-to-end
- seeded mock-run issues already contain useful coordination graph with contract, parallel lanes, and gates

That seeded graph is correct proof surface for visible parallelism and should be reused rather than replaced with flatter demo tasks.

## Runtime and config extensions

### Runtime modes

Keep:
- `runtime: "scripted"` for deterministic seam testing and cheap local development
- `runtime: "pi"` for live model-backed execution

Do not remove scripted runtime. It remains seam-test adapter and low-cost fallback.

### Model selection

Current `models` map stays and becomes runtime-enforced:
- `models.oracle`
- `models.titan`
- `models.sentinel`
- `models.janus`

Each model ref must remain exact `provider:model-id`.

Initial recommended live default:
- `openai-codex:gpt-5.4-mini` for all castes

### Thinking selection

Add new config map:
- `thinking.oracle`
- `thinking.titan`
- `thinking.sentinel`
- `thinking.janus`

Allowed values should match Pi thinking levels. Initial live default:
- `medium` for all castes

Reason:
- model identity and thinking level are separate runtime controls
- overloading both into one string would create fragile parsing and unclear validation

### Mock-run default config

Seeded mock-run config should default live-ready values but still allow explicit fallback to scripted mode.

Live-ready mock-run default:
- `runtime: "pi"`
- all caste models set to `openai-codex:gpt-5.4-mini`
- all caste thinking levels set to `medium`
- `labor.base_path` pointed at configured mock-run labor root (seeded profile uses `.aegis/labors/`)

## Provider authentication and model validation

Startup and direct-command preflight must validate more than syntax.

For each configured caste model:
1. parse configured `provider:model-id`
2. resolve exact provider and exact model from Pi model registry
3. verify provider currently has configured auth
4. resolve request auth for that exact model
5. fail startup before any live work if auth is missing or unusable

Error behavior:
- do not print full provider/model universe
- do print selected caste, configured ref, and reason for failure
- if provider is not authenticated, print currently authenticated provider ids
- if provider exists but model does not, print provider-specific concise guidance

Detection strategy should prefer Pi auth/model APIs over homegrown provider lists so Aegis only cares about authenticated providers and exact selected models.

## Live labor execution surface

### Real worktree requirement

Each executable issue must run in real git worktree, not in-place folder mutation.

For mock-run:
- root repo stays at `aegis-mock-run/`
- live issue worktrees live under configured `labor.base_path` (seeded profile uses `aegis-mock-run/.aegis/labors/<issue-id>/`)
- each worktree uses candidate branch derived from issue id

For non-mock repos:
- keep generic labor planning through configured labor base path
- labor path may still point outside repo root if operator chooses

### Issue materialization

Every live executable issue should materialize:
- issue metadata snapshot
- issue title and description
- dependency context
- expected acceptance notes if present
- allowed/target files when known

Materialization should be written into durable artifact/log surface before live prompt starts so observer can inspect exact task framing.

## Observability contract

Live proof must be fully observable from terminal and durable files.

For every caste run, persist:
- caste name
- issue id
- provider
- model id
- thinking level
- prompt/input artifact
- session id
- working directory
- branch name if applicable
- tool execution stream or summarized tool event log
- final assistant output
- failure reason if failed
- transcript path

For Titan and Janus, additionally persist:
- changed-files manifest
- git status snapshot before and after run
- diff/patch artifact or git diff artifact reference

For merge execution, persist:
- queue item id
- merge target branch
- merge result tier
- conflict summary if any

Terminal output must surface enough to let human or observing agent answer:
- which issues are running now
- which caste and model each issue is using
- which worktree path each issue owns
- what changed
- why issue advanced, requeued, or failed

## Proof strategy

### Cheap automated tests

Keep automated tests focused on seams:
- config parsing and validation
- provider/model preflight behavior with fake auth/model registries
- worktree planning and cleanup behavior
- transcript and artifact persistence
- daemon/monitor/reap state transitions
- merge queue orchestration using deterministic fakes

These tests must not invoke paid live models.

### Live proof runs

Real model proof moves to explicit observable mock-run flow for humans or QA agents.

That proof surface should be:
- repeatable
- scripted enough to run consistently
- not part of default CI
- obvious to inspect from terminal plus `.aegis/` artifacts

Acceptable proof modes:
- human-driven local run
- QA-agent-driven local run
- recorded artifact review from previous live run

Not acceptable:
- fake acceptance test pretending live Pi work happened
- CI tests that spend model tokens on every push

## Phase plan

### Phase H: Pi substrate truth

Goal:
- make Aegis config truly control live Pi execution

Required outcomes:
- new `thinking` config map exists and validates
- Pi runtime resolves exact caste model and thinking from Aegis config
- startup/direct-command preflight blocks on unauthenticated or unusable configured model
- live caste session artifacts include provider, model, thinking, prompt, session id, transcript, working directory
- no paid-model tokens used by automated tests

Exit proof:
- deterministic seam tests cover config/preflight/runtime wiring
- one human-readable mock-run command shows live session metadata using configured model

### Phase I: Titan, Sentinel, and real merge proof

Goal:
- prove real implementation, merge, and post-merge review for executable seeded issues

Required outcomes:
- Titan runs live in labor git worktree and edits real files
- merge queue performs real git merge in mock-run repo
- Sentinel runs live after merge success and closes issue on pass
- artifacts include changed-files manifest and diff references

Exit proof:
- observable mock-run slice from ready issue to reviewed issue
- no CI token gate

### Phase J: Oracle and visible parallelism proof

Goal:
- prove live bounded parallel execution on seeded Beads graph

Required outcomes:
- reuse existing seeded coordination graph with contract, lanes, and gates
- Oracle runs live on seeded issues
- daemon visibly launches concurrent live work on independent ready issues
- monitor/reap keep state readable while multiple live sessions run
- gate issues remain blocked until prerequisite lanes finish

Exit proof:
- operator can watch at least two lane issues run in parallel and later unblock gate issue

### Phase K: Janus live conflict proof

Goal:
- prove real T3 conflict handling with live Janus execution

Required outcomes:
- seeded mock-run can produce real merge conflict requiring T3 escalation
- Janus runs live against preserved labor artifacts and merge context
- Janus either requeues safely or emits manual-decision artifact
- outcome remains terminal-visible and durable

Exit proof:
- one observable live conflict run demonstrates Janus path end-to-end

### Phase L: Full MVP proof package

Goal:
- provide final human/QA-visible proof path for real all-caste MVP

Required outcomes:
- runbook documents exact live mock-run proof procedure
- proof artifacts are organized enough for post-run inspection by human or agent
- full seeded scenario covers Oracle, Titan, Sentinel, Janus, merge queue, and visible parallelism
- default CI remains cheap and deterministic

Exit proof:
- human or QA agent can run documented flow and verify real model-backed orchestration from artifacts without code archaeology

## Implementation boundaries

Do first:
- Phase H

Do next only after Phase H substrate stable:
- Phase I
- Phase J
- Phase K
- Phase L

Do not collapse H-L into one PR.

Recommended PR boundaries:
- PR 1: Phase H only
- PR 2: Phase I only
- PR 3: Phase J only
- PR 4: Phase K only
- PR 5: Phase L docs/runbook cleanup only

## Risks and controls

Risk:
- live provider auth drifts across machines
Control:
- fail fast with authenticated-provider-aware preflight and explicit operator error

Risk:
- live proof flakes due to model nondeterminism
Control:
- keep seeded tasks narrow, file-scoped, and easy to inspect

Risk:
- token cost balloons in automated loops
Control:
- no paid-model CI acceptance tests
- live proof only on explicit operator or QA runs

Risk:
- parallel live work causes overlapping file edits
Control:
- seeded graph and file scopes must keep parallel lane ownership disjoint

Risk:
- Janus conflict scenario becomes hard to reproduce
Control:
- seed conflict-producing issue pair intentionally in mock-run graph

## Success criteria

Emergency MVP is not complete until all are true:
- Aegis config selects live provider, model, and thinking level per caste
- preflight blocks unauthenticated or unusable live model refs before work starts
- live castes operate on real seeded Beads issues in mock-run labor git worktrees
- daemon visibly processes independent ready issues in parallel
- real merge and real post-merge review occur
- real Janus conflict path occurs
- observer can verify whole run from terminal output and `.aegis/` artifacts without hidden state

## Self-review

Consistency checks:
- proof strategy explicitly avoids paid-model CI gates
- phase order matches user-approved substrate-first approach
- seeded Beads graph is reused for parallelism proof
- provider-auth validation uses exact configured model refs
- labor-worktree requirement is explicit; mock-run seeded profile satisfies it via `labor.base_path: ".aegis/labors"`
