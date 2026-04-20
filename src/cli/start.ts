import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { execFile, spawnSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { loadConfig } from "../config/load-config.js";
import { runCasteCommand as defaultRunCasteCommand } from "../core/caste-runner.js";
import { runDaemonCycle as defaultRunDaemonCycle, runLoopPhase } from "../core/loop-runner.js";
import {
  loadDispatchState,
  reconcileDispatchState,
  saveDispatchState,
} from "../core/dispatch-state.js";
import {
  AEGIS_DIRECTORY,
  RUNTIME_STATE_FILES,
  type AegisConfig,
} from "../config/schema.js";
import { BeadsTrackerClient } from "../tracker/beads-tracker.js";
import {
  clearRuntimeCommandArtifacts,
  clearRuntimeCommandRequest,
  readRuntimeCommandRequests,
  writeRuntimeCommandResponse,
  type RuntimeCasteAction,
  type RuntimeMergeAction,
  type RuntimeCommandRequest,
  type RuntimeCommandResponse,
} from "./runtime-command.js";
import { createCasteRuntime } from "../runtime/create-caste-runtime.js";
import { verifyConfiguredPiModels } from "../runtime/pi-model-config.js";
import { runMergeNext as defaultRunMergeNext } from "../merge/merge-next.js";
import { createSessionViewTracker, type SessionViewTracker } from "./session-view.js";
import {
  formatStartupPreflight,
  runStartupPreflight,
  StartupPreflightBlockedError,
  type StartupPreflightProbeResult,
} from "./startup-preflight.js";
import { STOP_COMMAND_REASONS } from "./stop.js";
import {
  clearStopRequest,
  isProcessRunning,
  readStopRequest,
  readRuntimeState,
  writeRuntimeState,
  type RuntimeStateRecord,
} from "./runtime-state.js";

export const START_COMMAND_NAME = "start";

export const START_OVERRIDE_FLAGS = ["--view-agent-sessions"] as const;

export const CANONICAL_LAUNCH_SEQUENCE = [
  "load_config",
  "verify_tracker",
  "verify_git_repo",
  "recover_dispatch_state",
  "start_terminal_daemon",
  "enter_auto_mode",
  "print_runtime_summary",
] as const;

export const CANONICAL_SHUTDOWN_SEQUENCE = [
  "stop_dispatch_loop",
  "stop_active_agents",
  "persist_runtime_state",
  "print_shutdown_summary",
] as const;

const STOP_REQUEST_POLL_MS = 150;
const HEARTBEAT_LOG_INTERVAL_MS = 5_000;

let registeredSignalHandlers:
  | {
      sigint: () => void;
      sigterm: () => void;
    }
  | undefined;

export type StartOverrideFlag = (typeof START_OVERRIDE_FLAGS)[number];
export type LaunchSequenceStep = (typeof CANONICAL_LAUNCH_SEQUENCE)[number];
export type ShutdownSequenceStep = (typeof CANONICAL_SHUTDOWN_SEQUENCE)[number];

export interface StartCommandOverrides {
  viewAgentSessions?: boolean;
}

export interface StartCommandContract {
  command: typeof START_COMMAND_NAME;
  overrides: readonly StartOverrideFlag[];
  launchSequence: readonly LaunchSequenceStep[];
  shutdownSequence: readonly ShutdownSequenceStep[];
}

export interface StartRuntimeController {
  stop(reason?: "manual" | "signal" | "shutdown"): Promise<void>;
}

export interface StartResult {
  root: string;
  mode: "auto";
  runtime: StartRuntimeController;
}

export interface StartCommandOptions {
  verifyTracker?: (root: string) => void;
  verifyGitRepo?: () => void;
  probeBeadsCli?: () => StartupPreflightProbeResult;
  verifyModelRefs?: (config: AegisConfig) => StartupPreflightProbeResult;
  registerSignalHandlers?: boolean;
  runDaemonCycle?: (root: string) => Promise<void>;
  runCasteCommand?: (root: string, action: RuntimeCasteAction, issueId: string) => Promise<unknown>;
  runMergeCommand?: (root: string, action: RuntimeMergeAction) => Promise<unknown>;
  createSessionViewTracker?: (root: string) => SessionViewTracker;
}

export interface TrackerProbeResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: NodeJS.ErrnoException | null;
}

export type TrackerProbe = (root: string) => TrackerProbeResult;

