import type { DispatchState } from "./dispatch-state.js";
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

export async function dispatchReadyWork(input: DispatchInput): Promise<DispatchResult> {
  const timestamp = input.now ?? new Date().toISOString();
  const cooldownUntil = calculateFailureCooldown(timestamp);
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
      const oracleAssessmentRef = decision.caste === "oracle"
        ? null
        : previous?.oracleAssessmentRef ?? null;

      records[decision.issueId] = {
        issueId: decision.issueId,
        stage: decision.stage,
        runningAgent: {
          caste: decision.caste,
          sessionId: launched.sessionId,
          startedAt: launched.startedAt,
        },
        oracleAssessmentRef,
        oracleReady: decision.caste === "oracle" ? null : previous?.oracleReady ?? null,
        oracleDecompose: decision.caste === "oracle" ? null : previous?.oracleDecompose ?? null,
        oracleBlockers: decision.caste === "oracle" ? null : previous?.oracleBlockers ?? null,
        titanHandoffRef: null,
        titanClarificationRef: null,
        sentinelVerdictRef: null,
        janusArtifactRef: null,
        failureTranscriptRef: null,
        fileScope: previous?.fileScope ?? null,
        failureCount: previous?.failureCount ?? 0,
        consecutiveFailures: previous?.consecutiveFailures ?? 0,
        failureWindowStartMs: previous?.failureWindowStartMs ?? null,
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
      records[decision.issueId] = {
        issueId: decision.issueId,
        stage: "failed",
        runningAgent: null,
        oracleAssessmentRef: previous?.oracleAssessmentRef ?? null,
        oracleReady: previous?.oracleReady ?? null,
        oracleDecompose: previous?.oracleDecompose ?? null,
        oracleBlockers: previous?.oracleBlockers ?? null,
        titanHandoffRef: previous?.titanHandoffRef ?? null,
        titanClarificationRef: previous?.titanClarificationRef ?? null,
        sentinelVerdictRef: previous?.sentinelVerdictRef ?? null,
        janusArtifactRef: previous?.janusArtifactRef ?? null,
        failureTranscriptRef: previous?.failureTranscriptRef ?? null,
        fileScope: previous?.fileScope ?? null,
        failureCount: (previous?.failureCount ?? 0) + 1,
        consecutiveFailures: (previous?.consecutiveFailures ?? 0) + 1,
        failureWindowStartMs: previous?.failureWindowStartMs
          ?? resolveFailureWindowStartMs(timestamp),
        cooldownUntil,
        sessionProvenanceId: input.sessionProvenanceId,
        updatedAt: timestamp,
      };
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
