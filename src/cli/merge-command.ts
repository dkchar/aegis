import { runMergeNext } from "../merge/merge-next.js";
import { routeToDaemonOrRunLocal, formatCommandResult, type DaemonRoutingOptions } from "./daemon-routing.js";
import {
  requestMergeCommandFromDaemon,
  type RuntimeMergeAction,
} from "./runtime-command.js";

export interface RunDirectMergeCommandOptions extends DaemonRoutingOptions {
  runLocal?: (root: string, action: RuntimeMergeAction) => Promise<unknown>;
  routeToDaemon?: (root: string, action: RuntimeMergeAction, targetPid: number) => Promise<unknown>;
}

async function runLocalMergeCommand(root: string, action: RuntimeMergeAction) {
  return action === "next" ? runMergeNext(root) : null;
}

export async function runDirectMergeCommand(
  root: string,
  action: RuntimeMergeAction,
  options: RunDirectMergeCommandOptions = {},
) {
  const runLocal = options.runLocal ?? runLocalMergeCommand;
  const routeToDaemon = options.routeToDaemon ?? requestMergeCommandFromDaemon;
  return routeToDaemonOrRunLocal(
    root,
    options,
    () => runLocal(root, action),
    (targetPid) => routeToDaemon(root, action, targetPid),
  );
}

export const formatMergeCommandResult = formatCommandResult;