function parseStartOverrides(argv: readonly string[]): StartCommandOverrides {
  const overrides: StartCommandOverrides = {
    viewAgentSessions: false,
  };

  for (const flag of argv) {
    if (flag === "--view-agent-sessions") {
      overrides.viewAgentSessions = true;
      continue;
    }

    throw new Error(`Unknown start override flag: ${flag}`);
  }

  return overrides;
}

export { parseStartOverrides };

function runTrackerProbe(root: string): TrackerProbeResult {
  const trackerProbe = spawnSync("bd", ["ready", "--json"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });

  return {
    status: trackerProbe.status,
    stdout: trackerProbe.stdout ?? "",
    stderr: trackerProbe.stderr ?? "",
    error: trackerProbe.error ?? null,
  };
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return String(error);
}

function probeBeadsCli(): StartupPreflightProbeResult {
  const trackerProbe = spawnSync("bd", ["--help"], {
    encoding: "utf8",
    windowsHide: true,
  });
  const errorCode =
    trackerProbe.error && "code" in trackerProbe.error
      ? String(trackerProbe.error.code)
      : null;

  if (errorCode === "ENOENT") {
    return {
      ok: false,
      detail: "Beads CLI was not found. Install or fix `bd` before starting Aegis.",
      fix: "install the `bd` CLI and ensure it is available on PATH",
    };
  }

  if (trackerProbe.status !== 0) {
    const detail = (trackerProbe.stderr ?? trackerProbe.stdout ?? "").trim();

    return {
      ok: false,
      detail: detail.length > 0
        ? `Beads CLI did not execute cleanly. Details: ${detail}`
        : "Beads CLI did not execute cleanly.",
      fix: "run `bd --help` and fix the local Beads installation before starting Aegis",
    };
  }

  return {
    ok: true,
    detail: "Beads CLI is available.",
  };
}

function probeBeadsRepository(
  root: string,
  probe: TrackerProbe = runTrackerProbe,
): StartupPreflightProbeResult {
  const trackerProbe = probe(root);
  const errorCode =
    trackerProbe.error && "code" in trackerProbe.error
      ? String(trackerProbe.error.code)
      : null;

  if (errorCode === "ENOENT") {
    return {
      ok: false,
      detail: "Beads CLI was not found. Install or fix `bd` before starting Aegis.",
      fix: "install the `bd` CLI and ensure it is available on PATH",
    };
  }

  if (trackerProbe.status !== 0) {
    const detail = (trackerProbe.stderr || trackerProbe.stdout).trim();
    const suffix = detail.length > 0 ? ` Details: ${detail}` : "";

    return {
      ok: false,
      detail:
        "Beads tracker is not initialized or healthy for this repository. Run `bd init` (or `bd onboard`) before starting Aegis."
        + suffix,
      fix: "run `bd init` or `bd onboard` in this repository",
    };
  }

  return {
    ok: true,
    detail: "Beads tracker is initialized.",
  };
}

export function verifyTrackerRepository(
  root: string,
  probe: TrackerProbe = runTrackerProbe,
  probeCli: () => StartupPreflightProbeResult = probeBeadsCli,
) {
  const cliProbe = probeCli();
  if (!cliProbe.ok) {
    throw new Error(cliProbe.detail ?? "Beads CLI check failed.");
  }

  const repoProbe = probeBeadsRepository(root, probe);
  if (!repoProbe.ok) {
    throw new Error(repoProbe.detail ?? "Beads repository check failed.");
  }
}

function verifyGitRepository(root: string) {
  const gitProbe = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });

  if (gitProbe.status !== 0 || gitProbe.stdout.trim() !== "true") {
    throw new Error("Aegis start requires a git repository root.");
  }
}

function verifyRuntimeAdapter(config: AegisConfig): StartupPreflightProbeResult {
  if (config.runtime !== "pi" && config.runtime !== "scripted") {
    return {
      ok: false,
      detail: `Unsupported runtime adapter: ${config.runtime}`,
      fix: "set `.aegis/config.json` `runtime` to a supported adapter before starting Aegis",
    };
  }

  return {
    ok: true,
    detail: `Runtime adapter "${config.runtime}" is supported.`,
  };
}

