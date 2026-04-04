import type {
  OrchestrationMode,
  ServerLifecycleState,
} from "../server/routes.js";
import { isAegisOwned, isProcessRunning, readRuntimeState } from "./runtime-state.js";

export const STATUS_COMMAND_NAME = "status";

export interface StatusSnapshot {
  server_state: ServerLifecycleState;
  mode: OrchestrationMode;
  active_agents: number;
  queue_depth: number;
  uptime_ms: number;
}

export interface StatusCommandContract {
  command: typeof STATUS_COMMAND_NAME;
  snapshot_fields: readonly (keyof StatusSnapshot)[];
}

const DEFAULT_SNAPSHOT: StatusSnapshot = {
  server_state: "stopped",
  mode: "conversational",
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

export async function getAegisStatus(root = process.cwd()): Promise<StatusSnapshot> {
  const recoveredRuntime = readRuntimeState(root);

  if (!recoveredRuntime) {
    return DEFAULT_SNAPSHOT;
  }

  const isRunning = recoveredRuntime.server_token
    ? await isAegisOwned(recoveredRuntime)
    : isProcessRunning(recoveredRuntime.pid);

  if (recoveredRuntime.server_state !== "stopped" && isRunning) {
    return {
      server_state: "running",
      mode: recoveredRuntime.mode,
      active_agents: 0,
      queue_depth: 0,
      uptime_ms: calculateUptimeMs(recoveredRuntime.started_at),
    };
  }

  return {
    ...DEFAULT_SNAPSHOT,
    mode: recoveredRuntime.mode,
  };
}

export function formatStatusSnapshot(snapshot: StatusSnapshot) {
  return JSON.stringify(snapshot);
}
