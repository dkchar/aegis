import { isProcessRunning, readRuntimeState, type RuntimeStateRecord } from "./runtime-state.js";

export interface DaemonRoutingOptions {
  readRuntimeState?: (root?: string) => RuntimeStateRecord | null;
  isProcessRunning?: (pid: number) => boolean;
}

export function isDaemonOwned(
  runtimeState: RuntimeStateRecord | null,
  processRunning: (pid: number) => boolean = isProcessRunning,
): runtimeState is RuntimeStateRecord {
  return runtimeState !== null
    && runtimeState.server_state === "running"
    && processRunning(runtimeState.pid);
}

/**
 * Direct commands must not race a live daemon over `.aegis` state. When a
 * daemon owns the project, the command is routed to it; otherwise it runs
 * in-process.
 */
export async function routeToDaemonOrRunLocal<T>(
  root: string,
  options: DaemonRoutingOptions,
  runLocal: () => Promise<T>,
  routeToDaemon: (targetPid: number) => Promise<T>,
): Promise<T> {
  const runtimeState = (options.readRuntimeState ?? readRuntimeState)(root);
  if (isDaemonOwned(runtimeState, options.isProcessRunning ?? isProcessRunning)) {
    return routeToDaemon(runtimeState.pid);
  }

  return runLocal();
}

export function formatCommandResult(result: unknown) {
  return JSON.stringify(result);
}