function resolvePiSettingsPaths(repoRoot: string) {
  const projectSettingsPath = path.join(repoRoot, ".pi", "settings.json");
  const globalSettingsPath = process.env.PI_CODING_AGENT_DIR
    ? path.join(process.env.PI_CODING_AGENT_DIR, "settings.json")
    : path.join(homedir(), ".pi", "agent", "settings.json");

  return {
    projectSettingsPath,
    globalSettingsPath,
  };
}

function verifyRuntimeLocalConfig(
  repoRoot: string,
  config: AegisConfig,
): StartupPreflightProbeResult {
  if (config.runtime !== "pi") {
    return {
      ok: true,
      detail: `Runtime "${config.runtime}" does not require Pi local settings.`,
    };
  }

  const { projectSettingsPath, globalSettingsPath } = resolvePiSettingsPaths(repoRoot);

  if (existsSync(projectSettingsPath)) {
    return {
      ok: true,
      detail: `Pi runtime settings found at ${projectSettingsPath}.`,
    };
  }

  if (existsSync(globalSettingsPath)) {
    return {
      ok: true,
      detail: `Pi runtime settings found at ${globalSettingsPath}.`,
    };
  }

  return {
    ok: false,
    detail:
      `Pi runtime settings were not found. Checked ${projectSettingsPath} and ${globalSettingsPath}.`,
    fix:
      `create ${projectSettingsPath} for this repository or ${globalSettingsPath} for the current user before starting Aegis`,
  };
}

function verifyRuntimeStatePaths(repoRoot: string): StartupPreflightProbeResult {
  const aegisDir = path.join(repoRoot, AEGIS_DIRECTORY);

  if (!existsSync(aegisDir)) {
    return {
      ok: false,
      detail: `Missing Aegis runtime directory at ${aegisDir}.`,
      fix: "run `aegis init` in this repository before starting Aegis",
    };
  }

  const missingBootstrapFiles = RUNTIME_STATE_FILES
    .map((relativePath) => path.join(repoRoot, ...relativePath.split("/")))
    .filter((candidate) => !existsSync(candidate));

  if (missingBootstrapFiles.length > 0) {
    return {
      ok: false,
      detail: `Missing Aegis bootstrap state files: ${missingBootstrapFiles.join(", ")}.`,
      fix: "run `aegis init` to seed the required `.aegis` state files before starting Aegis",
    };
  }

  try {
    accessSync(aegisDir, constants.R_OK | constants.W_OK);
  } catch {
    return {
      ok: false,
      detail: `Aegis cannot write runtime state under ${aegisDir}.`,
      fix: "fix repository permissions so Aegis can read and write files under `.aegis/`",
    };
  }

  return {
    ok: true,
    detail: "Runtime state paths are available.",
  };
}

function toRunningRuntimeState(
  pid: number,
): RuntimeStateRecord {
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
  stopReason: "manual" | "signal" | "shutdown",
): RuntimeStateRecord {
  return {
    ...runningState,
    server_state: "stopped",
    stopped_at: new Date().toISOString(),
    last_stop_reason: stopReason,
  };
}

function registerLifecycleSignalHandlers(stop: () => Promise<void>) {
  if (registeredSignalHandlers) {
    process.off("SIGINT", registeredSignalHandlers.sigint);
    process.off("SIGTERM", registeredSignalHandlers.sigterm);
  }

  const handleSignal = () => {
    void stop().then(
      () => {
        process.exit(0);
      },
      (error) => {
        const details = error instanceof Error ? error.message : String(error);
        console.error(`Failed to stop Aegis gracefully: ${details}`);
        process.exit(1);
      },
    );
  };
  const sigint = () => {
    handleSignal();
  };
  const sigterm = () => {
    handleSignal();
  };

  process.on("SIGINT", sigint);
  process.on("SIGTERM", sigterm);
  registeredSignalHandlers = { sigint, sigterm };
}

function ensureLogsDirectory(repoRoot: string) {
  const logsDirectory = path.join(repoRoot, ".aegis", "logs");
  mkdirSync(logsDirectory, { recursive: true });
  return logsDirectory;
}

