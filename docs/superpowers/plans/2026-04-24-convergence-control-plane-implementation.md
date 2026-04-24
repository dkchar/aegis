# Convergence Control Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved convergence control plane so Aegis reduces the ready issue graph toward completion, with deterministic mutation policy, Oracle advisory-only scouting, Titan-owned blocking mutations, Sentinel pre-merge gating, and Janus-only integration escalation.

**Architecture:** Introduce a focused deterministic policy boundary in `src/core` that becomes the only writer for graph mutations and parent blocking transitions. Rebuild dispatch-state semantics around explicit control states (`failed_operational`, `blocked_on_child`, `rework_required`) and move Sentinel ahead of merge admission so same-parent rework loops do not enlarge the graph.

**Tech Stack:** TypeScript, Vitest, Node.js CLI, Beads tracker CLI integration, atomic `.aegis/*.json` state/artifact persistence.

---

## File Map

### Create

- `src/core/control-plane-policy.ts`
  - Deterministic mutation-policy entrypoint.
  - Accept/reject/reuse Titan and Janus proposals.
  - Persist accepted/rejected policy artifacts and return parent-stage transitions.
- `tests/unit/core/control-plane-policy.test.ts`
  - Contract tests for proposal acceptance, rejection, dedupe, and tracker linking.
- `docs/superpowers/plans/2026-04-24-convergence-control-plane-implementation.md`
  - This plan.

### Modify

- `src/core/dispatch-state.ts`
  - Add explicit control-stage taxonomy and helpers for stale-session reconciliation.
- `src/core/stage-invariants.ts`
  - Remove Oracle veto semantics and enforce new state/artifact invariants.
- `src/core/triage.ts`
  - Dispatch Titan from `scouted` and `rework_required`, never redispatch blocked parents, and only retry `failed_operational`.
- `src/core/dispatcher.ts`
  - Preserve stage-specific artifacts without resetting rework context and write new failure stage on launch errors.
- `src/core/reaper.ts`
  - Advance running stages into `scouted`, `implemented`, `reviewing`, or `complete`; classify operational failures cleanly.
- `src/core/caste-runner.ts`
  - Rewrite caste prompts, artifact handling, control-state transitions, Sentinel pre-merge behavior, and policy-tool integration.
- `src/core/loop-runner.ts`
  - Keep daemon loop aligned with new triage/review/merge ordering.
- `src/merge/auto-enqueue.ts`
  - Enqueue only Sentinel-passed candidates.
- `src/merge/merge-next.ts`
  - Remove post-merge Sentinel review, consume `queued_for_merge -> merging -> complete`, and route Janus outcomes through the new policy layer.
- `src/tracker/tracker.ts`
  - Extend tracker abstraction with explicit blocking-link support.
- `src/tracker/beads-tracker.ts`
  - Implement `bd link <blocking> <blocked> --type blocks` flow.
- `src/castes/oracle/oracle-parser.ts`
  - Replace `ready/decompose` semantics with scout-only artifact fields.
- `src/castes/oracle/oracle-tool-contract.ts`
  - Match the new scout-only schema.
- `src/castes/titan/titan-parser.ts`
  - Add structured optional mutation proposal payload.
- `src/castes/titan/titan-tool-contract.ts`
  - Enforce Titan proposal schema for blocking mutations only.
- `src/castes/sentinel/sentinel-parser.ts`
  - Replace follow-up issue ids with `blockingFindings`, `advisories`, `touchedFiles`, and `contractChecks`.
- `src/castes/sentinel/sentinel-tool-contract.ts`
  - Enforce binary gate + advisory contract.
- `src/castes/janus/janus-parser.ts`
  - Add explicit `requeue_parent` vs `create_integration_blocker` policy payload.
- `src/castes/janus/janus-tool-contract.ts`
  - Enforce Janus proposal schema.
- `tests/unit/core/triage.test.ts`
  - Add dispatch-selection coverage for `rework_required`, `blocked_on_child`, and `failed_operational`.
- `tests/unit/core/dispatcher.test.ts`
  - Cover launch-time stage preservation and `failed_operational`.
- `tests/unit/core/reaper.test.ts`
  - Cover new stage completions and failure classification.
- `tests/unit/core/caste-runner.test.ts`
  - Rewrite Oracle/Titan/Sentinel/Janus end-to-end control-state expectations.
- `tests/unit/merge/merge-next.test.ts`
  - Lock pre-merge Sentinel flow and Janus blocker behavior.
- `tests/unit/tracker/beads-tracker.test.ts`
  - Cover tracker `blocks` linking.
- `tests/unit/castes/oracle-parser.test.ts`
  - Cover scout-only schema.
