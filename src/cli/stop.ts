import {
  clearStopRequest,
  isAegisOwned,
  isProcessRunning,
  readRuntimeState,
  writeStopRequest,
  writeRuntimeState,
} from "./runtime-state.js";

export const STOP_COMMAND_NAME = "stop";
export const STOP_COMMAND_REASONS = [
  "manual",
  "signal",
  "shutdown",
] as const;
export const DEFAULT_STOP_GRACEFUL_TIMEOUT_MS = 60_000;

export type StopCommandReason = (typeof STOP_COMMAND_REASONS)[number];

export interface StopCommandContract {
  command: typeof STOP_COMMAND_NAME;
  graceful_timeout_ms: number;
  reasons: readonly StopCommandReason[];
}

export interface StopResult {
  stopped: boolean;
  alreadyStopped: boolean;
  forced: boolean;
  reason: StopCommandReason;
}

function wait(durationMs: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

async function waitForExit(pid: number, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (!isProcessRunning(pid)) {
      return true;
    }
    await wait(100);
  }

  return !isProcessRunning(pid);
}

export function createStopCommandContract(
  gracefulTimeoutMs = DEFAULT_STOP_GRACEFUL_TIMEOUT_MS,
): StopCommandContract {
  return {
    command: STOP_COMMAND_NAME,
    graceful_timeout_ms: gracefulTimeoutMs,
    reasons: STOP_COMMAND_REASONS,
  };
}

export async function stopAegis(
  root = process.cwd(),
  reason: StopCommandReason = "manual",
  gracefulTimeoutMs = DEFAULT_STOP_GRACEFUL_TIMEOUT_MS,
): Promise<StopResult> {
  const recoveredRuntime = readRuntimeState(root);

  if (!recoveredRuntime || recoveredRuntime.server_state === "stopped") {
    return {
      stopped: true,
      alreadyStopped: true,
      forced: false,
      reason,
    };
  }

  const owned = recoveredRuntime.server_token
    ? await isAegisOwned(recoveredRuntime)
    : isProcessRunning(recoveredRuntime.pid);

  if (!owned) {
    clearStopRequest(root);
    writeRuntimeState(
      {
        ...recoveredRuntime,
        server_state: "stopped",
        stopped_at: new Date().toISOString(),
        last_stop_reason: reason,
      },
      root,
    );

    return {
      stopped: true,
      alreadyStopped: true,
      forced: false,
      reason,
    };
  }

  writeStopRequest(root, {
    pid: recoveredRuntime.pid,
    reason,
    requested_at: new Date().toISOString(),
  });
  let stoppedGracefully = await waitForExit(recoveredRuntime.pid, gracefulTimeoutMs);

  if (!stoppedGracefully && isProcessRunning(recoveredRuntime.pid)) {
    if (recoveredRuntime.server_token && !(await isAegisOwned(recoveredRuntime))) {
      stoppedGracefully = true;
    } else {
      process.kill(recoveredRuntime.pid, "SIGTERM");
      stoppedGracefully = await waitForExit(recoveredRuntime.pid, 5_000);
    }
  }
  let forced = false;

  if (!stoppedGracefully && isProcessRunning(recoveredRuntime.pid)) {
    if (recoveredRuntime.server_token && !(await isAegisOwned(recoveredRuntime))) {
      stoppedGracefully = true;
    } else {
      forced = true;
      process.kill(recoveredRuntime.pid, "SIGKILL");
      stoppedGracefully = await waitForExit(recoveredRuntime.pid, 2_000);
    }
  }

  clearStopRequest(root);
  if (!stoppedGracefully) {
    const stillOwned = recoveredRuntime.server_token
      ? await isAegisOwned(recoveredRuntime)
      : isProcessRunning(recoveredRuntime.pid);

    if (stillOwned) {
      throw new Error(
        `Failed to stop Aegis pid ${recoveredRuntime.pid}; process is still running after escalation.`,
      );
    }
  }
  writeRuntimeState(
    {
      ...recoveredRuntime,
      server_state: "stopped",
      stopped_at: new Date().toISOString(),
      last_stop_reason: reason,
    },
    root,
  );

  return {
    stopped: true,
    alreadyStopped: false,
    forced,
    reason,
  };
}
