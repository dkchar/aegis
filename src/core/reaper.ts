import type { DispatchRecord, DispatchState } from "./dispatch-state.js";
import type { AgentRuntime } from "../runtime/agent-runtime.js";
import { writePhaseLog } from "./phase-log.js";

export interface ReapInput {
  dispatchState: DispatchState;
  runtime: AgentRuntime;
  issueIds: string[];
  root: string;
  now?: string;
}

export interface ReapResult {
  state: DispatchState;
  completed: string[];
  failed: string[];
}

function toCompletedRecord(record: DispatchRecord, timestamp: string): DispatchRecord {
  return {
    ...record,
    stage: "phase_d_complete",
    runningAgent: null,
    consecutiveFailures: 0,
    cooldownUntil: null,
    updatedAt: timestamp,
  };
}

function toFailedRecord(record: DispatchRecord, timestamp: string): DispatchRecord {
  return {
    ...record,
    stage: "failed",
    runningAgent: null,
    failureCount: record.failureCount + 1,
    consecutiveFailures: record.consecutiveFailures + 1,
    failureWindowStartMs: record.failureWindowStartMs ?? Date.now(),
    cooldownUntil: null,
    updatedAt: timestamp,
  };
}

export async function reapFinishedWork(input: ReapInput): Promise<ReapResult> {
  const timestamp = input.now ?? new Date().toISOString();
  const records = { ...input.dispatchState.records };
  const completed: string[] = [];
  const failed: string[] = [];

  for (const issueId of input.issueIds) {
    const record = records[issueId];
    if (!record?.runningAgent) {
      continue;
    }

    const snapshot = await input.runtime.readSession(
      input.root,
      record.runningAgent.sessionId,
    );
    if (!snapshot || snapshot.status === "running") {
      continue;
    }

    if (snapshot.status === "succeeded") {
      records[issueId] = toCompletedRecord(record, timestamp);
      completed.push(issueId);
      writePhaseLog(input.root, {
        timestamp,
        phase: "reap",
        issueId,
        action: "finalize_session",
        outcome: "phase_d_complete",
        sessionId: snapshot.sessionId,
      });
      continue;
    }

    records[issueId] = toFailedRecord(record, timestamp);
    failed.push(issueId);
    writePhaseLog(input.root, {
      timestamp,
      phase: "reap",
      issueId,
      action: "finalize_session",
      outcome: "failed",
      sessionId: snapshot.sessionId,
      detail: snapshot.error,
    });
  }

  return {
    state: {
      schemaVersion: input.dispatchState.schemaVersion,
      records,
    },
    completed,
    failed,
  };
}