- `tests/unit/castes/titan-parser.test.ts`
  - Cover optional mutation proposal payload.
- `tests/unit/castes/sentinel-parser.test.ts`
  - Cover binary gate + advisory payload.
- `tests/unit/castes/janus-parser.test.ts`
  - Cover Janus proposal payload.
- `tests/unit/castes/structured-tool-contract.test.ts`
  - Keep tool-contract enforcement aligned with the new schemas.
- `tests/unit/mock-run/acceptance.test.ts`
  - Update deadlock detection and convergence assertions for new states.
- `src/mock-run/acceptance.ts`
  - Detect new control-plane failure modes in proof runs.

## Parallelization Notes

Use subagent-driven development after Task 1 lands.

- Worker A: `src/castes/*` parser/tool-contract rewrites + parser tests
- Worker B: `src/tracker/*` + `src/core/control-plane-policy.ts` + policy/tracker tests
- Worker C: `src/core/*` + `src/merge/*` orchestration rewrites + loop/merge tests

Do not overlap writes to `src/core/caste-runner.ts`, `src/merge/merge-next.ts`, or `tests/unit/core/caste-runner.test.ts`.

---

### Task 1: Lock the new control-state and merge-boundary contract in tests

**Files:**
- Create: `tests/unit/core/control-plane-policy.test.ts`
- Modify: `tests/unit/core/triage.test.ts`
- Modify: `tests/unit/core/dispatcher.test.ts`
- Modify: `tests/unit/core/reaper.test.ts`
- Modify: `tests/unit/merge/merge-next.test.ts`
- Modify: `tests/unit/mock-run/acceptance.test.ts`

- [ ] **Step 1: Write failing triage tests for `rework_required`, `blocked_on_child`, and `failed_operational`**

```ts
it("dispatches Titan from rework_required without rerunning Oracle", () => {
  const result = triageReadyWork({
    readyIssues: [{ id: "ISSUE-1", title: "Retry review feedback" }],
    dispatchState: createDispatchState({
      "ISSUE-1": {
        issueId: "ISSUE-1",
        stage: "rework_required",
        runningAgent: null,
        oracleAssessmentRef: ".aegis/oracle/ISSUE-1.json",
        titanHandoffRef: ".aegis/titan/ISSUE-1.json",
        sentinelVerdictRef: ".aegis/sentinel/ISSUE-1.json",
        janusArtifactRef: null,
        fileScope: null,
        failureCount: 0,
        consecutiveFailures: 0,
        failureWindowStartMs: null,
        cooldownUntil: null,
        sessionProvenanceId: "daemon-1",
        updatedAt: "2026-04-24T10:00:00.000Z",
      } as any,
    }),
    config: DEFAULT_AEGIS_CONFIG,
    now: "2026-04-24T10:01:00.000Z",
  });

  expect(result.dispatchable).toEqual([
    { issueId: "ISSUE-1", title: "Retry review feedback", caste: "titan", stage: "implementing" },
  ]);
});

it("skips blocked_on_child issues even if the tracker still reports them ready", () => {
  const result = triageReadyWork({
    readyIssues: [{ id: "ISSUE-2", title: "Blocked parent" }],
    dispatchState: createDispatchState({
      "ISSUE-2": {
        issueId: "ISSUE-2",
        stage: "blocked_on_child",
        runningAgent: null,
        oracleAssessmentRef: ".aegis/oracle/ISSUE-2.json",
        titanHandoffRef: null,
        sentinelVerdictRef: null,
        janusArtifactRef: null,
        fileScope: null,
        failureCount: 0,
        consecutiveFailures: 0,
        failureWindowStartMs: null,
        cooldownUntil: null,
        sessionProvenanceId: "daemon-1",
        updatedAt: "2026-04-24T10:00:00.000Z",
      } as any,
    }),
    config: DEFAULT_AEGIS_CONFIG,
  });

  expect(result.dispatchable).toEqual([]);
  expect(result.skipped).toEqual([{ issueId: "ISSUE-2", reason: "blocked" }]);
});
```

- [ ] **Step 2: Write failing dispatcher and reaper tests for new operational failure semantics**

```ts
it("marks launch failures as failed_operational", async () => {
  const result = await dispatchReadyWork({
    dispatchState: emptyDispatchState(),
    decisions: [{ issueId: "ISSUE-1", title: "First", caste: "oracle", stage: "scouting" }],
    runtime: failingRuntime,
    sessionProvenanceId: "daemon-1",
    root,
    now: "2026-04-24T10:00:00.000Z",
  });

  expect(result.state.records["ISSUE-1"]?.stage).toBe("failed_operational");
});

it("moves successful Titan sessions to implemented and keeps review feedback for rework loops", async () => {
  const result = await reapFinishedWork({
    dispatchState: createReviewRunningState(),
    runtime: succeededRuntime,
    issueIds: ["ISSUE-9"],
    root,
    now: "2026-04-24T10:00:00.000Z",
  });

  expect(result.state.records["ISSUE-9"]).toMatchObject({
    stage: "queued_for_merge",
    runningAgent: null,
  });
});
```

