import { runLoopPhase, type LoopPhase } from "../core/loop-runner.js";
import { routeToDaemonOrRunLocal, formatCommandResult, type DaemonRoutingOptions } from "./daemon-routing.js";
import { requestPhaseCommandFromDaemon } from "./runtime-command.js";

export interface RunDirectPhaseCommandOptions extends DaemonRoutingOptions {
  runLocal?: (root: string, phase: LoopPhase) => Promise<unknown>;
  routeToDaemon?: (root: string, phase: LoopPhase, targetPid: number) => Promise<unknown>;
}

export async function runDirectPhaseCommand(
  root: string,
  phase: LoopPhase,
  options: RunDirectPhaseCommandOptions = {},
) {
  const runLocal = options.runLocal ?? runLoopPhase;
  const routeToDaemon = options.routeToDaemon ?? requestPhaseCommandFromDaemon;
  return routeToDaemonOrRunLocal(
    root,
    options,
    () => runLocal(root, phase),
    (targetPid) => routeToDaemon(root, phase, targetPid),
  );
}

export const formatPhaseCommandResult = formatCommandResult;
