# Aegis Source Of Truth

Date: 2026-05-01
Status: Canonical

This document is the only active product and architecture spec for Aegis.

It supersedes all older specs, addenda, plans, discovery notes, and follow-up docs. Older docs are historical only and must not be used as planning or implementation authority.

## Product Definition

Aegis is a terminal-first deterministic multi-agent orchestrator for software work.

It reads task truth from Agora, tracks orchestration truth in `.aegis`, runs agents through runtime adapters, and integrates work through a deterministic merge queue.

Aegis is not a dashboard product first. It is not an agent chatroom. Agora is its lightweight ticket graph, not an optional sidecar.

Core loop:

```text
poll -> triage -> dispatch -> monitor -> reap
```

Swarm posture:

- Agents are free inside assigned scope to inspect, reason, edit, test, and choose implementation tactics.
- Agents do not own orchestration truth, graph mutation, merge routing, retry policy, or durable completion semantics.
- Swarm behavior comes from many scoped agents moving concurrently through deterministic shared state, not from a manager-agent prompt deciding the control plane.
- Cross-agent handoffs must be typed artifacts that the control plane validates and routes mechanically. Prompt text may explain intent, but must not be the only enforcement layer.
- Agents do not message each other. Typed handoff artifacts are the message layer: Aegis routes them, the loop event log records them, and Olympus shows them as signals. A free-form agent channel would move orchestration decisions into prose that the control plane cannot validate.
- Review findings are typed control inputs. Sentinel may identify `finding_kind`, `required_files`, `owner_issue`, and `route`, but Aegis routes those findings deterministically.
- Operational exhaustion is a first-class control outcome. The daemon must halt or skip exhausted work visibly rather than consuming adapter quota indefinitely.
- Step 1 proof allows typed, bounded graph amplification. Agents may discover blockers, but Aegis decides mechanically whether to rework the owner, reopen prior work, or create a child issue.

Truth planes:

| Concern | Source |
| --- | --- |
| task truth | Agora `.agora/tickets.json` plus `.agora/events.jsonl` |
| orchestration truth | `.aegis/dispatch-state.json` |
| merge truth | `.aegis/merge-queue.json` |
| durable observability | `.aegis/logs/` (loop event log `phases.jsonl`, daemon log, session streams) and caste artifacts |
| runtime execution | adapter-owned sessions |

## Current Goal

Step 1 is not complete until Aegis has at least one real adapter that fully drains the seeded animated React todo graph and produces a working app.

That run is the MVP proof. Scripted seam tests are necessary but insufficient.

Required proof:

- Seeded Agora graph drains: no executable ticket remains in `ready`, `in_progress`, `in_review`, `blocked`, or `ready_to_merge`; no ticket is `halted`.
- Generated app is an animated React todo app matching seeded graph intent.
- App installs, builds, and runs.
- Oracle, Titan, Sentinel, Janus, merge, and dispatch artifacts explain the path.
- Any graph amplification is typed, bounded, auditable, and routed by Aegis rather than inferred by Titan from prose.
- No agent writes outside its labor or permitted merge/integration scope.
- No hidden root mutation is accepted. Clean, in-scope root commits made by a live agent may be adopted as explicit candidates when Aegis can prove the diff, scope, and artifact match.
- Merge queue lands work deterministically.
- Human or QA agent can verify outcome through terminal output and `.aegis` files.

## We Are Here

Built or mostly built:

- Terminal daemon and direct commands.
- Core loop shell.
- Agora tracker integration through the generic tracker boundary.
- `.aegis` dispatch, runtime, log, transcript, and caste artifact surfaces.
- Deterministic scripted runtime for seam tests.
- Pi-backed live runtime path.
- Codex (`codex exec`) and Claude Code (`claude -p`) CLI runtime adapters implementing the same contract.
- Merge queue and Janus escalation shell.
- Convergence control plane direction: Oracle advisory, Titan execution, Sentinel gate, Janus integration escalation.
- Recent hardening around file scope, root mutation detection, committed diff proof, scope-overlap scheduling, and Pi tool jailing.
- Verified merge path: candidates merge and verify in an integration worktree; the root only fast-forwards to verified results.

Not proven:

