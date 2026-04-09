import { execFile, spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { loadConfig } from "../config/load-config.js";
import {
  createNoopEventPublisher,
  executeProjectDirectCommand,
} from "../core/direct-command-runner.js";
import {
  loadDispatchState,
  reconcileDispatchState,
  saveDispatchState,
} from "../core/dispatch-state.js";
import {
  createHttpServerController,
  type HttpServerBindings,
} from "../server/http-server.js";
import type { OrchestrationMode } from "../server/routes.js";
import { PiRuntime } from "../runtime/pi-runtime.js";
import { BeadsCliClient } from "../tracker/beads-client.js";
import { parseCommand } from "./parse-command.js";
import { STOP_COMMAND_REASONS } from "./stop.js";
import {
  clearStopRequest,
  isAegisOwned,
  isProcessRunning,
  readStopRequest,
  readRuntimeState,
  writeRuntimeState,
  type RuntimeStateRecord,
} from "./runtime-state.js";

export const START_COMMAND_NAME = "start";

export const START_OVERRIDE_FLAGS = [
  "--port",
  "--no-browser",
] as const;

export const CANONICAL_LAUNCH_SEQUENCE = [
  "load_config",
  "verify_tracker",
  "verify_git_repo",
  "recover_dispatch_state",
  "start_http_server",
  "open_browser",
  "enter_conversational_idle",
  "print_runtime_summary",
] as const;

export const CANONICAL_SHUTDOWN_SEQUENCE = [
  "stop_polling",
  "stop_active_agents",
  "wait_for_graceful_completion",
  "abort_stragglers",
  "reconcile_tracker_work",
  "cleanup_labors",
  "persist_runtime_state",
  "print_budget_summary",
] as const;

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_MODE: OrchestrationMode = "conversational";

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
  port?: number;
  noBrowser?: boolean;
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
  host: string;
  port: number;
  url: string;
  openedBrowser: boolean;
  runtime: StartRuntimeController;
}

export interface StartCommandOptions {
  verifyTracker?: (root: string) => void;
  verifyGitRepo?: () => void;
  openBrowser?: (url: string) => boolean;
  registerSignalHandlers?: boolean;
  httpServerBindings?: HttpServerBindings;
}

export interface TrackerProbeResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: NodeJS.ErrnoException | null;
}

export type TrackerProbe = (root: string) => TrackerProbeResult;

function spawnDetachedBrowser(command: string, args: string[], options: {
  windowsHide?: boolean;
}) {
  const browser = spawn(command, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: options.windowsHide,
  });

  browser.once("error", () => {});
  browser.unref();

  return typeof browser.pid === "number";
}

function parseNumberFlag(flagName: string, value: string | undefined) {
  if (!value) {
    throw new Error(`Missing value for ${flagName}`);
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`Expected ${flagName} to be an integer between 1 and 65535`);
  }

  return parsed;
}

export function parseStartOverrides(argv: readonly string[]): StartCommandOverrides {
  const overrides: StartCommandOverrides = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    switch (token) {
      case "--port":
        overrides.port = parseNumberFlag("--port", argv[index + 1]);
        index += 1;
        break;
      case "--no-browser":
        overrides.noBrowser = true;
        break;
      default:
        throw new Error(`Unknown start override flag: ${token}`);
    }
  }

  return overrides;
}

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

export function verifyTrackerRepository(root: string, probe: TrackerProbe = runTrackerProbe) {
  const trackerProbe = probe(root);
  const errorCode =
    trackerProbe.error && "code" in trackerProbe.error
      ? String(trackerProbe.error.code)
      : null;

  if (errorCode === "ENOENT") {
    throw new Error("Beads CLI was not found. Install or fix `bd` before starting Aegis.");
  }

  if (trackerProbe.status !== 0) {
    const detail = (trackerProbe.stderr || trackerProbe.stdout).trim();
    const suffix = detail.length > 0 ? ` Details: ${detail}` : "";
    throw new Error(
      "Beads tracker is not initialized or healthy for this repository. Run `bd init` (or `bd onboard`) before starting Aegis."
      + suffix,
    );
  }
}

function verifyGitRepository(root: string) {
  const gitProbe = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: root,
    encoding: "utf8",
  });

  if (gitProbe.status !== 0 || gitProbe.stdout.trim() !== "true") {
    throw new Error("Aegis start requires a git repository root.");
  }
}

