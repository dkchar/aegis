# Aegis Convergence Control Plane Design

Date: 2026-04-24
Status: Proposed

## Purpose

Redefine caste authority, graph mutation, and loop control so Aegis reduces a ready issue graph toward completion instead of allowing LLM-driven graph self-amplification.

This design replaces the current ambiguous "failed" retry semantics and removes LLM veto power from Oracle and graph-mutation power from Sentinel. The target is a deterministic control plane with explicit mutation policy and narrow caste authority.

## Problem

Recent live Pi runs exposed a convergence failure mode:

- Oracle could emit semantic outputs like `decompose=true` or `ready=false` that behaved like execution vetoes.
- Sentinel could fail review and create follow-up issues while the parent issue remained runnable.
- Failed records were retried without distinguishing transient operational failure from semantic workflow outcomes.
- The system could enlarge the graph without making the originating parent not-ready, causing loops and churn instead of closure.

The result was an orchestration loop that could keep creating or redispatching work without shrinking the tracker's ready set.

## Goals

- Make the ready graph shrink toward zero in normal operation.
- Allow graph growth only for accepted blocking mutations.
- Ensure every accepted blocking mutation makes the parent issue not-ready.
- Keep public caste boundaries narrow and authority-based.
- Preserve rich agent output while moving control decisions into deterministic policy.
- Support lower-tier Oracle models without letting them gate execution.

## Non-Goals

- Adding new public castes.
- Building an intermediate "bridge" design before this target model.
- Reopening Olympus or dashboard work.
- Broadening Sentinel into repo-wide debt triage.

## Core Design

### Public castes remain fixed

Top-level public castes stay:

- Oracle
- Titan
- Sentinel
- Janus

Private sub-steps or sub-modes may be added later inside a caste, but they must not appear as new top-level orchestration authorities unless they own a distinct artifact, failure policy, and stop condition.

### Deterministic control plane owns graph mutation

Castes do not write Beads directly.

Any workflow mutation must go through an explicit structured mutation tool. The mutation tool is mediated by deterministic policy code, which is the only writer for:

- Beads issue creation or reuse
- parent blocking dependencies
- dispatch-state mutation caused by accepted/rejected proposals
- merge-queue side effects

This is the target design directly, not a transitional step.

## Caste Authority Contract

### Oracle

Oracle is mandatory on every issue for now.

Oracle authority:

- scout only
- produce a scout artifact
- provide file map, risk hints, likely tests, ambiguity notes, and complexity guidance

Oracle may not:

- veto Titan dispatch
- create or request graph mutations
- block a parent issue

Oracle output is advisory context, not permission.

Titan dispatch is blocked only by deterministic system facts such as tracker readiness, concurrency, config/runtime preconditions, or policy-state guards.

### Titan

Titan is the sole execution caste.

Titan authority:

- implement the parent issue
- produce implementation artifacts and labor output
- call the mutation tool when execution reveals blocking missing work

Allowed Titan mutation proposals:

- clarification blocker
- prerequisite blocker
- required out-of-scope dependency blocker

Titan may not:

- create non-blocking follow-up issues in auto mode
- decompose the issue graph for convenience
- widen scope into general planning or cleanup triage

If a Titan mutation proposal is accepted, the parent becomes blocked on the child issue and leaves the ready queue.

### Sentinel

Sentinel is a pre-merge gate only.

Sentinel authority:

- review the candidate before merge
- emit a gate verdict
- emit non-blocking advisories

Sentinel may block only on:

- the original issue contract
- regressions introduced in the touched scope

Sentinel may not:

- create issues
- mutate the graph
- reopen work for unrelated repo-wide debt or ambient quality concerns

Sentinel output must separate:

- blocking findings
- advisories

Blocking findings send the same parent back to Titan as rework. Advisories are logged only.

### Janus

Janus handles merge/integration failures only.

Janus authority:

- requeue the same parent when the integration problem remains within parent scope
- propose an explicit blocking integration issue when the root cause is outside parent scope

Janus may not:

- create non-blocking follow-up issues
- take over normal implementation or review duties

## Mutation Tool and Policy Contract

### Tool model

Castes use one structured mutation tool instead of direct tracker writes.

Each proposal includes:

- `origin_issue_id`
- `origin_caste`
- `proposal_type`
- `reason`
- `summary`
- `blocking`
- `suggested_title`
- `suggested_description`
- `dependency_type`
- `scope_evidence`
- `fingerprint`

### Allowed proposal types

Titan:

- `create_clarification_blocker`
- `create_prerequisite_blocker`
- `create_out_of_scope_blocker`

Janus:

- `requeue_parent`
- `create_integration_blocker`

Oracle and Sentinel have no allowed mutation proposal types.

### Policy layer behavior

The deterministic policy layer:

- validates caste permissions
- rejects non-blocking issue creation in auto mode
- rejects mutation attempts from Oracle and Sentinel
- rejects proposals with missing evidence
- rejects proposals that would not actually remove the parent from readiness
- deduplicates by stable fingerprint and reuses an existing open issue when appropriate

If accepted:

