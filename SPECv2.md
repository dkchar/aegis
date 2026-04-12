
# Aegis — Final Product Requirements Document
## Single Source of Truth from Start to Production

**Status:** Canonical implementation and product document  
**Supersedes:** `SPEC.md`, `SPEC-FUTURE.md`, and `deep-research-report-aegis-improvements.md`  
**Audience:** Human builder, implementation agents, reviewers, and any planning agent generating Beads issues from this doc  
**Priority rule:** If any older document conflicts with this one, **this document wins**

---

## 1. Purpose and product definition

Aegis is a lightweight, runtime-agnostic multi-agent orchestrator for software work. It coordinates AI coding agents through a pluggable runtime adapter layer, uses Beads as the default external issue tracker, persists orchestration state locally, and exposes the system through Olympus, a browser dashboard.

The core thesis is unchanged across all source documents and remains the foundation of this PRD:

- the **issue tracker owns task truth**
- the **dispatch store owns orchestration truth**
- the **runtime owns execution**
- the **dashboard owns visibility and control**
- expensive language-model reasoning is used only where it materially improves outcomes

Aegis is not meant to be a framework that swallows the repository. It is meant to be a thin, legible, replaceable control layer that a single developer can understand end to end. It should behave more like a workflow compiler than a coordinating chatroom: the product spec defines stages, tool permissions, budgets, structured outputs, and quality gates; runtime sessions execute inside those bounds.

### 1.1 Product goal

The goal is to let a human supervise a small swarm of coding agents that can scout, implement, merge, review, learn, and recover from interruption without turning the system into a black box.

### 1.2 Product promise

Aegis should be understandable enough that:
- a fresh reading agent can identify the role of every major module at a glance
- a fresh reading agent can raise correct Beads issues from this PRD alone
- the human can tell where truth lives and where it does not
- a crash or restart does not lose orchestration state
- the system can scale from one issue in conversational mode to background processing in auto mode
- merge and coordination risks are handled mechanically before an LLM is allowed to improvise

### 1.3 Non-goals

Aegis explicitly does **not** aim to:
- become a distributed message bus
- keep a second durable task database separate from Beads
- hide orchestration logic in prompts or comments
- depend on tmux or a terminal-only interface
- make agent-to-agent chatter the primary coordination mechanism
- delegate critical merge decisions to an LLM by default

---

## 2. Design principles

These principles are binding. When implementation choices conflict, choose the option that preserves more of these principles.

### 2.1 Thin orchestrator
Aegis coordinates. It does not absorb tracker responsibilities, source-control responsibilities, or agent-runtime responsibilities.

### 2.2 Single source of truth per concern
Aegis does not tolerate ambiguous truth planes.

- **Task truth:** Beads
- **Orchestration truth:** `.aegis/dispatch-state.json`
- **Learned project knowledge:** `.aegis/mnemosyne.jsonl`
- **Merge queue runtime state:** `.aegis/merge-queue.json` or a clearly derived sibling file
- **UI live state:** derived from server + SSE, never authoritative by itself

### 2.3 Deterministic core
The dispatch loop, merge queue, monitoring, and failure handling are deterministic. They must not require an LLM to decide what happens next.

### 2.4 Conversational-first, autonomous-second
Aegis starts idle. The human opts into autonomy. Auto mode is a feature, not the default posture.

### 2.5 Browser-first control surface
Olympus is the primary interface. Terminal output is useful, but the browser is where state, control, and observability converge.

### 2.6 Event-driven where useful, polling where necessary
Polling is the correctness baseline. Beads hooks and event ingest are acceleration paths that reduce latency and improve UX. If hooks fail, the system must still remain correct via polling.

### 2.7 AI at the edges, not at the seams
Use cheaper or stronger models only where appropriate:
- Oracle for planning and gating
- Titan for implementation
- Sentinel for review
- Janus for merge-boundary escalation only
- Metis for natural-language steering
- Prometheus for strategic decomposition

### 2.8 Workflow compiler, not coordinating chatroom
Aegis compiles work into explicit stages with budgets, tool permissions, required artifacts, and gates. Messaging and chat are support mechanisms, not the main substrate of correctness.

### 2.9 Operator economics over raw autonomy
The preferred default is lower spend, fewer concurrent failures, and clearer pause points — not maximum autonomy. Complex work, ambiguous work, and expensive escalation paths must become visible decision points.

### 2.10 Evaluate before scale
Aegis does not earn more concurrency, more castes, or more autonomy by argument. It earns them by passing benchmark scenarios and regression gates.

### 2.11 Windows-first portability
Git Bash, PowerShell, and cmd must be valid operating environments. Path handling, spawn behavior, and worktree operations must be robust on Windows.

---

## 3. Canonical architecture

### 3.1 Top-level components

The production system has seven first-class parts:

1. **Aegis orchestrator**
   - deterministic control loop
   - runtime spawning
   - monitoring
   - merge queue
   - event ingestion
   - HTTP server and SSE

2. **Olympus dashboard**
   - browser UI for state, commands, settings, and later analytics

3. **Beads**
   - task store
   - dependency graph
   - message storage through `type=message`
   - source of backlog and ready work

4. **Runtime adapter layer**
   - common interface for Pi first, others later

5. **Mnemosyne + Lethe**
   - project learnings store and pruning behavior

6. **Git worktree layer**
   - labor creation, isolation, cleanup, and merge integration

7. **Eval harness and benchmark corpus**
   - scenario runner
   - fixture repositories
   - regression thresholds
   - result artifact storage

### 3.2 Canonical responsibility boundaries

| Concern | Owner | Notes |
|---|---|---|
| Task definitions, blockers, ready queue | Beads | Aegis reads, creates, updates, and links issues through tracker commands |
| Orchestration stage for each issue | Dispatch state | Never inferred from Beads comments |
| Agent execution | Runtime adapter | Runtime-specific code never leaks into orchestration core |
| Merge queue sequencing | Aegis | Deterministic and mechanical by default |
| Agent-to-agent and system messaging | Beads messages + Aegis mail delegate | Sparse, structured, ephemeral by default |
| Learnings retrieval and pruning | Mnemosyne / Lethe | Not the same as telemetry or failure tracking |
| Live dashboard state | Olympus via SSE | Observability only |
| Benchmark truth, regression thresholds, and release gates | Eval harness | Scenario corpus and score artifacts; never inferred from anecdotes |

### 3.3 Default end-to-end workflow

The canonical default workflow from work selection to completion is:

**Beads work issue → Oracle → Titan in Labor → Merge Queue → Sentinel on merged code → Complete**

This is the final selected workflow for Aegis. Alternatives from the extension spec were evaluated, but this flow best matches the existing architecture while improving integration safety.

### 3.4 Why Sentinel is post-merge by default

The current spec and the extension spec can be reconciled cleanly by moving the default Sentinel review to **after** merge.

That decision is now canonical because:
- Sentinel should review the code that actually landed
- integration-aware review is more valuable than branch-only review
- the merge queue should remain mostly mechanical
- if a review failure occurs, the outcome is explicit follow-up work, not hidden pre-merge ambiguity

A pre-merge review stage may be introduced later through configurable pipelines, but it is **not** the default production workflow.

### 3.5 Why Janus exists but is not on the happy path

Janus is the fourth caste and is reserved for merge-boundary escalation. It exists because some integration failures are too costly or semantically messy for a purely mechanical queue, but that does **not** mean merge should become agent-first.

Canonical rule:
- the merge queue owns normal integration work
- Janus is invoked only after deterministic thresholds say mechanical handling has been exhausted or would be unsafe
- Janus never becomes the default path from Titan to main

---

## 4. Sources of truth and persistence rules

### 4.1 Beads is task truth

Beads is authoritative for:
- work issues
- dependencies and blockers
- ready queue
- message issues
- generated follow-up issues
- decomposition and escalation artifacts

Aegis must use structured tracker operations. It must not parse informal comments to infer orchestration state.

### 4.2 Dispatch state is orchestration truth

`.aegis/dispatch-state.json` is authoritative for:
- current stage of each tracked issue
- currently running agent assignment
- Oracle assessment
- Sentinel verdict
- failure counters and cooldown windows
- cumulative spend where exact dollar pricing is available
- cumulative credits, quota observations, and proxy budget observations where exact pricing is not available
- session-local provenance about which issues were dispatched by this Aegis instance

### 4.3 Merge queue state is derived orchestration state

`.aegis/merge-queue.json` is authoritative for queue processing, but it is not a rival truth plane. It is subordinate to dispatch state and can be rebuilt from durable facts when needed.

It tracks:
- which candidate branches are awaiting merge
- their queue order
- their current merge status
- attempt counts
- last mechanical failure
- whether rework or escalation was emitted

### 4.4 Mnemosyne is project knowledge, not telemetry

`.aegis/mnemosyne.jsonl` stores learned codebase facts such as conventions, patterns, and known local failure modes. It does **not** track agent crashes, retries, or budget kills. Those belong to dispatch state and event logs.

### 4.5 Olympus is never authoritative

The dashboard reflects state but does not own it. Any action in the UI resolves through the orchestrator and durable files, never directly into front-end-only state.

---

## 5. Canonical issue model

### 5.1 Work issue classes

Aegis works with Beads issues that fall into these functional classes:

- **Primary work issue**  
  The issue the human or planner wants implemented.

- **Sub-issue**  
  A decomposition artifact produced by planning or scouting.

- **Fix issue**  
  Produced by Sentinel or by failed mechanical gates.

- **Conflict issue**  
  Produced when merge conflicts require explicit rework or intervention.