- [ ] **Step 3: Write failing merge-next and proof tests for pre-merge Sentinel and no Sentinel-created issues**

```ts
it("runs Sentinel before merge admission and returns rework_required on blocking review", async () => {
  await expect(runMergeNext(root, deps)).resolves.toMatchObject({
    action: "merge_next",
    issueId: "aegis-777",
    status: "failed",
    stage: "rework_required",
  });
});

it("fails proof when a parent creates extra work but remains runnable", async () => {
  await expect(waitForMockAcceptanceProgress(root, statePath, queuePath, 5_000)).rejects.toThrow(
    "created blocker without removing parent from readiness",
  );
});
```

- [ ] **Step 4: Write failing policy-layer tests for accepted, rejected, and reused blocking mutations**

```ts
it("accepts Titan clarification blocker proposals and links the child to block the parent", async () => {
  await expect(applyMutationProposal(input)).resolves.toMatchObject({
    outcome: "accepted",
    parentStage: "blocked_on_child",
    childIssueId: "aegis-clarify-1",
  });
});

it("rejects Oracle mutation proposals", async () => {
  await expect(applyMutationProposal(input)).resolves.toMatchObject({
    outcome: "rejected",
    rejectionReason: "caste_not_permitted",
  });
});

it("reuses an existing open blocker when the fingerprint matches", async () => {
  await expect(applyMutationProposal(input)).resolves.toMatchObject({
    outcome: "reused",
    childIssueId: "aegis-existing-9",
  });
});
```

- [ ] **Step 5: Run targeted tests to verify RED**

Run:

```bash
npx vitest run tests/unit/core/triage.test.ts tests/unit/core/dispatcher.test.ts tests/unit/core/reaper.test.ts tests/unit/core/control-plane-policy.test.ts tests/unit/merge/merge-next.test.ts tests/unit/mock-run/acceptance.test.ts --config vitest.config.ts --project default
```

Expected:

```text
FAIL  tests/unit/core/triage.test.ts
FAIL  tests/unit/core/control-plane-policy.test.ts
FAIL  tests/unit/merge/merge-next.test.ts
```

- [ ] **Step 6: Commit the failing-tests checkpoint**

```bash
git add tests/unit/core/triage.test.ts tests/unit/core/dispatcher.test.ts tests/unit/core/reaper.test.ts tests/unit/core/control-plane-policy.test.ts tests/unit/merge/merge-next.test.ts tests/unit/mock-run/acceptance.test.ts
git commit -m "test(core): lock convergence control plane"
```

### Task 2: Introduce the dispatch-state taxonomy and triage/reap semantics

**Files:**
- Modify: `src/core/dispatch-state.ts`
- Modify: `src/core/stage-invariants.ts`
- Modify: `src/core/triage.ts`
- Modify: `src/core/dispatcher.ts`
- Modify: `src/core/reaper.ts`
- Modify: `tests/unit/core/triage.test.ts`
- Modify: `tests/unit/core/dispatcher.test.ts`
- Modify: `tests/unit/core/reaper.test.ts`

- [ ] **Step 1: Add explicit control-state types and stale-session reconciliation rules**

```ts
export type DispatchStage =
  | "pending"
  | "scouting"
  | "scouted"
  | "implementing"
  | "implemented"
  | "reviewing"
  | "queued_for_merge"
  | "merging"
  | "resolving_integration"
  | "blocked_on_child"
  | "rework_required"
  | "failed_operational"
  | "complete";

export interface DispatchRecord {
  issueId: string;
  stage: DispatchStage;
  lastCompletedCaste?: AgentCaste | null;
  blockedByIssueId?: string | null;
  reviewFeedbackRef?: string | null;
  policyArtifactRef?: string | null;
  oracleAssessmentRef: string | null;
  titanHandoffRef?: string | null;
  titanClarificationRef?: string | null;
  sentinelVerdictRef: string | null;
  janusArtifactRef?: string | null;
}

const IN_PROGRESS_STAGES = new Set<DispatchStage>([
  "scouting",
  "implementing",
  "reviewing",
  "merging",
  "resolving_integration",
]);
```

- [ ] **Step 2: Rewrite stage invariants so Oracle is advisory-only and Sentinel is pre-merge**

