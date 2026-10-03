import { loadConfig } from "../config/load-config.js";
import type { AegisConfig } from "../config/schema.js";
import { captureGitProofPair, listOperationalDirtyFiles, summarizeOperationalDirtyFiles } from "../core/git-proof.js";
import {
  loadDispatchState,
  replaceDispatchRecord,
  saveDispatchState,
  type DispatchRecord,
} from "../core/dispatch-state.js";
import { validateDispatchRecordStage } from "../core/stage-invariants.js";
import { applyOperationalFailure } from "../core/failure-policy.js";
import type { AegisIssue } from "../tracker/issue-model.js";
import type { TrackerClient } from "../tracker/tracker.js";
import { createTrackerClient } from "../tracker/create-tracker.js";
import {
  findNextQueuedItem,
  loadMergeQueueState,
  saveMergeQueueState,
  updateMergeQueueItem,
  type MergeFailureOutcome,
  type MergeQueueItem,
} from "./merge-state.js";
import {
  classifyMergeTier,
  type MergeExecutionOutcome,
} from "./tier-policy.js";
import {
  prepareIntegrationWorktree,
  runMergeVerification,
  type MergeVerification,
} from "./integration-worktree.js";
import { normalizeScopeFile } from "../shared/file-scope.js";
import { formatGitOutput, runGit } from "../shared/git.js";

interface TrackerLike extends Pick<TrackerClient, "closeIssue" | "createIssue" | "linkBlockingIssue"> {
  getIssue(id: string, root?: string): Promise<AegisIssue>;
}

export interface MergeExecutorResult {
  outcome: MergeExecutionOutcome;
  detail: string;
}

export interface MergeExecutor {
  execute(root: string, item: MergeQueueItem): Promise<MergeExecutorResult>;
}

export interface RunMergeNextOptions {
  executor?: MergeExecutor;
  tracker?: TrackerLike;
  now?: string;
  /** Queue items already attempted in this drain pass. */
  skipQueueItemIds?: ReadonlySet<string>;
}

export interface MergeNextResult {
  action: "merge_next";
  /** `escalated`: handed to Janus; the daemon runs it as an adapter session. */
  status: "idle" | "merged" | "requeued" | "escalated" | "failed";
  issueId?: string;
  queueItemId?: string;
  tier?: "T1" | "T2" | "T3";
  stage?: string;
  detail?: string;
}

interface ScriptedMergeOutcome {
  outcome: MergeExecutionOutcome;
  detail: string;
}

interface ScriptedMergeRule {
  issueId?: string;
  candidateBranch?: string;
  outcomes: ScriptedMergeOutcome[];
}

interface ScriptedMergePlan {
  rules: ScriptedMergeRule[];
}

const SCRIPTED_MERGE_PLAN_ENV = "AEGIS_SCRIPTED_MERGE_PLAN";

function parseScriptedMergePlan(raw: string): ScriptedMergePlan | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }

    const rules = (parsed as Record<string, unknown>).rules;
    if (!Array.isArray(rules)) {
      return null;
    }

    const normalizedRules = rules.flatMap((rule) => {
      if (typeof rule !== "object" || rule === null || Array.isArray(rule)) {
        return [];
      }

      const candidateRule = rule as Record<string, unknown>;
      const outcomes = candidateRule.outcomes;
      if (!Array.isArray(outcomes) || outcomes.length === 0) {
        return [];
      }

      const normalizedOutcomes = outcomes.flatMap((outcome) => {
        if (typeof outcome !== "object" || outcome === null || Array.isArray(outcome)) {
          return [];
        }

        const candidateOutcome = outcome as Record<string, unknown>;
        if (
          (candidateOutcome.outcome !== "merged"
            && candidateOutcome.outcome !== "stale_branch"
            && candidateOutcome.outcome !== "conflict"
            && candidateOutcome.outcome !== "verification_failed")
          || typeof candidateOutcome.detail !== "string"
        ) {
          return [];
        }

        return [{
          outcome: candidateOutcome.outcome as MergeExecutionOutcome,
          detail: candidateOutcome.detail,
        }];
      });

      if (normalizedOutcomes.length === 0) {
        return [];
      }

      return [{
        issueId: typeof candidateRule.issueId === "string" ? candidateRule.issueId : undefined,
        candidateBranch: typeof candidateRule.candidateBranch === "string" ? candidateRule.candidateBranch : undefined,
        outcomes: normalizedOutcomes,
      }];
    });

    return normalizedRules.length > 0 ? { rules: normalizedRules } : null;
  } catch {
    return null;
  }
}