- Full seeded animated React todo graph drain with a real adapter.
- Stable live adapter contract across long, concurrent, model-backed runs.
- Working app proof from the seeded graph.
- Olympus.

Current implementation posture:

- Treat Pi as current real adapter under test.
- Do not assume Pi is trustworthy until it drains the seeded graph under the adapter contract.
- If Pi remains flaky after adapter-contract enforcement, jump to Codex adapter rather than continuing Pi-specific harness patches.

## Roadmap

### Step 1: Prove Aegis Core With One Real Adapter

Goal:

- One real adapter drains the seeded animated React todo graph into a working product.

Scope:

- adapter contract
- seeded graph proof
- live Oracle/Titan/Sentinel/Janus path
- labor isolation
- deterministic merge queue
- terminal and durable artifact observability

Allowed adapters:

- Pi first, because code exists.
- Codex next, pre-approved fallback if Pi violates contract or remains flaky.
- Claude Code, approved under the same contract (see Claude Code Adapter).

Exit gate:

- Agora seeded executable tickets all reach `done`, with no `halted` tickets.
- The React todo app runs.
- All artifacts and logs support the claim.

Valid direct root adoption is allowed only when Aegis proves the root was clean before and after, the root head advanced linearly, the committed diff exactly matches the Titan artifact and file scope, and Sentinel still gates the adopted candidate.

### Step 2: Olympus

Goal:

- Visualize and supervise what already works from Aegis truth planes.

Scope:

- graph state
- agent/session state
- merge queue state
- logs/artifacts links
- controls that route through deterministic orchestrator commands
- editable `.aegis/config.json` settings through deterministic config writes
- live swarm map (Aether): tickets moving between caste stations and typed handoffs as signals, driven by the loop event log
- one in-repo design system (semantic tokens, headless accessible primitives, light and dark themes) with a living gallery, so every view shares status, caste, and layout language

Non-goal:

- Making Olympus a separate truth plane.
- Replacing terminal/scripted proof commands as correctness authority.

Exit gate:

- Olympus reflects terminal/.aegis truth and can supervise the seeded proof without becoming required for correctness.

### Later

Deferred until Steps 1-3 work:

- budget/economics guardrails
- Mnemosyne/Lethe
- alternate tracker integrations
- eval harness and benchmark corpus
- extra tracker adapters
- configurable pipelines
- semantic memory
- broad approval/risk systems
- batch CI optimization

## Adapter Contract

Aegis owns the adapter contract. Adapters are replaceable implementations.

Every real adapter must provide:

- `spawn` session with caste, model, thinking level, issue id, prompt, working directory, and branch context.
- `abort` session.
- session status and terminal/transcript events where available, including live activity lines streamed to `.aegis/logs/session-streams/` while the session runs.
- final result with success/failure, usage stats if available, and transcript/artifact refs.

Every real adapter must enforce or allow Aegis to enforce:

- cwd jail: tools operate only in assigned labor unless merge/Janus code explicitly owns integration workspace.
- no absolute-path escape.
- no `cd` or shell equivalent that escapes labor.
- no root mutation outside allowed orchestrator-owned files.
- no direct writes to Agora except through Aegis policy code.
- no direct merge to base branch by Titan.
- artifact emission before success is accepted.
- transcript persistence on failure and enough metadata on success.
- deterministic post-session validation by Aegis.
- clean, in-scope root commits can be adopted only when Aegis records them as candidate artifacts; dirty, unexplained, or out-of-scope root mutation still fails closed.

If an adapter cannot enforce a rule internally, Aegis must wrap or validate it externally. If wrapping/validation is insufficient, the adapter fails contract.

### Pi Adapter Posture

Pi is the current real adapter because it exists in the repo.

Pi is acceptable only if:

- tool jailing holds under live model behavior.
- root remains clean except intentional orchestrator files.
- session artifacts match Aegis contracts.
- long seeded runs do not race, leak, or mutate outside labor.

Pi is not acceptable if:

- it repeatedly allows escaped cwd writes.
- it hides material session state Aegis needs for proof.
- it cannot provide reliable abort/stop behavior.
- adapter-specific quirks keep forcing orchestration design changes.

### Codex Adapter Fallback

