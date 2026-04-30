import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  calculateFailureCooldown,
  type OperationalFailureKind,
  resolveFailureWindowStartMs,
  shouldEscalateSentinelOperationalFailure,
} from "./failure-policy.js";
import { renameWithRetries } from "../shared/atomic-write.js";

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

function aegisDir(projectRoot: string): string {
  return join(projectRoot, ".aegis");
}

function dispatchStatePath(projectRoot: string): string {
  return join(aegisDir(projectRoot), "dispatch-state.json");
}

function dispatchStateTmpPath(projectRoot: string): string {
  return join(aegisDir(projectRoot), "dispatch-state.json.tmp");
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
  const dir = aegisDir(projectRoot);
  mkdirSync(dir, { recursive: true });

  const tmpPath = dispatchStateTmpPath(projectRoot);
  const finalPath = dispatchStatePath(projectRoot);
  writeFileSync(tmpPath, JSON.stringify(state, null, 2), "utf-8");
  renameWithRetries(tmpPath, finalPath);
}

const IN_PROGRESS_STAGES = new Set<DispatchStage>([
  "scouting",
  "implementing",
  "reviewing",
  "merging",
  "resolving_integration",
]);

export function reconcileDispatchState(
  state: DispatchState,
  liveSessionId: string,
  timestamp = new Date().toISOString(),
): DispatchState {
  const reconciledRecords: Record<string, DispatchRecord> = {};

  for (const [issueId, record] of Object.entries(state.records)) {
    if (
      IN_PROGRESS_STAGES.has(record.stage)
      && record.sessionProvenanceId !== liveSessionId
    ) {
      if (record.stage === "reviewing" && record.runningAgent?.caste === "sentinel") {
        const nextConsecutiveFailures = record.consecutiveFailures + 1;
        reconciledRecords[issueId] = {
          ...record,
          stage: shouldEscalateSentinelOperationalFailure(nextConsecutiveFailures)
            ? "failed_operational"
            : "implemented",
          runningAgent: null,
          failureCount: record.failureCount + 1,
          consecutiveFailures: nextConsecutiveFailures,
          operationalFailureKind: "runtime_failure",
          failureWindowStartMs: record.failureWindowStartMs
            ?? resolveFailureWindowStartMs(timestamp),
          cooldownUntil: calculateFailureCooldown(timestamp),
          sessionProvenanceId: liveSessionId,
          updatedAt: timestamp,
        };
        continue;
      }

      reconciledRecords[issueId] = {
        ...record,
        stage: "failed_operational",
        runningAgent: null,
        failureCount: record.failureCount + 1,
        consecutiveFailures: record.consecutiveFailures + 1,
        operationalFailureKind: "runtime_failure",
        failureWindowStartMs: record.failureWindowStartMs
          ?? resolveFailureWindowStartMs(timestamp),
        cooldownUntil: null,
        sessionProvenanceId: liveSessionId,
        updatedAt: timestamp,
      };
    } else {
      reconciledRecords[issueId] = { ...record };
    }
  }

  return {
    schemaVersion: state.schemaVersion,
    records: reconciledRecords,
  };
}

export function emptyDispatchState(): DispatchState {
  return {
    schemaVersion: 1,
    records: {},
  };
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

export function activeTitanScopes(state: DispatchState): Array<{ issueId: string; files: string[] }> {
  const result: Array<{ issueId: string; files: string[] }> = [];
  for (const record of Object.values(state.records)) {
    if (record.stage === "implementing" && record.fileScope !== null) {
      result.push({
        issueId: record.issueId,
        files: [...record.fileScope.files],
      });
    }
  }
  return result;
}
