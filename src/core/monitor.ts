import type { DispatchState } from "./dispatch-state.js";
import type { AgentRuntime } from "../runtime/agent-runtime.js";
import { writePhaseLog } from "./phase-log.js";

export interface MonitorInput {
  dispatchState: DispatchState;
  runtime: AgentRuntime;
  thresholds: {
    stuck_warning_seconds: number;
    stuck_kill_seconds: number;
  };
  root: string;
  now?: string;
}

export interface MonitorResult {
  readyToReap: string[];
  killList: string[];
  warnings: string[];
}

export async function monitorActiveWork(input: MonitorInput): Promise<MonitorResult> {
  const timestamp = input.now ?? new Date().toISOString();
  const nowMs = Date.parse(timestamp);
  const readyToReap: string[] = [];
  const killList: string[] = [];
  const warnings: string[] = [];

  for (const record of Object.values(input.dispatchState.records)) {
    if (!record.runningAgent) {
      continue;
    }

    const snapshot = await input.runtime.readSession(
      input.root,
      record.runningAgent.sessionId,
    );

    if (snapshot && snapshot.status !== "running") {
      readyToReap.push(record.issueId);
      writePhaseLog(input.root, {
        timestamp,
        phase: "monitor",
        issueId: record.issueId,
        action: "session_observed",
        outcome: snapshot.status,
        sessionId: snapshot.sessionId,
      });
      continue;
    }

    const startedAtMs = Date.parse(record.runningAgent.startedAt);
    if (!Number.isFinite(startedAtMs)) {
      continue;
    }

    const elapsedSeconds = Math.max(0, Math.floor((nowMs - startedAtMs) / 1000));
    if (elapsedSeconds >= input.thresholds.stuck_kill_seconds) {
      await input.runtime.terminate(
        input.root,
        record.runningAgent.sessionId,
        "Exceeded stuck kill threshold.",
      );
      killList.push(record.issueId);
      readyToReap.push(record.issueId);
      writePhaseLog(input.root, {
        timestamp,
        phase: "monitor",
        issueId: record.issueId,
        action: "stuck_kill_threshold",
        outcome: "kill",
        sessionId: record.runningAgent.sessionId,
      });
      continue;
    }

    if (elapsedSeconds >= input.thresholds.stuck_warning_seconds) {
      warnings.push(record.issueId);
      writePhaseLog(input.root, {
        timestamp,
        phase: "monitor",
        issueId: record.issueId,
        action: "stuck_warning_threshold",
        outcome: "warn",
        sessionId: record.runningAgent.sessionId,
      });
    }
  }

  return {
    readyToReap,
    killList,
    warnings,
  };
}