Codex adapter is the approved fallback if Pi remains flaky after adapter-contract enforcement.

Switch trigger:

- two fresh full seeded proof attempts fail for adapter-specific reasons after deterministic Aegis bugs are fixed, or
- one run demonstrates a non-wrappable safety violation such as root mutation escape, unkillable session, or missing required artifact/control surface.

Codex adapter must implement the same contract. It must not receive privileged shortcuts, alternate graph semantics, or relaxed proof gates.

### Claude Code Adapter

Claude Code (`runtime: "claude"`) is an approved adapter alongside Pi and Codex. It runs each caste assignment as a headless `claude -p --output-format stream-json` session in the caste's working directory. The final artifact is constrained with `--json-schema` using the same caste artifact schema Pi uses for its `emit_*` tools (off on Windows, where the launcher cannot pass JSON arguments); the caste parsers still gate it. Configured thinking maps to Claude Code effort.

It must implement the same contract with no privileged shortcuts:

- per-caste tool policy: Oracle read-only; Sentinel and Janus without edit tools; Janus shell limited to read-only git commands.
- user MCP servers are not loaded (`--strict-mcp-config`).
- forbidden long-running dev/watch processes are killed and fail the session.
- abort kills the whole adapter process tree.
- transcripts record the stream (messages, tool calls, policy-denied tool calls, usage) for audit.
- Aegis post-session validation (git proof, file scope, root cleanliness, artifact parsing) applies unchanged.

Model refs use `anthropic:<model-id>`; the default is `anthropic:claude-opus-5-5`.

## Caste Authority

Public castes:

- Oracle
- Titan
- Sentinel
- Janus

No new public caste without a distinct artifact, failure policy, stop condition, and proof need.

### Oracle

Oracle scouts only.

Oracle may produce:

- affected file scope
- risk notes
- suggested checks
- ambiguity notes
- implementation context

Oracle may not:

- veto Titan dispatch.
- create Agora tickets.
- mutate graph state.
- block parent issues.

### Titan

Titan implements.

Titan may:

- edit within assigned labor and allowed file scope.
- produce implementation artifact.
- produce `already_satisfied` when prior merged work already fulfills the issue contract.
- propose blocking child work only through Aegis mutation policy.

Titan may not:

- merge.
- leave hidden, dirty, or out-of-scope root mutation.
- create non-blocking follow-up issues in auto mode.
- broaden scope into repo cleanup.
- claim ordinary `success` without advancing its candidate branch.

### Sentinel

Sentinel gates candidate work before merge.

Sentinel output:

- `pass`
- `fail_blocking`
- typed blocking findings with `finding_kind`, `summary`, `required_files`, `owner_issue`, and `route`
- advisories

Sentinel may not:

- create issues.
- mutate graph state.
- fail for unrelated ambient debt.

Blocking findings with `route=rework_owner` send the owner issue back to Titan as `rework_required`.

Blocking findings with `route=create_blocker` are routed by Aegis policy code. Sentinel does not decide Agora mutation; the deterministic router creates or reuses the blocking ticket, links it to the parent, and records the policy artifact.

### Janus

Janus handles merge/integration failures only.

Janus may:

- return same parent to Titan for in-scope integration rework.
- propose a blocking integration child through Aegis mutation policy when root cause is outside parent scope.

Janus may not:

- become normal implementation path.
- create non-blocking follow-ups.

## Default Flow

Canonical successful path:

```text
pending
-> scouting
-> scouted
-> implementing
-> implemented
-> reviewing
-> queued_for_merge
-> merging
-> complete
```

Side paths:

- `rework_required`: same parent returns to Titan with Sentinel or Janus feedback.
- `blocked_on_child`: parent blocked in Agora by accepted child ticket.
- `failed_operational`: runtime/tool/provider/policy failure, retry only through cooldown/manual policy. Exhausted provider/runtime failures must be reported explicitly in terminal status so a raw tracker queue cannot masquerade as runnable work.
- `resolving_integration`: Janus owns merge-boundary failure.

Merge boundary:

```text
Titan candidate -> Sentinel pre-merge gate -> merge queue -> complete
```

Janus is only after merge/integration failure.

Merge queue throughput:

