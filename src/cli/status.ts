import { isProcessRunning, readRuntimeState } from "./runtime-state.js";
import { listRunningRecords, loadDispatchState, type DispatchState } from "../core/dispatch-state.js";
import { hasExhaustedOperationalRetries } from "../core/failure-policy.js";
import { resolveIdleSeconds } from "../core/monitor.js";
import { loadMergeQueueState, type MergeQueueItemStatus } from "../merge/merge-state.js";
import { readLastSessionActivity, readSessionReport } from "../runtime/session-report.js";
import { createTrackerClient } from "../tracker/create-tracker.js";
import type { TrackerClient } from "../tracker/tracker.js";
import { recoverStaleRuntimeState } from "./runtime-recovery.js";

export interface TerminalOperationalFailure {
  issue_id: string;
  operational_failure_kind: string | null;
  failure_count: number;
  consecutive_failures: number;
  failure_transcript_ref: string | null;
}

export interface ActiveSessionStatus {
  issue_id: string;
  caste: string;
  stage: string;
  session_id: string;
  started_at: string;
  last_activity_at: string | null;
  /** Seconds since the last adapter activity; what the stuck monitor measures. */
  idle_seconds: number | null;
  last_activity: string | null;
}

export interface StatusSnapshot {
  server_state: "running" | "stopped";
  mode: "auto" | "paused";
  active_agents: number;
  queue_depth: number;
  uptime_ms: number;
  terminal_operational_failures: TerminalOperationalFailure[];
  sessions: ActiveSessionStatus[];
  /** Dispatch record count per stage. */
  stages: Record<string, number>;
  /** Merge queue item count per status, or null when the queue file is unreadable. */
  merge_queue: Record<MergeQueueItemStatus, number> | null;
}

export interface GetAegisStatusOptions {
  tracker?: Pick<TrackerClient, "listReadyIssues">;
  isProcessRunning?: (pid: number) => boolean;
  recoveryProvenanceId?: string;
  now?: string;
}

const DEFAULT_SNAPSHOT = {
  server_state: "stopped",
  mode: "auto",
  active_agents: 0,
  queue_depth: 0,
  uptime_ms: 0,
} as const;

function calculateUptimeMs(startedAt: string) {
  const startedEpoch = Date.parse(startedAt);
  if (Number.isNaN(startedEpoch)) {
    return 0;
  }

  return Math.max(0, Date.now() - startedEpoch);
}

function isActiveDispatchRecord(record: ReturnType<typeof loadDispatchState>["records"][string]) {
  if (record.runningAgent !== null) {
    return true;
  }

  return record.stage === "reviewing" && record.sentinelVerdictRef === null;
}

function collectTerminalOperationalFailures(
  dispatchState: ReturnType<typeof loadDispatchState>,
): TerminalOperationalFailure[] {
  return Object.values(dispatchState.records)
    .filter((record) =>
      record.stage === "failed_operational"
      && record.runningAgent === null
      && hasExhaustedOperationalRetries(record.consecutiveFailures))
    .map((record) => ({
      issue_id: record.issueId,
      operational_failure_kind: record.operationalFailureKind ?? null,
      failure_count: record.failureCount,
      consecutive_failures: record.consecutiveFailures,
      failure_transcript_ref: record.failureTranscriptRef ?? null,
    }))
    .sort((left, right) => left.issue_id.localeCompare(right.issue_id));
}

function collectActiveSessions(root: string, dispatchState: DispatchState, nowMs: number): ActiveSessionStatus[] {
  return listRunningRecords(dispatchState)
    .map((record) => {
      const agent = record.runningAgent!;
      const lastActivityAt = readSessionReport(root, agent.sessionId)?.lastActivityAt ?? null;
      return {
        issue_id: record.issueId,
        caste: agent.caste,
        stage: record.stage,
        session_id: agent.sessionId,
        started_at: agent.startedAt,
        last_activity_at: lastActivityAt,
        idle_seconds: resolveIdleSeconds(agent.startedAt, lastActivityAt, nowMs),
        last_activity: readLastSessionActivity(root, agent.sessionId),
      };
    })
    .sort((left, right) => left.issue_id.localeCompare(right.issue_id));
}

function countStages(dispatchState: DispatchState) {
  const counts: Record<string, number> = {};
  for (const record of Object.values(dispatchState.records)) {
    counts[record.stage] = (counts[record.stage] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function countMergeQueue(root: string): StatusSnapshot["merge_queue"] {
  try {
    const counts = { queued: 0, merging: 0, merged: 0, failed: 0 };
    for (const item of loadMergeQueueState(root).items) {
      counts[item.status] += 1;
    }
    return counts;
  } catch {
    return null;
  }
}

export async function getAegisStatus(
  root = process.cwd(),
  options: GetAegisStatusOptions = {},
): Promise<StatusSnapshot> {
  recoverStaleRuntimeState(root, {
    isProcessRunning: options.isProcessRunning,
    recoveryProvenanceId: options.recoveryProvenanceId ?? "status-recovery",
    now: options.now,
  });
  const recoveredRuntime = readRuntimeState(root);
  const dispatchState = loadDispatchState(root);
  const terminalOperationalFailures = collectTerminalOperationalFailures(dispatchState);
  const isLiveDaemon = recoveredRuntime
    ? recoveredRuntime.server_state !== "stopped"
      && (options.isProcessRunning ?? isProcessRunning)(recoveredRuntime.pid)
    : false;
  const activeAgentCount = isLiveDaemon
    ? Object.values(dispatchState.records).filter(
      (record) => isActiveDispatchRecord(record),
    ).length
    : 0;
  const tracker = options.tracker ?? createTrackerClient();
  let queueDepth = 0;

  try {
    queueDepth = (await tracker.listReadyIssues(root)).length;
  } catch {
    queueDepth = 0;
  }

  const planes = {
    terminal_operational_failures: terminalOperationalFailures,
    sessions: isLiveDaemon
      ? collectActiveSessions(root, dispatchState, options.now ? Date.parse(options.now) : Date.now())
      : [],
    stages: countStages(dispatchState),
    merge_queue: countMergeQueue(root),
  };

  if (isLiveDaemon && recoveredRuntime) {
    return {
      server_state: "running",
      mode: recoveredRuntime.mode,
      active_agents: activeAgentCount,
      queue_depth: queueDepth,
      uptime_ms: calculateUptimeMs(recoveredRuntime.started_at),
      ...planes,
    };
  }

  return {
    ...DEFAULT_SNAPSHOT,
    mode: recoveredRuntime?.mode ?? DEFAULT_SNAPSHOT.mode,
    active_agents: activeAgentCount,
    queue_depth: queueDepth,
    ...planes,
  };
}

export function formatStatusSnapshot(snapshot: StatusSnapshot) {
  return JSON.stringify(snapshot);
}
