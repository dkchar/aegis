import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

import { loadConfig } from "../config/load-config.js";
import { runDaemonCycle as defaultRunDaemonCycle, runLoopPhase } from "../core/loop-runner.js";
import {
  listRunningRecords,
  loadDispatchState,
  releaseStoppedRunningRecords,
  reconcileDispatchState,
  saveDispatchState,
} from "../core/dispatch-state.js";
import type { AegisConfig } from "../config/schema.js";
import {
  clearRuntimeCommandArtifacts,
  clearRuntimeCommandRequest,
  describeRuntimeCommandRequest,
  takeNextRuntimeCommandRequest,
  writeRuntimeCommandResponse,
  type RuntimeCasteAction,
  type RuntimeCommandRequest,
  type RuntimeMergeAction,
} from "./runtime-command.js";
import { runLocalCasteCommand } from "./caste-command.js";
import { createAgentRuntime } from "../runtime/dispatch-runtime.js";
import { runMergeNext as defaultRunMergeNext } from "../merge/merge-next.js";
import {
  formatStartupPreflight,
  runStartupPreflight,
  StartupPreflightBlockedError,
  type StartupPreflightProbeResult,
} from "./startup-preflight.js";
import {
  probeAgoraTrackerBackend,
  verifyConfiguredModelRefs,
  verifyGitRepository,
  verifyRuntimeAdapter,
  verifyRuntimeLocalConfig,
  verifyRuntimeStatePaths,
} from "./startup-probes.js";
import { STOP_COMMAND_REASONS } from "./stop.js";
import {
  clearStopRequest,
  isProcessRunning,
  readStopRequest,
  writeRuntimeState,
  type RuntimeStateRecord,
} from "./runtime-state.js";
import { recoverStaleRuntimeState } from "./runtime-recovery.js";

const STOP_REQUEST_POLL_MS = 150;
const HEARTBEAT_LOG_INTERVAL_MS = 60_000;

export type DaemonStopReason = "manual" | "signal" | "shutdown" | "provider_usage_limit";

let registeredSignalHandlers:
  | {
      sigint: () => void;
      sigterm: () => void;
    }
  | undefined;

export interface StartCommandOverrides {}

export interface StartRuntimeController {
  stop(reason?: DaemonStopReason): Promise<void>;
}

export interface StartResult {
  root: string;
  mode: "auto";
  /** Configured runtime adapter name. */
  adapter: string;
  runtime: StartRuntimeController;
}

export interface StartCommandOptions {
  verifyTracker?: (root: string) => void;
  verifyGitRepo?: () => void;
  probeTrackerBackend?: (root: string) => StartupPreflightProbeResult;
  verifyRuntimeLocalConfig?: (config: AegisConfig) => StartupPreflightProbeResult;
  verifyModelRefs?: (config: AegisConfig) => StartupPreflightProbeResult;
  registerSignalHandlers?: boolean;
  runDaemonCycle?: (root: string) => Promise<void>;
  runCasteCommand?: (root: string, action: RuntimeCasteAction, issueId: string) => Promise<unknown>;
  runMergeCommand?: (root: string, action: RuntimeMergeAction) => Promise<unknown>;
}

export function parseStartOverrides(argv: readonly string[]): StartCommandOverrides {
  if (argv.length > 0) {
    throw new Error(`Unknown start override flag: ${argv[0]}`);
  }

  return {};
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return String(error);
}

export function verifyTrackerRepository(
  root: string,
  probe: (root: string) => StartupPreflightProbeResult = probeAgoraTrackerBackend,
) {
  const repoProbe = probe(root);
  if (!repoProbe.ok) {
    throw new Error(repoProbe.detail ?? "Tracker backend check failed.");
  }
}

function toRunningRuntimeState(pid: number): RuntimeStateRecord {
  return {
    schema_version: 1,
    pid,
    server_state: "running",
    mode: "auto",
    started_at: new Date().toISOString(),
  };
}

function toStoppedRuntimeState(
  runningState: RuntimeStateRecord,
  stopReason: DaemonStopReason,
): RuntimeStateRecord {
  return {
    ...runningState,
    server_state: "stopped",
    mode: stopReason === "provider_usage_limit" ? "paused" : runningState.mode,
    stopped_at: new Date().toISOString(),
    last_stop_reason: stopReason,
  };
}

function hasProviderUsageLimitFailure(root: string) {
  return Object.values(loadDispatchState(root).records)
    .some((record) => record.stage === "failed_operational"
      && record.operationalFailureKind === "provider_usage_limit");
}

function exitAfterStop(stop: () => Promise<void>) {
  void stop().then(
    () => {
      process.exit(0);
    },
    (error) => {
      console.error(`Failed to stop Aegis gracefully: ${toErrorMessage(error)}`);
      process.exit(1);
    },
  );
}