- **Escalation issue**  
  Produced when an agent hits a blocker or when the system requires human intervention.

- **Clarification issue**  
  Produced when a worker cannot proceed safely without an explicit answer, missing requirement, or policy decision. Clarifications are work artifacts, not chat transcripts, and are linked to the originating issue.

- **Message issue**  
  A Beads issue with `type=message`, used for system signaling and selective coordination.

### 5.2 Aegis-managed issue lifecycle

Beads and dispatch state work together, but their roles are distinct:

- Beads tells Aegis what work exists and what is ready
- dispatch state tells Aegis where each tracked issue is inside the orchestration pipeline

Aegis must never assume that a closed issue is fully complete unless dispatch state also agrees.

### 5.3 Readiness model

The default queue of work comes from `bd ready`. Ready means:
- the issue exists
- it has no open blockers in the issue graph
- it is available to be worked

Ready does **not** mean:
- the issue is already scouted
- the issue is safe to implement without planning
- the issue is fully complete

### 5.4 Priority and dependency handling

Aegis respects Beads priorities and dependencies, but orchestration still uses deterministic local rules:

- dependencies prevent ready status at the tracker level
- priority affects dispatch order among ready issues
- optional focus filters can further reduce the eligible set
- concurrency limits cap what can run at once

### 5.5 Generated issues

Aegis may generate Beads issues in these cases:

- Oracle recommends decomposition
- Oracle discovers prerequisite work
- Titan discovers adjacent but out-of-scope required work
- Titan requires clarification before safe implementation
- Sentinel fails a review and files corrective work
- merge queue detects conflicts or non-conflict failures that require rework
- the system needs explicit escalation or human decision

Generated issues must be written so a later agent can pick them up without additional context hunting.

Canonical rules:
- when Oracle decomposes an issue, Aegis creates the child issues and blocks the parent on them
- when Titan raises a clarification issue, the original issue remains open and may be blocked until the clarification is resolved
- generated issues must link back to their originating issue so Olympus and later agents can reconstruct the chain without reading free-form chat

---

## 6. Dispatch state model

### 6.1 Canonical stage sequence

The canonical stage sequence for the default production pipeline is:

1. `pending`
2. `scouting`
3. `scouted`
4. `implementing`
5. `implemented`
6. `queued_for_merge`
7. `merging`
8. `resolving_integration`
9. `merged`
10. `reviewing`
11. `complete`

The system also supports `failed` as a non-success terminal state for the current attempt. `resolving_integration` is used only when Janus is active on a merge-boundary escalation.

### 6.2 Stage semantics

- **pending**  
  Issue is known to Aegis but has not yet been scouted.

- **scouting**  
  Oracle is currently running.

- **scouted**  
  Oracle finished and produced an assessment. This does not guarantee implementation will begin unless `ready=true`.

- **implementing**  
  Titan is currently working in a Labor.

- **implemented**  
  Titan finished successfully and produced a merge candidate branch.

- **queued_for_merge**  
  Candidate has been accepted into the merge queue.

- **merging**  
  The merge worker is actively running gates and attempting integration.

- **resolving_integration**  
  Janus is actively resolving a merge-boundary escalation or producing an explicit unresolved integration artifact.

- **merged**  
  Candidate landed on the target branch successfully.

- **reviewing**  
  Sentinel is reviewing the merged result.

- **complete**  
  The configured pipeline is fully finished and the issue requires no further automatic action.

- **failed**  
  The most recent attempt failed and requires either cooldown, manual restart, or newly generated follow-up work.

### 6.3 Dispatch state rules

- stage transitions are explicit and one-way for a given attempt
- the orchestrator never skips stages unless the configured pipeline explicitly omits them
- a restart must reconstruct active or incomplete work from disk
- in-progress stages survive process death and are reconciled on restart
- no transition may depend on informal text parsing
- Janus activation must always be visible as a dispatch-state transition, never only as a queue-local detail

### 6.4 Failure counters and cooldown

For any issue:
- three consecutive agent failures inside a ten-minute window trigger cooldown
- cooldown suppresses immediate redispatch
- cooldown state is persisted
- manual restart by the user can override cooldown if desired

This applies to Oracle, Titan, Sentinel, and Janus failures. Merge queue retries are tracked separately inside the queue item.

### 6.5 Manual validation for dispatch state

A reading or implementation agent should be able to validate dispatch state with these manual checks:

- start Aegis, create a new issue, confirm it begins at `pending`
- dispatch an Oracle, kill the process mid-run, restart, confirm the issue remains reconcilable
- force a failed Oracle output, confirm the issue enters `failed`
- trigger three rapid failures, confirm cooldown suppresses re-dispatch
- complete a full happy path, confirm `complete` is reached only after review passes

---

## 7. Core operating modes

### 7.1 Conversational mode

Conversational mode is the default startup mode.

Behavior:
- Olympus is served
- commands are accepted
- no automatic poll loop runs
- no ready-queue backlog is processed without explicit instruction

This mode exists to keep the human in control of cost and attention.

### 7.2 Auto mode

Auto mode is opt-in.

Behavior:
- the poll loop runs on the configured interval
- ready issues are triaged and dispatched automatically
- concurrency limits are enforced
- stopping auto returns the system to conversational mode

The existing rule remains canonical:
- auto mode sweeps any issue already in `bd ready` when it is enabled
- later polls continue to pick up newly ready work as it appears
- Sentinel auto-review is limited to work whose Titan was dispatched by the current Aegis session lineage recorded in dispatch state

### 7.3 Canonical direct commands

MVP direct commands are deterministic and do not need an LLM. The supported action family includes:

- `scout <issue-id>`
- `implement <issue-id>`
- `review <issue-id>`
- `process <issue-id>`
- `status`
- `pause`
- `resume`
- `auto on`
- `auto off`
- `scale`
- `kill`
- `restart`
- `focus`
- `tell`
- `add_learning`
- `reprioritize`
- `summarize`

Later natural-language modes resolve to this action family or its structured successors.

### 7.4 Manual validation for operating modes

- start Aegis and confirm idle mode does not poll
- run `process <issue-id>` and confirm only that issue is touched
- enable auto mode and verify backlog and newly ready issues begin flowing
- disable auto mode and confirm dispatch stops
- restart during auto mode and confirm the system resumes consistently from persisted state

---

## 8. Runtime adapter layer

### 8.1 Purpose

The runtime adapter layer allows Aegis to remain orchestration-first and runtime-agnostic.

The orchestrator talks to a minimal agent interface. It does not import runtime-specific packages directly in the orchestration core.

### 8.2 Required capabilities

Every runtime adapter must support:
- spawn a session
- send the initial prompt
- send steering messages
- abort a session
- subscribe to runtime events
- report usage and budget-relevant statistics

### 8.2.1 Minimal runtime contract

The orchestration core talks to runtimes through a deliberately small interface boundary:

```typescript
interface AgentRuntime {
  spawn(opts: SpawnOptions): Promise<AgentHandle>;
}

interface AgentHandle {
  prompt(msg: string): Promise<void>;
  steer(msg: string): Promise<void>;
  abort(): Promise<void>;
  subscribe(listener: (event: AgentEvent) => void): () => void;
  getStats(): AgentStats;
}
```

Canonical rule:
- `aegis.ts`, `triage.ts`, `monitor.ts`, and the HTTP/SSE layer only depend on this contract
- runtime-specific imports and quirks stay inside adapter modules
- future adapters may expose more features internally, but the orchestration core must not rely on them


### 8.2.2 Metering capability and auth mode

Aegis must treat runtime economics as **budget observability**, not always as exact dollar billing.

Different runtimes and auth modes expose different levels of pricing and usage detail:
- API-key auth may expose exact token and dollar billing
- subscription auth may expose quota windows, credit buckets, or coarse usage status but not exact per-session dollar cost
- local runtimes may expose tokens and wall time with zero direct dollar cost
- some runtimes may expose only session-local stats

Because of that, every runtime adapter must report both an auth mode and a metering capability.

**Canonical metering capabilities**
- `exact_usd` — exact dollar cost is available from provider billing or an official runtime meter
- `credits` — provider credits are available but dollars are not exact per session
- `quota` — remaining quota or reset windows are visible but not exact dollars
- `stats_only` — only local runtime/session stats are available
- `unknown` — no reliable budget signal is available beyond lifecycle events

**Canonical auth modes**
- `api_key`
- `subscription`
- `workspace_subscription`
- `local`
- `unknown`

A minimal implementation-facing shape is:

```typescript
type MeteringCapability =
  | "exact_usd"
  | "credits"
  | "quota"
  | "stats_only"
  | "unknown";

type AuthMode =
  | "api_key"
  | "subscription"
  | "workspace_subscription"
  | "local"
  | "unknown";

interface UsageObservation {
  provider: string;
  auth_mode: AuthMode;
  metering: MeteringCapability;

  exact_cost_usd?: number;
  credits_used?: number;
  credits_remaining?: number;
  quota_used_pct?: number;
  quota_remaining_pct?: number;
  reset_at?: string;
  input_tokens?: number;
  output_tokens?: number;
  session_turns?: number;
  wall_time_sec?: number;
  active_context_pct?: number;

  confidence: "exact" | "estimated" | "proxy";
  source: "billing_api" | "runtime_status" | "session_stats" | "adapter_estimate";
}
```

Canonical rule:
- Aegis must never display fabricated dollar precision when the runtime only exposes credits, quota, or proxy usage
- the monitor enforces **budget gates**, and exact dollar gates are only one special case of that broader system
- Janus auto-escalation requires at least one trustworthy budget signal; with `unknown` metering it defaults to human confirmation

