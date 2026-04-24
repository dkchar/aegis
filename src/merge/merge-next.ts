import { spawnSync } from "node:child_process";

import { loadConfig } from "../config/load-config.js";
import {
  loadDispatchState,
  replaceDispatchRecord,
  saveDispatchState,
  type DispatchRecord,
} from "../core/dispatch-state.js";
import { assertDispatchRecordStage } from "../core/stage-invariants.js";
import { runCasteCommand } from "../core/caste-runner.js";
import { createCasteRuntime } from "../runtime/create-caste-runtime.js";
import type { CasteRuntime } from "../runtime/caste-runtime.js";
import { BeadsTrackerClient } from "../tracker/beads-tracker.js";
import type { AegisIssue } from "../tracker/issue-model.js";
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

interface TrackerLike {
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

function runGit(root: string, args: string[]) {
  return spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
}

class GitMergeExecutor implements MergeExecutor {
  async execute(root: string, item: MergeQueueItem): Promise<MergeExecutorResult> {
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
      const detail = `${checkout.stdout ?? ""}${checkout.stderr ?? ""}`.trim();
      return {
        outcome: "stale_branch",
        detail: detail.length > 0 ? detail : `Failed to checkout ${item.targetBranch}.`,
      };
    }

    const merge = runGit(root, ["merge", "--no-ff", "--no-edit", item.candidateBranch]);
    if (merge.status === 0) {
      return {
        outcome: "merged",
        detail: `${merge.stdout ?? ""}${merge.stderr ?? ""}`.trim() || "Merged cleanly.",
      };
    }

    void runGit(root, ["merge", "--abort"]);
    const detail = `${merge.stdout ?? ""}${merge.stderr ?? ""}`.trim() || "Merge failed.";
    return {
      outcome: /CONFLICT/i.test(detail) ? "conflict" : "stale_branch",
      detail,
    };
  }
}

function createDefaultExecutor(root: string): MergeExecutor {
  const config = loadConfig(root);
  const scriptedPlanOverride = parseScriptedMergePlan(process.env[SCRIPTED_MERGE_PLAN_ENV] ?? "") !== null;
  return config.runtime === "scripted"
    || scriptedPlanOverride
    ? new ScriptedMergeExecutor()
    : new GitMergeExecutor();
}

function createDefaultTracker(): TrackerLike {
  return new BeadsTrackerClient();
}

function createDefaultRuntime(root: string, issueId: string): CasteRuntime {
  return createCasteRuntime(loadConfig(root).runtime, {}, { root, issueId });
}

function updateDispatchStage(
  root: string,
  issueId: string,
  record: DispatchRecord,
  stage: string,
  now: string,
) {
  const state = loadDispatchState(root);
  const nextState = replaceDispatchRecord(state, issueId, {
    ...record,
    stage,
    updatedAt: now,
  });
  saveDispatchState(root, nextState);
  return nextState.records[issueId]!;
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

  const executor = options.executor ?? createDefaultExecutor(root);
  const tracker = options.tracker ?? createDefaultTracker();
  const runtime = options.runtime ?? createDefaultRuntime(root, queueItem.issueId);

  const mergingQueueState = updateMergeQueueItem(queueState, queueItem.queueItemId, (item) => ({
    ...item,
    status: "merging",
    updatedAt: now,
  }));
  saveMergeQueueState(root, mergingQueueState);
  updateDispatchStage(root, queueItem.issueId, dispatchRecord, "merging", now);

  const attempt = await executor.execute(root, queueItem);
  const decision = classifyMergeTier({
    outcome: attempt.outcome,
    attempts: queueItem.attempts,
    janusRetryThreshold: loadConfig(root).thresholds.janus_retry_threshold,
    janusEnabled: loadConfig(root).janus.enabled,
    janusInvocations: queueItem.janusInvocations,
    maxJanusInvocations: loadConfig(root).janus.max_invocations_per_issue,
  });

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
    updateDispatchStage(root, queueItem.issueId, dispatchRecord, "queued_for_merge", now);

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
    updateDispatchStage(root, queueItem.issueId, dispatchRecord, "resolving_integration", now);
    const janus = await runCasteCommand({
      root,
      action: "process",
      issueId: queueItem.issueId,
      tracker,
      runtime,
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

  const failedState = updateMergeQueueItem(mergingQueueState, queueItem.queueItemId, (item) => ({
    ...item,
    status: "failed",
    attempts: item.attempts + 1,
    lastTier: "T3",
    lastError: attempt.detail,
    updatedAt: now,
  }));
  saveMergeQueueState(root, failedState);
  updateDispatchStage(root, queueItem.issueId, dispatchRecord, "failed_operational", now);

  return {
    action: "merge_next",
    status: "failed",
    issueId: queueItem.issueId,
    queueItemId: queueItem.queueItemId,
    tier: "T3",
    stage: "failed_operational",
    detail: attempt.detail,
  };
}
