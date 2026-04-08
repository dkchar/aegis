import type { EvalRunResult } from "./result-schema.js";
import {
  MVP_GATE_SCENARIO_IDS,
  type MvpScenarioId,
} from "./wire-mvp-scenarios.js";

export const RELEASE_METRIC_KEYS = [
  "issue_completion_rate",
  "structured_artifact_compliance_rate",
  "clarification_compliance_rate",
  "merge_conflict_rate_per_titan",
  "merge_queue_latency_ms",
  "rework_loops_per_issue",
  "janus_invocation_rate_per_10_issues",
  "janus_success_rate",
  "messaging_token_overhead",
  "human_interventions_per_10_issues",
  "cost_per_completed_issue_usd",
  "restart_recovery_success_rate",
] as const;

export type ReleaseMetricKey = (typeof RELEASE_METRIC_KEYS)[number];

export interface ReleaseScenarioArtifact {
  scenario_id: MvpScenarioId;
  result_path: string;
  summary_path: string | null;
}

export type ReleaseArtifactCatalog = Record<MvpScenarioId, ReleaseScenarioArtifact>;

export type ReleaseMetricValue = number | null;

export type ReleaseMetrics = Record<ReleaseMetricKey, ReleaseMetricValue> & {
  scenario_count: number;
  direct_to_main_bypass_count: number | null;
};