### 8.3 Canonical first adapter: Pi

Pi is the first production adapter.

Its implementation wraps the Pi SDK programmatic session APIs, including session creation and subscription primitives. The orchestration core should only know that it can create a session, subscribe to events, prompt the agent, and stop it.

### 8.4 Adapter design rules

- runtime-specific imports stay inside adapter modules
- tool restrictions are enforced by the adapter, not by prompt wording alone
- working directory assignment is controlled by the orchestrator but applied via the runtime
- event streams must surface enough information for real-time monitoring
- adapters must behave consistently across Windows and Unix-like environments

### 8.5 Future adapters

Future adapters include:
- Claude Code
- Ollama
- Cursor
- any other runtime that can satisfy the same contract

Mixed-model swarms are supported later by mapping models or stages to different adapters.

### 8.6 Manual validation for the adapter layer

- spawn a Pi session and verify streaming output is observable
- restrict tools for Oracle and confirm write actions are actually blocked
- assign a Titan to a Labor and confirm writes occur inside the labor directory only
- abort a session and confirm cleanup and stage transition happen correctly
- run on Windows and confirm spawn, path handling, and basic execution still work

---

## 9. Core loop and major modules

The heart of Aegis is the deterministic control loop:

**POLL → TRIAGE → DISPATCH → MONITOR → REAP**

### 9.1 `aegis.ts` — loop coordinator

**Purpose**  
Own the top-level lifecycle of the orchestrator.

**Responsibilities**
- bootstrap config and state
- start HTTP server and Olympus
- start or stop the auto loop
- coordinate poll, triage, dispatch, monitor, and reap
- own graceful shutdown and restart-safe persistence boundaries

**Inputs**
- config
- dispatch state
- tracker output
- runtime events
- user steering actions

**Outputs**
- spawned agent work
- persisted state transitions
- SSE events
- queueing decisions

**Key rules**
- never owns durable truth outside the sanctioned files
- never embeds runtime-specific logic
- never requires an LLM to decide control flow

**Manual validation**
- clean start with empty repo
- start with existing dispatch state
- graceful shutdown mid-run
- hard kill and restart recovery

### 9.2 Poller

**Purpose**  
Query the issue tracker and obtain candidate work.

**Responsibilities**
- call `bd ready`
- normalize issue records
- compare ready work against tracked in-progress work
- pass eligible items into triage

**Key rules**
- correctness fallback exists even if hooks are unavailable
- no poll result alone changes stage state
- poll interval is configurable

**Manual validation**
- add ready issue while auto mode is on
- remove or block an issue and confirm it drops out
- simulate tracker delay or empty queue handling

### 9.3 `triage.ts` — deterministic work selector

**Purpose**  
Decide what the next stage should be for each issue.

**Responsibilities**
- inspect dispatch state
- inspect Oracle readiness
- inspect queue capacity and focus filters
- inspect declared file scope and overlap constraints
- select the next stage or skip action

**Key rules**
- triage is deterministic for the same input
- triage never parses free-form comments for state
- triage must understand both the default pipeline and, later, configured pipelines
- triage must refuse unsafe parallel Titan dispatch when declared scopes overlap beyond policy

**Canonical default decisions**
- no record or `pending` → Oracle
- `scouted` with `ready=true` → Titan
- `implemented` → Merge Queue
- `merged` → Sentinel
- `complete` → skip
- `failed` → skip unless restarted or cooldown expired
- in-progress stage → skip
- over concurrency limit → queue

### 9.3.1 Upstream scope allocator

Aegis should reduce merge pain before the queue ever sees it.

Canonical rule:
- Oracle `files_affected` becomes the provisional `FILE_SCOPE` for dispatch safety
- a user or planner may seed or narrow scope explicitly
- Aegis refuses to dispatch two Titans whose scopes overlap beyond the configured threshold unless the human forces the decision
- scope is surfaced in Olympus and retained in the handoff artifact so later stages can reason about intended ownership

This is a lightweight ownership system, not a full code-ownership bureaucracy. The goal is to keep the queue mechanical by preventing unnecessary collisions upstream.

**Manual validation**
- the same issue state always produces the same triage decision
- focus filters exclude non-matching issues
- concurrency caps suppress new dispatches
- merged issues trigger review rather than reimplementation
- overlapping Titan scopes are blocked deterministically until one issue completes or the human overrides

### 9.4 Dispatcher

**Purpose**  
Turn a triage decision into a running agent or queue action.

**Responsibilities**
- transition dispatch state into the in-progress stage
- create Labor when needed
- build the prompt payload
- include relevant learnings
- invoke the runtime adapter
- emit observable events

**Key rules**
- state transition happens before uncontrolled execution begins
- Titans always get a Labor
- Oracles and Sentinels use read-only tool filtering
- prompt construction is deterministic outside the model-generated portion of the run

### 9.4.1 Prompt construction contract

Every agent prompt is assembled in this order:
1. project `AGENTS.md`, if present
2. caste-specific system instructions
3. relevant Mnemosyne learnings
4. issue-specific context and stage-specific structured inputs

Canonical rules:
- Aegis reads the repository's existing `AGENTS.md` if present
- Aegis injects that content into every agent session
- Aegis does not create or modify `AGENTS.md`
- caste-specific instructions are appended after `AGENTS.md`, not substituted for it

**Manual validation**
- Oracle dispatch creates no worktree
- Titan dispatch creates the correct worktree and branch
- Sentinel dispatch runs against merged main by default
- existing `AGENTS.md` content appears ahead of caste instructions in built prompts
- dispatch events appear in Olympus immediately

### 9.5 `spawner.ts` — runtime boundary

**Purpose**  
Instantiate the correct runtime adapter and session.

**Responsibilities**
- map configured runtime/model to adapter
- pass working directory and tool restrictions
- attach subscriptions
- return a handle the monitor can manage

**Manual validation**
- adapter selection follows config
- bad runtime names fail clearly
- invalid credentials fail without corrupting state

### 9.6 Monitor

**Purpose**  
Observe running sessions in real time and enforce budgets.

**Canonical default thresholds**  
- poll interval: 5 seconds
- stuck warning: 90 seconds without tool progress
- stuck kill: 150 seconds without tool progress
- per-issue exact-cost warning: $3.00 when `metering=exact_usd`
- daily exact-cost warning: $10.00 when `metering=exact_usd`
- daily exact-cost hard stop: $20.00 when `metering=exact_usd`
- subscription quota warning floor: 35% remaining when `metering=quota`
- subscription quota hard-stop floor: 20% remaining when `metering=quota`
- unknown-metering posture: no autonomous Janus and no autonomous complex-work dispatch

**Responsibilities**
- subscribe to session events
- track turns, tokens, elapsed time, tool activity, and last-progress timestamp
- track per-issue exact cost when available, otherwise credits, quota state, and proxy budget usage
- push events to Olympus via SSE
- inject steering nudges when agents appear stuck
- abort sessions when limits are exceeded
- suppress optional escalations such as Janus when configured budget guardrails would be violated without human override

**Canonical stuck rules**
- no tool call for warning threshold → steering nudge
- no tool call for kill threshold → abort
- repeating the same tool call three or more times → steering nudge
- turn budget exceeded → abort
- token budget exceeded → abort
- daily hard stop exceeded, quota floor crossed, or credit floor crossed → refuse new autonomous dispatch until human review

**Key rules**
- budget enforcement runs on event boundaries, not only on the outer poll tick
- telemetry is not stored in Mnemosyne
- monitor decisions must be visible to the user
- when `metering=exact_usd`, cost may be estimated from embedded per-model pricing tables or provider billing data, and cumulative spend persists in dispatch state so it survives restarts
- when `metering=credits` or `quota`, the monitor persists provider observations and gate decisions rather than pretending to know exact dollars
- when `metering=stats_only`, proxy budget enforcement falls back to turns, tokens, wall time, retry counts, and concurrency
- optional intelligence layers never bypass budget guardrails silently

**Manual validation**
- force an infinite loop and confirm kill
- force budget exhaustion and confirm kill or suppression
- exceed the daily hard stop, quota floor, or credit floor and confirm new autonomous dispatch pauses
- observe live SSE updates in the dashboard
- confirm repeated-tool-call nudges are emitted

### 9.7 Reaper

**Purpose**  
Finalize the outcome of a finished session.

**Responsibilities**
- verify expected outputs exist
- transition state to the next stage or `failed`
- reset or increment failure counters
- trigger Labor cleanup or preservation
- queue merge candidates after Titan success
- reclaim concurrency capacity
- run Lethe pruning when appropriate

**Key rules**
- success requires artifact verification, not just process exit
- failed sessions return issues to an actionable state
- Titans do not mark work complete directly
- merge work proceeds through the queue, not through implicit REAP merge in the final design

**Manual validation**
- Oracle with invalid JSON is treated as failed
- Titan with no meaningful code output is treated as failed
- Sentinel with no verdict is treated as failed
- successful Titan enqueues merge candidate rather than completing the issue

### 9.8 Event ingest

**Purpose**  
Accept Beads hook events and convert them into immediate local updates.

**Responsibilities**
- receive hook payloads through a local endpoint or equivalent local channel
- refresh Olympus immediately
- optionally trigger an immediate poll/triage cycle

**Key rules**
- event ingest improves freshness but does not replace polling
- missing hooks cannot break correctness
- only local trusted hook sources should be accepted by default

**Manual validation**
- create or update a Beads issue and confirm Olympus reflects it quickly
- disable hooks and confirm polling still maintains correctness