- create or reuse the child issue
- create the blocking tracker dependency
- set parent dispatch state to `blocked_on_child`
- persist a policy artifact with acceptance details

If rejected:

- persist a rejection artifact
- fail the originating caste run closed as an operational/policy failure

## Dispatch-State Redesign

The current overloaded `failed` state is insufficient. Dispatch state must distinguish semantic workflow outcomes from retryable runtime failures.

### Canonical states

Primary path:

- `pending`
- `scouting`
- `scouted`
- `implementing`
- `implemented`
- `reviewing`
- `queued_for_merge`
- `merging`
- `complete`

Side-path states:

- `failed_operational`
- `blocked_on_child`
- `rework_required`
- `resolving_integration`

### State meaning

- `failed_operational`
  - runtime/tool/provider/policy execution failure
  - retryable with cooldown and lane-aware policy

- `blocked_on_child`
  - parent is blocked on an accepted Titan or Janus child issue
  - not dispatchable until tracker readiness returns

- `rework_required`
  - same parent must return to Titan with prior review or integration context
  - no new issue is created

### Key transitions

- `scouting -> failed_operational`
  - Oracle runtime or parse failure

- `implementing -> blocked_on_child`
  - accepted Titan blocker proposal

- `implementing -> failed_operational`
  - Titan runtime/tool/provider/policy failure

- `implemented -> reviewing`
  - candidate exists, Sentinel reviews before merge

- `reviewing -> rework_required`
  - Sentinel returns `fail_blocking`

- `reviewing -> queued_for_merge`
  - Sentinel returns `pass`

- `queued_for_merge -> merging`
  - merge worker starts

- `merging -> complete`
  - merge succeeds

- `merging -> resolving_integration`
  - merge needs Janus

- `resolving_integration -> rework_required`
  - Janus recommends same-parent rework

- `resolving_integration -> blocked_on_child`
  - Janus accepted integration blocker is outside parent scope

- `resolving_integration -> failed_operational`
  - Janus operational failure

## Loop Behavior

### Oracle runs once by default

Oracle should not rerun on every same-parent loop.

Default rule:

- run Oracle once when an issue first enters the pipeline
- reuse the Oracle artifact through same-parent rework loops

Rerun Oracle only when:

- the parent issue text changed materially
- accepted child resolution changed scope or requirements materially
- the operator explicitly requests re-scouting

### Same-parent rework loops

Rework should stay on the same parent for:

- Sentinel blocking findings
- Janus in-scope integration feedback

That rework loop goes back to Titan, not Oracle.

### Blocking child loops

If Titan or Janus creates an accepted blocking issue:

- parent remains open
- parent becomes blocked in the tracker
- parent dispatch state becomes `blocked_on_child`
- parent cannot return to the ready queue until dependency resolution

When the child closes and the parent becomes ready again:

- if scope is materially unchanged, resume Titan with existing scout context
- if scope changed materially, rerun Oracle first

## Sentinel Review Model

Sentinel uses a binary control plane and a rich advisory plane.

Control plane:

- `pass`
- `fail_blocking`

Advisory plane:

- warnings
- notes
- informational guidance

Only `fail_blocking` changes control flow. Advisories never reopen work and never create issues.

This keeps deterministic workflow branching crisp while preserving nuance for operators and later analysis.

## Merge Boundary

The merge boundary changes to:

- `implemented -> reviewing -> queued_for_merge -> merging -> complete`

This means:

- Titan produces a candidate branch
- Sentinel gates the candidate before it is admitted to the merge queue
- only passing candidates enter merge execution
- Janus sees only true integration failures, not ordinary review failures

## Verification Requirements

### Deterministic seam tests

Must cover at least:

- Oracle mutation attempts are rejected
- Sentinel mutation attempts are rejected
- Titan blocking proposals are accepted, reused, and rejected correctly
- Janus same-parent requeue vs integration-blocker split
- `blocked_on_child` never dispatches
- `rework_required` dispatches Titan, not Oracle
- `failed_operational` retries only by explicit cooldown and lane policy
- Sentinel failure does not create a new issue
- Titan clarification removes the parent from `bd ready`

### Live proof expectations

In live proof runs:

- ready graph shrinks toward zero
- graph grows only on accepted blocking mutations
- every growth event makes the originating parent not-ready
- no caste may create extra work while leaving the parent still runnable

## Migration Guidance

Implementation should aim directly at this model with tight scope.

Do not build an intermediate hybrid where:

- Oracle still has readiness veto power
- Sentinel still creates issues
- generic `failed` continues to mix semantic outcomes with transient runtime errors

Those hybrid shapes preserve the same convergence hazards that caused recent live-run churn.

## Acceptance Criteria

This design is successful when:

- Oracle is mandatory but advisory-only
- Titan is the only normal execution caster with blocking mutation authority
- Sentinel is pre-merge, binary-gated, and non-mutating
- Janus only mutates graph for out-of-scope integration blockers
- accepted blockers always remove the parent from readiness
- same-parent rework loops do not spawn new issues
- ready work steadily reduces under autonomous execution
