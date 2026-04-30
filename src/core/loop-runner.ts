import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { loadConfig } from "../config/load-config.js";
import { loadDispatchState, saveDispatchState } from "./dispatch-state.js";
import { dispatchReadyWork } from "./dispatcher.js";
import { monitorActiveWork } from "./monitor.js";
import { pollReadyWork } from "./poller.js";
import { reapFinishedWork } from "./reaper.js";
import { triageReadyWork } from "./triage.js";
import { BeadsTrackerClient } from "../tracker/beads-tracker.js";
import type { AgentRuntime } from "../runtime/agent-runtime.js";
import { createAgentRuntime } from "../runtime/scripted-agent-runtime.js";
import { createCasteRuntime } from "../runtime/create-caste-runtime.js";
import { writePhaseLog } from "./phase-log.js";
import { autoEnqueueImplementedIssuesForMerge } from "../merge/auto-enqueue.js";
import { runCasteCommand } from "./caste-runner.js";
import {
  calculateFailureCooldown,
  resolveFailureWindowStartMs,
} from "./failure-policy.js";
import { parseSentinelVerdict } from "../castes/sentinel/sentinel-parser.js";

export type LoopPhase = "poll" | "dispatch" | "monitor" | "reap";

export interface LoopPhaseResult {
  phase: LoopPhase;
  readyIssueIds?: string[];
  dispatched?: string[];
  skipped?: Array<{ issueId: string; reason: string }>;
  warnings?: string[];
  killList?: string[];
  readyToReap?: string[];
  completed?: string[];
  failed?: string[];
}

export interface RunLoopPhaseOptions {
  runtime?: AgentRuntime;
  sessionProvenanceId?: string;
  launchPreMergeReview?: (input: {
    root: string;
    issueId: string;
    timestamp: string;
  }) => Promise<void>;
}

const ACTIVE_PRE_MERGE_REVIEWS = new Set<string>();

function createDefaultRuntime(root: string) {
  const config = loadConfig(root);
  return createAgentRuntime(config.runtime);
}

interface DispatchPipelineResult {
  dispatchState: ReturnType<typeof loadDispatchState>;
  readyIssueIds: string[];
  dispatched: string[];
  skipped: Array<{ issueId: string; reason: string }>;
  failed: string[];
}