### 9.9 HTTP server and SSE

**Purpose**  
Serve Olympus, APIs, and real-time updates.

**Responsibilities**
- static asset serving
- steering endpoint
- learning endpoint
- state and event endpoints
- SSE stream for live agent and queue updates

**Canonical endpoint set**
- `GET /` — Olympus static app
- `GET /api/state` — current orchestrator, agent, queue, and issue snapshot
- `POST /api/steer` — direct control-plane actions
- `POST /api/learning` — append to Mnemosyne
- `GET /api/events` — SSE stream
- `POST /api/hooks/beads` — local event-ingest endpoint for Beads hooks

**Key rules**
- the browser is a consumer, not the source of truth
- SSE should auto-reconnect cleanly
- API writes must update durable state before claiming success

**Manual validation**
- Olympus loads on first run
- SSE reconnects after browser refresh
- steering actions update state correctly
- learning posts append to Mnemosyne atomically

---

## 10. Agent castes

Aegis has four named castes:
- **Oracle** for scouting and gating
- **Titan** for implementation
- **Sentinel** for post-merge review
- **Janus** for merge-boundary escalation only

Janus is first-class in the architecture but absent from the happy path. A normal successful issue should flow Oracle → Titan → Merge Queue → Sentinel without ever invoking Janus.

### 10.1 Oracle

**Purpose**  
Scout an issue, inspect the codebase, and produce a structured implementation assessment.

**Canonical default budget**  
10 turns and 80k tokens.

**When used**
- any issue entering from `pending`
- any explicitly scouted issue
- any issue needing decomposition or go/no-go gating

**Allowed tools**
- read
- read-only shell commands
- tracker commands
- no file modifications

**Output**
A structured assessment covering:
- files likely to change
- complexity estimate
- whether to decompose
- possible sub-issues
- blockers
- ready / not ready decision

### 10.1.1 Canonical `OracleAssessment` contract

At minimum, the Oracle output must provide these fields in a machine-parseable shape:
- `files_affected: string[]`
- `estimated_complexity: "trivial" | "moderate" | "complex"`
- `decompose: boolean`
- `sub_issues?: string[]`
- `blockers?: string[]`
- `ready: boolean`

The orchestrator stores the parsed assessment in dispatch state. It does not recover stage meaning by re-reading narrative text later.

### 10.1.2 Complexity gate and decomposition rules

Canonical rules:
- if `estimated_complexity=complex`, Aegis emits an `orchestrator.complex_issue` event
- in conversational mode, complex issues wait for explicit human confirmation before Titan dispatch
- in auto mode, complex issues are skipped unless the user has explicitly opted in through config
- if `decompose=true`, Aegis creates the proposed child issues, links them as dependencies, and leaves the parent open but blocked

**Success condition**
- valid structured assessment
- no code modifications
- state transitions to `scouted`

**Failure condition**
- invalid or missing assessment
- write attempts
- timeout, budget kill, crash

**Manual validation**
- Oracle produces a parsable assessment
- Oracle can discover sub-issues and blockers
- Oracle cannot write files even if prompted to do so
- a `complex` result pauses Titan dispatch in conversational mode until the human approves
- a decomposed issue produces linked child issues and blocks the parent appropriately

### 10.2 Titan

**Purpose**  
Implement one scoped issue in an isolated Labor.

**Canonical default budget**  
20 turns and 300k tokens.

**When used**
- issue is `scouted` and `ready=true`
- user explicitly implements an issue
- configured pipeline includes implementation stage

**Allowed tools**
- read
- write
- edit
- shell
- tracker commands

**Execution environment**
- dedicated Labor path
- dedicated branch
- isolated from other Titans

**Success condition**
- the implementation is completed in the labor branch
- the issue is closed or otherwise marked completed from Titan’s perspective
- merge candidate is ready for queue submission

### 10.2.1 Titan handoff contract

Titan completion is not just “branch exists.” It must produce a structured handoff artifact that later stages can consume without rereading the full session transcript.

At minimum, the handoff must capture:
- issue id
- labor path and candidate branch
- base branch
- files changed
- tests and checks run
- known risks or uncertainties
- follow-up work or next actions
- any learnings written to Mnemosyne

Canonical rule:
- the handoff artifact is required even when Beads messaging is enabled
- durable messages may mirror or reference the handoff, but they do not replace it
- the handoff must be accessible to the merge queue, Sentinel, Olympus, and crash recovery logic

### 10.2.2 Clarification-before-guessing rule

If Titan cannot proceed safely because requirements are ambiguous, information is missing, or a policy decision is required, Titan does **not** improvise by default.

Canonical behavior:
- create a clarification issue linked to the original issue
- preserve the labor for resumption if useful
- leave an explicit handoff note describing the blocked decision
- return control to deterministic orchestration rather than turning clarification into agent chatter

**Failure condition**
- no meaningful diff
- dirty or inconsistent labor state
- budget kill
- crash
- unable to satisfy issue scope

**Manual validation**
- Titan writes only inside the Labor
- Titan can create discovered work in Beads when needed
- Titan success produces a candidate branch that the queue can process
- Titan creates a clarification issue instead of guessing when a requirement is materially ambiguous

### 10.3 Sentinel

**Purpose**  
Review the result of landed work and create corrective work if necessary.

**Canonical default budget**  
8 turns and 100k tokens.

**When used**
- after the merge queue reports `merged`
- when user explicitly requests review
- when pipelines later configure extra review stages

**Allowed tools**
- read
- read-only shell commands
- tracker commands

**Default review target**
- merged code on the target branch, not the unmerged labor branch

**Success condition**
- explicit pass or fail verdict
- fail verdict produces follow-up issue(s)
- pass verdict advances work to `complete`

### 10.3.1 Sentinel verdict contract

Sentinel must emit a structured verdict artifact, not only narrative commentary.

At minimum, the verdict must capture:
- `verdict: "pass" | "fail"`
- review summary
- concrete issues found, if any
- follow-up issue ids created, if any
- notable risk areas or test gaps still worth human attention

Canonical rule:
- Sentinel reviews the landed result on the target branch by default
- a fail verdict creates explicit corrective work rather than reopening hidden debate in chat
- the verdict artifact is retained even when follow-up issues exist so the rationale remains inspectable

**Failure condition**
- missing verdict
- tool misuse
- crash or budget kill

**Manual validation**
- Sentinel can identify obvious defects in merged work
- failed review creates a fix issue rather than silently burying the problem
- pass review completes the pipeline
- the structured verdict remains inspectable after follow-up issues are filed

### 10.4 Janus

**Purpose**  
Resolve merge-boundary escalations that the deterministic queue cannot safely clear on its own.

**Canonical default budget**  
12 turns and 120k tokens.

**When used**
- a queue item reaches Tier 3 escalation
- repeated rework or conflict attempts exceed the configured cap
- a human explicitly invokes integration assistance

**Allowed tools**
- read
- write and edit only inside the preserved conflict labor or a dedicated integration labor
- shell
- tracker commands

**Success condition**
- Janus produces a structured integration-resolution artifact
- Janus either prepares a refreshed candidate for requeue or emits an explicit unresolved escalation artifact
- Janus never merges directly outside the queue

### 10.4.1 Janus resolution contract

At minimum, the Janus artifact must capture:
- originating issue id
- queue item id
- preserved labor path or integration branch
- conflict or failure summary
- resolution strategy chosen
- files touched
- validations run
- residual risks
- recommended next action: `requeue` | `manual_decision` | `fail`

Canonical rule:
- Janus may only be invoked by queue policy or explicit human command
- Janus does not replace Titan for ordinary implementation
- Janus returns control to deterministic queue processing or to an explicit human decision point

**Failure condition**
- semantic conflict still unresolved
- policy ambiguity that requires a human
- budget kill
- crash
- unsafe broad refactoring outside merge-boundary scope

**Manual validation**
- Janus can resolve a contained integration conflict and return the candidate to the queue
- Janus creates a human-decision artifact rather than bluffing through semantic uncertainty
- Janus cannot be dispatched for ordinary feature work

### 10.5 Janus invocation policy

Janus is a first-class caste but not a default happy-path stage. Aegis attempts mechanical handling first. Janus becomes eligible only when:
- conflict complexity crosses the configured threshold
- repeated rework attempts exceed a cap
- economic guardrails allow escalation, unless the human explicitly overrides them
- repository policy enables Janus escalation

The default merge queue remains deterministic and mechanical.

---

## 11. Labors and git worktree isolation

### 11.1 Purpose

Titans need branch-isolated workspaces so multiple implementations can proceed in parallel without sharing a mutable checkout.

### 11.2 Lifecycle

**Creation**
- create a worktree under `.aegis/labors/labor-{issue_id}`
- create a branch named `aegis/{issue_id}` from the current target branch HEAD

**Use**
- Titan runs inside that labor only

**Queue handoff**
- successful Titan produces a merge candidate referencing this branch

**Cleanup after successful merge**
- remove worktree
- delete branch

**Preservation on conflict or failure**
- preserve the labor and branch when conflict resolution or manual recovery is needed

### 11.3 Windows rules

Path normalization and worktree command behavior must be handled explicitly so the same logic works under Git Bash, PowerShell, and cmd.

### 11.4 Manual validation

- dispatch two Titans at once and confirm they write to separate labor directories
- merge one labor successfully and verify cleanup
- force a conflict and verify the labor is preserved rather than destroyed

---

## 12. Merge queue

### 12.1 Canonical design decision

The final selected design is:

**Aegis owns the merge queue deterministically, with Janus available only as an escalation-only caste.**