function appendDaemonLog(repoRoot: string, message: string) {
  const logsDirectory = ensureLogsDirectory(repoRoot);
  const logPath = path.join(logsDirectory, "daemon.log");
  appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`, "utf8");
}

export function createStartCommandContract(): StartCommandContract {
  return {
    command: START_COMMAND_NAME,
    overrides: START_OVERRIDE_FLAGS,
    launchSequence: CANONICAL_LAUNCH_SEQUENCE,
    shutdownSequence: CANONICAL_SHUTDOWN_SEQUENCE,
  };
}

export async function startAegis(
  root = process.cwd(),
  overrides: StartCommandOverrides = {
    viewAgentSessions: false,
  },
  options: StartCommandOptions = {},
): Promise<StartResult> {
  const repoRoot = path.resolve(root);
  const verifyTracker = options.verifyTracker ?? ((candidateRoot: string) => {
    const probe = probeBeadsRepository(candidateRoot);

    if (!probe.ok) {
      throw new Error(probe.detail ?? "Beads repository check failed.");
    }
  });
  const verifyGitRepo = options.verifyGitRepo ?? (() => {
    verifyGitRepository(repoRoot);
  });
  const beadsCliProbe = options.probeBeadsCli ?? probeBeadsCli;
  const verifyModelRefs = options.verifyModelRefs ?? verifyConfiguredPiModels;

  void overrides;
  let config: AegisConfig | undefined;

  const preflight = runStartupPreflight(repoRoot, {
    verifyGitRepo,
    probeBeadsCli: beadsCliProbe,
    probeBeadsRepo: () => {
      try {
        verifyTracker(repoRoot);
        return {
          ok: true,
          detail: "Beads tracker is initialized.",
        };
      } catch (error) {
        return {
          ok: false,
          detail: toErrorMessage(error),
          fix: "run `bd init` or `bd onboard` in this repository",
        };
      }
    },
    loadConfig: () => {
      config = loadConfig(repoRoot);
      return config;
    },
    verifyRuntimeAdapter,
    verifyRuntimeLocalConfig: (loadedConfig) => verifyRuntimeLocalConfig(repoRoot, loadedConfig),
    verifyModelRefs,
    verifyRuntimeStatePaths,
  });

  if (preflight.overall === "blocked") {
    console.error(formatStartupPreflight(preflight));
    throw new StartupPreflightBlockedError(preflight);
  }

  const recoveredRuntime = readRuntimeState(repoRoot);
  const isAlreadyRunning = recoveredRuntime
    && recoveredRuntime.server_state !== "stopped"
    && isProcessRunning(recoveredRuntime.pid);

  if (isAlreadyRunning) {
    throw new Error(
      `Aegis is already running on pid ${recoveredRuntime.pid}.`,
    );
  }

  const resolvedConfig = config ?? loadConfig(repoRoot);
  let runningState = toRunningRuntimeState(process.pid);
  let hasStopped = false;
  let stopRequestPoller: NodeJS.Timeout | null = null;
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let daemonLoopTimer: NodeJS.Timeout | null = null;
  let cycleInFlight = false;
  const runDaemonCycle = options.runDaemonCycle ?? ((candidateRoot: string) =>
    defaultRunDaemonCycle(candidateRoot, {
      sessionProvenanceId: String(process.pid),
    }));
  const runCasteCommand = options.runCasteCommand ?? ((candidateRoot: string, action: RuntimeCasteAction, issueId: string) =>
    defaultRunCasteCommand({
      root: candidateRoot,
      action,
      issueId,
      tracker: new BeadsTrackerClient(),
      runtime: createCasteRuntime(loadConfig(candidateRoot).runtime, {}, {
        root: candidateRoot,
        issueId,
      }),
    }));
  const runMergeCommand = options.runMergeCommand ?? ((candidateRoot: string, action: RuntimeMergeAction) =>
    action === "next" ? defaultRunMergeNext(candidateRoot) : Promise.resolve(null));
  const sessionViewTrackerFactory = options.createSessionViewTracker
    ?? ((candidateRoot: string) => createSessionViewTracker(candidateRoot, {
      onLaunchError(detail) {
        appendDaemonLog(candidateRoot, `[daemon][session_view_error] ${detail}`);
      },
    }));
  const sessionViewTracker = overrides.viewAgentSessions
    ? sessionViewTrackerFactory(repoRoot)
    : null;

  clearStopRequest(repoRoot);
  clearRuntimeCommandArtifacts(repoRoot);
  const reconciledDispatchState = reconcileDispatchState(
    loadDispatchState(repoRoot),
    String(process.pid),
  );
  saveDispatchState(repoRoot, reconciledDispatchState);
  writeRuntimeState(runningState, repoRoot);
  appendDaemonLog(
    repoRoot,
    `[daemon][start] runtime=${resolvedConfig.runtime} poll_interval_seconds=${resolvedConfig.thresholds.poll_interval_seconds}`,
  );

  const runtime: StartRuntimeController = {
    async stop(reason = "shutdown") {
      if (hasStopped) {
        return;
      }

      hasStopped = true;
      if (stopRequestPoller) {
        clearInterval(stopRequestPoller);
        stopRequestPoller = null;
      }
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      if (daemonLoopTimer) {
        clearInterval(daemonLoopTimer);
        daemonLoopTimer = null;
      }
      sessionViewTracker?.stop();
      clearStopRequest(repoRoot);
      clearRuntimeCommandArtifacts(repoRoot);
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

    void runtime.stop(reason).then(
      () => {
        process.exit(0);
      },
      (error) => {
        const details = error instanceof Error ? error.message : String(error);
        console.error(`Failed to stop Aegis gracefully: ${details}`);
        process.exit(1);
      },
      );
  };

  const handleRuntimeCommandRequest = async () => {
    const request = readRuntimeCommandRequests(repoRoot)[0] as RuntimeCommandRequest | undefined;
    if (!request || request.target_pid !== process.pid || cycleInFlight || hasStopped) {
      return;
    }

    cycleInFlight = true;
    try {
      const result = request.command_kind === "caste"
        ? await runCasteCommand(repoRoot, request.action, request.issue_id)
        : request.command_kind === "merge"
          ? await runMergeCommand(repoRoot, request.action)
          : await runLoopPhase(repoRoot, request.phase, {
            sessionProvenanceId: String(process.pid),
          });
      const response: RuntimeCommandResponse = {
        request_id: request.request_id,
        command_kind: request.command_kind,
        ...(request.command_kind === "caste"
          ? { action: request.action, issue_id: request.issue_id }
          : request.command_kind === "merge"
            ? { action: request.action }
          : { phase: request.phase }),
        completed_at: new Date().toISOString(),
        result,
      };
      writeRuntimeCommandResponse(repoRoot, response);
      clearRuntimeCommandRequest(repoRoot, request.request_id);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const response: RuntimeCommandResponse = {
        request_id: request.request_id,
        command_kind: request.command_kind,
        ...(request.command_kind === "caste"
          ? { action: request.action, issue_id: request.issue_id }
          : request.command_kind === "merge"
            ? { action: request.action }
          : { phase: request.phase }),
        completed_at: new Date().toISOString(),
        error: detail,
      };
      writeRuntimeCommandResponse(repoRoot, response);
      clearRuntimeCommandRequest(repoRoot, request.request_id);
    } finally {
      cycleInFlight = false;
    }
  };

  stopRequestPoller = setInterval(() => {
    handleExternalStopRequest();
    void handleRuntimeCommandRequest();
  }, STOP_REQUEST_POLL_MS);
  heartbeatTimer = setInterval(() => {
    appendDaemonLog(repoRoot, "[daemon][heartbeat] mode=auto");
  }, HEARTBEAT_LOG_INTERVAL_MS);
  const runCycleSafely = async () => {
    if (cycleInFlight || hasStopped) {
      return;
    }

    cycleInFlight = true;
    try {
      await runDaemonCycle(repoRoot);
      await runMergeCommand(repoRoot, "next");
      const runningSessions = Object.values(loadDispatchState(repoRoot).records)
        .filter((record) => record.runningAgent !== null)
        .map((record) => ({
          issueId: record.issueId,
          caste: record.runningAgent!.caste,
          sessionId: record.runningAgent!.sessionId,
        }));
      sessionViewTracker?.sync(runningSessions);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      appendDaemonLog(repoRoot, `[daemon][cycle_error] ${detail}`);
    } finally {
      cycleInFlight = false;
    }
  };

  await runCycleSafely();
  daemonLoopTimer = setInterval(() => {
    void runCycleSafely();
  }, resolvedConfig.thresholds.poll_interval_seconds * 1_000);

  if (options.registerSignalHandlers !== false) {
    registerLifecycleSignalHandlers(() => runtime.stop("signal"));
  }

  return {
    root: repoRoot,
    mode: "auto",
    runtime,
  };
}

export function execBdInRepository(root: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "bd",
      args,
      {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = stderr?.trim() ? ` - ${stderr.trim()}` : "";
          reject(new Error(`bd ${args[0]} failed: ${error.message}${detail}`));
          return;
        }
        resolve(stdout);
      },
    );
  });
}