export function createEmptyReleaseMetrics(): ReleaseMetrics {
  return {
    scenario_count: 0,
    direct_to_main_bypass_count: null,
    issue_completion_rate: null,
    structured_artifact_compliance_rate: null,
    clarification_compliance_rate: null,
    merge_conflict_rate_per_titan: null,
    merge_queue_latency_ms: null,
    rework_loops_per_issue: null,
    janus_invocation_rate_per_10_issues: null,
    janus_success_rate: null,
    messaging_token_overhead: null,
    human_interventions_per_10_issues: null,
    cost_per_completed_issue_usd: null,
    restart_recovery_success_rate: null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function validateScenarioArtifact(
  scenarioId: MvpScenarioId,
  artifact: unknown,
): ReleaseScenarioArtifact {
  if (!isRecord(artifact)) {
    throw new Error(`Release artifact for ${scenarioId} must be an object`);
  }

  if (artifact["scenario_id"] !== scenarioId) {
    throw new Error(
      `Release artifact for ${scenarioId} must declare scenario_id ${scenarioId}`,
    );
  }

  if (
    typeof artifact["result_path"] !== "string"
    || artifact["result_path"].length === 0
  ) {
    throw new Error(`Release artifact for ${scenarioId} must include result_path`);
  }

  if (
    artifact["summary_path"] !== null
    && (
      typeof artifact["summary_path"] !== "string"
      || artifact["summary_path"].length === 0
    )
  ) {
    throw new Error(
      `Release artifact for ${scenarioId} must include summary_path or null`,
    );
  }

  return {
    scenario_id: scenarioId,
    result_path: artifact["result_path"],
    summary_path: artifact["summary_path"],
  };
}

export function normalizeReleaseArtifactCatalog(
  catalog: Partial<Record<MvpScenarioId, ReleaseScenarioArtifact>>,
): ReleaseScenarioArtifact[] {
  return MVP_GATE_SCENARIO_IDS.map((scenarioId) => {
    const artifact = catalog[scenarioId];

    if (!artifact) {
      throw new Error(
        `Release artifact catalog must include scenario ${scenarioId}`,
      );
    }

    return validateScenarioArtifact(scenarioId, artifact);
  });
}

const STRUCTURED_ARTIFACT_KEYS = [
  "oracle",
  "titan",
  "sentinel",
  "janus",
] as const;

function toLatencyMs(
  queuedAt: string | null | undefined,
  mergedAt: string | null | undefined,
): number | null {
  if (!queuedAt || !mergedAt) {
    return null;
  }

  const queuedAtMs = new Date(queuedAt).getTime();
  const mergedAtMs = new Date(mergedAt).getTime();

  if (Number.isNaN(queuedAtMs) || Number.isNaN(mergedAtMs)) {
    return null;
  }

  return Math.max(0, mergedAtMs - queuedAtMs);
}

function median(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }

  return (sorted[middle - 1] + sorted[middle]) / 2;
}

export function computeReleaseMetrics(
  results: readonly EvalRunResult[],
): ReleaseMetrics {
  let totalIssueCount = 0;
  let totalCompletedCount = 0;
  let expectedArtifactCount = 0;
  let compliantArtifactCount = 0;
  let expectedClarificationCount = 0;
  let compliantClarificationCount = 0;
  let titanExpectedCount = 0;
  let totalConflictCount = 0;
  let totalReworkCount = 0;
  let janusInvocationCount = 0;
  let janusSuccessCount = 0;
  let directToMainBypassCount = 0;
  let humanInterventionCount = 0;
  let exactDollarMeteringAvailable = true;
  let totalCostUsd = 0;
  let expectedRestartRecoveryCount = 0;
  let recoveredRestartCount = 0;

  const mergeQueueLatenciesMs: number[] = [];

  for (const result of results) {
    totalIssueCount += result.issue_count;
    totalCompletedCount += Object.values(result.completion_outcomes).filter(
      (outcome) => outcome === "completed",
    ).length;
    humanInterventionCount += result.human_intervention_issue_ids.length;

    if (result.cost_totals === null) {
      exactDollarMeteringAvailable = false;
    } else {
      totalCostUsd += result.cost_totals.total_usd;
    }

    for (const issueEvidence of Object.values(result.issue_evidence)) {
      for (const key of STRUCTURED_ARTIFACT_KEYS) {
        const artifact = issueEvidence.structured_artifacts[key];
        if (!artifact.expected) {
          continue;
        }

        expectedArtifactCount += 1;
        if (artifact.compliant === true) {
          compliantArtifactCount += 1;
        }
      }

      if (issueEvidence.clarification.expected) {
        expectedClarificationCount += 1;
        if (issueEvidence.clarification.compliant === true) {
          compliantClarificationCount += 1;
        }
      }

      if (issueEvidence.structured_artifacts.titan.expected) {
        titanExpectedCount += 1;
      }

      totalConflictCount += issueEvidence.merge_queue.conflict_count;
      totalReworkCount += issueEvidence.merge_queue.rework_count;

      if (issueEvidence.merge_queue.direct_to_main_bypass) {
        directToMainBypassCount += 1;
      }

      if (issueEvidence.merge_queue.janus_invoked) {
        janusInvocationCount += 1;
        if (issueEvidence.merge_queue.janus_succeeded) {
          janusSuccessCount += 1;
        }
      }

      const latencyMs = toLatencyMs(
        issueEvidence.merge_queue.queued_at,
        issueEvidence.merge_queue.merged_at,
      );
      if (latencyMs !== null) {
        mergeQueueLatenciesMs.push(latencyMs);
      }

      if (issueEvidence.restart_recovery.expected) {
        expectedRestartRecoveryCount += 1;
        if (issueEvidence.restart_recovery.recovered === true) {
          recoveredRestartCount += 1;
        }
      }
    }
  }

  return {
    scenario_count: results.length,
    direct_to_main_bypass_count: directToMainBypassCount,
    issue_completion_rate:
      totalIssueCount === 0 ? 0 : totalCompletedCount / totalIssueCount,
    structured_artifact_compliance_rate:
      expectedArtifactCount === 0
        ? 1
        : compliantArtifactCount / expectedArtifactCount,
    clarification_compliance_rate:
      expectedClarificationCount === 0
        ? 1
        : compliantClarificationCount / expectedClarificationCount,
    merge_conflict_rate_per_titan:
      titanExpectedCount === 0 ? 0 : totalConflictCount / titanExpectedCount,
    merge_queue_latency_ms: median(mergeQueueLatenciesMs),
    rework_loops_per_issue:
      totalIssueCount === 0 ? 0 : totalReworkCount / totalIssueCount,
    janus_invocation_rate_per_10_issues:
      totalIssueCount === 0 ? 0 : (janusInvocationCount * 10) / totalIssueCount,
    janus_success_rate:
      janusInvocationCount === 0 ? null : janusSuccessCount / janusInvocationCount,
    messaging_token_overhead: null,
    human_interventions_per_10_issues:
      totalCompletedCount === 0
        ? 0
        : (humanInterventionCount * 10) / totalCompletedCount,
    cost_per_completed_issue_usd:
      !exactDollarMeteringAvailable || totalCompletedCount === 0
        ? null
        : totalCostUsd / totalCompletedCount,
    restart_recovery_success_rate:
      expectedRestartRecoveryCount === 0
        ? null
        : recoveredRestartCount / expectedRestartRecoveryCount,
  };
}