function readPolicyArtifact(root: string, artifactRef: string | null | undefined) {
  if (!artifactRef) {
    return null;
  }

  const artifactPath = path.join(root, artifactRef);
  if (!existsSync(artifactPath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(artifactPath, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isResolvedPolicyBlockerReady(input: {
  root: string;
  readyIssueIds: Set<string>;
  record: ReturnType<typeof loadDispatchState>["records"][string];
}) {
  const { record } = input;
  if (
    record.stage !== "blocked_on_child"
    && record.stage !== "failed_operational"
    || !input.readyIssueIds.has(record.issueId)
    || !record.blockedByIssueId
    || !record.policyArtifactRef
  ) {
    return false;
  }

  const artifact = readPolicyArtifact(input.root, record.policyArtifactRef);
  return artifact?.["outcome"] !== "rejected"
    && artifact?.["childIssueId"] === record.blockedByIssueId;
}

function isRejectedBlockerChainReady(input: {
  root: string;
  readyIssueIds: Set<string>;
  record: ReturnType<typeof loadDispatchState>["records"][string];
}) {
  const { record } = input;
  if (
    record.runningAgent
    || !input.readyIssueIds.has(record.issueId)
    || !record.policyArtifactRef
  ) {
    return false;
  }

  const artifact = readPolicyArtifact(input.root, record.policyArtifactRef);
  return artifact?.["outcome"] === "rejected"
    && artifact?.["rejectionReason"] === "blocker_chain_not_allowed";
}

function toFreshScoutRecord(
  record: ReturnType<typeof loadDispatchState>["records"][string],
  timestamp: string,
) {
  return {
    ...record,
    stage: "pending" as const,
    runningAgent: null,
    blockedByIssueId: null,
    policyArtifactRef: null,
    oracleAssessmentRef: null,
    oracleReady: null,
    oracleDecompose: null,
    oracleBlockers: null,
    fileScope: null,
    reviewFeedbackRef: null,
    titanHandoffRef: null,
    titanClarificationRef: null,
    sentinelVerdictRef: null,
    janusArtifactRef: null,
    cooldownUntil: null,
    updatedAt: timestamp,
  };
}

function recoverResolvedPolicyBlockedParents(input: {
  root: string;
  dispatchState: ReturnType<typeof loadDispatchState>;
  readyIssueIds: string[];
  timestamp: string;
}) {
  const readyIssueIds = new Set(input.readyIssueIds);
  let changed = false;
  const records = Object.fromEntries(
    Object.entries(input.dispatchState.records).map(([issueId, record]) => {
      if (!isResolvedPolicyBlockerReady({
        root: input.root,
        readyIssueIds,
        record,
      }) && !isRejectedBlockerChainReady({
        root: input.root,
        readyIssueIds,
        record,
      })) {
        return [issueId, record];
      }

      changed = true;
      writePhaseLog(input.root, {
        timestamp: input.timestamp,
        phase: "triage",
        issueId,
        action: "resolved_policy_blocker_recovered",
        outcome: "implemented",
        detail: JSON.stringify({
          blockedByIssueId: record.blockedByIssueId,
          policyArtifactRef: record.policyArtifactRef,
          nextStage: "pending",
        }),
      });

      return [issueId, toFreshScoutRecord(record, input.timestamp)];
    }),
  );

  return {
    changed,
    state: changed
      ? {
          schemaVersion: input.dispatchState.schemaVersion,
          records,
        }
      : input.dispatchState,
  };
}

async function runDispatchPipeline(
  root: string,
  runtime: AgentRuntime,
  sessionProvenanceId: string,
  timestamp: string,
): Promise<DispatchPipelineResult> {
  const config = loadConfig(root);
  const tracker = new BeadsTrackerClient();
  let dispatchState = loadDispatchState(root);
  const snapshot = await pollReadyWork({
    dispatchState,
    tracker,
    root,
  });

  writePhaseLog(root, {
    timestamp,
    phase: "poll",
    issueId: "_all",
    action: "poll_ready_work",
    outcome: "ok",
    detail: snapshot.readyIssues.map((issue) => issue.id).join(","),
  });

  const recoveredBlockedParents = recoverResolvedPolicyBlockedParents({
    root,
    dispatchState,
    readyIssueIds: snapshot.readyIssues.map((issue) => issue.id),
    timestamp,
  });
  dispatchState = recoveredBlockedParents.state;
  if (recoveredBlockedParents.changed) {
    saveDispatchState(root, dispatchState);
  }

  const triage = triageReadyWork({
    readyIssues: snapshot.readyIssues,
    dispatchState,
    config,
    now: timestamp,
  });

  writePhaseLog(root, {
    timestamp,
    phase: "triage",
    issueId: "_all",
    action: "triage_ready_work",
    outcome: "ok",
    detail: triage.dispatchable.map((item) => item.issueId).join(","),
  });

  const dispatchResult = await dispatchReadyWork({
    dispatchState,
    decisions: triage.dispatchable,
    runtime,
    root,
    sessionProvenanceId,
    now: timestamp,
  });
  saveDispatchState(root, dispatchResult.state);

  return {
    dispatchState: dispatchResult.state,
    readyIssueIds: snapshot.readyIssues.map((issue) => issue.id),
    dispatched: dispatchResult.dispatched,
    skipped: triage.skipped,
    failed: dispatchResult.failed,
  };
}

async function runMonitorPipeline(
  root: string,
  runtime: AgentRuntime,
  timestamp: string,
  dispatchState = loadDispatchState(root),
) {
  const config = loadConfig(root);

  return monitorActiveWork({
    dispatchState,
    runtime,
    thresholds: {
      stuck_warning_seconds: config.thresholds.stuck_warning_seconds,
      stuck_kill_seconds: config.thresholds.stuck_kill_seconds,
    },
    root,
    now: timestamp,
  });
}

async function runReapPipeline(
  root: string,
  runtime: AgentRuntime,
  timestamp: string,
  issueIds: string[],
  dispatchState = loadDispatchState(root),
) {
  const reapResult = await reapFinishedWork({
    dispatchState,
    runtime,
    issueIds,
    root,
    now: timestamp,
  });
  saveDispatchState(root, reapResult.state);
  return reapResult;
}

function markRecordReviewing(root: string, issueId: string, timestamp: string) {
  const dispatchState = loadDispatchState(root);
  const record = dispatchState.records[issueId];
  if (!record || (record.stage !== "implemented" && record.stage !== "reviewing")) {
    return false;
  }

  saveDispatchState(root, {
    schemaVersion: dispatchState.schemaVersion,
    records: {
      ...dispatchState.records,
      [issueId]: {
        ...record,
        stage: "reviewing",
        updatedAt: timestamp,
      },
    },
  });

  return true;
}

function markRecordReviewingWithAgent(input: {
  root: string;
  issueId: string;
  timestamp: string;
  sessionProvenanceId: string;
  sessionId: string;
  startedAt: string;
}) {
  const dispatchState = loadDispatchState(input.root);
  const record = dispatchState.records[input.issueId];
  if (!record || (record.stage !== "implemented" && record.stage !== "reviewing")) {
    return false;
  }

  saveDispatchState(input.root, {
    schemaVersion: dispatchState.schemaVersion,
    records: {
      ...dispatchState.records,
      [input.issueId]: {
        ...record,
        stage: "reviewing",
        runningAgent: {
          caste: "sentinel",
          sessionId: input.sessionId,
          startedAt: input.startedAt,
        },
        cooldownUntil: null,
        sessionProvenanceId: input.sessionProvenanceId,
        updatedAt: input.timestamp,
      },
    },
  });

  return true;
}

function resolveDurableSentinelRef(root: string, issueId: string, currentRef: string | null) {
  const candidates = [
    currentRef,
    path.join(".aegis", "sentinel", `${issueId}.json`),
  ].filter((entry): entry is string => entry !== null);

  return candidates.find((candidate) => existsSync(path.join(root, candidate))) ?? null;
}

function readDurableSentinelVerdict(root: string, artifactRef: string) {
  const payload = JSON.parse(readFileSync(path.join(root, artifactRef), "utf8")) as Record<string, unknown>;

  return parseSentinelVerdict(JSON.stringify({
    verdict: payload["verdict"],
    reviewSummary: payload["reviewSummary"],
    blockingFindings: payload["blockingFindings"],
    advisories: payload["advisories"],
    touchedFiles: payload["touchedFiles"],
    contractChecks: payload["contractChecks"],
  }));
}

function recoverReviewingRecord(root: string, issueId: string, timestamp: string) {
  const dispatchState = loadDispatchState(root);
  const record = dispatchState.records[issueId];
  if (!record || record.stage !== "reviewing") {
    return false;
  }

  const sentinelVerdictRef = resolveDurableSentinelRef(root, issueId, record.sentinelVerdictRef);
  if (!sentinelVerdictRef) {
    return false;
  }

  const verdict = readDurableSentinelVerdict(root, sentinelVerdictRef);
  const reviewStage = verdict.verdict === "pass" ? "queued_for_merge" : "rework_required";
  saveDispatchState(root, {
    schemaVersion: dispatchState.schemaVersion,
    records: {
      ...dispatchState.records,
      [issueId]: {
        ...record,
        stage: reviewStage,
        sentinelVerdictRef,
        reviewFeedbackRef: sentinelVerdictRef,
        updatedAt: timestamp,
      },
    },
  });

  writePhaseLog(root, {
    timestamp,
    phase: "dispatch",
    issueId,
    action: "sentinel_review_recovered",
    outcome: reviewStage,
    detail: JSON.stringify({
      blockingFindingCount: verdict.blockingFindings.length,
      advisoryCount: verdict.advisories.length,
    }),
  });

  return true;
}

function markReviewRetryCooldown(root: string, issueId: string, timestamp: string, detail: string) {
  const dispatchState = loadDispatchState(root);
  const record = dispatchState.records[issueId];
  if (!record) {
    return;
  }

  saveDispatchState(root, {
    schemaVersion: dispatchState.schemaVersion,
    records: {
      ...dispatchState.records,
      [issueId]: {
        ...record,
        stage: "implemented",
        runningAgent: null,
        failureCount: record.failureCount + 1,
        consecutiveFailures: record.consecutiveFailures + 1,
        failureWindowStartMs: record.failureWindowStartMs
          ?? resolveFailureWindowStartMs(timestamp),
        cooldownUntil: calculateFailureCooldown(timestamp),
        updatedAt: timestamp,
      },
    },
  });

  writePhaseLog(root, {
    timestamp,
    phase: "dispatch",
    issueId,
    action: "sentinel_review_completed",
    outcome: "failed",
    detail,
  });
}

function isRecordCoolingDown(record: { cooldownUntil: string | null }, timestamp: string) {
  if (!record.cooldownUntil) {
    return false;
  }

  const cooldownMs = Date.parse(record.cooldownUntil);
  const nowMs = Date.parse(timestamp);
  return Number.isFinite(cooldownMs)
    && Number.isFinite(nowMs)
    && cooldownMs > nowMs;
}

function createPreMergeReviewLauncher(
  root: string,
  launchPreMergeReview?: RunLoopPhaseOptions["launchPreMergeReview"],
) {
  if (launchPreMergeReview) {
    return launchPreMergeReview;
  }

  return async ({ issueId, timestamp }: {
    root: string;
    issueId: string;
    timestamp: string;
  }) => {
    const config = loadConfig(root);
    const tracker = new BeadsTrackerClient();
    await runCasteCommand({
      root,
      action: "review",
      issueId,
      tracker,
      runtime: createCasteRuntime(config.runtime, {}, {
        root,
        issueId,
      }),
      artifactEmissionMode: config.runtime === "pi" ? "tool" : "json",
      now: timestamp,
    });
  };
}

async function runPreMergeReviews(
  root: string,
  timestamp: string,
  runtime: AgentRuntime,
  sessionProvenanceId: string,
  launchPreMergeReview?: RunLoopPhaseOptions["launchPreMergeReview"],
): Promise<void> {
  const reviewCandidates = Object.values(loadDispatchState(root).records)
    .filter((record) => (
      record.stage === "implemented" || record.stage === "reviewing"
    ) && !isRecordCoolingDown(record, timestamp));
  const launchReview = createPreMergeReviewLauncher(root, launchPreMergeReview);

  for (const record of reviewCandidates) {
    if (record.runningAgent) {
      continue;
    }
    if (ACTIVE_PRE_MERGE_REVIEWS.has(record.issueId)) {
      continue;
    }
    if (recoverReviewingRecord(root, record.issueId, timestamp)) {
      continue;
    }

    ACTIVE_PRE_MERGE_REVIEWS.add(record.issueId);
    try {
      if (launchPreMergeReview) {
        if (!markRecordReviewing(root, record.issueId, timestamp)) {
          continue;
        }
        await launchReview({
          root,
          issueId: record.issueId,
          timestamp,
        });
      } else {
        const launched = await runtime.launch({
          root,
          issueId: record.issueId,
          title: record.issueId,
          caste: "sentinel",
          stage: "reviewing",
        });
        if (!markRecordReviewingWithAgent({
          root,
          issueId: record.issueId,
          timestamp,
          sessionProvenanceId,
          sessionId: launched.sessionId,
          startedAt: launched.startedAt,
        })) {
          continue;
        }
        writePhaseLog(root, {
          timestamp,
          phase: "dispatch",
          issueId: record.issueId,
          action: "launch_sentinel",
          outcome: "running",
          sessionId: launched.sessionId,
          detail: JSON.stringify({
            caste: "sentinel",
            stage: "reviewing",
          }),
        });
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      markReviewRetryCooldown(root, record.issueId, timestamp, detail);
    } finally {
      ACTIVE_PRE_MERGE_REVIEWS.delete(record.issueId);
    }
  }
}

export async function runLoopPhase(
  root = process.cwd(),
  phase: LoopPhase,
  options: RunLoopPhaseOptions = {},
): Promise<LoopPhaseResult> {
  const runtime = options.runtime ?? createDefaultRuntime(root);
  const timestamp = new Date().toISOString();
  const sessionProvenanceId = options.sessionProvenanceId ?? "direct-command";

  if (phase === "poll") {
    const snapshot = await pollReadyWork({
      dispatchState: loadDispatchState(root),
      tracker: new BeadsTrackerClient(),
      root,
    });
    writePhaseLog(root, {
      timestamp,
      phase: "poll",
      issueId: "_all",
      action: "poll_ready_work",
      outcome: "ok",
      detail: snapshot.readyIssues.map((issue) => issue.id).join(","),
    });
    return {
      phase,
      readyIssueIds: snapshot.readyIssues.map((issue) => issue.id),
    };
  }

  if (phase === "dispatch") {
    const result = await runDispatchPipeline(
      root,
      runtime,
      sessionProvenanceId,
      timestamp,
    );
    return {
      phase,
      readyIssueIds: result.readyIssueIds,
      dispatched: result.dispatched,
      skipped: result.skipped,
      failed: result.failed,
    };
  }

  if (phase === "monitor") {
    const result = await runMonitorPipeline(root, runtime, timestamp);
    return {
      phase,
      warnings: result.warnings,
      killList: result.killList,
      readyToReap: result.readyToReap,
    };
  }

  const dispatchState = loadDispatchState(root);
  const result = await runReapPipeline(
    root,
    runtime,
    timestamp,
    Object.values(dispatchState.records)
      .filter((record) => record.runningAgent !== null)
      .map((record) => record.issueId),
    dispatchState,
  );
  return {
    phase,
    completed: result.completed,
    failed: result.failed,
  };
}

export async function runDaemonCycle(
  root = process.cwd(),
  options: RunLoopPhaseOptions = {},
): Promise<void> {
  const runtime = options.runtime ?? createDefaultRuntime(root);
  const timestamp = new Date().toISOString();
  const sessionProvenanceId = options.sessionProvenanceId ?? "daemon";
  const dispatchResult = await runDispatchPipeline(
    root,
    runtime,
    sessionProvenanceId,
    timestamp,
  );

  const monitorResult = await runMonitorPipeline(
    root,
    runtime,
    timestamp,
    dispatchResult.dispatchState,
  );

  await runReapPipeline(
    root,
    runtime,
    timestamp,
    monitorResult.readyToReap,
    dispatchResult.dispatchState,
  );

  await runPreMergeReviews(
    root,
    timestamp,
    runtime,
    sessionProvenanceId,
    options.launchPreMergeReview,
  );
  autoEnqueueImplementedIssuesForMerge(root, timestamp);
}
