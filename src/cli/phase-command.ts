import { runLoopPhase, type LoopPhase } from "../core/loop-runner.js";
import { isProcessRunning, readRuntimeState, type RuntimeStateRecord } from "./runtime-state.js";
import { requestPhaseCommandFromDaemon } from "./runtime-command.js";

export interface RunDirectPhaseCommandOptions {
  readRuntimeState?: (root?: string) => RuntimeStateRecord | null;
  isProcessRunning?: (pid: number) => boolean;
  runLocal?: (root: string, phase: LoopPhase) => Promise<unknown>;
  routeToDaemon?: (root: string, phase: LoopPhase, targetPid: number) => Promise<unknown>;
}

function isDaemonOwned(
  runtimeState: RuntimeStateRecord | null,
  processRunning: (pid: number) => boolean,
) {
  return runtimeState !== null
    && runtimeState.server_state === "running"
    && processRunning(runtimeState.pid);
}

export async function runDirectPhaseCommand(
  root: string,
  phase: LoopPhase,
  options: RunDirectPhaseCommandOptions = {},
) {
  const readRuntime = options.readRuntimeState ?? readRuntimeState;
  const processRunning = options.isProcessRunning ?? isProcessRunning;
  const runLocal = options.runLocal ?? ((candidateRoot: string, candidatePhase: LoopPhase) =>
    runLoopPhase(candidateRoot, candidatePhase));
  const routeToDaemon = options.routeToDaemon ?? requestPhaseCommandFromDaemon;
  const runtimeState = readRuntime(root);

  if (runtimeState && isDaemonOwned(runtimeState, processRunning)) {
    return routeToDaemon(root, phase, runtimeState.pid);
  }

  return runLocal(root, phase);
}

export function formatPhaseCommandResult(result: unknown) {
  return JSON.stringify(result);
}
