import { loadConfig } from "../config/load-config.js";
import { loadDispatchState, saveDispatchState } from "./dispatch-state.js";
import { dispatchReadyWork } from "./dispatcher.js";
import { monitorActiveWork } from "./monitor.js";
import { pollReadyWork } from "./poller.js";
import { reapFinishedWork } from "./reaper.js";
import { triageReadyWork } from "./triage.js";
import { BeadsTrackerClient } from "../tracker/beads-tracker.js";
import type { AgentRuntime } from "../runtime/agent-runtime.js";
import { createAgentRuntime } from "../runtime/phase-d-shell-runtime.js";
import { writePhaseLog } from "./phase-log.js";

export type LoopPhase = "poll" | "dispatch" | "monitor" | "reap";

export interface LoopPhaseResult {
  phase: LoopPhase;
  readyIssueIds?: string[];
  dispatched?: string[];
  skipped?: Array<{ issueId: string; reason: string }>;
  warnings?: string[];
  killList?: string[];
  readyToReap?: string[];
  completed?: string[];
  failed?: string[];
}

export interface RunLoopPhaseOptions {
  runtime?: AgentRuntime;
  sessionProvenanceId?: string;
}

function createDefaultRuntime(root: string) {
  const config = loadConfig(root);
  return createAgentRuntime(config.runtime);
}

interface DispatchPipelineResult {
  dispatchState: ReturnType<typeof loadDispatchState>;
  readyIssueIds: string[];
  dispatched: string[];
  skipped: Array<{ issueId: string; reason: string }>;
  failed: string[];
}

async function runDispatchPipeline(
  root: string,
  runtime: AgentRuntime,
  sessionProvenanceId: string,
  timestamp: string,
): Promise<DispatchPipelineResult> {
  const config = loadConfig(root);
  const tracker = new BeadsTrackerClient();
  const dispatchState = loadDispatchState(root);
  const snapshot = await pollReadyWork({
    dispatchState,
    tracker,
    root,
  });

  writePhaseLog(root, {
    timestamp,
    phase: "poll",
    issueId: "_all",
    action: "poll_ready_work",
    outcome: "ok",
    detail: snapshot.readyIssues.map((issue) => issue.id).join(","),
  });

  const triage = triageReadyWork({
    readyIssues: snapshot.readyIssues,
    dispatchState,
    config,
    now: timestamp,
  });

  writePhaseLog(root, {
    timestamp,
    phase: "triage",
    issueId: "_all",
    action: "triage_ready_work",
    outcome: "ok",
    detail: triage.dispatchable.map((item) => item.issueId).join(","),
  });

  const dispatchResult = await dispatchReadyWork({
    dispatchState,
    decisions: triage.dispatchable,
    runtime,
    root,
    sessionProvenanceId,
    now: timestamp,
  });
  saveDispatchState(root, dispatchResult.state);

  return {
    dispatchState: dispatchResult.state,
    readyIssueIds: snapshot.readyIssues.map((issue) => issue.id),
    dispatched: dispatchResult.dispatched,
    skipped: triage.skipped,
    failed: dispatchResult.failed,
  };
}

async function runMonitorPipeline(
  root: string,
  runtime: AgentRuntime,
  timestamp: string,
  dispatchState = loadDispatchState(root),
) {
  const config = loadConfig(root);

  return monitorActiveWork({
    dispatchState,
    runtime,
    thresholds: {
      stuck_warning_seconds: config.thresholds.stuck_warning_seconds,
      stuck_kill_seconds: config.thresholds.stuck_kill_seconds,
    },
    root,
    now: timestamp,
  });
}

async function runReapPipeline(
  root: string,
  runtime: AgentRuntime,
  timestamp: string,
  issueIds: string[],
  dispatchState = loadDispatchState(root),
) {
  const reapResult = await reapFinishedWork({
    dispatchState,
    runtime,
    issueIds,
    root,
    now: timestamp,
  });
  saveDispatchState(root, reapResult.state);
  return reapResult;
}

export async function runLoopPhase(
  root = process.cwd(),
  phase: LoopPhase,
  options: RunLoopPhaseOptions = {},
): Promise<LoopPhaseResult> {
  const runtime = options.runtime ?? createDefaultRuntime(root);
  const timestamp = new Date().toISOString();
  const sessionProvenanceId = options.sessionProvenanceId ?? "direct-command";

  if (phase === "poll") {
    const snapshot = await pollReadyWork({
      dispatchState: loadDispatchState(root),
      tracker: new BeadsTrackerClient(),
      root,
    });
    writePhaseLog(root, {
      timestamp,
      phase: "poll",
      issueId: "_all",
      action: "poll_ready_work",
      outcome: "ok",
      detail: snapshot.readyIssues.map((issue) => issue.id).join(","),
    });
    return {
      phase,
      readyIssueIds: snapshot.readyIssues.map((issue) => issue.id),
    };
  }

  if (phase === "dispatch") {
    const result = await runDispatchPipeline(
      root,
      runtime,
      sessionProvenanceId,
      timestamp,
    );
    return {
      phase,
      readyIssueIds: result.readyIssueIds,
      dispatched: result.dispatched,
      skipped: result.skipped,
      failed: result.failed,
    };
  }

  if (phase === "monitor") {
    const result = await runMonitorPipeline(root, runtime, timestamp);
    return {
      phase,
      warnings: result.warnings,
      killList: result.killList,
      readyToReap: result.readyToReap,
    };
  }

  const dispatchState = loadDispatchState(root);
  const result = await runReapPipeline(
    root,
    runtime,
    timestamp,
    Object.values(dispatchState.records)
      .filter((record) => record.runningAgent !== null)
      .map((record) => record.issueId),
    dispatchState,
  );
  return {
    phase,
    completed: result.completed,
    failed: result.failed,
  };
}

export async function runDaemonCycle(
  root = process.cwd(),
  options: RunLoopPhaseOptions = {},
): Promise<void> {
  const runtime = options.runtime ?? createDefaultRuntime(root);
  const timestamp = new Date().toISOString();
  const sessionProvenanceId = options.sessionProvenanceId ?? "daemon";
  const dispatchResult = await runDispatchPipeline(
    root,
    runtime,
    sessionProvenanceId,
    timestamp,
  );

  const monitorResult = await runMonitorPipeline(
    root,
    runtime,
    timestamp,
    dispatchResult.dispatchState,
  );

  if (monitorResult.readyToReap.length === 0) {
    return;
  }

  await runReapPipeline(
    root,
    runtime,
    timestamp,
    monitorResult.readyToReap,
    dispatchResult.dispatchState,
  );
}