```ts
const ORACLE_REQUIRED_STAGES = new Set<DispatchStage>([
  "scouted",
  "implementing",
  "implemented",
  "reviewing",
  "queued_for_merge",
  "merging",
  "rework_required",
  "complete",
]);

export function validateTitanDispatchEligibility(record: DispatchRecord): string | null {
  if (record.stage !== "scouted" && record.stage !== "rework_required") {
    return "Titan requires a scouted issue or same-parent rework loop.";
  }

  if (!record.oracleAssessmentRef) {
    return `Issue ${record.issueId} requires an Oracle assessment artifact.`;
  }

  if (record.stage === "rework_required" && !record.reviewFeedbackRef) {
    return `Issue ${record.issueId} rework loop requires review or Janus feedback.`;
  }

  return null;
}
```

- [ ] **Step 3: Update triage to dispatch only valid next stages**

```ts
function resolveDecision(issue: TrackerReadyIssue, record?: DispatchRecord): DispatchDecision {
  if (record?.stage === "scouted" || record?.stage === "rework_required") {
    return {
      issueId: issue.id,
      title: issue.title,
      caste: "titan",
      stage: "implementing",
    };
  }

  return {
    issueId: issue.id,
    title: issue.title,
    caste: "oracle",
    stage: "scouting",
  };
}

function resolveFailedIssueSkipReason(record: DispatchRecord): TriageSkipReason | null {
  if (record.stage === "blocked_on_child") return "blocked";
  if (record.stage === "failed_operational" && record.cooldownUntil) return "cooldown";
  if (record.stage === "complete" || record.stage === "queued_for_merge" || record.stage === "merging") {
    return "already_progressed";
  }
  return null;
}
```

- [ ] **Step 4: Update dispatcher and reaper to classify operational failures and completed stages correctly**

```ts
records[decision.issueId] = {
  ...previous,
  issueId: decision.issueId,
  stage: decision.stage,
  runningAgent: {
    caste: decision.caste,
    sessionId: launched.sessionId,
    startedAt: launched.startedAt,
  },
  lastCompletedCaste: previous?.lastCompletedCaste ?? null,
  cooldownUntil: null,
  updatedAt: timestamp,
};

function toFailedOperationalRecord(record: DispatchRecord, timestamp: string): DispatchRecord {
  return {
    ...record,
    stage: "failed_operational",
    runningAgent: null,
    failureCount: record.failureCount + 1,
    consecutiveFailures: record.consecutiveFailures + 1,
    cooldownUntil: calculateFailureCooldown(timestamp),
    updatedAt: timestamp,
  };
}
```

- [ ] **Step 5: Run targeted tests to verify GREEN**

Run:

```bash
npx vitest run tests/unit/core/triage.test.ts tests/unit/core/dispatcher.test.ts tests/unit/core/reaper.test.ts --config vitest.config.ts --project default
```

Expected:

```text
Test Files  3 passed
Tests       all passed
```

- [ ] **Step 6: Commit the state-taxonomy slice**

```bash
git add src/core/dispatch-state.ts src/core/stage-invariants.ts src/core/triage.ts src/core/dispatcher.ts src/core/reaper.ts tests/unit/core/triage.test.ts tests/unit/core/dispatcher.test.ts tests/unit/core/reaper.test.ts
git commit -m "feat(core): add convergence control states"
```

### Task 3: Add tracker blocking links and the deterministic control-plane policy layer

**Files:**
- Create: `src/core/control-plane-policy.ts`
- Modify: `src/tracker/tracker.ts`
- Modify: `src/tracker/beads-tracker.ts`
- Modify: `tests/unit/core/control-plane-policy.test.ts`
- Modify: `tests/unit/tracker/beads-tracker.test.ts`

- [ ] **Step 1: Extend the tracker abstraction with explicit blocking-link support**

```ts
export interface TrackerLinkInput {
  blockingIssueId: string;
  blockedIssueId: string;
}

export interface TrackerClient {
  listReadyIssues(root?: string): Promise<TrackerReadyIssue[]>;
  getIssue?(id: string, root?: string): Promise<AegisIssue>;
  closeIssue?(id: string, root?: string): Promise<void>;
  createIssue?(input: TrackerCreateIssueInput, root?: string): Promise<string>;
  linkBlockingIssue?(input: TrackerLinkInput, root?: string): Promise<void>;
}
```

- [ ] **Step 2: Implement `bd link <blocking> <blocked> --type blocks` in the Beads tracker**

```ts
async linkBlockingIssue(input: TrackerLinkInput, root = process.cwd()): Promise<void> {
  return new Promise((resolve, reject) => {
    this.execFileImpl(
      "bd",
      ["link", input.blockingIssueId, input.blockedIssueId, "--type", "blocks"],
      {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
        windowsHide: true,
      },
      (error, _stdout, stderr) => {
        if (error) {
          const detail = stderr?.trim() ? ` ${stderr.trim()}` : "";
          reject(new Error(`bd link failed:${detail}`));
          return;
        }

        resolve();
      },
    );
  });
}
```

