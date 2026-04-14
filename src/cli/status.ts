import { isProcessRunning, readRuntimeState } from "./runtime-state.js";
import { loadDispatchState } from "../core/dispatch-state.js";
import { BeadsTrackerClient } from "../tracker/beads-tracker.js";

export const STATUS_COMMAND_NAME = "status";

export interface StatusSnapshot {
  server_state: "running" | "stopped";
  mode: "auto" | "paused";
  active_agents: number;
  queue_depth: number;
  uptime_ms: number;
}

export interface StatusCommandContract {
  command: typeof STATUS_COMMAND_NAME;
  snapshot_fields: readonly (keyof StatusSnapshot)[];
}

export interface GetAegisStatusOptions {
  tracker?: Pick<BeadsTrackerClient, "listReadyIssues">;
}

const DEFAULT_SNAPSHOT: StatusSnapshot = {
  server_state: "stopped",
  mode: "auto",
  active_agents: 0,
  queue_depth: 0,
  uptime_ms: 0,
};

function calculateUptimeMs(startedAt: string) {
  const startedEpoch = Date.parse(startedAt);
  if (Number.isNaN(startedEpoch)) {
    return 0;
  }

  return Math.max(0, Date.now() - startedEpoch);
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
    ],
  };
}

export async function getAegisStatus(
  root = process.cwd(),
  options: GetAegisStatusOptions = {},
): Promise<StatusSnapshot> {
  const recoveredRuntime = readRuntimeState(root);
  const dispatchState = loadDispatchState(root);
  const activeAgentCount = Object.values(dispatchState.records).filter(
    (record) => record.runningAgent !== null,
  ).length;
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
      active_agents: activeAgentCount,
      queue_depth: queueDepth,
    };
  }

  const isRunning = isProcessRunning(recoveredRuntime.pid);

  if (recoveredRuntime.server_state !== "stopped" && isRunning) {
    return {
      server_state: "running",
      mode: recoveredRuntime.mode,
      active_agents: activeAgentCount,
      queue_depth: queueDepth,
      uptime_ms: calculateUptimeMs(recoveredRuntime.started_at),
    };
  }

  return {
    ...DEFAULT_SNAPSHOT,
    mode: recoveredRuntime.mode,
    active_agents: activeAgentCount,
    queue_depth: queueDepth,
  };
}

export function formatStatusSnapshot(snapshot: StatusSnapshot) {
  return JSON.stringify(snapshot);
}