This is chosen over:
- a dedicated merger caste as default
- full externalization to a platform merge queue

because it best preserves the thin-orchestrator philosophy while improving correctness at scale. Janus exists to handle the minority case where deterministic integration reaches a justified escalation threshold; it does not own the normal merge path.

### 12.2 Queue placement in the pipeline

The merge queue sits:

**after Titan success and before Sentinel review**

That is now the canonical integration point.

### 12.3 Queue goals

The queue exists to:
- serialize integration work safely
- prevent Titans from racing merges directly into main
- run mechanical gates consistently
- convert integration failures into explicit, inspectable artifacts

### 12.4 Queue item responsibilities

Each queue item must carry enough information to:
- identify the originating issue
- identify the candidate branch
- identify the target branch
- identify who submitted it
- count attempts
- retain the last mechanical error
- expose current queue status

### 12.5 Queue processing policy

The default production policy is:
- FIFO ordering
- optional future priority-within-FIFO, but not required for MVP
- one active merge worker at a time for correctness
- mechanical checks before human or LLM escalation
- Janus invocation only through deterministic policy gates

### 12.5.1 Janus escalation triggers

Janus becomes eligible only when all of the following are true:
- the queue item has reached Tier 3 escalation
- the number of failed refresh or conflict cycles has reached the configured cap
- the repository has Janus enabled
- no higher-priority human decision is obviously required first
- economic guardrails allow the escalation or the human explicitly overrides them

The queue remains the owner of sequencing, retries, and final merge admission even when Janus is used.

### 12.6 Mechanical merge flow

For each item:
1. mark queue item as active
2. run verification gates on the candidate
3. attempt merge into target branch
4. on success, emit success outcome and advance dispatch state to `merged`
5. on stale-branch or non-conflict failure, emit failure outcome and create a rework issue or refreshed implementation request
6. on hard conflict, create a conflict issue and preserve the labor and artifacts required for recovery
7. if Tier 3 escalation is eligible and enabled, transition dispatch state to `resolving_integration` and dispatch Janus
8. on Janus success, update the candidate artifact and return the item to the queue for a fresh mechanical pass
9. on Janus failure or unsafe ambiguity, create explicit manual-decision artifacts and stop automatic processing for that item

### 12.7 Canonical verification gates

The queue can run whichever gates are configured for the repository, but the conceptual gate categories are:

- tests
- lint
- build
- optional repository-specific verification scripts

The system must treat this as configurable policy rather than hardcoded assumptions about toolchains.

### 12.8 Merge conflict tiers

The selected tier model is:

- **Tier 0 — clean merge**  
  merge succeeds; proceed to Sentinel

- **Tier 1 — simple rebase or stale branch**  
  create rework request, requeue after refreshed implementation if appropriate

- **Tier 2 — hard conflict**  
  create explicit conflict issue, preserve the labor, and stop automatic merge for that candidate unless Janus escalation later becomes eligible

- **Tier 3 — Janus escalation**  
  invoke Janus only after configured thresholds or repeated attempts, and never as the default merge path

### 12.9 Canonical merge outcomes

The system must support at least these semantic outcomes:

- `MERGE_READY`
- `MERGED`
- `MERGE_FAILED`
- `REWORK_REQUEST`
- `JANUS_REQUIRED`
- `JANUS_RESOLVED`
- `JANUS_FAILED`

These are surfaced both as queue events and, when messaging is enabled, as Beads message types.

### 12.10 Relationship to Sentinel

A successful merge is **not** equivalent to issue completion.

Success in the queue advances the issue to `merged`, which triggers Sentinel review in the default pipeline.

### 12.11 Manual validation for the merge queue

- submit a clean candidate and verify it merges and triggers review
- force a failing test and verify `MERGE_FAILED` plus a rework issue
- force a merge conflict and verify `REWORK_REQUEST` plus preserved labor
- trigger a Tier 3 case and verify Janus is dispatched only when policy allows it
- verify Janus success returns the item to the queue for a fresh mechanical pass
- run two candidates and verify queue ordering is preserved
- restart the orchestrator during queue processing and verify recovery is safe

---

## 13. Messaging through Beads

### 13.1 Canonical design decision

The final selected design is:

**Beads-native messaging with an Aegis mail delegate, used sparingly and structured by policy.**

Messaging is in scope, but it is not the backbone of routine orchestration. Dispatch state remains the main coordination layer.

### 13.2 Why messaging exists

Messaging solves narrow but important coordination needs:
- merge queue outcome signaling
- explicit handoffs
- escalations
- human decision requests
- optional targeted nudges to running agents
- durable, inspectable communication threads when needed

### 13.2.1 Artifact-first coordination rule

The default coordination posture remains artifact-first rather than chat-first.

Canonical rules:
- stage completion is carried by structured artifacts such as `OracleAssessment`, Titan handoff payloads, and Sentinel verdicts
- clarification should become an issue when it blocks safe progress
- Beads messages may reference or route around those artifacts, but they must not become the only place where critical state is explained

### 13.3 Why messaging is not the main control loop

Routine dispatch, stage transitions, and worker selection do **not** require a mailbox. That remains deterministic and state-machine driven.

### 13.4 Message storage model

Messages are Beads issues with `type=message`.

Aegis relies on Beads capabilities for:
- message storage
- threading through `replies_to`
- unread/read semantics through status
- ephemeral lifecycle
- mail delegation hooks

### 13.5 Message policy

The default production messaging policy is:

- **ephemeral by default**
- **persistent only when the message matters later**
- **typed subject lines**
- **structured body format**
- **machine-readable first, human-readable second**

Persistent messages are reserved for:
- handoffs
- escalations
- human decisions
- merge outcomes that matter for auditability
- security/privacy-relevant events

Even when a persistent message is emitted, the authoritative structured artifact for that stage must still exist outside the message body.

### 13.6 Canonical message types

At minimum, the system must support:

- `MERGE_READY`
- `MERGED`
- `MERGE_FAILED`
- `REWORK_REQUEST`
- `JANUS_REQUIRED`
- `JANUS_RESOLVED`
- `JANUS_FAILED`
- `HANDOFF`
- `ESCALATION`
- `HUMAN_DECISION_REQUIRED`

The first seven support merge queue integration and escalation visibility. The latter three support sparse, durable coordination.

### 13.7 Message routing model

Beads stores the message. Aegis performs delivery actions.

Possible delivery actions:
- push the message into Olympus
- attach it to an issue detail view
- optionally nudge a running agent
- record it in event history
- trigger immediate local refresh through hook ingestion

### 13.8 Relationship to `tell_agent` and `tell_all`

The future steering actions `tell_agent` and `tell_all` are **user-to-agent control actions**, not the same thing as Beads-native mail.

Canonical rule:
- if the human wants to steer a running agent right now, use runtime steering
- if the system or agent needs a durable thread that survives sessions, use Beads messaging

### 13.9 Hooks and live updates

When Beads hooks are available:
- message creation, update, and close events can immediately inform Olympus
- the orchestrator can refresh state or schedule follow-up work more quickly
- the system becomes more live without depending on a heavy broker

### 13.10 Manual validation for messaging

- create a message issue and confirm Olympus surfaces it
- reply to a message and confirm threading works
- create ephemeral messages and confirm cleanup works
- create a persistent escalation and confirm it remains visible after cleanup
- verify merge outcomes can be emitted as message issues

---

## 14. Mnemosyne and Lethe

### 14.1 Purpose of Mnemosyne

Mnemosyne stores reusable knowledge about the codebase so future agents do not rediscover the same local truths repeatedly.

### 14.2 What belongs in Mnemosyne

Three record categories are canonical:
- **convention**
- **pattern**
- **failure**

These describe the codebase, not the agent run.

Examples that belong:
- a local convention for exports
- a project-specific auth pattern
- a known failing tool or library pattern inside this repository

Examples that do not belong:
- the agent got stuck
- the agent timed out
- the user was unhappy with a run
- transient telemetry

### 14.3 Read path

When constructing prompts:
- retrieve relevant learnings by domain or keyword matching
- sort recent-first
- stay within the configured context token budget
- fall back to recent general learnings when no domain-specific match exists

### 14.4 Write path

Agents and humans can add learnings through the orchestrator endpoint or command bar action. The orchestrator enriches the record with source, issue, timestamp, and ID before appending.

### 14.5 Lethe pruning

Lethe prunes Mnemosyne when the configured record budget is exceeded.

Canonical policy:
- prune oldest records first
- keep convention records longer than ordinary items
- prune during REAP to avoid a separate maintenance daemon

### 14.6 Future semantic retrieval

Once Mnemosyne becomes large enough that keyword matching fails, semantic retrieval via local embeddings can be introduced. This is post-MVP and depends on an embedding-capable local runtime.

### 14.7 Manual validation

- write learnings from both a human and an agent
- confirm relevant learnings are injected into prompts
- confirm telemetry is not mixed into Mnemosyne
- exceed the record limit and verify pruning behavior
- ensure the file remains readable and append-only in practice

---

## 15. Olympus dashboard

### 15.1 Purpose

Olympus is the browser control room for Aegis.

It exists to:
- make swarm state legible
- expose commands without terminal dependency
- show budget usage, activity, and issues
- make intervention easy

### 15.2 MVP scope

The MVP dashboard includes:
- top bar with status, active agents, total spend or quota state, uptime, queue depth
- auto mode toggle
- settings access
- a swarm overview of active agents
- direct command bar
- response area for command results

### 15.3 Active agent card requirements

Each active agent card should show:
- agent ID
- caste
- model
- assigned issue
- turn count
- token count
- elapsed time
- spend or quota usage so far
- kill action

