import { routeToDaemonOrRunLocal, formatCommandResult, type DaemonRoutingOptions } from "./daemon-routing.js";
import {
  requestCasteCommandFromDaemon,
  type RuntimeCasteAction,
} from "./runtime-command.js";
import { runCasteCommand } from "../core/caste-runner.js";
import { createTrackerClient } from "../tracker/create-tracker.js";
import { loadConfig } from "../config/load-config.js";
import { createCasteRuntime } from "../runtime/create-caste-runtime.js";
import { resolveArtifactEmissionMode } from "../runtime/runtime-registry.js";

export interface RunDirectCasteCommandOptions extends DaemonRoutingOptions {
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

/** Runs one caste action in-process with the configured adapter. */
export async function runLocalCasteCommand(
  root: string,
  action: RuntimeCasteAction,
  issueId: string,
  onActivity?: (line: string) => void,
) {
  const config = loadConfig(root);
  return runCasteCommand({
    root,
    action,
    issueId,
    tracker: createTrackerClient(),
    runtime: createCasteRuntime(config.runtime, {}, { root, issueId }),
    artifactEmissionMode: resolveArtifactEmissionMode(config.runtime),
    onActivity,
  });
}

/** Live session activity for terminal runs; stdout stays the JSON result. */
function writeActivityToStderr(action: RuntimeCasteAction, issueId: string) {
  return (line: string) => {
    process.stderr.write(`[${action} ${issueId}] ${line}\n`);
  };
}

export async function runDirectCasteCommand(
  root: string,
  action: RuntimeCasteAction,
  issueId: string,
  options: RunDirectCasteCommandOptions = {},
) {
  const runLocal = options.runLocal
    ?? ((localRoot: string, localAction: RuntimeCasteAction, localIssueId: string) =>
      runLocalCasteCommand(localRoot, localAction, localIssueId, writeActivityToStderr(localAction, localIssueId)));
  const routeToDaemon = options.routeToDaemon ?? requestCasteCommandFromDaemon;
  return routeToDaemonOrRunLocal(
    root,
    options,
    () => runLocal(root, action, issueId),
    (targetPid) => routeToDaemon(root, action, issueId, targetPid),
  );
}

export const formatCasteCommandResult = formatCommandResult;
