import { existsSync } from "node:fs";
import path from "node:path";

import {
  loadDispatchState,
  type DispatchRecord,
  type DispatchStage,
  type DispatchState,
} from "./dispatch-state.js";
import type { AgentRuntime } from "../runtime/agent-runtime.js";
import { buildArtifactRef, type ArtifactFamily } from "./artifact-store.js";
import { writePhaseLog, writePhaseLogEntry, type PhaseLogWriter } from "./phase-log.js";
import { applyOperationalFailure, applySentinelOperationalFailure } from "./failure-policy.js";
import { validateDispatchRecordStage } from "./stage-invariants.js";
import { normalizeFileScope } from "../shared/file-scope.js";
import { readArtifactRecord, readStringArray } from "../shared/json.js";

export interface ReapInput {
  dispatchState: DispatchState;
  runtime: AgentRuntime;
  issueIds: string[];
  root: string;
  now?: string;
  /** Writer for the `_all` pass summary; defaults to always writing. */
  writeSummaryLog?: PhaseLogWriter;
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

  const ref = buildArtifactRef("transcripts", record.issueId, caste);
  return existsSync(path.join(root, ref)) ? ref : (record.failureTranscriptRef ?? null);
}

function toFailedRecord(
  root: string,
  record: DispatchRecord,
  timestamp: string,
  errorMessage?: string | null,
): DispatchRecord {
  const options = {
    timestamp,
    errorMessage,
    failureTranscriptRef: resolveFailureTranscriptRef(root, record),
  };
  return record.stage === "reviewing" && record.runningAgent?.caste === "sentinel"
    ? applySentinelOperationalFailure(record, options)
    : applyOperationalFailure(record, options);
}

/**
 * Caste commands save their own record transitions while the session runs.
 * Re-read after the session settles and prefer that newer record unless it
 * already belongs to a different session.
 */
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

function resolveDurableArtifactRef(root: string, family: ArtifactFamily, issueId: string) {
  const ref = buildArtifactRef(family, issueId);
  return existsSync(path.join(root, ref)) ? ref : null;
}

function readOracleFileScope(root: string, artifactRef: string | null) {
  const artifact = readArtifactRecord(root, artifactRef);
  return artifact ? normalizeFileScope(readStringArray(artifact["files_affected"])) : null;
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

/** Finalizes settled sessions: success advances the stage, failure applies retry policy. */
export async function reapFinishedWork(input: ReapInput): Promise<ReapResult> {
  const timestamp = input.now ?? new Date().toISOString();
  const latestState = loadDispatchState(input.root);
  const records = {
    ...input.dispatchState.records,
    ...latestState.records,
  };
  const completed: string[] = [];
  const failed: string[] = [];

  const recordFailure = (issueId: string, record: DispatchRecord, sessionId: string, detail?: string) => {
    records[issueId] = toFailedRecord(input.root, record, timestamp, detail);
    failed.push(issueId);
    writePhaseLog(input.root, {
      timestamp,
      phase: "reap",
      issueId,
      action: "finalize_session",
      outcome: "failed",
      sessionId,
      detail,
    });
  };

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

    if (snapshot.status !== "succeeded") {
      recordFailure(issueId, resolveLatestRecord(input.root, record), snapshot.sessionId, snapshot.error);
      continue;
    }

    const latestRecord = resolveLatestRecord(input.root, record);
    if (latestRecord.stage === "failed_operational") {
      // The caste command already recorded a failure (for example a Titan
      // `failure` outcome); keep its retry accounting instead of resetting it.
      records[issueId] = {
        ...latestRecord,
        runningAgent: null,
        updatedAt: timestamp,
      };
      failed.push(issueId);
      writePhaseLog(input.root, {
        timestamp,
        phase: "reap",
        issueId,
        action: "finalize_session",
        outcome: "failed_operational",
        sessionId: snapshot.sessionId,
      });
      continue;
    }

    const completedRecord = hydrateDurableArtifactRefs(
      input.root,
      toCompletedRecord(latestRecord, timestamp),
    );
    const invariantError = validateDispatchRecordStage(completedRecord);
    if (invariantError) {
      recordFailure(issueId, completedRecord, snapshot.sessionId, invariantError);
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
  }

  (input.writeSummaryLog ?? writePhaseLogEntry)(input.root, {
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