- [ ] **Step 3: Implement the policy module with accept/reject/reuse behavior**

```ts
export interface MutationProposal {
  originIssueId: string;
  originCaste: "titan" | "janus";
  proposalType:
    | "create_clarification_blocker"
    | "create_prerequisite_blocker"
    | "create_out_of_scope_blocker"
    | "create_integration_blocker"
    | "requeue_parent";
  blocking: boolean;
  summary: string;
  suggestedTitle?: string;
  suggestedDescription?: string;
  dependencyType?: "blocks";
  scopeEvidence: string[];
  fingerprint: string;
}

export async function applyMutationProposal(input: ApplyMutationProposalInput): Promise<ApplyMutationProposalResult> {
  if (!input.proposal.blocking && input.proposal.proposalType !== "requeue_parent") {
    return persistRejectedPolicyResult(input, "non_blocking_not_allowed");
  }

  if (input.proposal.originCaste !== "titan" && input.proposal.originCaste !== "janus") {
    return persistRejectedPolicyResult(input, "caste_not_permitted");
  }

  const reusedIssueId = findReusableIssueId(input.record, input.proposal.fingerprint, input.root);
  if (reusedIssueId) {
    return persistAcceptedPolicyResult(input, reusedIssueId, "reused");
  }

  const childIssueId = await input.tracker.createIssue!(buildCreateIssueInput(input.proposal), input.root);
  await input.tracker.linkBlockingIssue!({
    blockingIssueId: childIssueId,
    blockedIssueId: input.record.issueId,
  }, input.root);

  return persistAcceptedPolicyResult(input, childIssueId, "accepted");
}
```

- [ ] **Step 4: Run policy/tracker tests to verify GREEN**

Run:

```bash
npx vitest run tests/unit/core/control-plane-policy.test.ts tests/unit/tracker/beads-tracker.test.ts --config vitest.config.ts --project default
```

Expected:

```text
Test Files  2 passed
Tests       all passed
```

- [ ] **Step 5: Commit the policy-layer slice**

```bash
git add src/core/control-plane-policy.ts src/tracker/tracker.ts src/tracker/beads-tracker.ts tests/unit/core/control-plane-policy.test.ts tests/unit/tracker/beads-tracker.test.ts
git commit -m "feat(core): add deterministic mutation policy"
```

### Task 4: Rewrite caste tool contracts and parsers around the new authority model

**Files:**
- Modify: `src/castes/oracle/oracle-parser.ts`
- Modify: `src/castes/oracle/oracle-tool-contract.ts`
- Modify: `src/castes/titan/titan-parser.ts`
- Modify: `src/castes/titan/titan-tool-contract.ts`
- Modify: `src/castes/sentinel/sentinel-parser.ts`
- Modify: `src/castes/sentinel/sentinel-tool-contract.ts`
- Modify: `src/castes/janus/janus-parser.ts`
- Modify: `src/castes/janus/janus-tool-contract.ts`
- Modify: `tests/unit/castes/oracle-parser.test.ts`
- Modify: `tests/unit/castes/titan-parser.test.ts`
- Modify: `tests/unit/castes/sentinel-parser.test.ts`
- Modify: `tests/unit/castes/janus-parser.test.ts`
- Modify: `tests/unit/castes/structured-tool-contract.test.ts`

- [ ] **Step 1: Rewrite the Oracle contract to be scout-only**

```ts
export interface OracleAssessment {
  files_affected: string[];
  estimated_complexity: OracleComplexity;
  risks: string[];
  suggested_checks: string[];
  scope_notes: string[];
}

const ORACLE_ASSESSMENT_KEYS = new Set([
  "files_affected",
  "estimated_complexity",
  "risks",
  "suggested_checks",
  "scope_notes",
]);
```

- [ ] **Step 2: Add optional Titan mutation proposals for blocking child creation**

```ts
export interface TitanMutationProposal {
  proposal_type:
    | "create_clarification_blocker"
    | "create_prerequisite_blocker"
    | "create_out_of_scope_blocker";
  summary: string;
  suggested_title: string;
  suggested_description: string;
  scope_evidence: string[];
}

export interface TitanArtifact {
  outcome: TitanRunOutcome;
  summary: string;
  files_changed: string[];
  tests_and_checks_run: string[];
  known_risks: string[];
  follow_up_work: string[];
  learnings_written_to_mnemosyne: string[];
  mutation_proposal?: TitanMutationProposal;
}
```

