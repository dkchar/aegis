# Aegis Source Of Truth

Date: 2026-04-26
Status: Canonical

This document is the only active product and architecture spec for Aegis.

It supersedes all older specs, addenda, plans, discovery notes, and follow-up docs. Older docs are historical only and must not be used as planning or implementation authority.

## Product Definition

Aegis is a terminal-first deterministic multi-agent orchestrator for software work.

It reads task truth from Beads, tracks orchestration truth in `.aegis`, runs agents through runtime adapters, and integrates work through a deterministic merge queue.

Aegis is not a dashboard product first. It is not an agent chatroom. It is not a second issue tracker.

Core loop:

```text
poll -> triage -> dispatch -> monitor -> reap
```

Swarm posture:

- Agents are free inside assigned scope to inspect, reason, edit, test, and choose implementation tactics.
- Agents do not own orchestration truth, graph mutation, merge routing, retry policy, or durable completion semantics.
- Swarm behavior comes from many scoped agents moving concurrently through deterministic shared state, not from a manager-agent prompt deciding the control plane.
- Cross-agent handoffs must be typed artifacts that the control plane validates and routes mechanically. Prompt text may explain intent, but must not be the only enforcement layer.
- Review findings are typed control inputs. Sentinel may identify `finding_kind`, `required_files`, `owner_issue`, and `route`, but Aegis routes those findings deterministically.
- Operational exhaustion is a first-class control outcome. The daemon must halt or skip exhausted work visibly rather than consuming adapter quota indefinitely.
- Step 1 proof allows typed, bounded graph amplification. Agents may discover blockers, but Aegis decides mechanically whether to rework the owner, reopen prior work, or create a child issue.

Truth planes:

| Concern | Source |
| --- | --- |
| task truth | Beads |
| orchestration truth | `.aegis/dispatch-state.json` |
| merge truth | `.aegis/merge-queue.json` |
| durable observability | `.aegis/logs/` and caste artifacts |
| runtime execution | adapter-owned sessions |

## Current Goal

Step 1 is not complete until Aegis has at least one real adapter that fully drains the seeded animated React todo graph and produces a working app.

That run is the MVP proof. Scripted seam tests are necessary but insufficient.

Required proof:

- Seeded Beads graph drains to `bd ready --json` returning `[]`.
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
- Beads tracker integration.
- `.aegis` dispatch, runtime, log, transcript, and caste artifact surfaces.
- Deterministic scripted runtime for seam tests.
- Pi-backed live runtime path.
- Merge queue and Janus escalation shell.
- Convergence control plane direction: Oracle advisory, Titan execution, Sentinel gate, Janus integration escalation.
- Recent hardening around file scope, root mutation detection, committed diff proof, scope-overlap scheduling, and Pi tool jailing.

Not proven:

- Full seeded animated React todo graph drain with a real adapter.
- Stable live adapter contract across long, concurrent, model-backed runs.
- Working app proof from the seeded graph.
- Per-agent session terminal visibility.
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

Exit gate:

- `bd ready --json` returns `[]` in seeded mock repo.
- The React todo app runs.
- All artifacts and logs support the claim.

Valid direct root adoption is allowed only when Aegis proves the root was clean before and after, the root head advanced linearly, the committed diff exactly matches the Titan artifact and file scope, and Sentinel still gates the adopted candidate.

### Step 2: Per-Agent Session Terminals

Goal:

- Operator can watch each live agent session without spelunking raw transcripts.

Scope:

- per-agent terminal/session panes
- session lifecycle visibility
- live command/tool stream where adapter supports it
- abort/stop surface
- transcript links

Non-goal:

- Olympus product UI polish.

Exit gate:

- During seeded proof, operator can identify each active agent, issue, labor path, model, session id, and current activity from terminal-visible surfaces.

### Step 3: Olympus

Goal:

- Visualize what already works.

Scope:

- graph state
- agent/session state
- merge queue state
- logs/artifacts links
- controls that route through deterministic orchestrator commands

Non-goal:

- Making Olympus a separate truth plane.

Exit gate:

- Olympus reflects terminal/.aegis truth and can supervise the seeded proof without becoming required for correctness.

### Later

Deferred until Steps 1-3 work:

- budget/economics guardrails
- Mnemosyne/Lethe
- Beads-native messaging
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
- session status and terminal/transcript events where available.
- final result with success/failure, usage stats if available, and transcript/artifact refs.

Every real adapter must enforce or allow Aegis to enforce:

- cwd jail: tools operate only in assigned labor unless merge/Janus code explicitly owns integration workspace.
- no absolute-path escape.
- no `cd` or shell equivalent that escapes labor.
- no root mutation outside allowed orchestrator-owned files.
- no direct writes to Beads except through Aegis policy code.
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
- create Beads issues.
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

Blocking findings with `route=create_blocker` are routed by Aegis policy code. Sentinel does not decide Beads mutation; the deterministic router creates or reuses the blocking issue, links it to the parent, and records the policy artifact.

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
- `blocked_on_child`: parent blocked in Beads by accepted child issue.
- `failed_operational`: runtime/tool/provider/policy failure, retry only through cooldown/manual policy. Exhausted provider/runtime failures must be reported explicitly in terminal status so a raw tracker queue cannot masquerade as runnable work.
- `resolving_integration`: Janus owns merge-boundary failure.

Merge boundary:

```text
Titan candidate -> Sentinel pre-merge gate -> merge queue -> complete
```

Janus is only after merge/integration failure.

Runtime session ownership:

- Long-running caste work must be represented as adapter-owned sessions in dispatch state.
- Oracle, Titan, and Sentinel review work use durable `runningAgent` records and advance only through monitor/reaper or explicit caste command completion.
- The daemon dispatch loop may launch sessions, but must not synchronously wait on live model work as an inline side effect.
- If Titan fails operationally after Oracle context exists, retry stays at Titan with the existing Oracle artifact instead of restarting scouting.
- If a Sentinel review session is interrupted or fails operationally, the parent returns to `implemented` with cooldown so retry stays at the review layer.
- Repeated Sentinel operational failure escalates to `failed_operational`; triage then routes Titan with the existing Oracle artifact and durable review feedback instead of relaunching review forever.
- Repeated operational failures have a deterministic retry ceiling. Once exhausted, triage skips the issue with `operational_failure_limit` and status reports the terminal operational failure instead of draining adapter quota forever.
- A stranded `reviewing` record with a durable Sentinel verdict is recovered from the artifact; without a verdict it retries Sentinel, not Oracle/Titan.
- Rework dispatch must include the durable Sentinel or Janus feedback artifact in the Titan prompt. Repeating a parent handoff without the blocking finding is a control-plane bug.

## Mutation Policy

Castes never write Beads directly.

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
- Beads dependency makes parent not ready.
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
- If implementation reveals a new decision, record it here or in Beads as execution work, not in a side spec.
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
- Use atomic writes for durable state and artifacts via temp file then rename.
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

Use Beads for work tracking.

Before selecting work:

```bash
bd ready --json
```

If Beads server is down, report that and continue only with explicitly requested non-Beads work.

Current next work after this spec:

1. Finish or revert in-flight adapter-contract hardening based on tests.
2. Run deterministic verification.
3. Run full seeded React todo proof with Pi.
4. If Pi fails by adapter-specific contract breach, implement Codex adapter instead of more Pi harness patching.

## Superseded Files

These files are historical and must be ignored for active context:

- `docs/SPECv2.md`
- `docs/enhancement-spec-2026.md`
- `docs/superpowers/specs/`
- `docs/superpowers/plans/`

If any of those conflict with this document, this document wins.
