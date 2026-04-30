import { isProcessRunning, readRuntimeState, type RuntimeStateRecord } from "./runtime-state.js";
import {
  requestCasteCommandFromDaemon,
  type RuntimeCasteAction,
} from "./runtime-command.js";
import { runCasteCommand } from "../core/caste-runner.js";
import { BeadsTrackerClient } from "../tracker/beads-tracker.js";
import { loadConfig } from "../config/load-config.js";
import { createCasteRuntime } from "../runtime/create-caste-runtime.js";

export interface RunDirectCasteCommandOptions {
  readRuntimeState?: (root?: string) => RuntimeStateRecord | null;
  isProcessRunning?: (pid: number) => boolean;
  runLocal?: (
    root: string,
    action: RuntimeCasteAction,
    issueId: string,
  ) => Promise<unknown>;
  routeToDaemon?: (
    root: string,
    action: RuntimeCasteAction,
    issueId: string,
    targetPid: number,
  ) => Promise<unknown>;
}

function isDaemonOwned(
  runtimeState: RuntimeStateRecord | null,
  processRunning: (pid: number) => boolean,
) {
  return runtimeState !== null
    && runtimeState.server_state === "running"
    && processRunning(runtimeState.pid);
}

async function runUnsupportedLocalAction(
  root: string,
  action: RuntimeCasteAction,
  issueId: string,
) {
  const config = loadConfig(root);
  return runCasteCommand({
    root,
    action,
    issueId,
    tracker: new BeadsTrackerClient(),
    runtime: createCasteRuntime(config.runtime, {}, { root, issueId }),
    artifactEmissionMode: config.runtime === "pi" ? "tool" : "json",
  });
}

export async function runDirectCasteCommand(
  root: string,
  action: RuntimeCasteAction,
  issueId: string,
  options: RunDirectCasteCommandOptions = {},
) {
  const readRuntime = options.readRuntimeState ?? readRuntimeState;
  const processRunning = options.isProcessRunning ?? isProcessRunning;
  const runLocal = options.runLocal ?? runUnsupportedLocalAction;
  const routeToDaemon = options.routeToDaemon ?? requestCasteCommandFromDaemon;
  const runtimeState = readRuntime(root);

  if (runtimeState && isDaemonOwned(runtimeState, processRunning)) {
    return routeToDaemon(root, action, issueId, runtimeState.pid);
  }

  return runLocal(root, action, issueId);
}

export function formatCasteCommandResult(result: unknown) {
  return JSON.stringify(result);
}
