import { loadConfig } from "../config/load-config.js";
import type { AegisConfig } from "../config/schema.js";
import { captureGitProofPair, listOperationalDirtyFiles, summarizeOperationalDirtyFiles } from "../core/git-proof.js";
import {
  loadDispatchState,
  replaceDispatchRecord,
  saveDispatchState,
  type DispatchRecord,
} from "../core/dispatch-state.js";
import { assertDispatchRecordStage } from "../core/stage-invariants.js";
import { runCasteCommand } from "../core/caste-runner.js";
import { applyOperationalFailure } from "../core/failure-policy.js";
import { createCasteRuntime } from "../runtime/create-caste-runtime.js";
import { resolveArtifactEmissionMode } from "../runtime/runtime-registry.js";
import type { CasteRuntime } from "../runtime/caste-runtime.js";
import type { AegisIssue } from "../tracker/issue-model.js";
import type { TrackerClient } from "../tracker/tracker.js";
import { createTrackerClient } from "../tracker/create-tracker.js";
import {
  findNextQueuedItem,
  loadMergeQueueState,
  saveMergeQueueState,
  updateMergeQueueItem,
  type MergeQueueItem,
} from "./merge-state.js";
import {
  classifyMergeTier,
  type MergeExecutionOutcome,
} from "./tier-policy.js";
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
  runtime?: CasteRuntime;
  now?: string;
}

export interface MergeNextResult {
  action: "merge_next";
  status: "idle" | "merged" | "requeued" | "janus_requeued" | "failed";
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
            && candidateOutcome.outcome !== "conflict")
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

class GitMergeExecutor implements MergeExecutor {
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

    const merge = runGit(root, ["merge", "--no-ff", "--no-edit", item.candidateBranch]);
    if (merge.status === 0) {
      return {
        outcome: "merged",
        detail: formatGitOutput(merge) || "Merged cleanly.",
      };
    }

    void runGit(root, ["merge", "--abort"]);
    const detail = formatGitOutput(merge) || "Merge failed.";
    return {
      outcome: /CONFLICT/i.test(detail) ? "conflict" : "stale_branch",
      detail,
    };
  }
}

function createDefaultExecutor(config: AegisConfig): MergeExecutor {
  const scriptedPlanOverride = parseScriptedMergePlan(process.env[SCRIPTED_MERGE_PLAN_ENV] ?? "") !== null;
  return config.runtime === "scripted"
    || scriptedPlanOverride
    ? new ScriptedMergeExecutor()
    : new GitMergeExecutor();
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

export async function runMergeNext(
  root: string,
  options: RunMergeNextOptions = {},
): Promise<MergeNextResult> {
  const now = options.now ?? new Date().toISOString();
  const queueState = loadMergeQueueState(root);
  const queueItem = findNextQueuedItem(queueState);

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
    throw new Error(`Merge queue item ${queueItem.queueItemId} has no dispatch record.`);
  }
  assertDispatchRecordStage(dispatchRecord, "queued_for_merge");

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
  const failMerge = (detail: string, tier: "T2" | "T3", janusInvoked: boolean): MergeNextResult => {
    saveMergeQueueState(root, updateMergeQueueItem(mergingQueueState, queueItem.queueItemId, (item) => ({
      ...item,
      status: "failed",
      attempts: item.attempts + 1,
      janusInvocations: item.janusInvocations + (janusInvoked ? 1 : 0),
      lastTier: tier,
      lastError: detail,
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
    return failMerge(`Merge executor failed: ${toErrorMessage(error)}`, "T2", false);
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
    const janusInvocation = queueItem.janusInvocations + 1;
    const attemptNumber = queueItem.attempts + 1;
    updateDispatchStage(root, dispatchRecord, "resolving_integration", now);

    let janus: Awaited<ReturnType<typeof runCasteCommand>>;
    try {
      janus = await runCasteCommand({
        root,
        action: "process",
        issueId: queueItem.issueId,
        tracker,
        runtime: options.runtime ?? createCasteRuntime(config.runtime, {}, { root, issueId: queueItem.issueId }),
        artifactEmissionMode: resolveArtifactEmissionMode(config.runtime),
        janusContext: {
          queueItemId: queueItem.queueItemId,
          mergeOutcome: attempt.outcome,
          mergeDetail: attempt.detail,
          attempt: attemptNumber,
          tier: "T3",
          janusInvocation,
        },
        now,
      });
    } catch (error) {
      return failMerge(`${attempt.detail} Janus failed: ${toErrorMessage(error)}`, "T3", true);
    }

    const janusDetail = `${attempt.detail} Janus recommended ${janus.janusRecommendation ?? janus.stage}.`;
    const afterJanusState = updateMergeQueueItem(mergingQueueState, queueItem.queueItemId, (item) => ({
      ...item,
      status: "failed",
      attempts: item.attempts + 1,
      janusInvocations: item.janusInvocations + 1,
      lastTier: "T3",
      lastError: janusDetail,
      updatedAt: now,
    }));
    saveMergeQueueState(root, afterJanusState);

    return {
      action: "merge_next",
      status: "failed",
      issueId: queueItem.issueId,
      queueItemId: queueItem.queueItemId,
      tier: "T3",
      stage: janus.stage,
      detail: janusDetail,
    };
  }

  return failMerge(attempt.detail, "T3", false);
}
