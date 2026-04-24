import { loadDispatchState, type DispatchRecord, type DispatchState } from "./dispatch-state.js";
import type { AgentRuntime } from "../runtime/agent-runtime.js";
import { writePhaseLog } from "./phase-log.js";
import {
  calculateFailureCooldown,
  resolveFailureWindowStartMs,
} from "./failure-policy.js";
import { validateDispatchRecordStage } from "./stage-invariants.js";

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

function resolveCompletedStage(record: DispatchRecord): string {
  if (record.stage === "scouting") {
    return "scouted";
  }

  if (record.stage === "implementing") {
    return "implemented";
  }

  return record.stage;
}

function toCompletedRecord(record: DispatchRecord, timestamp: string): DispatchRecord {
  return {
    ...record,
    stage: resolveCompletedStage(record),
    runningAgent: null,
    lastCompletedCaste: record.runningAgent?.caste ?? record.lastCompletedCaste ?? null,
    consecutiveFailures: 0,
    cooldownUntil: null,
    updatedAt: timestamp,
  };
}

function toFailedRecord(record: DispatchRecord, timestamp: string): DispatchRecord {
  return {
    ...record,
    stage: "failed_operational",
    runningAgent: null,
    failureCount: record.failureCount + 1,
    consecutiveFailures: record.consecutiveFailures + 1,
    failureWindowStartMs: record.failureWindowStartMs
      ?? resolveFailureWindowStartMs(timestamp),
    cooldownUntil: calculateFailureCooldown(timestamp),
    updatedAt: timestamp,
  };
}

function resolveLatestRecord(root: string, record: DispatchRecord): DispatchRecord {
  const latestRecord = loadDispatchState(root).records[record.issueId];
  if (!latestRecord) {
    return record;
  }

  const staleSessionId = record.runningAgent?.sessionId ?? null;
  const latestSessionId = latestRecord.runningAgent?.sessionId ?? null;
  if (staleSessionId && latestSessionId && staleSessionId !== latestSessionId) {
    return record;
  }

  return latestRecord;
}

export async function reapFinishedWork(input: ReapInput): Promise<ReapResult> {
  const timestamp = input.now ?? new Date().toISOString();
  const latestState = loadDispatchState(input.root);
  const records = {
    ...input.dispatchState.records,
    ...latestState.records,
  };
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
      const completedRecord = toCompletedRecord(resolveLatestRecord(input.root, record), timestamp);
      const invariantError = validateDispatchRecordStage(completedRecord);
      if (invariantError) {
        records[issueId] = toFailedRecord(completedRecord, timestamp);
        failed.push(issueId);
        writePhaseLog(input.root, {
          timestamp,
          phase: "reap",
          issueId,
          action: "finalize_session",
          outcome: "failed",
          sessionId: snapshot.sessionId,
          detail: invariantError,
        });
        continue;
      }

      records[issueId] = completedRecord;
      completed.push(issueId);
      writePhaseLog(input.root, {
        timestamp,
        phase: "reap",
        issueId,
        action: "finalize_session",
        outcome: completedRecord.stage,
        sessionId: snapshot.sessionId,
      });
      continue;
    }

    records[issueId] = toFailedRecord(resolveLatestRecord(input.root, record), timestamp);
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

  writePhaseLog(input.root, {
    timestamp,
    phase: "reap",
    issueId: "_all",
    action: "reap_finished_work",
    outcome: "ok",
    detail: JSON.stringify({
      issueIds: input.issueIds,
      completed,
      failed,
    }),
  });

  return {
    state: {
      schemaVersion: latestState.schemaVersion ?? input.dispatchState.schemaVersion,
      records,
    },
    completed,
    failed,
  };
}
