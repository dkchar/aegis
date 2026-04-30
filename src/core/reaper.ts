import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { loadDispatchState, type DispatchRecord, type DispatchStage, type DispatchState } from "./dispatch-state.js";
import type { AgentRuntime } from "../runtime/agent-runtime.js";
import { writePhaseLog } from "./phase-log.js";
import {
  calculateFailureCooldown,
  classifyOperationalFailure,
  resolveNextOperationalFailureCount,
  resolveFailureWindowStartMs,
  shouldEscalateSentinelOperationalFailure,
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

function resolveCompletedStage(record: DispatchRecord): DispatchStage {
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

function resolveFailureTranscriptRef(root: string, record: DispatchRecord) {
  const caste = record.runningAgent?.caste;
  if (!caste) {
    return record.failureTranscriptRef ?? null;
  }

  const ref = path.join(".aegis", "transcripts", `${record.issueId}--${caste}.json`);
  return existsSync(path.join(root, ref)) ? ref : (record.failureTranscriptRef ?? null);
}

function toFailedRecord(
  root: string,
  record: DispatchRecord,
  timestamp: string,
  errorMessage?: string | null,
): DispatchRecord {
  if (record.stage === "reviewing" && record.runningAgent?.caste === "sentinel") {
    const nextConsecutiveFailures = resolveNextOperationalFailureCount(
      record.consecutiveFailures,
      errorMessage,
    );
    const failureTranscriptRef = resolveFailureTranscriptRef(root, record);
    const operationalFailureKind = classifyOperationalFailure(errorMessage);
    if (shouldEscalateSentinelOperationalFailure(nextConsecutiveFailures)) {
      return {
        ...record,
        stage: "failed_operational",
        runningAgent: null,
        failureCount: record.failureCount + 1,
        consecutiveFailures: nextConsecutiveFailures,
        failureTranscriptRef,
        operationalFailureKind,
        failureWindowStartMs: record.failureWindowStartMs
          ?? resolveFailureWindowStartMs(timestamp),
        cooldownUntil: calculateFailureCooldown(timestamp),
        updatedAt: timestamp,
      };
    }

    return {
      ...record,
      stage: "implemented",
      runningAgent: null,
      failureCount: record.failureCount + 1,
      consecutiveFailures: nextConsecutiveFailures,
      failureTranscriptRef,
      operationalFailureKind,
      failureWindowStartMs: record.failureWindowStartMs
        ?? resolveFailureWindowStartMs(timestamp),
      cooldownUntil: calculateFailureCooldown(timestamp),
      updatedAt: timestamp,
    };
  }

  return {
    ...record,
    stage: "failed_operational",
    runningAgent: null,
    failureCount: record.failureCount + 1,
    consecutiveFailures: resolveNextOperationalFailureCount(
      record.consecutiveFailures,
      errorMessage,
    ),
    failureTranscriptRef: resolveFailureTranscriptRef(root, record),
    operationalFailureKind: classifyOperationalFailure(errorMessage),
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

function resolveDurableArtifactRef(
  root: string,
  family: "oracle" | "titan" | "sentinel" | "janus",
  issueId: string,
) {
  const relativePath = path.join(".aegis", family, `${issueId}.json`);
  return existsSync(path.join(root, relativePath)) ? relativePath : null;
}

function normalizeArtifactFileScope(filesAffected: unknown) {
  if (!Array.isArray(filesAffected)) {
    return null;
  }

  const files = [...new Set(
    filesAffected
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.replace(/\\/g, "/").replace(/^\.\//, "").trim())
      .filter((entry) => entry.length > 0),
  )].sort();

  return files.length > 0 ? { files } : null;
}

function readOracleFileScope(root: string, artifactRef: string | null) {
  if (!artifactRef) {
    return null;
  }

  const artifactPath = path.join(root, artifactRef);
  if (!existsSync(artifactPath)) {
    return null;
  }

  try {
    const artifact = JSON.parse(readFileSync(artifactPath, "utf8")) as {
      files_affected?: unknown;
    };
    return normalizeArtifactFileScope(artifact.files_affected);
  } catch {
    return null;
  }
}

function hydrateDurableArtifactRefs(root: string, record: DispatchRecord): DispatchRecord {
  const oracleAssessmentRef = record.oracleAssessmentRef
    ?? resolveDurableArtifactRef(root, "oracle", record.issueId);
  const titanArtifactRef = resolveDurableArtifactRef(root, "titan", record.issueId);
  const sentinelArtifactRef = resolveDurableArtifactRef(root, "sentinel", record.issueId);

  return {
    ...record,
    oracleAssessmentRef,
    titanHandoffRef: record.titanHandoffRef ?? titanArtifactRef,
    sentinelVerdictRef: record.sentinelVerdictRef ?? sentinelArtifactRef,
    reviewFeedbackRef: record.reviewFeedbackRef ?? sentinelArtifactRef,
    fileScope: record.fileScope ?? readOracleFileScope(root, oracleAssessmentRef),
    janusArtifactRef: record.janusArtifactRef
      ?? resolveDurableArtifactRef(root, "janus", record.issueId),
  };
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
      const completedRecord = hydrateDurableArtifactRefs(
        input.root,
        toCompletedRecord(resolveLatestRecord(input.root, record), timestamp),
      );
      const invariantError = validateDispatchRecordStage(completedRecord);
      if (invariantError) {
        records[issueId] = toFailedRecord(input.root, completedRecord, timestamp, invariantError);
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

    records[issueId] = toFailedRecord(input.root, resolveLatestRecord(input.root, record), timestamp, snapshot.error);
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