function registerLifecycleSignalHandlers(stop: () => Promise<void>) {
  if (registeredSignalHandlers) {
    process.off("SIGINT", registeredSignalHandlers.sigint);
    process.off("SIGTERM", registeredSignalHandlers.sigterm);
  }

  const sigint = () => exitAfterStop(stop);
  const sigterm = () => exitAfterStop(stop);
  process.on("SIGINT", sigint);
  process.on("SIGTERM", sigterm);
  registeredSignalHandlers = { sigint, sigterm };
}

function appendDaemonLog(repoRoot: string, message: string) {
  const logsDirectory = path.join(repoRoot, ".aegis", "logs");
  mkdirSync(logsDirectory, { recursive: true });
  appendFileSync(path.join(logsDirectory, "daemon.log"), `${new Date().toISOString()} ${message}\n`, "utf8");
}

function runPreflight(repoRoot: string, options: StartCommandOptions) {
  const verifyTracker = options.verifyTracker ?? ((candidateRoot: string) => {
    verifyTrackerRepository(candidateRoot);
  });
  const trackerBackendProbe = options.probeTrackerBackend ?? probeAgoraTrackerBackend;
  let config: AegisConfig | undefined;

  const preflight = runStartupPreflight(repoRoot, {
    verifyGitRepo: options.verifyGitRepo ?? (() => verifyGitRepository(repoRoot)),
    probeTrackerBackend: () => {
      const backendProbe = trackerBackendProbe(repoRoot);
      if (!backendProbe.ok) {
        return backendProbe;
      }
      try {
        verifyTracker(repoRoot);
        return {
          ok: true,
          detail: "Tracker repository is initialized.",
        };
      } catch (error) {
        return {
          ok: false,
          detail: toErrorMessage(error),
          fix: "initialize the configured tracker for this repository",
        };
      }
    },
    loadConfig: () => {
      config = loadConfig(repoRoot);
      return config;
    },
    verifyRuntimeAdapter,
    verifyRuntimeLocalConfig: options.verifyRuntimeLocalConfig
      ?? ((loadedConfig) => verifyRuntimeLocalConfig(repoRoot, loadedConfig)),
    verifyModelRefs: options.verifyModelRefs ?? verifyConfiguredModelRefs,
    verifyRuntimeStatePaths,
  });

  if (preflight.overall === "blocked") {
    console.error(formatStartupPreflight(preflight));
    throw new StartupPreflightBlockedError(preflight);
  }

  return config ?? loadConfig(repoRoot);
}

/**
 * Starts the terminal daemon: preflight, recover state from any dead daemon,
 * then run `runDaemonCycle` every poll interval while serving direct-command
 * requests and stop requests between cycles.
 */
