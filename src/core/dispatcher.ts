import { createDispatchRecord, type DispatchState } from "./dispatch-state.js";
import type { DispatchDecision } from "./triage.js";
import type { AgentRuntime } from "../runtime/agent-runtime.js";
import { writePhaseLog, writePhaseLogEntry, type PhaseLogWriter } from "./phase-log.js";
import { applyOperationalFailure } from "./failure-policy.js";

export interface DispatchInput {
  dispatchState: DispatchState;
  decisions: DispatchDecision[];
  runtime: AgentRuntime;
  root: string;
  sessionProvenanceId: string;
  now?: string;
  /** Writer for the `_all` pass summary; defaults to always writing. */
  writeSummaryLog?: PhaseLogWriter;
}

export interface DispatchResult {
  state: DispatchState;
  dispatched: string[];
  failed: string[];
}

/**
 * Launches one adapter session per triage decision and records it as the
 * issue's `runningAgent`. Launch only starts work; monitor and reaper own
 * completion.
 */
export async function dispatchReadyWork(input: DispatchInput): Promise<DispatchResult> {
  const timestamp = input.now ?? new Date().toISOString();
  const records = { ...input.dispatchState.records };
  const dispatched: string[] = [];
  const failed: string[] = [];

  for (const decision of input.decisions) {
    const baseRecord = records[decision.issueId]
      ?? createDispatchRecord(decision.issueId, input.sessionProvenanceId, timestamp);

    try {
      const launched = await input.runtime.launch({
        root: input.root,
        issueId: decision.issueId,
        title: decision.title,
        caste: decision.caste,
        stage: decision.stage,
      });

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
      records[decision.issueId] = {
        ...applyOperationalFailure(baseRecord, { timestamp, errorMessage: detail }),
        sessionProvenanceId: input.sessionProvenanceId,
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

      // A launch error usually means the adapter itself is unhealthy, so the
      // rest of this pass fails closed instead of repeating the same error.
      break;
    }
  }

  (input.writeSummaryLog ?? writePhaseLogEntry)(input.root, {
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