function resolveScriptedMergeOutcome(item: MergeQueueItem): MergeExecutorResult {
  const rawPlan = process.env[SCRIPTED_MERGE_PLAN_ENV];
  if (!rawPlan) {
    return {
      outcome: "merged",
      detail: "Deterministic scripted merge succeeded.",
    };
  }

  const plan = parseScriptedMergePlan(rawPlan);
  if (!plan) {
    return {
      outcome: "merged",
      detail: "Deterministic scripted merge succeeded.",
    };
  }

  const rule = plan.rules.find((candidate) =>
    (candidate.issueId === undefined || candidate.issueId === item.issueId)
    && (candidate.candidateBranch === undefined || candidate.candidateBranch === item.candidateBranch));

  if (!rule) {
    return {
      outcome: "merged",
      detail: "Deterministic scripted merge succeeded.",
    };
  }

  const selectedOutcome = rule.outcomes[Math.min(item.attempts, rule.outcomes.length - 1)];
  if (!selectedOutcome) {
    return {
      outcome: "merged",
      detail: "Deterministic scripted merge succeeded.",
    };
  }

  return {
    outcome: selectedOutcome.outcome,
    detail: selectedOutcome.detail,
  };
}

class ScriptedMergeExecutor implements MergeExecutor {
  async execute(_root: string, item: MergeQueueItem): Promise<MergeExecutorResult> {
    return resolveScriptedMergeOutcome(item);
  }
}

/**
 * Merges in the integration worktree, runs the configured verification on the
 * result, and only then fast-forwards the target branch in the project root.
 */
class GitMergeExecutor implements MergeExecutor {
  constructor(private readonly verification: MergeVerification | null) {}

  async execute(root: string, item: MergeQueueItem): Promise<MergeExecutorResult> {
    const rootWorkspace = captureGitProofPair(root).before;
    const dirtyWorkspaceDetail = summarizeOperationalDirtyFiles(rootWorkspace);
    if (dirtyWorkspaceDetail) {
      return {
        outcome: "stale_branch",
        detail: `Project root has non-Aegis working tree changes. Merge requires a clean root: ${dirtyWorkspaceDetail}.`,
      };
    }

    if (item.candidateBranch === item.targetBranch) {
      return {
        outcome: "stale_branch",
        detail: `Candidate branch ${item.candidateBranch} matches target branch ${item.targetBranch}; refusing no-op self-merge.`,
      };
    }

    const targetProbe = runGit(root, ["rev-parse", "--verify", item.targetBranch]);
    if (targetProbe.status !== 0) {
      return {
        outcome: "stale_branch",
        detail: `Missing target branch ${item.targetBranch}.`,
      };
    }

    const candidateProbe = runGit(root, ["rev-parse", "--verify", item.candidateBranch]);
    if (candidateProbe.status !== 0) {
      return {
        outcome: "stale_branch",
        detail: `Missing candidate branch ${item.candidateBranch}.`,
      };
    }

    const checkout = runGit(root, ["checkout", item.targetBranch]);
    if (checkout.status !== 0) {
      const detail = formatGitOutput(checkout);
      return {
        outcome: "stale_branch",
        detail: detail.length > 0 ? detail : `Failed to checkout ${item.targetBranch}.`,
      };
    }

    let worktreePath: string;
    try {
      worktreePath = prepareIntegrationWorktree(root, targetProbe.stdout.trim());
    } catch (error) {
      return { outcome: "stale_branch", detail: toErrorMessage(error) };
    }

    const merge = runGit(worktreePath, [
      "merge",
      "--no-ff",
      "-m",
      `Merge branch '${item.candidateBranch}' into ${item.targetBranch}`,
      item.candidateBranch,
    ]);
    if (merge.status !== 0) {
      void runGit(worktreePath, ["merge", "--abort"]);
      const detail = formatGitOutput(merge) || "Merge failed.";
      return {
        outcome: /CONFLICT/i.test(detail) ? "conflict" : "stale_branch",
        detail,
      };
    }
    const mergeDetail = formatGitOutput(merge) || "Merged cleanly.";

    let verificationDetail = "";
    if (this.verification) {
      const verified = await runMergeVerification(worktreePath, this.verification);
      if (!verified.passed) {
        return { outcome: "verification_failed", detail: verified.detail };
      }
      verificationDetail = `\n${verified.detail.split("\n")[0]}`;
    }

    const mergedCommit = runGit(worktreePath, ["rev-parse", "HEAD"]).stdout.trim();
    const advance = runGit(root, ["merge", "--ff-only", mergedCommit]);
    if (advance.status !== 0) {
      return {
        outcome: "stale_branch",
        detail: `Could not fast-forward ${item.targetBranch} to the merge result: ${formatGitOutput(advance) || "target moved"}.`,
      };
    }

    return {
      outcome: "merged",
      detail: `${mergeDetail}${verificationDetail}`,
    };
  }
}