- [ ] **Step 3: Replace Sentinel follow-up ids with binary gate plus advisories**

```ts
export type SentinelVerdictValue = "pass" | "fail_blocking";

export interface SentinelVerdict {
  verdict: SentinelVerdictValue;
  reviewSummary: string;
  blockingFindings: string[];
  advisories: string[];
  touchedFiles: string[];
  contractChecks: string[];
}
```

- [ ] **Step 4: Add Janus proposal payload for requeue vs integration blocker**

```ts
export interface JanusMutationProposal {
  proposal_type: "requeue_parent" | "create_integration_blocker";
  summary: string;
  suggested_title?: string;
  suggested_description?: string;
  scope_evidence: string[];
}

export interface JanusResolutionArtifact {
  originatingIssueId: string;
  queueItemId: string;
  preservedLaborPath: string;
  conflictSummary: string;
  resolutionStrategy: string;
  filesTouched: string[];
  validationsRun: string[];
  residualRisks: string[];
  mutation_proposal: JanusMutationProposal;
}
```

- [ ] **Step 5: Run parser/tool-contract tests to verify GREEN**

Run:

```bash
npx vitest run tests/unit/castes/oracle-parser.test.ts tests/unit/castes/titan-parser.test.ts tests/unit/castes/sentinel-parser.test.ts tests/unit/castes/janus-parser.test.ts tests/unit/castes/structured-tool-contract.test.ts --config vitest.config.ts --project default
```

Expected:

```text
Test Files  5 passed
Tests       all passed
```

- [ ] **Step 6: Commit the caste-contract slice**

```bash
git add src/castes/oracle/oracle-parser.ts src/castes/oracle/oracle-tool-contract.ts src/castes/titan/titan-parser.ts src/castes/titan/titan-tool-contract.ts src/castes/sentinel/sentinel-parser.ts src/castes/sentinel/sentinel-tool-contract.ts src/castes/janus/janus-parser.ts src/castes/janus/janus-tool-contract.ts tests/unit/castes/oracle-parser.test.ts tests/unit/castes/titan-parser.test.ts tests/unit/castes/sentinel-parser.test.ts tests/unit/castes/janus-parser.test.ts tests/unit/castes/structured-tool-contract.test.ts
git commit -m "feat(castes): align contracts with convergence policy"
```

### Task 5: Refactor caste-runner around policy-driven mutations and same-parent rework

**Files:**
- Modify: `src/core/caste-runner.ts`
- Modify: `tests/unit/core/caste-runner.test.ts`
- Modify: `src/core/stage-invariants.ts`
- Modify: `src/core/control-plane-policy.ts`

- [ ] **Step 1: Rewrite Oracle handling so it persists scout context and never vetoes Titan**

```ts
function buildOraclePrompt(issue: AegisIssue) {
  return [
    `Scout ${issue.id}: ${issue.title}`,
    `Description: ${issue.description?.trim() || "No description provided."}`,
    "Produce only scout context: files, risks, suggested checks, and scope notes.",
    "Do not decide readiness, do not decompose, and do not propose new issues.",
    `Call tool '${ORACLE_EMIT_ASSESSMENT_TOOL_NAME}' exactly once as final step after analysis is complete.`,
    "Return only JSON.",
  ].join("\n");
}

saveRecord(input.root, issue.id, {
  ...clearDownstreamArtifactRefs(record),
  stage: "scouted",
  oracleAssessmentRef: artifactRef,
  updatedAt: now,
});
```

- [ ] **Step 2: Route Titan clarification/prerequisite/out-of-scope blockers through the policy layer**

```ts
if (artifact.mutation_proposal) {
  const policyResult = await applyMutationProposal({
    root: input.root,
    tracker: input.tracker,
    issue,
    record,
    proposal: buildTitanPolicyProposal(issue.id, artifact),
    now,
  });

  saveRecord(input.root, issue.id, {
    ...clearDownstreamArtifactRefs(record),
    stage: policyResult.parentStage,
    oracleAssessmentRef: record.oracleAssessmentRef,
    titanClarificationRef: artifactRef,
    blockedByIssueId: policyResult.childIssueId ?? null,
    policyArtifactRef: policyResult.policyArtifactRef,
    updatedAt: now,
  });

  return { action: input.action, issueId: issue.id, stage: policyResult.parentStage, artifactRefs: [artifactRef, policyResult.policyArtifactRef] };
}
```

- [ ] **Step 3: Make Sentinel non-mutating and return same-parent rework**