Completed agents may remain visible briefly after completion to improve continuity.

### 15.4 Post-MVP panels

Planned additions include:
- issue board / kanban with canonical columns: Ready → Scouting → Implementing → Queued for Merge → Merging → Resolving Integration → Reviewing → Done
- budget and performance charts
- event timeline
- Mnemosyne panel
- eval dashboard showing benchmark history and regression status
- scope-overlap visibility so the operator can see why work was deferred
- expandable terminal output
- mode selector for Direct, Steer, Ask, and Plan
- first-run setup wizard

### 15.5 Real-time transport

Olympus uses server-sent events for live updates. This is simpler than websockets and sufficient for the required UI model.

### 15.6 Manual validation

- dashboard loads on first run
- status and queue depth update in real time
- commands sent from the command bar produce the correct control actions
- kill button aborts the correct agent
- browser refresh does not corrupt live state

---

## 16. Configuration and local filesystem layout

### 16.1 Configuration goals

Configuration should be:
- file-based
- local to the repository
- explicit
- friendly to the first-run wizard
- sufficient to reproduce runtime behavior after restart

### 16.2 Key configuration domains

The config must cover at least:
- runtime selection
- auth providers and auth modes
- model assignment per caste and later per intelligence layer
- concurrency limits
- per-caste budgets
- timing and retry thresholds
- budget guardrails across exact-cost, credits, quota, and stats-only modes
- Janus enablement and escalation thresholds
- scope overlap policy
- Mnemosyne limits
- labor base path
- Olympus port and browser-open behavior
- eval harness configuration and release thresholds

### 16.2.1 Canonical default operational values

Unless the user overrides them, the default production-minded values are:
- max agents: 3
- max Oracles: 2
- max Titans: 3
- max Sentinels: 1
- max Janus: 1
- Oracle budget: 10 turns / 80k tokens
- Titan budget: 20 turns / 300k tokens
- Sentinel budget: 8 turns / 100k tokens
- Janus budget: 12 turns / 120k tokens
- poll interval: 5 seconds
- stuck warning: 90 seconds
- stuck kill: 150 seconds
- per-issue exact-cost warning: $3.00 when `metering=exact_usd`
- daily exact-cost warning: $10.00 when `metering=exact_usd`
- daily exact-cost hard stop: $20.00 when `metering=exact_usd`
- subscription quota warning floor: 35% remaining when `metering=quota`
- subscription quota hard-stop floor: 20% remaining when `metering=quota`
- Janus enabled: true
- Janus retry threshold: 2 failed integration-refresh cycles
- scope overlap threshold: 0 overlapping files by default
- Mnemosyne max records: 500
- Mnemosyne prompt budget: 1000 tokens
- Olympus default port: 3847

### 16.2.2 Canonical config shape example

A production-ready config should be concrete enough that a fresh implementation agent can wire the system without guessing key names.

```json
{
  "runtime": "pi",
  "auth": {
    "provider": "pi",
    "mode": "subscription",
    "plan": "pro"
  },
  "models": {
    "oracle": "pi:default",
    "titan": "pi:default",
    "sentinel": "pi:default",
    "janus": "anthropic:claude-sonnet",
    "metis": "anthropic:claude-haiku",
    "prometheus": "anthropic:claude-sonnet"
  },
  "concurrency": {
    "max_agents": 3,
    "max_oracles": 2,
    "max_titans": 3,
    "max_sentinels": 1,
    "max_janus": 1
  },
  "budgets": {
    "oracle": { "turns": 10, "tokens": 80000 },
    "titan": { "turns": 20, "tokens": 300000 },
    "sentinel": { "turns": 8, "tokens": 100000 },
    "janus": { "turns": 12, "tokens": 120000 }
  },
  "thresholds": {
    "poll_interval_seconds": 5,
    "stuck_warning_seconds": 90,
    "stuck_kill_seconds": 150,
    "allow_complex_auto_dispatch": false,
    "scope_overlap_threshold": 0,
    "janus_retry_threshold": 2
  },
  "economics": {
    "metering_fallback": "stats_only",
    "per_issue_cost_warning_usd": 3.0,
    "daily_cost_warning_usd": 10.0,
    "daily_hard_stop_usd": 20.0,
    "quota_warning_floor_pct": 35,
    "quota_hard_stop_floor_pct": 20,
    "credit_warning_floor": null,
    "credit_hard_stop_floor": null,
    "allow_exact_cost_estimation": true
  },
  "janus": {
    "enabled": true,
    "max_invocations_per_issue": 1
  },
  "mnemosyne": {
    "max_records": 500,
    "prompt_token_budget": 1000
  },
  "labor": {
    "base_path": ".aegis/labors"
  },
  "olympus": {
    "port": 3847,
    "open_browser": true
  },
  "evals": {
    "enabled": true,
    "results_path": ".aegis/evals",
    "benchmark_suite": "core",
    "minimum_pass_rate": 0.8,
    "max_human_interventions_per_10_issues": 2
  }
}
```

Rules:
- exact field names may evolve, but the config must preserve these domains
- future pipeline and mixed-model configuration extends this shape rather than replacing it
- provider-prefixed model strings may be used later to select different runtime adapters deterministically
- economic guardrails and eval thresholds are first-class configuration, not hidden constants


### 16.2.3 Auth-plan-aware budget gates

Budget policy must adapt to what the runtime can actually report.

Canonical behavior:
- `api_key` + `exact_usd` → enforce dollar warnings and dollar hard stops
- `subscription` or `workspace_subscription` + `quota` → enforce remaining-quota floors and reset-aware warnings
- any auth mode + `credits` → enforce remaining-credit floors when the provider exposes them
- `stats_only` → enforce proxy limits using turns, tokens, wall time, retries, and concurrency
- `unknown` → use the safest posture: no autonomous Janus and no autonomous complex-work dispatch unless a human explicitly overrides

The config surface must therefore support both provider-auth settings and metering fallbacks.

Canonical rule:
- subscription-auth runtimes are first-class citizens in Aegis; the system must still meter, gate, and visualize usage even when exact dollar pricing is unavailable

### 16.3 Files and directories under `.aegis/`

Canonical files and directories include:

- `.aegis/config.json`
- `.aegis/dispatch-state.json`
- `.aegis/merge-queue.json`
- `.aegis/mnemosyne.jsonl`
- `.aegis/labors/`
- future embeddings sidecar for semantic Mnemosyne retrieval if added

### 16.3.1 Project `AGENTS.md`

The repository's existing `AGENTS.md`, if present, is an input to prompt construction.

Canonical rules:
- Aegis reads the project `AGENTS.md`
- Aegis injects it into every agent session before caste-specific instructions
- Aegis does not create or modify the file
- missing `AGENTS.md` is valid and simply results in no project-level instruction prelude

### 16.4 Git treatment

Runtime state and labors are local operational artifacts and should be gitignored.

Mnemosyne is project knowledge and is committed to git by default so the codebase can retain learned conventions and local patterns across machines and sessions.

### 16.5 Manual validation

- run `aegis init` in a new repo and confirm files are created correctly
- verify `.gitignore` receives the runtime-state paths
- confirm an existing project `AGENTS.md` is read but not modified
- change config values and confirm behavior changes on next start

---

## 17. Installation and startup

### 17.1 Prerequisites

The system expects:
- Node.js
- git
- Beads CLI by default
- a configured runtime provider, starting with Pi

### 17.2 Canonical CLI surface

The minimal CLI must include:
- `aegis init`
- `aegis start`
- `aegis status`
- `aegis stop`

`aegis start` should support at least these overrides:
- `--port <N>`
- `--concurrency <N>`
- `--model <model>`
- `--no-browser`
- `--verbose`

### 17.3 Canonical launch sequence

When `aegis start` executes, Aegis should:
1. read `.aegis/config.json` and fail clearly if it is missing
2. verify the tracker CLI is installed and initialized
3. verify the repository is a git repo
4. load dispatch state and run crash recovery
5. start the HTTP server and Olympus assets
6. open the browser unless disabled
7. start idle in conversational mode
8. print the local Olympus URL and shutdown hint

### 17.4 Canonical graceful shutdown

On SIGINT or SIGTERM, Aegis should:
1. stop polling for new work
2. tell active agents to wrap up and stop
3. wait up to 60 seconds for clean completion
4. abort stragglers after the timeout
5. reopen or otherwise reconcile in-progress tracker work as needed
6. clean up completed labors while preserving failed/conflicted ones
7. persist final dispatch and queue state
8. print a final budget summary and exit

### 17.5 First-time installation

The canonical flow is:
1. install Aegis globally
2. initialize Beads in the project if needed
3. run `aegis init`
4. launch with `aegis start`

### 17.6 First-run setup

If no config exists, Olympus should present a setup path that covers:
- API keys or runtime credentials
- model assignment
- concurrency
- prerequisite validation
- final confirmation

### 17.7 Manual validation

- clean install in a new repository
- existing-repo install where Beads is already initialized
- startup with missing prerequisites and confirm clear failure messages
- startup on Windows and confirm the browser opens and state files are created correctly
- graceful shutdown mid-run and verify state is persisted and recoverable

---

## 18. Beads integration contract

### 18.1 Canonical contract with the tracker

Aegis expects the tracker to provide:
- issue creation and update operations
- ready queue query
- dependency model
- stable issue IDs
- structured message issues
- local CLI usability

### 18.2 Why Beads fits

Beads is a strong default because it offers:
- ready queue semantics
- structured dependency graph
- message issues with threading and ephemeral lifecycle
- portability across operating systems
- a CLI model that fits local orchestrator control

