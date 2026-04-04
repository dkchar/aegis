/**
 * Run comparison utility — S02 lane B.
 *
 * Provides `compareScoreSummaries`, which produces a RegressionReport by
 * comparing all numeric metrics between a baseline and a current ScoreSummary.
 */

import type { ScoreSummary } from "./result-schema.js";

// ---------------------------------------------------------------------------
// RegressionReport
// ---------------------------------------------------------------------------

export interface MetricDelta {
  metric: string;
  baseline_value: number;
  current_value: number;
  delta: number;
}

export interface RegressionReport {
  regressions: MetricDelta[];
  improvements: MetricDelta[];
  has_regressions: boolean;
}

// ---------------------------------------------------------------------------
// Metric extraction
// ---------------------------------------------------------------------------

/**
 * Metrics where a *higher* value is better.
 * A regression is detected when current < baseline.
 */
const HIGHER_IS_BETTER = new Set<string>([
  "issue_completion_rate",
  "structured_artifact_compliance_rate",
  "clarification_compliance_rate",
  "janus_success_rate",
  "restart_recovery_success_rate",
]);

/**
 * Metrics where a *lower* value is better.
 * A regression is detected when current > baseline.
 */
const LOWER_IS_BETTER = new Set<string>([
  "merge_conflict_rate_per_titan",
  "merge_queue_latency_ms",
  "rework_loops_per_issue",
  "janus_invocation_rate_per_10_issues",
  "human_interventions_per_10_issues",
  "cost_per_completed_issue_usd",
]);

type NumericMetricKey = keyof {
  [K in keyof ScoreSummary as ScoreSummary[K] extends number ? K : never]: ScoreSummary[K];
};

/** Extract all numeric (non-null) metric fields from a ScoreSummary. */
function extractNumericMetrics(summary: ScoreSummary): Map<string, number> {
  const result = new Map<string, number>();

  const numericKeys: NumericMetricKey[] = [
    "issue_completion_rate",
    "structured_artifact_compliance_rate",
    "clarification_compliance_rate",
    "merge_conflict_rate_per_titan",
    "merge_queue_latency_ms",
    "rework_loops_per_issue",
    "janus_invocation_rate_per_10_issues",
    "human_interventions_per_10_issues",
  ];

  for (const key of numericKeys) {
    const value = summary[key];
    if (typeof value === "number") {
      result.set(key, value);
    }
  }

  // Include nullable numeric metrics when the run has a value.
  // messaging_token_overhead is omitted from direction sets — not yet classifiable.
  if (typeof summary.janus_success_rate === "number") {
    result.set("janus_success_rate", summary.janus_success_rate);
  }
  if (typeof summary.messaging_token_overhead === "number") {
    result.set("messaging_token_overhead", summary.messaging_token_overhead);
  }
  if (typeof summary.cost_per_completed_issue_usd === "number") {
    result.set("cost_per_completed_issue_usd", summary.cost_per_completed_issue_usd);
  }
  if (typeof summary.restart_recovery_success_rate === "number") {
    result.set("restart_recovery_success_rate", summary.restart_recovery_success_rate);
  }

  return result;
}

// ---------------------------------------------------------------------------
// compareScoreSummaries
// ---------------------------------------------------------------------------

/**
 * Compare two ScoreSummary artifacts and produce a RegressionReport.
 *
 * A metric is flagged as a **regression** when the current value is worse
 * than the baseline (direction depends on whether higher or lower is better).
 * A metric is flagged as an **improvement** when the current value is better.
 * Metrics whose direction is unknown are omitted from both lists.
 *
 * Only metrics present in both summaries are compared.
 */
export function compareScoreSummaries(
  baseline: ScoreSummary,
  current: ScoreSummary,
): RegressionReport {
  const baselineMetrics = extractNumericMetrics(baseline);
  const currentMetrics = extractNumericMetrics(current);

  const regressions: MetricDelta[] = [];
  const improvements: MetricDelta[] = [];

  for (const [metric, baselineValue] of baselineMetrics) {
    if (!currentMetrics.has(metric)) continue;
    const currentValue = currentMetrics.get(metric)!;

    const delta = currentValue - baselineValue;

    if (delta === 0) continue;

    if (HIGHER_IS_BETTER.has(metric)) {
      const entry: MetricDelta = { metric, baseline_value: baselineValue, current_value: currentValue, delta };
      if (delta < 0) {
        regressions.push(entry);
      } else {
        improvements.push(entry);
      }
    } else if (LOWER_IS_BETTER.has(metric)) {
      const entry: MetricDelta = { metric, baseline_value: baselineValue, current_value: currentValue, delta };
      if (delta > 0) {
        regressions.push(entry);
      } else {
        improvements.push(entry);
      }
    }
    // metrics with unknown direction (e.g. messaging_token_overhead when we lack context) are skipped
  }

  return {
    regressions,
    improvements,
    has_regressions: regressions.length > 0,
  };
}
