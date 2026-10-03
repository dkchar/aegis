import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  applyOperationalFailure,
  applySentinelOperationalFailure,
  type OperationalFailureKind,
} from "./failure-policy.js";
import { writeJsonAtomic } from "../shared/atomic-write.js";

export type AgentCaste = "oracle" | "titan" | "sentinel" | "janus";

export interface AgentAssignment {
  caste: AgentCaste;
  sessionId: string;
  startedAt: string;
}

export type DispatchStage =
  | "pending"
  | "scouting"
  | "scouted"
  | "implementing"
  | "implemented"
  | "reviewing"
  | "queued_for_merge"
  | "merging"
  | "resolving_integration"
  | "blocked_on_child"
  | "rework_required"
  | "failed_operational"
  | "complete";

export interface DispatchRecord {
  issueId: string;
  stage: DispatchStage;
  runningAgent: AgentAssignment | null;
  lastCompletedCaste?: AgentCaste | null;
  blockedByIssueId?: string | null;
  reviewFeedbackRef?: string | null;
  policyArtifactRef?: string | null;
  oracleAssessmentRef: string | null;
  oracleReady?: boolean | null;
  oracleDecompose?: boolean | null;
  oracleBlockers?: string[] | null;
  titanHandoffRef?: string | null;
  titanClarificationRef?: string | null;
  sentinelVerdictRef: string | null;
  janusArtifactRef?: string | null;
  failureTranscriptRef?: string | null;
  operationalFailureKind?: OperationalFailureKind | null;
  fileScope: { files: string[] } | null;
  failureCount: number;
  consecutiveFailures: number;
  failureWindowStartMs: number | null;
  cooldownUntil: string | null;
  sessionProvenanceId: string;
  updatedAt: string;
}

export interface DispatchState {
  schemaVersion: 1;
  records: Record<string, DispatchRecord>;
}

/** Stages where a live adapter session is expected to own the record. */
export const IN_PROGRESS_STAGES: ReadonlySet<DispatchStage> = new Set<DispatchStage>([
  "scouting",
  "implementing",
  "reviewing",
  "merging",
  "resolving_integration",
]);

function dispatchStatePath(projectRoot: string): string {
  return join(projectRoot, ".aegis", "dispatch-state.json");
}

export function emptyDispatchState(): DispatchState {
  return {
    schemaVersion: 1,
    records: {},
  };
}

export function createDispatchRecord(
  issueId: string,
  sessionProvenanceId: string,
  timestamp: string,
): DispatchRecord {
  return {
    issueId,
    stage: "pending",
    runningAgent: null,
    lastCompletedCaste: null,
    blockedByIssueId: null,
    reviewFeedbackRef: null,
    policyArtifactRef: null,
    oracleAssessmentRef: null,
    oracleReady: null,
    oracleDecompose: null,
    oracleBlockers: null,
    titanHandoffRef: null,
    titanClarificationRef: null,
    sentinelVerdictRef: null,
    janusArtifactRef: null,
    failureTranscriptRef: null,
    operationalFailureKind: null,
    fileScope: null,
    failureCount: 0,
    consecutiveFailures: 0,
    failureWindowStartMs: null,
    cooldownUntil: null,
    sessionProvenanceId,
    updatedAt: timestamp,
  };
}