function createDefaultExecutor(config: AegisConfig): MergeExecutor {
  const scriptedPlanOverride = parseScriptedMergePlan(process.env[SCRIPTED_MERGE_PLAN_ENV] ?? "") !== null;
  return config.runtime === "scripted"
    || scriptedPlanOverride
    ? new ScriptedMergeExecutor()
    : new GitMergeExecutor(config.merge.verify_command.trim()
      ? {
        command: config.merge.verify_command.trim(),
        idleTimeoutSeconds: config.merge.verify_idle_timeout_seconds,
      }
      : null);
}

function createDefaultTracker(): TrackerLike {
  return createTrackerClient() as TrackerLike;
}

function updateDispatchRecord(
  root: string,
  fallback: DispatchRecord,
  transform: (record: DispatchRecord) => DispatchRecord,
) {
  const state = loadDispatchState(root);
  const nextRecord = transform(state.records[fallback.issueId] ?? fallback);
  saveDispatchState(root, replaceDispatchRecord(state, fallback.issueId, nextRecord));
  return nextRecord;
}

function updateDispatchStage(
  root: string,
  record: DispatchRecord,
  stage: DispatchRecord["stage"],
  now: string,
) {
  return updateDispatchRecord(root, record, (latest) => ({
    ...latest,
    stage,
    updatedAt: now,
  }));
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function toFailureOutcome(outcome: MergeExecutionOutcome): MergeFailureOutcome {
  return outcome === "conflict" || outcome === "verification_failed" ? outcome : "stale_branch";
}

function findActiveTitanDirtyOwners(
  dispatchState: ReturnType<typeof loadDispatchState>,
  dirtyFiles: string[],
) {
  if (dirtyFiles.length === 0) {
    return null;
  }

  const ownerByFile = new Map<string, string>();
  for (const dirtyFile of dirtyFiles.map((entry) => normalizeScopeFile(entry))) {
    const owner = Object.values(dispatchState.records).find((record) =>
      record.runningAgent?.caste === "titan"
      && record.fileScope !== null
      && record.fileScope.files.map((entry) => normalizeScopeFile(entry)).includes(dirtyFile));
    if (!owner) {
      return null;
    }
    ownerByFile.set(dirtyFile, owner.issueId);
  }

  return ownerByFile;
}

/**
 * Fails a queue item that cannot merge without throwing: a broken queue head
 * must not stall every candidate behind it. A new Sentinel pass re-enqueues it.
 */
function failInvalidQueueItem(
  root: string,
  queueState: ReturnType<typeof loadMergeQueueState>,
  queueItem: MergeQueueItem,
  now: string,
  reason: string,
  stage?: string,
): MergeNextResult {
  const detail = `Merge queue item ${queueItem.queueItemId} cannot merge: ${reason.replace(/\.$/, "")}.`;
  saveMergeQueueState(root, updateMergeQueueItem(queueState, queueItem.queueItemId, (item) => ({
    ...item,
    status: "failed",
    lastError: detail,
    updatedAt: now,
  })));
  return {
    action: "merge_next",
    status: "failed",
    issueId: queueItem.issueId,
    queueItemId: queueItem.queueItemId,
    stage,
    detail,
  };
}

export async function runMergeNext(
  root: string,
  options: RunMergeNextOptions = {},
): Promise<MergeNextResult> {
  const now = options.now ?? new Date().toISOString();
  const queueState = loadMergeQueueState(root);
  const queueItem = findNextQueuedItem(queueState, options.skipQueueItemIds);

  if (!queueItem) {
    return {
      action: "merge_next",
      status: "idle",
      stage: "idle",
    };
  }

  const dispatchState = loadDispatchState(root);
  const dispatchRecord = dispatchState.records[queueItem.issueId];
  if (!dispatchRecord) {
    return failInvalidQueueItem(root, queueState, queueItem, now, "no dispatch record");
  }
  const stageError = dispatchRecord.stage === "queued_for_merge"
    ? validateDispatchRecordStage(dispatchRecord)
    : `expects queued_for_merge, found ${dispatchRecord.stage}`;
  if (stageError) {
    return failInvalidQueueItem(root, queueState, queueItem, now, stageError, dispatchRecord.stage);
  }

  const rootWorkspace = captureGitProofPair(root).before;
  const dirtyFiles = listOperationalDirtyFiles(rootWorkspace);
  const activeDirtyOwners = findActiveTitanDirtyOwners(dispatchState, dirtyFiles);
  if (activeDirtyOwners) {
    const ownerSummary = [...activeDirtyOwners.entries()]
      .map(([file, owner]) => `${file}:${owner}`)
      .join(", ");
    return {
      action: "merge_next",
      status: "requeued",
      issueId: queueItem.issueId,
      queueItemId: queueItem.queueItemId,
      stage: "queued_for_merge",
      detail: `Merge waiting for active scoped work to finish before requiring a clean root: ${ownerSummary}.`,
    };
  }

  const config = loadConfig(root);
  const executor = options.executor ?? createDefaultExecutor(config);
  const tracker = options.tracker ?? createDefaultTracker();

  const mergingQueueState = updateMergeQueueItem(queueState, queueItem.queueItemId, (item) => ({
    ...item,
    status: "merging",
    updatedAt: now,
  }));
  saveMergeQueueState(root, mergingQueueState);
  updateDispatchStage(root, dispatchRecord, "merging", now);

  // Any throw past this point would strand the item in `merging`; fail it
  // closed with retry accounting instead.
  const failMerge = (detail: string, tier: "T2" | "T3", outcome?: MergeExecutionOutcome): MergeNextResult => {
    saveMergeQueueState(root, updateMergeQueueItem(mergingQueueState, queueItem.queueItemId, (item) => ({
      ...item,
      status: "failed",
      attempts: item.attempts + 1,
      lastTier: tier,
      lastError: detail,
      ...(outcome ? { lastOutcome: toFailureOutcome(outcome) } : {}),
      updatedAt: now,
    })));
    updateDispatchRecord(root, dispatchRecord, (latest) =>
      applyOperationalFailure(latest, { timestamp: now, errorMessage: detail }));

    return {
      action: "merge_next",
      status: "failed",
      issueId: queueItem.issueId,
      queueItemId: queueItem.queueItemId,
      tier,
      stage: "failed_operational",
      detail,
    };
  };

  let attempt: MergeExecutorResult;
  try {
    attempt = await executor.execute(root, queueItem);
  } catch (error) {
    return failMerge(`Merge executor failed: ${toErrorMessage(error)}`, "T2");
  }

  const decision = classifyMergeTier({
    outcome: attempt.outcome,
    attempts: queueItem.attempts,
    janusRetryThreshold: config.thresholds.janus_retry_threshold,
    janusEnabled: config.janus.enabled,
    janusInvocations: queueItem.janusInvocations,
    maxJanusInvocations: config.janus.max_invocations_per_issue,
  });

  if (decision.action === "merge") {
    await tracker.closeIssue?.(queueItem.issueId, root);
    const mergedQueueState = updateMergeQueueItem(mergingQueueState, queueItem.queueItemId, (item) => ({
      ...item,
      status: "merged",
      lastTier: "T1",
      lastError: null,
      updatedAt: now,
    }));
    saveMergeQueueState(root, mergedQueueState);
    updateDispatchStage(root, dispatchRecord, "complete", now);

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

  if (decision.action === "requeue") {
    const requeuedState = updateMergeQueueItem(mergingQueueState, queueItem.queueItemId, (item) => ({
      ...item,
      status: "queued",
      attempts: item.attempts + 1,
      lastTier: "T2",
      lastError: attempt.detail,
      lastOutcome: toFailureOutcome(attempt.outcome),
      updatedAt: now,
    }));
    saveMergeQueueState(root, requeuedState);
    updateDispatchStage(root, dispatchRecord, "queued_for_merge", now);

    return {
      action: "merge_next",
      status: "requeued",
      issueId: queueItem.issueId,
      queueItemId: queueItem.queueItemId,
      tier: "T2",
      stage: "queued_for_merge",
      detail: attempt.detail,
    };
  }

  if (decision.action === "janus") {
    // Janus is live model work. Hand it to an adapter session that the daemon
    // launches and the reaper settles, so merging never blocks the loop.
    saveMergeQueueState(root, updateMergeQueueItem(mergingQueueState, queueItem.queueItemId, (item) => ({
      ...item,
      status: "failed",
      attempts: item.attempts + 1,
      janusInvocations: item.janusInvocations + 1,
      lastTier: "T3",
      lastError: attempt.detail,
      lastOutcome: toFailureOutcome(attempt.outcome),
      updatedAt: now,
    })));
    updateDispatchStage(root, dispatchRecord, "resolving_integration", now);

    return {
      action: "merge_next",
      status: "escalated",
      issueId: queueItem.issueId,
      queueItemId: queueItem.queueItemId,
      tier: "T3",
      stage: "resolving_integration",
      detail: attempt.detail,
    };
  }

  return failMerge(attempt.detail, "T3", attempt.outcome);
}

/**
 * Lands every mergeable candidate in one pass instead of one per daemon tick.
 * Each queued item is attempted at most once per pass, so requeues and
 * dirty-root waits cannot spin.
 */
export async function drainMergeQueue(
  root: string,
  options: Omit<RunMergeNextOptions, "skipQueueItemIds"> = {},
): Promise<MergeNextResult[]> {
  const attempted = new Set<string>();
  const results: MergeNextResult[] = [];
  for (;;) {
    const result = await runMergeNext(root, { ...options, skipQueueItemIds: attempted });
    if (!result.queueItemId) {
      return results;
    }
    attempted.add(result.queueItemId);
    results.push(result);
  }
}