```ts
const reviewStage = verdict.verdict === "pass" ? "queued_for_merge" : "rework_required";

saveRecord(input.root, issue.id, {
  ...clearDownstreamArtifactRefs(record),
  stage: reviewStage,
  oracleAssessmentRef: record.oracleAssessmentRef,
  titanHandoffRef: record.titanHandoffRef ?? null,
  sentinelVerdictRef: artifactRef,
  reviewFeedbackRef: artifactRef,
  updatedAt: now,
});
```

- [ ] **Step 4: Route Janus recommendations through the same deterministic policy**

```ts
if (artifact.mutation_proposal.proposal_type === "requeue_parent") {
  saveRecord(input.root, issue.id, {
    ...clearDownstreamArtifactRefs(record),
    stage: "rework_required",
    janusArtifactRef: artifactRef,
    reviewFeedbackRef: artifactRef,
    updatedAt: now,
  });
} else {
  const policyResult = await applyMutationProposal({
    root: input.root,
    tracker: input.tracker,
    issue,
    record,
    proposal: buildJanusPolicyProposal(issue.id, artifact),
    now,
  });

  saveRecord(input.root, issue.id, {
    ...clearDownstreamArtifactRefs(record),
    stage: policyResult.parentStage,
    janusArtifactRef: artifactRef,
    blockedByIssueId: policyResult.childIssueId ?? null,
    policyArtifactRef: policyResult.policyArtifactRef,
    updatedAt: now,
  });
}
```

- [ ] **Step 5: Run caste-runner tests to verify GREEN**

Run:

```bash
npx vitest run tests/unit/core/caste-runner.test.ts --config vitest.config.ts --project default
```

Expected:

```text
Test Files  1 passed
Tests       all passed
```

- [ ] **Step 6: Commit the caste-runner slice**

```bash
git add src/core/caste-runner.ts src/core/stage-invariants.ts src/core/control-plane-policy.ts tests/unit/core/caste-runner.test.ts
git commit -m "feat(core): enforce deterministic caste authority"
```

### Task 6: Rewire merge admission, Janus integration handling, and the daemon loop

**Files:**
- Modify: `src/merge/auto-enqueue.ts`
- Modify: `src/merge/merge-next.ts`
- Modify: `src/core/loop-runner.ts`
- Modify: `tests/unit/merge/merge-next.test.ts`
- Modify: `tests/unit/core/parallel-lane-scheduling.test.ts`

- [ ] **Step 1: Admit only Sentinel-passed candidates to the merge queue**

```ts
export function autoEnqueueImplementedIssuesForMerge(root: string, now = new Date().toISOString()) {
  const dispatchState = loadDispatchState(root);
  const eligibleRecords = Object.values(dispatchState.records).filter(
    (record) => record.stage === "queued_for_merge" && record.titanHandoffRef,
  );

  const queueState = loadMergeQueueState(root);
  const nextQueueState = eligibleRecords.reduce(
    (state, record) => enqueueMergeCandidate(state, {
      issueId: record.issueId,
      candidateBranch: readTitanMergeCandidate(root, record).candidate_branch,
      targetBranch: loadConfig(root).git.base_branch,
      laborPath: readTitanMergeCandidate(root, record).labor_path,
    }, now),
    queueState,
  );

  saveMergeQueueState(root, nextQueueState);
}
```

- [ ] **Step 2: Remove post-merge Sentinel from `runMergeNext` and complete on clean merge**

```ts
if (decision.action === "merge") {
  const mergedQueueState = updateMergeQueueItem(mergingQueueState, queueItem.queueItemId, (item) => ({
    ...item,
    status: "merged",
    lastTier: "T1",
    lastError: null,
    updatedAt: now,
  }));
  saveMergeQueueState(root, mergedQueueState);
  updateDispatchStage(root, queueItem.issueId, dispatchRecord, "complete", now);

  return {
    action: "merge_next",
    status: "merged",
    issueId: queueItem.issueId,
    queueItemId: queueItem.queueItemId,
    tier: "T1",
    stage: "complete",
    detail: attempt.detail,
  };
}
```

- [ ] **Step 3: Send Janus same-parent feedback to `rework_required` and out-of-scope integration blockers to policy**

```ts
if (janus.stage === "rework_required") {
  return {
    action: "merge_next",
    status: "failed",
    issueId: queueItem.issueId,
    queueItemId: queueItem.queueItemId,
    tier: "T3",
    stage: "rework_required",
    detail: janusDetail,
  };
}

return {
  action: "merge_next",
  status: "failed",
  issueId: queueItem.issueId,
  queueItemId: queueItem.queueItemId,
  tier: "T3",
  stage: "blocked_on_child",
  detail: janusDetail,
};
```

- [ ] **Step 4: Keep the daemon loop ordering unchanged but aligned with new stage semantics**