export async function startAegis(
  root = process.cwd(),
  overrides: StartCommandOverrides = {},
  options: StartCommandOptions = {},
): Promise<StartResult> {
  void overrides;
  const repoRoot = path.resolve(root);
  const resolvedConfig = runPreflight(repoRoot, options);

  const recoveredRuntime = recoverStaleRuntimeState(repoRoot, {
    recoveryProvenanceId: String(process.pid),
  }).runtimeState;
  if (
    recoveredRuntime
    && recoveredRuntime.server_state !== "stopped"
    && isProcessRunning(recoveredRuntime.pid)
  ) {
    throw new Error(
      `Aegis is already running on pid ${recoveredRuntime.pid}.`,
    );
  }

  let runningState = toRunningRuntimeState(process.pid);
  let hasStopped = false;
  let cycleInFlight = false;
  const timers: NodeJS.Timeout[] = [];
  const runDaemonCycle = options.runDaemonCycle ?? ((candidateRoot: string) =>
    defaultRunDaemonCycle(candidateRoot, {
      sessionProvenanceId: String(process.pid),
    }));
  const runCasteCommand = options.runCasteCommand ?? runLocalCasteCommand;
  const runMergeCommand = options.runMergeCommand ?? ((candidateRoot: string, action: RuntimeMergeAction) =>
    action === "next" ? defaultRunMergeNext(candidateRoot) : Promise.resolve(null));

  clearStopRequest(repoRoot);
  clearRuntimeCommandArtifacts(repoRoot);
  saveDispatchState(
    repoRoot,
    reconcileDispatchState(loadDispatchState(repoRoot), String(process.pid)),
  );
  writeRuntimeState(runningState, repoRoot);
  appendDaemonLog(
    repoRoot,
    `[daemon][start] runtime=${resolvedConfig.runtime} poll_interval_seconds=${resolvedConfig.thresholds.poll_interval_seconds}`,
  );
  if (resolvedConfig.runtime === "scripted") {
    const warning = "runtime=scripted is the deterministic test runtime: it fakes agent work and merges. "
      + "Set a live adapter (claude, codex, pi) in .aegis/config.json for real work.";
    appendDaemonLog(repoRoot, `[daemon][warning] ${warning}`);
    console.warn(`Aegis: ${warning}`);
  }

  const runtime: StartRuntimeController = {
    async stop(reason = "shutdown") {
      if (hasStopped) {
        return;
      }

      hasStopped = true;
      for (const timer of timers.splice(0)) {
        clearInterval(timer);
      }
      clearStopRequest(repoRoot);
      clearRuntimeCommandArtifacts(repoRoot);
      const stopRuntime = createAgentRuntime(resolvedConfig.runtime);
      for (const record of listRunningRecords(loadDispatchState(repoRoot))) {
        await stopRuntime.terminate(
          repoRoot,
          record.runningAgent!.sessionId,
          `Daemon stopped: ${reason}.`,
        );
      }
      saveDispatchState(
        repoRoot,
        releaseStoppedRunningRecords(
          loadDispatchState(repoRoot),
          String(process.pid),
        ),
      );
      runningState = toStoppedRuntimeState(runningState, reason);
      writeRuntimeState(runningState, repoRoot);
      appendDaemonLog(repoRoot, `[daemon][stop] reason=${reason}`);
    },
  };

  const handleExternalStopRequest = () => {
    const request = readStopRequest(repoRoot);
    if (!request || request.pid !== process.pid) {
      return;
    }

    const reason = STOP_COMMAND_REASONS.includes(
      request.reason as (typeof STOP_COMMAND_REASONS)[number],
    )
      ? (request.reason as (typeof STOP_COMMAND_REASONS)[number])
      : "manual";
    exitAfterStop(() => runtime.stop(reason));
  };

  const executeRuntimeCommand = (request: RuntimeCommandRequest) => {
    if (request.command_kind === "caste") {
      return runCasteCommand(repoRoot, request.action, request.issue_id);
    }
    if (request.command_kind === "merge") {
      return runMergeCommand(repoRoot, request.action);
    }
    return runLoopPhase(repoRoot, request.phase, {
      sessionProvenanceId: String(process.pid),
    });
  };

  const handleRuntimeCommandRequest = async () => {
    if (cycleInFlight || hasStopped) {
      return;
    }
    const request = takeNextRuntimeCommandRequest(repoRoot, process.pid);
    if (!request) {
      return;
    }

    cycleInFlight = true;
    const baseResponse = {
      request_id: request.request_id,
      command_kind: request.command_kind,
      ...describeRuntimeCommandRequest(request),
    };
    try {
      const result = await executeRuntimeCommand(request);
      writeRuntimeCommandResponse(repoRoot, {
        ...baseResponse,
        completed_at: new Date().toISOString(),
        result,
      });
    } catch (error) {
      writeRuntimeCommandResponse(repoRoot, {
        ...baseResponse,
        completed_at: new Date().toISOString(),
        error: toErrorMessage(error),
      });
    } finally {
      clearRuntimeCommandRequest(repoRoot, request.request_id);
      cycleInFlight = false;
    }
  };

  const runCycleSafely = async () => {
    if (cycleInFlight || hasStopped) {
      return;
    }

    cycleInFlight = true;
    try {
      await runDaemonCycle(repoRoot);
      if (hasProviderUsageLimitFailure(repoRoot)) {
        await runtime.stop("provider_usage_limit");
        return;
      }
      await runMergeCommand(repoRoot, "next");
    } catch (error) {
      appendDaemonLog(repoRoot, `[daemon][cycle_error] ${toErrorMessage(error)}`);
    } finally {
      cycleInFlight = false;
    }
  };

  timers.push(setInterval(() => {
    handleExternalStopRequest();
    void handleRuntimeCommandRequest();
  }, STOP_REQUEST_POLL_MS));
  timers.push(setInterval(() => {
    appendDaemonLog(repoRoot, "[daemon][heartbeat] mode=auto");
  }, HEARTBEAT_LOG_INTERVAL_MS));

  await runCycleSafely();
  if (!hasStopped) {
    timers.push(setInterval(() => {
      void runCycleSafely();
    }, resolvedConfig.thresholds.poll_interval_seconds * 1_000));
  }

  if (options.registerSignalHandlers !== false) {
    registerLifecycleSignalHandlers(() => runtime.stop("signal"));
  }

  return {
    root: repoRoot,
    mode: "auto",
    adapter: resolvedConfig.runtime,
    runtime,
  };
}