function execBdInRepository(root: string, args: string[]): Promise<string> {
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
          const detail = stderr?.trim() ? ` — ${stderr.trim()}` : "";
          reject(new Error(`bd ${args[0]} failed: ${error.message}${detail}`));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

function createRuntimeForConfig(runtime: string) {
  if (runtime === "pi") {
    return new PiRuntime();
  }

  throw new Error(`Unsupported runtime adapter: ${runtime}`);
}

function toRunningRuntimeState(
  pid: number,
  host: string,
  port: number,
  browserOpened: boolean,
  token: string,
): RuntimeStateRecord {
  return {
    schema_version: 1,
    pid,
    server_token: token,
    host,
    port,
    server_state: "running",
    mode: DEFAULT_MODE,
    started_at: new Date().toISOString(),
    browser_opened: browserOpened,
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

export function openBrowserUrl(url: string) {
  try {
    if (process.platform === "win32") {
      return spawnDetachedBrowser("cmd", ["/c", "start", "", url], {
        windowsHide: true,
      });
    }

    if (process.platform === "darwin") {
      return spawnDetachedBrowser("open", [url], {});
    }

    return spawnDetachedBrowser("xdg-open", [url], {});
  } catch {
    return false;
  }
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
  overrides: StartCommandOverrides = {},
  options: StartCommandOptions = {},
): Promise<StartResult> {
  const repoRoot = path.resolve(root);
  const verifyTracker = options.verifyTracker ?? verifyTrackerRepository;
  const verifyGitRepo = options.verifyGitRepo ?? (() => {
    verifyGitRepository(repoRoot);
  });
  const openBrowser = options.openBrowser ?? openBrowserUrl;

  const config = loadConfig(repoRoot);
  verifyTracker(repoRoot);
  verifyGitRepo();

  const recoveredState = readRuntimeState(repoRoot);
  const isAlreadyRunning = recoveredState
    && recoveredState.server_state !== "stopped"
    && (recoveredState.server_token
      ? await isAegisOwned(recoveredState)
      : isProcessRunning(recoveredState.pid));

  if (isAlreadyRunning) {
    throw new Error(
      `Aegis is already running on pid ${recoveredState.pid} (port ${recoveredState.port}).`,
    );
  }

  const dispatchSessionId = randomUUID();
  const recoveredDispatchState = reconcileDispatchState(
    loadDispatchState(repoRoot),
    dispatchSessionId,
  );
  saveDispatchState(repoRoot, recoveredDispatchState);

  const token = randomUUID();
  const runtimeAdapter = createRuntimeForConfig(config.runtime);
  const tracker = new BeadsCliClient((args) => execBdInRepository(repoRoot, args));
  let runningState: RuntimeStateRecord | null = null;
  const httpServerBindings: HttpServerBindings = {
    ...options.httpServerBindings,
    executeCommand: options.httpServerBindings?.executeCommand ?? (async (commandText) => (
      executeProjectDirectCommand(parseCommand(commandText), {
        projectRoot: repoRoot,
        config,
        tracker,
        runtime: runtimeAdapter,
        eventPublisher: options.httpServerBindings?.eventPublisher ?? createNoopEventPublisher(),
      })
    )),
    onOperatingModeStateChange: (state) => {
      if (runningState) {
        runningState = {
          ...runningState,
          mode: state.mode,
        };
        writeRuntimeState(runningState, repoRoot);
      }

      options.httpServerBindings?.onOperatingModeStateChange?.(state);
    },
  };
  const controller = createHttpServerController(httpServerBindings);
  const requestedPort = overrides.port ?? config.olympus.port;
  const server = await controller.start({
    root: repoRoot,
    host: DEFAULT_HOST,
    port: requestedPort,
    serverToken: token,
  });
  const shouldOpenBrowser = !overrides.noBrowser && config.olympus.open_browser;
  const openedBrowser = shouldOpenBrowser ? openBrowser(server.url) : false;
  runningState = toRunningRuntimeState(
    process.pid,
    server.host,
    server.port,
    openedBrowser,
    token,
  );
  let hasStopped = false;
  let stopRequestPoller: NodeJS.Timeout | null = null;

  clearStopRequest(repoRoot);
  writeRuntimeState(runningState, repoRoot);

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
      await controller.stop();
      clearStopRequest(repoRoot);
      writeRuntimeState(toStoppedRuntimeState(runningState!, reason), repoRoot);
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

  stopRequestPoller = setInterval(handleExternalStopRequest, 150);
  stopRequestPoller.unref();

  if (options.registerSignalHandlers !== false) {
    registerLifecycleSignalHandlers(() => runtime.stop("signal"));
  }

  return {
    root: repoRoot,
    host: server.host,
    port: server.port,
    url: server.url,
    openedBrowser,
    runtime,
  };
}
