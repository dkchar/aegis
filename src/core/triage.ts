import type { AegisConfig } from "../config/schema.js";
import { countRunningAgents, type DispatchRecord, type DispatchState } from "./dispatch-state.js";
import type { TrackerReadyIssue } from "../tracker/tracker.js";
import { hasExhaustedOperationalRetries } from "./failure-policy.js";
import { calculateScopeOverlapCount } from "../shared/file-scope.js";

export type TriageSkipReason =
  | "capacity"
  | "cooldown"
  | "in_progress"
  | "already_progressed"
  | "blocked"
  | "operational_failure_limit"
  | "scope_overlap";

export interface DispatchDecision {
  issueId: string;
  title: string;
  caste: "oracle" | "titan";
  stage: "scouting" | "implementing";
}

export interface SkipDecision {
  issueId: string;
  reason: TriageSkipReason;
}

export interface TriageInput {
  readyIssues: TrackerReadyIssue[];
  dispatchState: DispatchState;
  config: Pick<AegisConfig, "concurrency" | "thresholds">;
  now?: string;
}

export interface TriageResult {
  dispatchable: DispatchDecision[];
  skipped: SkipDecision[];
}

function isCoolingDown(record: DispatchRecord, nowMs: number) {
  if (!record.cooldownUntil) {
    return false;
  }

  const cooldownMs = Date.parse(record.cooldownUntil);
  return Number.isFinite(cooldownMs) && cooldownMs > nowMs;
}

function resolveFailedIssueSkipReason(record: DispatchRecord): TriageSkipReason | null {
  if (
    record.stage === "complete"
    || record.stage === "implemented"
    || record.stage === "reviewing"
    || record.stage === "queued_for_merge"
    || record.stage === "merging"
    || record.stage === "resolving_integration"
  ) {
    return "already_progressed";
  }

  if (record.stage !== "failed_operational") {
    return null;
  }

  if (hasExhaustedOperationalRetries(record.consecutiveFailures)) {
    return "operational_failure_limit";
  }

  return null;
}

function needsFuturePhase(record: DispatchRecord) {
  return record.stage !== "pending"
    && record.stage !== "scouted"
    && record.stage !== "rework_required"
    && record.stage !== "blocked_on_child"
    && record.stage !== "failed_operational";
}

function resolveDecision(
  issue: TrackerReadyIssue,
  record: DispatchRecord | undefined,
): DispatchDecision {
  if (
    record?.stage === "scouted"
    || record?.stage === "rework_required"
    || record?.stage === "blocked_on_child"
    || (record?.stage === "failed_operational" && record.oracleAssessmentRef !== null && record.fileScope !== null)
  ) {
    return {
      issueId: issue.id,
      title: issue.title,
      caste: "titan",
      stage: "implementing",
    };
  }

  return {
    issueId: issue.id,
    title: issue.title,
    caste: "oracle",
    stage: "scouting",
  };
}

const MERGE_RESERVED_SCOPE_STAGES = new Set<DispatchRecord["stage"]>([
  "implementing",
  "implemented",
  "reviewing",
  "queued_for_merge",
  "merging",
  "resolving_integration",
]);

export function triageReadyWork(input: TriageInput): TriageResult {
  const nowMs = Date.parse(input.now ?? new Date().toISOString());
  const dispatchable: DispatchDecision[] = [];
  const skipped: SkipDecision[] = [];
  const activeAgentCount = countRunningAgents(input.dispatchState);
  const activeOracleCount = countRunningAgents(input.dispatchState, "oracle");
  const activeTitanCount = countRunningAgents(input.dispatchState, "titan");
  let reservedAgents = 0;
  let reservedOracles = 0;
  let reservedTitans = 0;
  const reservedTitanScopes: string[][] = [];
  const reservedScopes = Object.values(input.dispatchState.records)
    .filter((record) => MERGE_RESERVED_SCOPE_STAGES.has(record.stage) && record.fileScope !== null)
    .map((record) => record.fileScope!.files);
  const scopeOverlapThreshold = input.config.thresholds.scope_overlap_threshold;

  for (const issue of input.readyIssues) {
    const record = input.dispatchState.records[issue.id];

    if (record?.runningAgent) {
      skipped.push({
        issueId: issue.id,
        reason: "in_progress",
      });
      continue;
    }

    const failedIssueSkipReason = record ? resolveFailedIssueSkipReason(record) : null;
    if (failedIssueSkipReason) {
      skipped.push({
        issueId: issue.id,
        reason: failedIssueSkipReason,
      });
      continue;
    }

    if (record && isCoolingDown(record, nowMs)) {
      skipped.push({
        issueId: issue.id,
        reason: "cooldown",
      });
      continue;
    }

    if (record && needsFuturePhase(record)) {
      skipped.push({
        issueId: issue.id,
        reason: "already_progressed",
      });
      continue;
    }

    const decision = resolveDecision(issue, record);
    const titanScope = decision.caste === "titan" ? record?.fileScope?.files ?? null : null;
    if (titanScope) {
      const overlaps = (files: string[]) => calculateScopeOverlapCount(titanScope, files) > scopeOverlapThreshold;
      if (reservedScopes.some(overlaps) || reservedTitanScopes.some(overlaps)) {
        skipped.push({
          issueId: issue.id,
          reason: "scope_overlap",
        });
        continue;
      }
    }

    const reachedAgentCapacity =
      activeAgentCount + reservedAgents >= input.config.concurrency.max_agents;
    const reachedCasteCapacity = decision.caste === "oracle"
      ? activeOracleCount + reservedOracles >= input.config.concurrency.max_oracles
      : activeTitanCount + reservedTitans >= input.config.concurrency.max_titans;

    if (reachedAgentCapacity || reachedCasteCapacity) {
      skipped.push({
        issueId: issue.id,
        reason: "capacity",
      });
      continue;
    }

    dispatchable.push(decision);
    reservedAgents += 1;
    if (decision.caste === "oracle") {
      reservedOracles += 1;
    } else {
      reservedTitans += 1;
      if (titanScope) {
        reservedTitanScopes.push([...titanScope]);
      }
    }
  }

  return {
    dispatchable,
    skipped,
  };
}