### 18.3 Aegis tracker rules

- use tracker commands, not ad-hoc file scraping
- create issues for discovered, corrective, or clarification work rather than burying them in logs
- preserve threadable messages for coordination that should survive runs
- avoid coupling orchestration correctness to comment parsing

### 18.4 Manual validation

- create blockers and confirm `bd ready` behavior influences triage
- create sub-issues and confirm they behave as distinct work items
- create and view message issues
- close or reopen tracker issues and verify Aegis reflects the change

---

## 19. Metis — natural-language steering

### 19.1 Role

Metis is the conversational interpreter for Olympus Steer and Ask modes.

### 19.2 Why it is post-MVP

Direct deterministic commands already cover the necessary control plane. Metis adds convenience and reference resolution, not foundational correctness.

### 19.3 Canonical behavior

Metis:
- receives user text plus current swarm state
- returns structured actions
- is stateless between invocations
- uses a cheap model
- never bypasses action validation

### 19.3.1 Structured action family

The structured action family should be explicit enough to avoid prompt folklore. It must cover at least:
- pause / resume
- auto_on / auto_off
- scale
- focus / clear_focus
- scout / implement / review / process / rush
- kill / restart
- tell_agent / tell_all
- add_learning
- dispatch_oracle
- reprioritize
- summarize
- noop with explanation

Canonical rule:
- Metis receives current swarm state so it can resolve references such as “that stuck worker” deterministically into one of these actions

### 19.4 Ask mode vs Steer mode

- **Ask** returns summaries or read-only interpretations
- **Steer** returns state-changing actions
- **Direct** bypasses the LLM entirely
- **Plan** belongs to Prometheus

### 19.5 Manual validation

- a direct command still bypasses the model
- ambiguous references like “that stuck worker” resolve correctly when enough state exists
- impossible requests return a no-op explanation instead of random action

---

## 20. Prometheus — strategic planner

### 20.1 Role

Prometheus turns a high-level goal into Beads issues and dependency chains.

### 20.2 Canonical boundaries

Prometheus may:
- inspect codebase context
- inspect Beads state
- inspect Mnemosyne
- propose issue creation and updates

Prometheus may **not**:
- dispatch agents directly
- bypass user confirmation
- become a hidden background planner

### 20.3 User interaction model

Prometheus runs only in Plan mode and only when explicitly invoked. It may be more expensive than Metis and should be treated as deliberate planning work.

### 20.3.1 Execution confirmation contract

Canonical rules:
- the orchestrator shows the user the expected budget tier before execution when practical
- Prometheus returns proposed issue creations and updates, not direct side effects
- the user confirms before Aegis creates or updates tracker issues
- after confirmation, the resulting issues enter the normal deterministic loop rather than a special planner-only path

### 20.4 Manual validation

- provide a large goal and confirm Prometheus proposes a plausible issue chain
- require user confirmation before issue creation
- confirm the created issues flow into the normal deterministic loop afterward

---

## 21. Configurable pipelines

### 21.1 Why pipelines exist

The hardcoded Oracle → Titan → Merge Queue → Sentinel path is the default production workflow, but not every issue type needs the same path forever.

### 21.2 Canonical default pipeline

The default remains:

**oracle → titan → merge-queue → sentinel**

### 21.3 Future configurable behavior

Later, `.aegis/config.json` may define named pipelines and stage mappings so trivial or special issue classes can use alternate paths.

Examples of future variation:
- trivial work may skip Oracle
- chore work may use Titan only
- security work may run an extra review stage
- pre-merge review may be introduced for specific categories

### 21.3.1 Example future pipeline config

```json
{
  "pipelines": {
    "default": ["oracle", "titan", "merge-queue", "sentinel"],
    "chore": ["titan", "merge-queue"],
    "trivial": ["titan", "merge-queue", "sentinel"],
    "security": ["oracle", "titan", "merge-queue", "sentinel", "security-review"]
  },
  "stages": {
    "oracle": { "caste": "oracle", "model": "claude-haiku" },
    "titan": { "caste": "titan", "model": "claude-sonnet" },
    "sentinel": { "caste": "sentinel", "model": "claude-sonnet" },
    "security-review": {
      "caste": "sentinel",
      "model": "claude-opus",
      "prompt_override": "Focus specifically on security implications."
    }
  }
}
```

### 21.4 Design constraint

Configurable pipelines require the dispatch stage model to become generic enough to walk arbitrary stage sequences rather than relying on hardcoded transitions.

### 21.5 Manual validation

- define a non-default pipeline and confirm the correct stage order is followed
- verify omitted stages are actually skipped cleanly
- verify a repeated caste with a different prompt still behaves as a distinct stage

---

## 22. Mixed-model swarms

### 22.1 Purpose

Mixed-model swarms allow different work classes to run on different runtimes or providers.

### 22.2 Canonical target behavior

Examples:
- cheap local models for Oracle and Sentinel
- stronger cloud model for Titan
- stronger or equal-strength cloud model for Janus when enabled
- cheap model for Metis
- stronger planner model for Prometheus

### 22.3 Requirements

- at least one additional runtime adapter beyond Pi
- normalized budget tracking across runtimes and auth modes
- prompt/template handling that tolerates model differences

### 22.3.1 Example runtime/model mapping

```json
{
  "models": {
    "oracle": "ollama:qwen2.5-coder:32b",
    "titan": "anthropic:claude-sonnet-4-6",
    "sentinel": "ollama:qwen2.5-coder:32b",
    "janus": "anthropic:claude-sonnet-4-6",
    "metis": "ollama:qwen2.5-coder:32b",
    "prometheus": "anthropic:claude-sonnet-4-6"
  }
}
```

Canonical rule:
- the provider prefix determines which runtime adapter is selected
- the remainder of the string is passed to that adapter as the model identifier
- local models may report token usage with zero direct dollar cost, subscription-auth runtimes may report quota rather than dollars, and accounting still remains normalized across runtimes

### 22.4 Manual validation

- assign different models to different castes
- confirm the correct adapter is chosen from configuration
- confirm token, quota, credit, and cost accounting remain coherent

---

## 23. Future semantic Mnemosyne retrieval

### 23.1 Trigger condition

When the learnings store becomes large enough that keyword matching becomes unreliable, semantic retrieval becomes justified.

### 23.2 Canonical future approach

- generate embeddings for learnings
- store them alongside the JSONL records or in a sidecar
- embed the current issue description
- retrieve top-K relevant records
- fall back to keyword retrieval if the embedding runtime is unavailable

### 23.3 Manual validation

- verify retrieval quality beats naive domain matching on a large store
- verify fallback still works if the embedding provider is unavailable

---

## 24. Production operations and observability

### 24.1 What must be observable

The human should be able to observe:
- what issues are in flight
- which agents are running
- which stage each issue is in
- why an issue failed
- what the merge queue is doing
- what messages and escalations exist
- how much work has cost or consumed in quota/credits

### 24.2 Event visibility

At minimum, event visibility should cover:
- dispatch
- agent completion
- agent kill
- merge queue events
- message events
- state transitions
- generated issue creation
- pruning and maintenance events that affect interpretation

### 24.3 Recovery posture

Production operation assumes:
- crashes happen
- agents get stuck
- merges fail
- external providers wobble
- humans will intervene selectively

The system must therefore prefer explicit artifacts and visible state over implicit recovery magic.

### 24.4 Operator economics and release guardrails

Aegis must surface and enforce the economics of autonomy.

At minimum, the operator must be able to see:
- cumulative spend for the current session and current day when exact dollars are available
- quota, credit, or proxy usage when exact dollars are not available
- budget usage by caste and by issue
- the budget impact of Janus escalation
- whether a dispatch or escalation was suppressed by guardrails

Canonical rule:
- Aegis prefers pausing and asking the human over silently spending or draining quota through a guardrail
- clean low-cost flow beats high-autonomy theatrics

### 24.5 Canonical eval harness

Aegis includes a first-class eval harness so the system can be judged by repeatable runs rather than narrative impressions.

The harness must provide:
- fixture repositories or fixture branches covering representative software tasks
- a scenario runner that invokes Aegis against named benchmark scenarios
- stable result artifacts under `.aegis/evals/`
- machine-readable score summaries for regression comparison

Each eval run must capture at minimum:
- Aegis version or git SHA
- config fingerprint
- runtime and model mapping
- scenario id
- issue count and issue types
- completion outcomes
- merge outcomes
- human interventions
- cost totals when exact dollars are available
- quota or credit totals when dollars are not available
- wall-clock timing

### 24.6 Required benchmark suite

The core benchmark suite must include at least these scenarios:
- single clean issue with no blockers
- issue that Oracle marks `complex` and therefore pauses correctly
- issue that requires decomposition into child issues
- Titan ambiguity that must create a clarification issue instead of guessing
- stale-branch merge requiring rework
- hard merge conflict with preserved labor
- Tier 3 integration escalation where Janus is permitted
- Janus case where semantic ambiguity forces a human-decision artifact rather than unsafe auto-resolution
- orchestrator restart during implementation
- orchestrator restart during merge processing
- hooks disabled so polling remains the correctness path

### 24.7 Canonical metrics

The eval harness must compute at minimum:
- issue completion rate
- structured-artifact compliance rate
- clarification compliance rate
- merge conflict rate per Titan
- merge queue latency from `queued_for_merge` to `merged`
- rework loops per issue
- Janus invocation rate per 10 issues
- Janus success rate
- token overhead attributable to messaging, if messaging is enabled
- human interventions per 10 completed issues
- cost per completed issue
- restart recovery success rate

