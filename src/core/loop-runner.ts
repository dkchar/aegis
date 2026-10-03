import { loadConfig } from "../config/load-config.js";
import type { AegisConfig } from "../config/schema.js";
import {
  commitDispatchChanges,
  countRunningAgents,
  listRunningRecords,
  loadDispatchState,
  saveDispatchRecord,
  saveDispatchState,
  type DispatchRecord,
  type DispatchState,
} from "./dispatch-state.js";
import { dispatchReadyWork } from "./dispatcher.js";
import { monitorActiveWork } from "./monitor.js";
import { pollReadyWork } from "./poller.js";
import { reapFinishedWork } from "./reaper.js";
import { triageReadyWork } from "./triage.js";
import { createTrackerClient } from "../tracker/create-tracker.js";
import type { AgentRuntime } from "../runtime/agent-runtime.js";
import { createAgentRuntime } from "../runtime/dispatch-runtime.js";
import { writePhaseLog, writePhaseLogEntry, type PhaseLogWriter } from "./phase-log.js";
import { autoEnqueueImplementedIssuesForMerge } from "../merge/auto-enqueue.js";
import {
  recoverDispatchStateAfterPoll,
  recoverReviewingRecord,
} from "./dispatch-recovery.js";
import { applyOperationalFailure, applySentinelOperationalFailure } from "./failure-policy.js";

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
  /**
   * Writer for `_all` phase summaries. The daemon passes a
   * `createCycleSummaryWriter()` so repeated identical summaries are skipped;
   * direct phase commands always write.
   */
  summaryLog?: PhaseLogWriter;
  launchPreMergeReview?: (input: {
    root: string;
    issueId: string;
    timestamp: string;
  }) => Promise<void>;
}

// Guards against launching the same review twice while an inline launch awaits.
const ACTIVE_PRE_MERGE_REVIEWS = new Set<string>();

interface CycleContext {
  root: string;
  config: AegisConfig;
  runtime: AgentRuntime;
  sessionProvenanceId: string;
  timestamp: string;
  writeSummaryLog: PhaseLogWriter;
}

function createCycleContext(root: string, options: RunLoopPhaseOptions, defaultProvenance: string): CycleContext {
  const config = loadConfig(root);
  return {
    root,
    config,
    runtime: options.runtime ?? createAgentRuntime(config.runtime),
    sessionProvenanceId: options.sessionProvenanceId ?? defaultProvenance,
    timestamp: new Date().toISOString(),
    writeSummaryLog: options.summaryLog ?? writePhaseLogEntry,
  };
}

interface DispatchPipelineResult {
  dispatchState: DispatchState;
  readyIssueIds: string[];
  dispatched: string[];
  skipped: Array<{ issueId: string; reason: string }>;
  failed: string[];
}

function logPoll(context: CycleContext, readyIssueIds: string[]) {
  context.writeSummaryLog(context.root, {
    timestamp: context.timestamp,
    phase: "poll",
    issueId: "_all",
    action: "poll_ready_work",
    outcome: "ok",
    detail: readyIssueIds.join(","),
  });
}

async function runDispatchPipeline(context: CycleContext): Promise<DispatchPipelineResult> {
  const { root, config, timestamp } = context;
  const tracker = createTrackerClient();
  const loadedState = loadDispatchState(root);
  let dispatchState = loadedState;
  const snapshot = await pollReadyWork({
    dispatchState,
    tracker,
    root,
  });
  const readyIssueIds = snapshot.readyIssues.map((issue) => issue.id);
  logPoll(context, readyIssueIds);

  dispatchState = await recoverDispatchStateAfterPoll({
    root,
    tracker,
    dispatchState,
    readyIssueIds,
    timestamp,
  });

  const triage = triageReadyWork({
    readyIssues: snapshot.readyIssues,
    dispatchState,
    config,
    now: timestamp,
  });

  context.writeSummaryLog(root, {
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
    runtime: context.runtime,
    root,
    sessionProvenanceId: context.sessionProvenanceId,
    now: timestamp,
    writeSummaryLog: context.writeSummaryLog,
  });
  // The tracker poll and adapter launches sit between load and save, so only
  // this pass's own changes are written over whatever landed meanwhile.
  const committedState = commitDispatchChanges(root, loadedState, dispatchResult.state);

  return {
    dispatchState: committedState,
    readyIssueIds,
    dispatched: dispatchResult.dispatched,
    skipped: triage.skipped,
    failed: dispatchResult.failed,
  };
}

function runMonitorPipeline(context: CycleContext, dispatchState = loadDispatchState(context.root)) {
  return monitorActiveWork({
    dispatchState,
    runtime: context.runtime,
    thresholds: {
      stuck_warning_seconds: context.config.thresholds.stuck_warning_seconds,
      stuck_kill_seconds: context.config.thresholds.stuck_kill_seconds,
    },
    root: context.root,
    now: context.timestamp,
    writeSummaryLog: context.writeSummaryLog,
  });
}

