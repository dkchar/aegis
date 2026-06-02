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

## Operational Exhaustion

Provider, runtime, or tool failures are first-class outcomes. Aegis reports exhausted work visibly rather than spending adapter quota indefinitely.