- The merge step is mechanical and never waits on model work. A T3 escalation hands the parent to `resolving_integration` and settles the queue item as failed with the merge outcome and detail Janus needs; Janus then runs as an adapter-owned session like every other caste.
- Each daemon cycle drains the queue: every queued candidate is attempted at most once per pass, so all mergeable work lands without waiting a poll interval per merge.
- Queue order is fewest attempts first, FIFO among equals. A requeued candidate never blocks fresh candidates behind it and retries after they move the target branch.
- A queue item that cannot merge (missing or out-of-stage dispatch record) fails closed instead of stalling the queue.
- Verify, then advance: each candidate merges in the integration worktree (`.aegis/integration/`), never in the project root. The optional `merge.verify_command` runs on that merge result, and the root fast-forwards the target branch only to a result that merged cleanly and passed verification. A failed verification is the `verification_failed` outcome: it requeues like a conflict and reaches Janus at T3 with the command output.
- Every settled merge attempt is recorded in the loop event log.

Runtime session ownership:

- Long-running caste work must be represented as adapter-owned sessions in dispatch state.
- Stuck detection measures idle time since the session's last adapter activity, not session age: a long session that keeps working is not killed, a silent one is.
- Oracle, Titan, Sentinel review, and Janus integration work use durable `runningAgent` records and advance only through monitor/reaper or explicit caste command completion. Janus launches within `max_janus` and `max_agents`.
- The daemon dispatch loop may launch sessions, but must not synchronously wait on live model work as an inline side effect.
- If Titan fails operationally after Oracle context exists, retry stays at Titan with the existing Oracle artifact instead of restarting scouting.
- If a Sentinel review session is interrupted or fails operationally, the parent returns to `implemented` with cooldown so retry stays at the review layer.
- Repeated Sentinel operational failure escalates to `failed_operational`; triage then routes Titan with the existing Oracle artifact and durable review feedback instead of relaunching review forever.
- Repeated operational failures have a deterministic retry ceiling. Once exhausted, triage skips the issue with `operational_failure_limit` and status reports the terminal operational failure instead of draining adapter quota forever.
- A stranded `reviewing` record with a durable Sentinel verdict is recovered from the artifact; without a verdict it retries Sentinel, not Oracle/Titan.
- Mechanical merge stages resume instead of redoing model work: an interrupted `merging` record requeues, a stranded `merging` queue item is requeued, and `resolving_integration` work awaiting Janus (or whose Janus session a clean stop released) relaunches Janus. A Janus session lost with a dead daemon is an operational failure.
- Rework dispatch must include the durable Sentinel or Janus feedback artifact in the Titan prompt. Repeating a parent handoff without the blocking finding is a control-plane bug.

## Mutation Policy

Castes never write Agora directly.

All graph mutation goes through deterministic Aegis policy code.

Allowed mutation proposals:

- Titan: clarification blocker, prerequisite blocker, out-of-scope blocker.
- Janus: integration blocker, same-parent requeue.
- Oracle: none.
- Sentinel: none.

Deterministic router inputs:

- Sentinel typed finding with `route=rework_owner`: same owner issue returns to Titan.
- Sentinel typed finding with `route=create_blocker`: Aegis creates or reuses a blocking child through policy code.

Accepted blocker requirements:

- proposal has evidence.
- proposal is blocking.
- child issue is created or reused.
- Agora dependency makes parent not ready.
- dispatch state becomes `blocked_on_child`.
- policy artifact is persisted.
- policy-created blocker work must resolve with `success` or explicit `failure`; `already_satisfied` is not accepted because the blocker exists to change unresolved parent state.
- Titan prompts for policy-created blocker issues must state this explicitly before the session starts.
- if a resumed parent emits another blocker after its previous child closed, Aegis fails closed instead of creating a blocker chain.

Rejected proposals fail closed as policy failures.

## Already-Satisfied Work

Real repositories contain overlapping or stale issues. Aegis must handle this without pretending a no-op edit is a real implementation.

Titan may emit `outcome: "already_satisfied"` when all are true:

- current repository state already satisfies the issue contract
- Titan made no edits
- `files_changed` is empty
- `tests_and_checks_run` records at least one relevant verification
- artifact explains what prior state satisfies the issue

Control behavior:

- `already_satisfied` is a valid Titan handoff
- candidate branch does not need to advance
- Sentinel still reviews the handoff before merge/complete
- ordinary `success` still requires candidate branch advancement
- root mutation still fails closed

This is not a loophole for skipped work. It is the deterministic way to close real-world duplicate or overlapped work.

## Seeded React Todo Proof

The seeded proof is the product gate, not demo theater.

Expected graph shape:

- contract/setup foundation
- parallel independent implementation lanes
- integration/gate work
- review/merge closure
- at least one path exercising Janus if seeded conflict is present
- gate issues may own cross-lane integration files, and any discovered missing work may become a typed child blocker when Aegis policy accepts the route
- initial ready set exposes multiple Oracle sessions in parallel
- post-Oracle dispatch exposes multiple Titan lanes in parallel when scopes do not overlap
- dependencies stress blocked -> ready transitions without relying on issue-name semantics

Expected product:

- React app
- animated todo interactions
- installable dependencies
- working build
- runnable local app

Proof commands should remain terminal-first and scriptable. The final run must capture:

- branch/head before and after
- config fingerprint
- adapter name and model mapping
- active issues over time
- ready set over time
- `.aegis/dispatch-state.json`
- `.aegis/merge-queue.json`
- loop event log `.aegis/logs/phases.jsonl`
- caste artifacts
- merge artifacts
- transcripts for failed or invalid sessions
- final app verification output

## Non-Drift Rules

This document is the only active source of truth.

Rules:

- Do not read old docs for current requirements.
- Do not update old specs, addenda, or plans.
- Do not create new source-of-truth addenda.
- If this document is wrong, edit this document.
- If implementation reveals a new decision, record it here or in Agora as execution work, not in a side spec.
- Historical docs may remain ignored locally for archaeology only.

Forbidden drift:

- reviving Olympus before Step 1 proof.
- adding economics before Step 1 proof.
- adding memory/messaging/evals before Step 1 proof.
- making adapter quirks control orchestration design.
- treating scripted runtime success as MVP completion.
- accepting narrative agent success without git/state/artifact validation.

## Engineering Rules

- No in-place mutation of dispatch or merge state records. Return new objects.
- Use atomic writes for durable state and artifacts via temp file then rename. Append-only logs (loop event log, daemon log, session streams) append one whole line per write, and readers keep a byte offset as their cursor.
- A pass that loads dispatch state before awaiting tracker or adapter work saves only the records it changed onto the latest state.
- Keep tracker semantics generic. Never infer orchestration meaning from issue naming.
- Preserve clear boundaries for `poller`, `triage`, `dispatcher`, `monitor`, `reaper`, `runtime`, `merge`, `tracker`, and caste runners.
- Prefer Windows-safe path/process handling: `path.join()`, `spawnSync`, `execFile`, `execFileSync`.
- Do not reintroduce cut systems as compatibility code or stubs.
- Validate claims with command output, git state, dispatch state, merge state, and artifacts.

## Verification Rules

Deterministic CI:

- unit tests
- acceptance seam tests
- lint
- build
- scripted mock acceptance

Live proof:

- explicit operator/QA run
- real adapter
- seeded React todo graph
- high timeouts
- observed to terminal completion
- stopped cleanly on odd behavior
- report causality with logs/artifacts

Do not claim pass without running relevant command and seeing pass.

## Active Work Selection

Use Agora for Step 1 work tracking.

Before selecting work:

```bash
node packages/agora/dist/cli.js board --json
```

Agora is the only active tracker backend. Any future tracker integration is later work and must not change Step 1 tracker semantics.

Current next work after this spec:

1. Integrate Agora as Aegis task truth through the existing generic tracker boundary.
2. Prove seeded React todo mock-run drains through Agora with equivalent graph semantics.
3. Prove Pi drains the Agora-seeded graph after Copilot usage reset.
4. If Pi fails by adapter-specific contract breach, use Codex adapter without changing tracker semantics.

## Superseded Files

These files are historical and must be ignored for active context:

- `docs/SPECv2.md`
- `docs/enhancement-spec-2026.md`
- `docs/superpowers/specs/`
- `docs/superpowers/plans/`

If any of those conflict with this document, this document wins.
