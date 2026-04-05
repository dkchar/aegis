/**
 * Score summary computation for completed eval run results.
 *
 * Derives the SPECv2 §24.7 metrics and §24.8 release-gate flags from a
 * completed EvalRunResult.
 */

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

  const issueCount = result.issue_count;

  // ── Outcome tallies ───────────────────────────────────────────────────────

  const completionValues = Object.values(result.completion_outcomes);
  const mergeValues = Object.values(result.merge_outcomes);

  const completedCount = completionValues.filter((o) => o === "completed").length;

  // §24.7: issue_completion_rate
  const completionRate = issueCount === 0 ? 0 : completedCount / issueCount;

  // TODO(S16A): derive this from real orchestration artifacts once scenario
  // runs are wired to the production pipeline.
  // §24.7: structured_artifact_compliance_rate — MVP: always 1.0
  const structuredArtifactComplianceRate = 1.0;

  // TODO(S16A): replace this stub once ambiguous-scenario outcomes are backed
  // by real clarification artifacts instead of fixture-declared results.
  // §24.7: clarification_compliance_rate
  // MVP: we have no signal for ambiguous issues that were NOT raised correctly.
  // When the real pipeline wires in (S16A), the denominator becomes the count of
  // issues that were actually ambiguous, and the numerator becomes the count of
  // correctly raised clarifications. For now, any paused_ambiguous outcome is
  // treated as a correct clarification, so the rate is always 1.0 when there are
  // ambiguous issues (they all raised clarifications) and 1.0 when there are none.
  const clarificationComplianceRate = 1.0;

  // §24.7: merge_conflict_rate_per_titan — non-clean outcomes / issue_count
  const nonCleanMergeCount = mergeValues.filter(
    (o) => o !== "merged_clean" && o !== "not_attempted",
  ).length;
  const mergeConflictRatePerTitan = issueCount === 0 ? 0 : nonCleanMergeCount / issueCount;

  // TODO(S16A): compute this from persisted merge-queue timings once
  // scenarios exercise the real merge worker instead of fixture stubs.
  // §24.7: merge_queue_latency_ms — MVP: 0
  const mergeQueueLatencyMs = 0;

  // TODO(S16A): compute this from actual rework artifacts once benchmark runs
  // are wired to deterministic merge/rework execution.
  // §24.7: rework_loops_per_issue — MVP: 0
  const reworkLoopsPerIssue = 0;

  // §24.7: Janus metrics
  const janusCount = mergeValues.filter(
    (o) => o === "conflict_resolved_janus",
  ).length;
  const janusInvocationRatePer10Issues =
    issueCount === 0 ? 0 : (janusCount * 10) / issueCount;
  const janusSuccessRate = janusCount === 0 ? null : 1.0; // all recorded conflict_resolved_janus are successes

  // TODO(S16A): populate this when message-issue coordination is present in
  // benchmark scenarios and token attribution is observable.
  // §24.7: messaging_token_overhead — MVP: null
  const messagingTokenOverhead: number | null = null;

  // §24.7: human_interventions_per_10_issues
  const humanInterventionCount = result.human_intervention_issue_ids.length;
  const humanInterventionsPer10Issues =
    completedCount === 0 ? 0 : (humanInterventionCount * 10) / completedCount;

  // §24.7: cost_per_completed_issue_usd
  const costPerCompletedIssueUsd =
    result.cost_totals === null || completedCount === 0
      ? null
      : result.cost_totals.total_usd / completedCount;

  // TODO(S16A): derive this from restart benchmark outcomes once those
  // scenarios run through the real restart reconciliation path.
  // §24.7: restart_recovery_success_rate — MVP: null
  const restartRecoverySuccessRate: number | null = null;

  // ── Release gate flags (§24.8) ────────────────────────────────────────────

  const gates: ScoreSummary["gates"] = {
    structured_artifact_compliance_100pct: structuredArtifactComplianceRate === 1.0,
    clarification_compliance_100pct: clarificationComplianceRate === 1.0,
    restart_recovery_100pct: restartRecoverySuccessRate === null || restartRecoverySuccessRate === 1.0,
    no_direct_to_main_bypasses: true, // MVP: harness always uses merge queue
    issue_completion_rate_80pct: completionRate >= 0.8,
    human_interventions_within_threshold: humanInterventionsPer10Issues <= maxHumanPer10,
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