export function loadDispatchState(projectRoot: string): DispatchState {
  const filePath = dispatchStatePath(projectRoot);

  if (!existsSync(filePath)) {
    return emptyDispatchState();
  }

  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch (err) {
    throw new Error(
      `loadDispatchState: failed to read ${filePath}: ${(err as Error).message}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `loadDispatchState: malformed JSON in ${filePath}: ${(err as Error).message}`,
    );
  }

  if (
    typeof parsed !== "object"
    || parsed === null
    || (parsed as Record<string, unknown>)["schemaVersion"] !== 1
  ) {
    throw new Error(
      `loadDispatchState: invalid or unsupported schemaVersion in ${filePath} `
        + `(expected 1, got ${(parsed as Record<string, unknown>)?.["schemaVersion"]})`,
    );
  }

  const obj = parsed as Record<string, unknown>;
  if (typeof obj["records"] !== "object" || obj["records"] === null) {
    throw new Error(
      `loadDispatchState: missing or invalid 'records' field in ${filePath}`,
    );
  }

  return parsed as DispatchState;
}

export function saveDispatchState(projectRoot: string, state: DispatchState): void {
  writeJsonAtomic(dispatchStatePath(projectRoot), state);
}

export function replaceDispatchRecord(
  state: DispatchState,
  issueId: string,
  record: DispatchRecord,
): DispatchState {
  return {
    schemaVersion: state.schemaVersion,
    records: {
      ...state.records,
      [issueId]: record,
    },
  };
}

/** Loads the latest state, replaces one record, and saves it back. */
export function saveDispatchRecord(projectRoot: string, record: DispatchRecord) {
  saveDispatchState(projectRoot, replaceDispatchRecord(loadDispatchState(projectRoot), record.issueId, record));
}

/**
 * Marks in-progress records owned by another daemon as operational failures.
 * Interrupted Sentinel reviews retry at the review layer. Mechanical merge
 * stages own no model session, so they resume instead of redoing Titan work:
 * an interrupted merge requeues, and escalated work still awaiting its Janus
 * launch keeps waiting for it.
 */
export function reconcileDispatchState(
  state: DispatchState,
  liveSessionId: string,
  timestamp = new Date().toISOString(),
): DispatchState {
  const reconciledRecords: Record<string, DispatchRecord> = {};

  for (const [issueId, record] of Object.entries(state.records)) {
    if (!IN_PROGRESS_STAGES.has(record.stage) || record.sessionProvenanceId === liveSessionId) {
      reconciledRecords[issueId] = { ...record };
      continue;
    }

    if (
      record.runningAgent === null
      && (record.stage === "merging" || record.stage === "resolving_integration")
    ) {
      reconciledRecords[issueId] = {
        ...record,
        stage: record.stage === "merging" ? "queued_for_merge" : record.stage,
        sessionProvenanceId: liveSessionId,
        updatedAt: timestamp,
      };
      continue;
    }

    const failed = record.stage === "reviewing" && record.runningAgent?.caste === "sentinel"
      ? applySentinelOperationalFailure(record, { timestamp })
      : applyOperationalFailure(record, { timestamp, cooldown: false });
    reconciledRecords[issueId] = {
      ...failed,
      sessionProvenanceId: liveSessionId,
    };
  }

  return {
    schemaVersion: state.schemaVersion,
    records: reconciledRecords,
  };
}

function resolveStoppedStage(record: DispatchRecord): DispatchStage {
  switch (record.stage) {
    case "scouting":
      return "pending";
    case "implementing":
      return "scouted";
    case "reviewing":
      return "implemented";
    case "merging":
      return "queued_for_merge";
    default:
      // `resolving_integration` stays put so the next daemon relaunches Janus.
      return record.stage;
  }
}

/** Rolls running records back one stage after a clean daemon stop. */
export function releaseStoppedRunningRecords(
  state: DispatchState,
  sessionProvenanceId: string,
  timestamp = new Date().toISOString(),
): DispatchState {
  const records = Object.fromEntries(
    Object.entries(state.records).map(([issueId, record]) => [
      issueId,
      record.runningAgent
        ? {
          ...record,
          stage: resolveStoppedStage(record),
          runningAgent: null,
          cooldownUntil: null,
          sessionProvenanceId,
          updatedAt: timestamp,
        }
        : { ...record },
    ]),
  );

  return {
    schemaVersion: state.schemaVersion,
    records,
  };
}

export function listRunningRecords(state: DispatchState) {
  return Object.values(state.records).filter((record) => record.runningAgent !== null);
}

export function countRunningAgents(state: DispatchState, caste?: AgentCaste) {
  return Object.values(state.records).filter((record) =>
    record.runningAgent !== null && (caste === undefined || record.runningAgent.caste === caste)).length;
}
