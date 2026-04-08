/**
 * Score summary computation for completed eval run results.
 *
 * Derives the SPECv2 §24.7 metrics and §24.8 release-gate flags from a
 * completed EvalRunResult.
 */

import { computeReleaseMetrics } from "./compute-metrics.js";
import type { EvalRunResult, ScoreSummary } from "./result-schema.js";

// ---------------------------------------------------------------------------
// Optional config surface (threshold overrides)
// ---------------------------------------------------------------------------

export interface ScoreSummaryConfig {
  /** Maximum human interventions per 10 issues before the gate fails. Default: 2. */
  max_human_interventions_per_10_issues?: number;
}

const DEFAULT_MAX_HUMAN_INTERVENTIONS_PER_10 = 2;

// ---------------------------------------------------------------------------
// computeScoreSummary
// ---------------------------------------------------------------------------

/**
 * Compute all SPECv2 §24.7 canonical metrics and §24.8 release-gate flags
 * from a completed EvalRunResult.
 *
 * Division-by-zero cases return 0 or safe defaults where noted in the spec.
 */
export function computeScoreSummary(
  result: EvalRunResult,
  config: ScoreSummaryConfig = {},
): ScoreSummary {
  const maxHumanPer10 =
    config.max_human_interventions_per_10_issues ??
    DEFAULT_MAX_HUMAN_INTERVENTIONS_PER_10;
  const metrics = computeReleaseMetrics([result]);

  const completionRate = metrics.issue_completion_rate ?? 0;
  const structuredArtifactComplianceRate =
    metrics.structured_artifact_compliance_rate ?? 1;
  const clarificationComplianceRate =
    metrics.clarification_compliance_rate ?? 1;
  const mergeConflictRatePerTitan =
    metrics.merge_conflict_rate_per_titan ?? 0;
  const mergeQueueLatencyMs = metrics.merge_queue_latency_ms ?? 0;
  const reworkLoopsPerIssue = metrics.rework_loops_per_issue ?? 0;
  const janusInvocationRatePer10Issues =
    metrics.janus_invocation_rate_per_10_issues ?? 0;
  const janusSuccessRate = metrics.janus_success_rate;
  const messagingTokenOverhead = metrics.messaging_token_overhead;
  const humanInterventionsPer10Issues =
    metrics.human_interventions_per_10_issues ?? 0;
  const costPerCompletedIssueUsd = metrics.cost_per_completed_issue_usd;
  const restartRecoverySuccessRate = metrics.restart_recovery_success_rate;
  const directToMainBypassCount = metrics.direct_to_main_bypass_count ?? 0;

  const gates: ScoreSummary["gates"] = {
    structured_artifact_compliance_100pct:
      structuredArtifactComplianceRate === 1.0,
    clarification_compliance_100pct: clarificationComplianceRate === 1.0,
    restart_recovery_100pct:
      restartRecoverySuccessRate === null
      || restartRecoverySuccessRate === 1.0,
    no_direct_to_main_bypasses: directToMainBypassCount === 0,
    issue_completion_rate_80pct: completionRate >= 0.8,
    human_interventions_within_threshold:
      humanInterventionsPer10Issues <= maxHumanPer10,
    janus_minority_path: janusInvocationRatePer10Issues < 5,
  };

  return {
    scenario_id: result.scenario_id,
    run_timestamp: result.timing.started_at,
    issue_completion_rate: completionRate,
    structured_artifact_compliance_rate: structuredArtifactComplianceRate,
    clarification_compliance_rate: clarificationComplianceRate,
    merge_conflict_rate_per_titan: mergeConflictRatePerTitan,
    merge_queue_latency_ms: mergeQueueLatencyMs,
    rework_loops_per_issue: reworkLoopsPerIssue,
    janus_invocation_rate_per_10_issues: janusInvocationRatePer10Issues,
    janus_success_rate: janusSuccessRate,
    messaging_token_overhead: messagingTokenOverhead,
    human_interventions_per_10_issues: humanInterventionsPer10Issues,
    cost_per_completed_issue_usd: costPerCompletedIssueUsd,
    restart_recovery_success_rate: restartRecoverySuccessRate,
    gates,
  };
}
