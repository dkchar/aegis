# Control Loop And Decisions

`docs/AEGIS.md` is the canonical source of truth. This document expands how the loop reasons.

## Loop

```text
poll -> triage -> dispatch -> monitor -> reap
```

Each phase is deterministic. Aegis reads current truth planes, computes the next state, writes durable records, and exposes the result through terminal status and Olympus.

## Poll

Poll reads Agora task truth. It discovers tickets, dependencies, columns, scope, and leases.

Poll does not decide implementation strategy.

## Triage

Triage decides what state each issue is in:

- ready for Oracle scouting
- ready for Titan implementation
- waiting on Sentinel review
- queued for merge
- blocked on child work
- failed operationally
- exhausted by retry policy
- complete

Triage also recovers stranded review records when durable artifacts prove the correct next state.

## Dispatch

Dispatch starts bounded sessions when work is runnable.

Dispatch considers:

- dependencies
- file scope
- scope overlap with running sessions
- configured concurrency
- adapter availability
- cooldown and retry ceilings

## Monitor

Monitor observes running sessions and durable runtime output.

Monitor does not accept narrative success alone. It expects transcript, artifact, status, and candidate evidence that match the adapter contract.

## Reap

Reap turns finished sessions into durable orchestration outcomes:

- Oracle context
- Titan handoff
- Sentinel verdict
- Janus integration result
- operational failure record

## Mutation Policy

Castes never write Agora directly. They may propose typed outcomes. Aegis decides graph mutation.

Examples:

- Sentinel `route=rework_owner` sends the owner back to Titan.
- Sentinel `route=create_blocker` goes through policy code that creates or reuses a blocking child.
- Janus can return work to the parent or propose an integration blocker.

## Merge Decisions

Merge decisions are mechanical:

- candidate branch exists
- diff is in scope
- root mutation is explained and accepted
- Sentinel gate passed
- merge queue item is valid
- integration succeeds or routes to Janus

Each daemon cycle drains the merge queue: every queued item is attempted at most once per pass, fewest attempts first, so a requeued candidate never blocks fresh ones. A merge executor error marks the queue item failed and the issue `failed_operational` with retry accounting; nothing is left stranded in `merging`. A queue item whose dispatch record is missing or out of stage fails closed instead of stalling the queue. Candidates that pass Sentinel again are re-queued automatically.

T3 escalation never runs model work inside the merge step. The issue moves to `resolving_integration` and the queue item settles as failed with `lastOutcome` and `lastError`. The daemon then launches Janus as an adapter session within `max_janus`; Janus reads its merge context from the queue item, and the reaper settles its outcome (rework, blocker, or `failed_operational` on session failure). Without a daemon, `aegis process <issue>` runs the escalated Janus directly.

## Operational Exhaustion

Provider, runtime, or tool failures are first-class outcomes. Aegis reports exhausted work visibly rather than spending adapter quota indefinitely.

Every failure path goes through `src/core/failure-policy.ts`:

- each failure increments `failureCount` and `consecutiveFailures` and sets a 30 second cooldown
- three consecutive failures exhaust the issue (`operational_failure_limit`)
- provider usage-limit errors exhaust immediately and pause the daemon
- a Titan `failure` outcome counts as an operational failure, and the reaper keeps that accounting even though the session itself finished
- Sentinel failures retry once at the review layer before escalating to Titan

## Recovery

After each poll, `src/core/dispatch-recovery.ts` repairs records from durable evidence:

- rework, blocked, or failed records whose tracker ticket is closed become `complete`
- parents whose policy blocker child is done restart from scouting
- failed Titan records with a valid durable handoff return to `implemented`
- failed Titan labors holding only in-scope uncommitted edits retry Titan without wiping the labor
- stranded `reviewing` records with a readable Sentinel verdict are routed from the verdict; otherwise Sentinel runs again
- on daemon start, an interrupted `merging` record requeues and `resolving_integration` work awaiting Janus keeps waiting for its launch; a clean stop leaves released Janus work in `resolving_integration` for relaunch
- a `merging` queue item stranded by an interrupted merge is requeued when its issue is `queued_for_merge` again