```ts
const dispatchResult = await runDispatchPipeline(root, runtime, sessionProvenanceId, timestamp);
const monitorResult = await runMonitorPipeline(root, runtime, timestamp, dispatchResult.dispatchState);
await runReapPipeline(root, runtime, timestamp, monitorResult.readyToReap, dispatchResult.dispatchState);
autoEnqueueImplementedIssuesForMerge(root, timestamp);
```

- [ ] **Step 5: Run merge/loop tests to verify GREEN**

Run:

```bash
npx vitest run tests/unit/merge/merge-next.test.ts tests/unit/core/parallel-lane-scheduling.test.ts --config vitest.config.ts --project default
```

Expected:

```text
Test Files  2 passed
Tests       all passed
```

- [ ] **Step 6: Commit the merge/loop slice**

```bash
git add src/merge/auto-enqueue.ts src/merge/merge-next.ts src/core/loop-runner.ts tests/unit/merge/merge-next.test.ts tests/unit/core/parallel-lane-scheduling.test.ts
git commit -m "feat(merge): move sentinel before merge admission"
```

### Task 7: Update proof surfaces, run full verification, and prepare the final merge-ready branch

**Files:**
- Modify: `src/mock-run/acceptance.ts`
- Modify: `tests/unit/mock-run/acceptance.test.ts`
- Modify: `tests/unit/runtime/create-caste-runtime.test.ts`
- Modify: `tests/unit/runtime/pi-caste-runtime.test.ts`
- Modify: `docs/superpowers/specs/2026-04-24-aegis-convergence-control-plane-design.md` (only if implementation reveals a spec ambiguity that must be corrected)

- [ ] **Step 1: Update mock-run proof helpers for new convergence assertions**

```ts
function getDeadlockReason(state: DispatchState, readyIssueIds: string[]) {
  for (const issueId of readyIssueIds) {
    const record = state.records[issueId];
    if (!record) continue;

    if (record.stage === "blocked_on_child") {
      return `issue ${issueId} is tracker-ready but dispatch-blocked by child ${record.blockedByIssueId ?? "unknown"}`;
    }

    if (record.stage === "rework_required" && record.runningAgent === null) {
      return `issue ${issueId} is stuck in rework_required without Titan dispatch`;
    }
  }

  return null;
}
```

- [ ] **Step 2: Run the full deterministic verification suite**

Run:

```bash
npm test
npm run test:acceptance
npm run lint
npm run build
npm run mock:acceptance
```

Expected:

```text
PASS
PASS
PASS
PASS
PASS
```

- [ ] **Step 3: Run the live Pi proof with the new control plane**

Run:

```bash
$env:AEGIS_PI_SESSION_TIMEOUT_MS="1800000"
$env:AEGIS_PI_ORACLE_TIMEOUT_MS="2400000"
$env:AEGIS_PI_TITAN_TIMEOUT_MS="1800000"
$env:AEGIS_PI_SENTINEL_TIMEOUT_MS="1800000"
$env:AEGIS_PI_JANUS_TIMEOUT_MS="1800000"
$env:AEGIS_PI_TIMEOUT_RETRY_COUNT="0"
$env:AEGIS_PI_TIMEOUT_RETRY_DELAY_MS="0"
npm run mock:run -- node ../dist/index.js start
node ../dist/index.js status --json
bd ready --json
```

Expected:

```text
{"server_state":"running","mode":"auto",...}
[]  # full-success flow
["aegis-blocker-1"]  # acceptable only when the originating parent id is absent from ready
```

- [ ] **Step 4: Review final diff and commit remaining proof-surface changes**

```bash
git status --short
git log --oneline -n 8
git add src/mock-run/acceptance.ts tests/unit/mock-run/acceptance.test.ts tests/unit/runtime/create-caste-runtime.test.ts tests/unit/runtime/pi-caste-runtime.test.ts
git commit -m "test(mock-run): prove convergence control plane"
```

- [ ] **Step 5: Sync and publish the branch**

```bash
git pull --rebase
git push -u origin feat/convergence-control-plane
```

---

## Self-Review Checklist

- Spec coverage:
  - Oracle advisory-only: Task 4
  - Titan blocking-only mutation authority: Tasks 3 and 5
  - Sentinel pre-merge, non-mutating gate: Tasks 4 and 6
  - Janus same-parent requeue vs integration blocker: Tasks 4 and 6
  - explicit control states: Task 2
  - proof of monotonic convergence: Tasks 1 and 7
- Placeholder scan:
  - no `TODO`, `TBD`, or "similar to"
  - every code step includes concrete snippets
  - every verification step includes exact commands
- Type consistency:
  - canonical stage names used consistently: `failed_operational`, `blocked_on_child`, `rework_required`, `complete`
  - canonical proposal types match the approved spec
