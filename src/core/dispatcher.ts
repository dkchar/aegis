import type { DispatchRecord, DispatchState } from "./dispatch-state.js";
import type { DispatchDecision } from "./triage.js";
import type { AgentRuntime } from "../runtime/agent-runtime.js";
import { writePhaseLog } from "./phase-log.js";
import {
  calculateFailureCooldown,
  resolveFailureWindowStartMs,
} from "./failure-policy.js";

export interface DispatchInput {
  dispatchState: DispatchState;
  decisions: DispatchDecision[];
  runtime: AgentRuntime;
  root: string;
  sessionProvenanceId: string;
  now?: string;
}

export interface DispatchResult {
  state: DispatchState;
  dispatched: string[];
  failed: string[];
}

function createInitialRecord(issueId: string, sessionProvenanceId: string, timestamp: string): DispatchRecord {
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
    fileScope: null,
    failureCount: 0,
    consecutiveFailures: 0,
    failureWindowStartMs: null,
    cooldownUntil: null,
    sessionProvenanceId,
    updatedAt: timestamp,
  };
}

function toFailedOperationalRecord(
  previous: DispatchRecord | undefined,
  issueId: string,
  sessionProvenanceId: string,
  timestamp: string,
): DispatchRecord {
  const record = previous ?? createInitialRecord(issueId, sessionProvenanceId, timestamp);
  return {
    ...record,
    issueId,
    stage: "failed_operational",
    runningAgent: null,
    failureCount: record.failureCount + 1,
    consecutiveFailures: record.consecutiveFailures + 1,
    failureWindowStartMs: record.failureWindowStartMs
      ?? resolveFailureWindowStartMs(timestamp),
    cooldownUntil: calculateFailureCooldown(timestamp),
    sessionProvenanceId,
    updatedAt: timestamp,
  };
}

export async function dispatchReadyWork(input: DispatchInput): Promise<DispatchResult> {
  const timestamp = input.now ?? new Date().toISOString();
  const records = { ...input.dispatchState.records };
  const dispatched: string[] = [];
  const failed: string[] = [];

  for (const decision of input.decisions) {
    try {
      const launched = await input.runtime.launch({
        root: input.root,
        issueId: decision.issueId,
        title: decision.title,
        caste: decision.caste,
        stage: decision.stage,
      });
      const previous = records[decision.issueId];
      const baseRecord = previous ?? createInitialRecord(decision.issueId, input.sessionProvenanceId, timestamp);

      records[decision.issueId] = {
        ...baseRecord,
        stage: decision.stage,
        runningAgent: {
          caste: decision.caste,
          sessionId: launched.sessionId,
          startedAt: launched.startedAt,
        },
        lastCompletedCaste: baseRecord.lastCompletedCaste ?? null,
        cooldownUntil: null,
        sessionProvenanceId: input.sessionProvenanceId,
        updatedAt: timestamp,
      };
      dispatched.push(decision.issueId);
      writePhaseLog(input.root, {
        timestamp,
        phase: "dispatch",
        issueId: decision.issueId,
        action: `launch_${decision.caste}`,
        outcome: "running",
        sessionId: launched.sessionId,
        detail: JSON.stringify({
          caste: decision.caste,
          stage: decision.stage,
        }),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const previous = records[decision.issueId];
      records[decision.issueId] = toFailedOperationalRecord(
        previous,
        decision.issueId,
        input.sessionProvenanceId,
        timestamp,
      );
      failed.push(decision.issueId);
      writePhaseLog(input.root, {
        timestamp,
        phase: "dispatch",
        issueId: decision.issueId,
        action: `launch_${decision.caste}`,
        outcome: "failed",
        detail,
      });

      // Phase D has no durable failure classifier yet, so a launch error
      // fails closed for the remainder of the current dispatch pass.
      break;
    }
  }

  writePhaseLog(input.root, {
    timestamp,
    phase: "dispatch",
    issueId: "_all",
    action: "dispatch_ready_work",
    outcome: failed.length > 0 ? "partial" : "ok",
    detail: JSON.stringify({
      dispatched,
      failed,
      attempted: input.decisions.map((decision) => decision.issueId),
    }),
  });

  return {
    state: {
      schemaVersion: input.dispatchState.schemaVersion,
      records,
    },
    dispatched,
    failed,
  };
}
