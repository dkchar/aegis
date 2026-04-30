import { isProcessRunning, readRuntimeState } from "./runtime-state.js";
import { loadDispatchState } from "../core/dispatch-state.js";
import { hasExhaustedOperationalRetries } from "../core/failure-policy.js";
import { BeadsTrackerClient } from "../tracker/beads-tracker.js";
import { recoverStaleRuntimeState } from "./runtime-recovery.js";

export const STATUS_COMMAND_NAME = "status";

export interface TerminalOperationalFailure {
  issue_id: string;
  operational_failure_kind: string | null;
  failure_count: number;
  consecutive_failures: number;
  failure_transcript_ref: string | null;
}

export interface StatusSnapshot {
  server_state: "running" | "stopped";
  mode: "auto" | "paused";
  active_agents: number;
  queue_depth: number;
  uptime_ms: number;
  terminal_operational_failures: TerminalOperationalFailure[];
}

export interface StatusCommandContract {
  command: typeof STATUS_COMMAND_NAME;
  snapshot_fields: readonly (keyof StatusSnapshot)[];
}

export interface GetAegisStatusOptions {
  tracker?: Pick<BeadsTrackerClient, "listReadyIssues">;
  isProcessRunning?: (pid: number) => boolean;
  recoveryProvenanceId?: string;
  now?: string;
}

const DEFAULT_SNAPSHOT: StatusSnapshot = {
  server_state: "stopped",
  mode: "auto",
  active_agents: 0,
  queue_depth: 0,
  uptime_ms: 0,
  terminal_operational_failures: [],
};

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

export function createStatusCommandContract(): StatusCommandContract {
  return {
    command: STATUS_COMMAND_NAME,
    snapshot_fields: [
      "server_state",
      "mode",
      "active_agents",
      "queue_depth",
      "uptime_ms",
      "terminal_operational_failures",
    ],
  };
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
  const tracker = options.tracker ?? new BeadsTrackerClient();
  let queueDepth = 0;

  try {
    queueDepth = (await tracker.listReadyIssues(root)).length;
  } catch {
    queueDepth = 0;
  }

  if (!recoveredRuntime) {
    return {
      ...DEFAULT_SNAPSHOT,
      queue_depth: queueDepth,
      terminal_operational_failures: terminalOperationalFailures,
    };
  }

  if (isLiveDaemon) {
    return {
      server_state: "running",
      mode: recoveredRuntime.mode,
      active_agents: activeAgentCount,
      queue_depth: queueDepth,
      uptime_ms: calculateUptimeMs(recoveredRuntime.started_at),
      terminal_operational_failures: terminalOperationalFailures,
    };
  }

  return {
    ...DEFAULT_SNAPSHOT,
    mode: recoveredRuntime.mode,
    active_agents: activeAgentCount,
    queue_depth: queueDepth,
    terminal_operational_failures: terminalOperationalFailures,
  };
}

export function formatStatusSnapshot(snapshot: StatusSnapshot) {
  return JSON.stringify(snapshot);
}
