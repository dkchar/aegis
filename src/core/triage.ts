import type { AegisConfig } from "../config/schema.js";
import type { DispatchRecord, DispatchState } from "./dispatch-state.js";
import type { TrackerReadyIssue } from "../tracker/tracker.js";

export type TriageSkipReason =
  | "capacity"
  | "cooldown"
  | "in_progress"
  | "phase_e_required";

export interface DispatchDecision {
  issueId: string;
  title: string;
  caste: "oracle";
  stage: "scouting";
}

export interface SkipDecision {
  issueId: string;
  reason: TriageSkipReason;
}

export interface TriageInput {
  readyIssues: TrackerReadyIssue[];
  dispatchState: DispatchState;
  config: Pick<AegisConfig, "concurrency">;
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

function needsFuturePhase(record: DispatchRecord) {
  return record.stage !== "failed" && record.stage !== "pending";
}

function countActiveOracles(state: DispatchState) {
  return Object.values(state.records).filter(
    (record) => record.runningAgent?.caste === "oracle",
  ).length;
}

export function triageReadyWork(input: TriageInput): TriageResult {
  const nowMs = Date.parse(input.now ?? new Date().toISOString());
  const dispatchable: DispatchDecision[] = [];
  const skipped: SkipDecision[] = [];
  const activeAgentCount = Object.values(input.dispatchState.records).filter(
    (record) => record.runningAgent !== null,
  ).length;
  const activeOracleCount = countActiveOracles(input.dispatchState);
  let reservedAgents = 0;
  let reservedOracles = 0;

  for (const issue of input.readyIssues) {
    const record = input.dispatchState.records[issue.id];

    if (record?.runningAgent) {
      skipped.push({
        issueId: issue.id,
        reason: "in_progress",
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
        reason: "phase_e_required",
      });
      continue;
    }

    const reachedAgentCapacity =
      activeAgentCount + reservedAgents >= input.config.concurrency.max_agents;
    const reachedOracleCapacity =
      activeOracleCount + reservedOracles >= input.config.concurrency.max_oracles;

    if (reachedAgentCapacity || reachedOracleCapacity) {
      skipped.push({
        issueId: issue.id,
        reason: "capacity",
      });
      continue;
    }

    dispatchable.push({
      issueId: issue.id,
      title: issue.title,
      caste: "oracle",
      stage: "scouting",
    });
    reservedAgents += 1;
    reservedOracles += 1;
  }

  return {
    dispatchable,
    skipped,
  };
}