### 24.8 Release gates

A build is not considered release-ready until the benchmark suite shows all of the following on the configured core benchmark corpus:
- 100% structured-artifact compliance for Oracle, Titan, Sentinel, and Janus when Janus is invoked
- 100% clarification compliance in scenarios that are intentionally ambiguous
- 100% restart recovery on the designated restart scenarios
- 0 direct-to-main bypasses outside the merge queue
- at least 80% issue completion rate on the core benchmark suite
- no more than 2 human interventions per 10 completed issues after the initial stabilization run
- Janus invocation remains the minority path and does not become the dominant route through the system

The exact percentage thresholds may be tightened per repository, but a looser threshold than these defaults requires an explicit human decision recorded in the project config or release notes.

### 24.9 Recommended experiments

Recommended evaluation comparisons include:
- mechanical merge queue only vs mechanical queue plus Janus escalation path
- artifact-first coordination vs heavier Beads-native messaging usage
- polling only vs polling plus hook-driven event ingest
- scope-overlap protection on vs scope-overlap protection off

Success is not “more autonomy.” Success is lower operator burden and higher integration reliability for the same or lower cost.

---

## 25. Phased implementation plan with manual testing gates

This section defines the implementation ordering for start-to-production work. A phase is not complete until its manual gate passes.

### Phase 0 — bootstrap and local setup

**Build**
- CLI entrypoints
- `aegis init`
- config creation
- basic HTTP server
- Olympus shell
- prerequisite checks

**Done when**
- a new project can install Aegis, initialize Beads, initialize `.aegis`, and open Olympus

**Manual gate**
- fresh repo setup works end to end on at least one Unix-like environment and one Windows environment
- missing prerequisites fail clearly

### Phase 0.5 — eval harness and benchmark corpus

**Build**
- fixture repositories or fixture branches
- scenario runner
- result artifact schema
- score summary generation
- at least the initial core benchmark corpus

**Done when**
- Aegis can be run repeatedly against named scenarios and produce comparable result artifacts

**Manual gate**
- run the same scenario twice and verify comparable score output
- simulate a failed run and verify the result artifact still records the failure cleanly

### Phase 1 — deterministic dispatch core

**Build**
- dispatch store
- poller
- triage
- dispatcher
- monitor
- reaper
- runtime adapter abstraction
- Pi adapter
- Oracle, Titan, Sentinel prompts and role wiring
- labor creation
- direct commands
- SSE state updates
- Mnemosyne write/read basics
- Lethe pruning

**Done when**
- one issue can run through Oracle and Titan deterministically
- monitor and reap work correctly
- restart recovery works
- live dashboard visibility exists

**Manual gate**
- run one issue with `process`
- force an Oracle failure, Titan failure, and Sentinel failure
- confirm cooldown behavior
- confirm learnings can be written and re-read
- confirm labor isolation on Titan

### Phase 1.5 — merge queue

**Build**
- merge queue persistence
- queue worker
- gate runner
- deterministic merge outcome handling
- conflict issue generation
- scope-overlap protection in triage
- Janus escalation path and artifact handling
- queue visibility in Olympus or event stream

**Done when**
- Titans no longer merge directly to main in the final design
- successful implementation goes through the queue first
- failures produce explicit artifacts
- Janus can be invoked for Tier 3 integration cases without becoming the default path

**Manual gate**
- one clean merge candidate lands successfully
- one failing candidate emits `MERGE_FAILED`
- one conflicting candidate emits `REWORK_REQUEST`
- one Tier 3 case dispatches Janus and either requeues safely or emits a human-decision artifact
- restart during merge processing remains safe

### Phase 1.6 — Beads-native messaging and event ingest

**Build**
- Aegis mail delegate
- structured message creation and read flow
- ephemeral cleanup policy
- hook ingestion endpoint or local equivalent
- Olympus surfacing for important messages

**Done when**
- merge queue outcomes and escalations can be represented as Beads messages
- hook-driven updates improve freshness without replacing polling

**Manual gate**
- create message threads
- verify ephemeral cleanup
- verify persistent escalation survives cleanup
- disable hooks and confirm correctness remains intact

### Phase 2 — Olympus maturity and operator UX

**Build**
- polished swarm overview
- settings overlay
- issue board
- event timeline
- budget views
- Mnemosyne panel
- eval panel
- optional terminal stream expansion

**Done when**
- a human can supervise several simultaneous agents without falling back to terminal-only inspection

**Manual gate**
- run multiple agents and verify the UI remains legible
- verify issue-board state matches dispatch state
- verify budget and event views update live

### Phase 2.5 — Metis and pipeline foundations

**Build**
- Metis action interpreter
- Steer and Ask modes
- generic enough stage machinery to prepare for configurable pipelines
- user-to-agent tell actions clearly separated from message issues

**Done when**
- natural-language steering reliably resolves to valid actions
- the control plane stays deterministic after action resolution

**Manual gate**
- test ambiguous commands
- confirm no-op explanations on bad requests
- confirm direct mode still bypasses the LLM

### Phase 3 — configurable pipelines and mixed-model swarms

**Build**
- stage mapping model
- pipeline definitions in config
- per-stage prompt override capability
- at least one additional runtime adapter
- normalized budgeting across runtimes

**Done when**
- a repository can define a non-default workflow and Aegis follows it safely

**Manual gate**
- run a trivial pipeline
- run a security review pipeline
- run mixed runtimes for at least two different castes

### Phase 4 — Prometheus and semantic Mnemosyne

**Build**
- Plan mode
- issue-graph generation
- user confirmation loop
- optional embedding-backed Mnemosyne retrieval
- benchmark expansion for new pipelines and mixed-runtime cases

**Done when**
- the human can request top-down planning into Beads issues
- large Mnemosyne stores remain retrievable

**Manual gate**
- generate an issue graph from a high-level feature request
- confirm the issues dispatch through the normal loop
- verify semantic retrieval beats keyword-only behavior on a large knowledge base

---

## 26. Production readiness checklist

Aegis is production-ready when all of the following are true:

- task truth and orchestration truth are clearly separated
- the system survives restart without losing in-progress understanding
- Oracle, Titan, Sentinel, and Janus all have validated success and failure handling in the scenarios where they are supposed to run
- Titans operate in isolated labors
- merge operations go through the queue instead of direct integration
- queue failures become explicit issues or messages
- messaging is sparse, structured, and ephemeral by default
- hooks improve freshness but are not required for correctness
- Olympus exposes enough state to supervise the swarm
- direct commands are deterministic
- Metis and Prometheus remain optional and bounded by explicit modes
- multiple issues can be processed concurrently without merge corruption
- scope-overlap protection blocks unsafe parallel Titan work by default
- budgets, stuck detection, cooldowns, and economic guardrails prevent runaway behavior
- the eval harness passes the configured core benchmark suite
- a reading agent can derive implementation tickets from this document alone

---

## 27. Canonical decisions summary

These decisions are final unless a later revision of this PRD changes them explicitly.

- **Default workflow:** Oracle → Titan → Merge Queue → Sentinel
- **Fourth caste:** Janus, escalation-only for merge-boundary integration work
- **Merge queue owner:** Aegis orchestrator, deterministic by default
- **Default Sentinel placement:** post-merge
- **Janus placement:** not on the happy path; invoked only after deterministic escalation thresholds
- **Default messaging system:** Beads-native messages with Aegis mail delegate
- **Messaging policy:** sparse, typed, ephemeral by default
- **Correctness baseline:** polling
- **Freshness accelerator:** Beads hooks and event ingest
- **Upstream conflict reduction:** scope-overlap protection before Titan dispatch
- **Primary runtime at launch:** Pi
- **Primary tracker at launch:** Beads
- **Primary UI:** Olympus
- **Task truth:** Beads
- **Orchestration truth:** dispatch state
- **Project knowledge truth:** Mnemosyne
- **Release truth:** eval harness and benchmark corpus
- **LLM use in control plane:** only after deterministic action selection or for explicitly bounded modules

---

## 28. Glossary

- **Aegis** — the orchestrator
- **Olympus** — the browser dashboard
- **Beads** — default issue tracker and message store
- **Oracle** — scouting and planning caste
- **Titan** — implementation caste
- **Sentinel** — review caste
- **Janus** — escalation-only integration caste for merge-boundary problems
- **Labor** — isolated git worktree for a Titan or preserved integration workspace for Janus
- **Mnemosyne** — learned project knowledge store
- **Lethe** — pruning mechanism for Mnemosyne
- **Dispatch state** — persistent orchestration stage tracking
- **Merge queue** — deterministic integration layer after Titan success
- **Scope allocator** — the overlap-protection rule that suppresses unsafe parallel Titan work
- **Eval harness** — scenario runner, benchmark corpus, and regression score artifacts
- **Metis** — natural-language steering layer
- **Prometheus** — strategic planning layer
- **Event ingest** — hook-driven update path into the orchestrator
- **Message issue** — Beads issue with `type=message`
- **Cooldown** — temporary suppression after repeated failures

---

## 29. Final implementation note

This document is intentionally written so it can be used in four ways without switching sources:

1. as the human-readable PRD
2. as the engineering implementation order
3. as the planning corpus for an agent that needs to open implementation tasks against missing work
4. as the acceptance source for evals and manual release gates

Canonical build posture:
- build phase by phase, not as one giant end-to-end generation prompt
- treat the eval harness and manual gates as part of the product, not postscript tooling
- prefer narrow, testable slices that preserve truth boundaries over broad speculative generation

That is the standard the final build must meet.