async function runReapPipeline(
  context: CycleContext,
  issueIds: string[],
  dispatchState = loadDispatchState(context.root),
) {
  const reapResult = await reapFinishedWork({
    dispatchState,
    runtime: context.runtime,
    issueIds,
    root: context.root,
    now: context.timestamp,
    writeSummaryLog: context.writeSummaryLog,
  });
  saveDispatchState(context.root, reapResult.state);
  return reapResult;
}

function isReviewStage(record: DispatchRecord | undefined): record is DispatchRecord {
  return record?.stage === "implemented" || record?.stage === "reviewing";
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

/** Applies `transform` to the latest persisted record when `guard` accepts it. */
function updateLatestRecord(
  root: string,
  issueId: string,
  guard: (record: DispatchRecord | undefined) => record is DispatchRecord,
  transform: (record: DispatchRecord) => DispatchRecord,
) {
  const record = loadDispatchState(root).records[issueId];
  if (!guard(record)) {
    return false;
  }

  saveDispatchRecord(root, transform(record));
  return true;
}

function markReviewLaunchFailed(root: string, issueId: string, timestamp: string, detail: string) {
  const updated = updateLatestRecord(
    root,
    issueId,
    (record): record is DispatchRecord => record !== undefined,
    (record) => applySentinelOperationalFailure(record, { timestamp, errorMessage: detail }),
  );
  if (!updated) {
    return;
  }

  writePhaseLog(root, {
    timestamp,
    phase: "dispatch",
    issueId,
    action: "sentinel_review_completed",
    outcome: "failed",
    detail,
  });
}

function clearStaleImplementedReviewAgent(root: string, issueId: string, timestamp: string) {
  const cleared = updateLatestRecord(
    root,
    issueId,
    (record): record is DispatchRecord =>
      record?.stage === "implemented" && record.runningAgent?.caste === "sentinel",
    (record) => ({
      ...record,
      runningAgent: null,
      updatedAt: timestamp,
    }),
  );
  if (cleared) {
    writePhaseLog(root, {
      timestamp,
      phase: "dispatch",
      issueId,
      action: "stale_review_agent_cleared",
      outcome: "implemented",
    });
  }
  return cleared;
}

async function launchSentinelSession(context: CycleContext, issueId: string) {
  const { root, timestamp } = context;
  const launched = await context.runtime.launch({
    root,
    issueId,
    title: issueId,
    caste: "sentinel",
    stage: "reviewing",
  });
  const marked = updateLatestRecord(root, issueId, isReviewStage, (record) => ({
    ...record,
    stage: "reviewing",
    runningAgent: {
      caste: "sentinel",
      sessionId: launched.sessionId,
      startedAt: launched.startedAt,
    },
    cooldownUntil: null,
    sessionProvenanceId: context.sessionProvenanceId,
    updatedAt: timestamp,
  }));
  if (!marked) {
    return false;
  }

  writePhaseLog(root, {
    timestamp,
    phase: "dispatch",
    issueId,
    action: "launch_sentinel",
    outcome: "running",
    sessionId: launched.sessionId,
    detail: JSON.stringify({
      caste: "sentinel",
      stage: "reviewing",
    }),
  });
  return true;
}

async function runInlineReview(
  context: CycleContext,
  issueId: string,
  launchPreMergeReview: NonNullable<RunLoopPhaseOptions["launchPreMergeReview"]>,
) {
  const { root, timestamp } = context;
  const marked = updateLatestRecord(root, issueId, isReviewStage, (record) => ({
    ...record,
    stage: "reviewing",
    updatedAt: timestamp,
  }));
  if (marked) {
    await launchPreMergeReview({ root, issueId, timestamp });
  }
  return marked;
}

/**
 * Starts Sentinel for `implemented` work within capacity. Stranded `reviewing`
 * records are recovered from a durable verdict first.
 */
async function runPreMergeReviews(
  context: CycleContext,
  launchPreMergeReview?: RunLoopPhaseOptions["launchPreMergeReview"],
): Promise<void> {
  const { root, config, timestamp } = context;
  const initialState = loadDispatchState(root);
  const activeAgentCount = countRunningAgents(initialState);
  const activeSentinelCount = countRunningAgents(initialState, "sentinel");
  let reservedAgents = 0;
  let reservedSentinels = 0;
  const reviewCandidates = Object.values(initialState.records)
    .filter((record) => isReviewStage(record) && !isRecordCoolingDown(record, timestamp));

  for (const record of reviewCandidates) {
    if (ACTIVE_PRE_MERGE_REVIEWS.has(record.issueId)) {
      continue;
    }
    if (recoverReviewingRecord(root, record.issueId, timestamp)) {
      continue;
    }
    if (clearStaleImplementedReviewAgent(root, record.issueId, timestamp)) {
      continue;
    }
    if (record.runningAgent) {
      continue;
    }
    if (
      activeAgentCount + reservedAgents >= config.concurrency.max_agents
      || activeSentinelCount + reservedSentinels >= config.concurrency.max_sentinels
    ) {
      continue;
    }

    ACTIVE_PRE_MERGE_REVIEWS.add(record.issueId);
    try {
      const started = launchPreMergeReview
        ? await runInlineReview(context, record.issueId, launchPreMergeReview)
        : await launchSentinelSession(context, record.issueId);
      if (started) {
        reservedAgents += 1;
        reservedSentinels += 1;
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      markReviewLaunchFailed(root, record.issueId, timestamp, detail);
    } finally {
      ACTIVE_PRE_MERGE_REVIEWS.delete(record.issueId);
    }
  }
}

function isAwaitingJanus(record: DispatchRecord | undefined): record is DispatchRecord {
  return record?.stage === "resolving_integration" && record.runningAgent === null;
}

function markJanusLaunchFailed(root: string, issueId: string, timestamp: string, detail: string) {
  const updated = updateLatestRecord(
    root,
    issueId,
    isAwaitingJanus,
    (record) => applyOperationalFailure(record, { timestamp, errorMessage: detail }),
  );
  if (updated) {
    writePhaseLog(root, {
      timestamp,
      phase: "dispatch",
      issueId,
      action: "launch_janus",
      outcome: "failed",
      detail,
    });
  }
}

/**
 * Starts Janus for merge-escalated (`resolving_integration`) work within
 * capacity. Janus runs as an adapter session like every other caste and the
 * reaper settles it, so the merge queue never waits on model work.
 */
async function launchJanusResolutions(context: CycleContext): Promise<void> {
  const { root, config, timestamp } = context;
  const state = loadDispatchState(root);
  let activeAgents = countRunningAgents(state);
  let activeJanus = countRunningAgents(state, "janus");

  for (const record of Object.values(state.records)) {
    if (!isAwaitingJanus(record) || isRecordCoolingDown(record, timestamp)) {
      continue;
    }
    if (
      activeAgents >= config.concurrency.max_agents
      || activeJanus >= config.concurrency.max_janus
    ) {
      return;
    }

    try {
      const launched = await context.runtime.launch({
        root,
        issueId: record.issueId,
        title: record.issueId,
        caste: "janus",
        stage: "resolving_integration",
      });
      const marked = updateLatestRecord(root, record.issueId, isAwaitingJanus, (latest) => ({
        ...latest,
        runningAgent: {
          caste: "janus",
          sessionId: launched.sessionId,
          startedAt: launched.startedAt,
        },
        sessionProvenanceId: context.sessionProvenanceId,
        updatedAt: timestamp,
      }));
      if (!marked) {
        continue;
      }
      activeAgents += 1;
      activeJanus += 1;
      writePhaseLog(root, {
        timestamp,
        phase: "dispatch",
        issueId: record.issueId,
        action: "launch_janus",
        outcome: "running",
        sessionId: launched.sessionId,
        detail: JSON.stringify({
          caste: "janus",
          stage: "resolving_integration",
        }),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      markJanusLaunchFailed(root, record.issueId, timestamp, detail);
    }
  }
}

/** Runs one loop phase directly (terminal `aegis poll|dispatch|monitor|reap`). */
export async function runLoopPhase(
  root = process.cwd(),
  phase: LoopPhase,
  options: RunLoopPhaseOptions = {},
): Promise<LoopPhaseResult> {
  const context = createCycleContext(root, options, "direct-command");

  if (phase === "poll") {
    const snapshot = await pollReadyWork({
      dispatchState: loadDispatchState(root),
      tracker: createTrackerClient(),
      root,
    });
    const readyIssueIds = snapshot.readyIssues.map((issue) => issue.id);
    logPoll(context, readyIssueIds);
    return {
      phase,
      readyIssueIds,
    };
  }

  if (phase === "dispatch") {
    const result = await runDispatchPipeline(context);
    return {
      phase,
      readyIssueIds: result.readyIssueIds,
      dispatched: result.dispatched,
      skipped: result.skipped,
      failed: result.failed,
    };
  }

  if (phase === "monitor") {
    const result = await runMonitorPipeline(context);
    return {
      phase,
      warnings: result.warnings,
      killList: result.killList,
      readyToReap: result.readyToReap,
    };
  }

  const dispatchState = loadDispatchState(root);
  const result = await runReapPipeline(
    context,
    listRunningRecords(dispatchState).map((record) => record.issueId),
    dispatchState,
  );
  return {
    phase,
    completed: result.completed,
    failed: result.failed,
  };
}

/**
 * One daemon tick: poll -> triage -> dispatch -> monitor -> reap, then launch
 * Sentinel reviews and Janus resolutions, and enqueue Sentinel-passed work.
 */
export async function runDaemonCycle(
  root = process.cwd(),
  options: RunLoopPhaseOptions = {},
): Promise<void> {
  const context = createCycleContext(root, options, "daemon");
  const dispatchResult = await runDispatchPipeline(context);
  const monitorResult = await runMonitorPipeline(context, dispatchResult.dispatchState);

  await runReapPipeline(context, monitorResult.readyToReap, dispatchResult.dispatchState);
  await runPreMergeReviews(context, options.launchPreMergeReview);
  await launchJanusResolutions(context);
  autoEnqueueImplementedIssuesForMerge(root, context.timestamp);
}
