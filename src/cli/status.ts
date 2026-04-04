import type {
  OrchestrationMode,
  ServerLifecycleState,
} from "../server/routes.js";

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
