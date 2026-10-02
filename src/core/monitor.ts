import type { DispatchState } from "./dispatch-state.js";
import type { AgentRuntime } from "../runtime/agent-runtime.js";
import { writePhaseLog, writePhaseLogEntry, type PhaseLogWriter } from "./phase-log.js";

export interface MonitorInput {
  dispatchState: DispatchState;
  runtime: AgentRuntime;
  thresholds: {
    stuck_warning_seconds: number;
    stuck_kill_seconds: number;
  };
  root: string;
  now?: string;
  /** Writer for the `_all` pass summary; defaults to always writing. */
  writeSummaryLog?: PhaseLogWriter;
}

export interface MonitorResult {
  readyToReap: string[];
  killList: string[];
  warnings: string[];
}

/**
 * A session is stuck when it stops producing activity, not when it runs long:
 * idle time counts from the latest of session start and last adapter activity.
 */
export function resolveIdleSeconds(startedAt: string, lastActivityAt: string | null | undefined, nowMs: number) {
  const lastSignalMs = Math.max(
    Date.parse(startedAt),
    lastActivityAt ? Date.parse(lastActivityAt) : Number.NEGATIVE_INFINITY,
  );
  return Number.isFinite(lastSignalMs)
    ? Math.max(0, Math.floor((nowMs - lastSignalMs) / 1000))
    : null;
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

    const idleSeconds = resolveIdleSeconds(record.runningAgent.startedAt, snapshot?.lastActivityAt, nowMs);
    if (idleSeconds === null) {
      continue;
    }

    if (idleSeconds >= input.thresholds.stuck_kill_seconds) {
      await input.runtime.terminate(
        input.root,
        record.runningAgent.sessionId,
        `Exceeded stuck kill threshold: no session activity for ${idleSeconds}s.`,
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
        detail: JSON.stringify({ idleSeconds }),
      });
      continue;
    }

    if (idleSeconds >= input.thresholds.stuck_warning_seconds) {
      warnings.push(record.issueId);
      writePhaseLog(input.root, {
        timestamp,
        phase: "monitor",
        issueId: record.issueId,
        action: "stuck_warning_threshold",
        outcome: "warn",
        sessionId: record.runningAgent.sessionId,
        detail: JSON.stringify({ idleSeconds }),
      });
    }
  }

  (input.writeSummaryLog ?? writePhaseLogEntry)(input.root, {
    timestamp,
    phase: "monitor",
    issueId: "_all",
    action: "monitor_active_work",
    outcome: "ok",
    detail: JSON.stringify({
      warnings,
      killList,
      readyToReap,
    }),
  });

  return {
    readyToReap,
    killList,
    warnings,
  };
}
