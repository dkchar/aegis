import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  type ReleaseArtifactCatalog,
  type ReleaseMetrics,
  createEmptyReleaseMetrics,
  normalizeReleaseArtifactCatalog,
} from "./compute-metrics.js";
import { computeScoreSummary } from "./compute-score-summary.js";
import { validateEvalRunResult } from "./validate-result.js";
import type { EvalRunResult, ScoreSummary } from "./result-schema.js";
import type { MvpScenarioId } from "./wire-mvp-scenarios.js";

export const MVP_RELEASE_CHECKLIST_PATH = "docs/mvp-release-checklist.md" as const;

export const RELEASE_GATE_CHECK_IDS = [
  "structured_artifact_compliance_100pct",
  "clarification_compliance_100pct",
  "restart_recovery_100pct",
  "no_direct_to_main_bypasses",
  "issue_completion_rate_80pct",
  "human_interventions_within_threshold",
  "janus_minority_path",
] as const;

export type ReleaseGateCheckId = (typeof RELEASE_GATE_CHECK_IDS)[number];

export interface ReleaseGateThresholds {
  structured_artifact_compliance_rate_min: number;
  clarification_compliance_rate_min: number;
  restart_recovery_success_rate_min: number;
  direct_to_main_bypass_count_max: number;
  issue_completion_rate_min: number;
  human_interventions_per_10_issues_max: number;
  janus_invocation_rate_per_10_issues_max: number;
}

export const DEFAULT_RELEASE_GATE_THRESHOLDS = {
  structured_artifact_compliance_rate_min: 1,
  clarification_compliance_rate_min: 1,
  restart_recovery_success_rate_min: 1,
  direct_to_main_bypass_count_max: 0,
  issue_completion_rate_min: 0.8,
  human_interventions_per_10_issues_max: 2,
  janus_invocation_rate_per_10_issues_max: 5,
} as const satisfies ReleaseGateThresholds;

export type ReleaseGateStatus = "pending" | "pass" | "fail";

export interface ReleaseEvidenceLink {
  scenario_id: MvpScenarioId;
  result_path: string;
  summary_path: string | null;
}

export interface ReleaseGateCheck {
  id: ReleaseGateCheckId;
  label: string;
  metric_key:
    | keyof ReleaseMetrics
    | "direct_to_main_bypass_count";
  threshold_kind: "min" | "max";
  threshold_value: number;
  status: ReleaseGateStatus;
  metric_value: number | null;
  evidence: ReleaseEvidenceLink[];
}

export interface ReleaseGateReport {
  generated_at: string | null;
  overall_status: ReleaseGateStatus;
  checklist_path: string;
  thresholds: ReleaseGateThresholds;
  metrics: ReleaseMetrics;
  checks: ReleaseGateCheck[];
}

const CHECK_LABELS: Record<ReleaseGateCheckId, string> = {
  structured_artifact_compliance_100pct:
    "Structured artifact compliance is 100%.",
  clarification_compliance_100pct:
    "Clarification compliance is 100% on intentionally ambiguous scenarios.",
  restart_recovery_100pct:
    "Restart recovery succeeds on every designated restart scenario.",
  no_direct_to_main_bypasses:
    "No scenario bypasses the merge queue and lands directly on main.",
  issue_completion_rate_80pct:
    "Issue completion rate is at least 80% across the MVP suite.",
  human_interventions_within_threshold:
    "Human interventions stay at or below 2 per 10 completed issues.",
  janus_minority_path:
    "Janus remains a minority path across the MVP suite.",
};

const CHECK_EVIDENCE_SCENARIOS: Record<
  ReleaseGateCheckId,
  readonly MvpScenarioId[]
> = {
  structured_artifact_compliance_100pct: [
    "single-clean-issue",
    "complex-pause",
    "decomposition",
    "clarification",
    "stale-branch-rework",
    "hard-merge-conflict",
    "janus-escalation",
    "janus-human-decision",
    "restart-during-implementation",
    "restart-during-merge",
    "polling-only",
  ],
  clarification_compliance_100pct: ["clarification"],
  restart_recovery_100pct: [
    "restart-during-implementation",
    "restart-during-merge",
  ],
  no_direct_to_main_bypasses: [
    "single-clean-issue",
    "decomposition",
    "stale-branch-rework",
    "hard-merge-conflict",
    "janus-escalation",
    "janus-human-decision",
    "restart-during-implementation",
    "restart-during-merge",
    "polling-only",
  ],
  issue_completion_rate_80pct: [
    "single-clean-issue",
    "complex-pause",
    "decomposition",
    "clarification",
    "stale-branch-rework",
    "hard-merge-conflict",
    "janus-escalation",
    "janus-human-decision",
    "restart-during-implementation",
    "restart-during-merge",
    "polling-only",
  ],
  human_interventions_within_threshold: [
    "single-clean-issue",
    "complex-pause",
    "decomposition",
    "clarification",
    "stale-branch-rework",
    "hard-merge-conflict",
    "janus-escalation",
    "janus-human-decision",
    "restart-during-implementation",
    "restart-during-merge",
    "polling-only",
  ],
  janus_minority_path: ["janus-escalation", "janus-human-decision"],
};

const CHECK_METRIC_KEYS: Record<
  ReleaseGateCheckId,
  keyof ReleaseMetrics
> = {
  structured_artifact_compliance_100pct:
    "structured_artifact_compliance_rate",
  clarification_compliance_100pct: "clarification_compliance_rate",
  restart_recovery_100pct: "restart_recovery_success_rate",
  no_direct_to_main_bypasses: "direct_to_main_bypass_count",
  issue_completion_rate_80pct: "issue_completion_rate",
  human_interventions_within_threshold:
    "human_interventions_per_10_issues",
  janus_minority_path: "janus_invocation_rate_per_10_issues",
};

const CHECK_THRESHOLD_KINDS: Record<
  ReleaseGateCheckId,
  "min" | "max"
> = {
  structured_artifact_compliance_100pct: "min",
  clarification_compliance_100pct: "min",
  restart_recovery_100pct: "min",
  no_direct_to_main_bypasses: "max",
  issue_completion_rate_80pct: "min",
  human_interventions_within_threshold: "max",
  janus_minority_path: "max",
};

function getThresholdValue(
  checkId: ReleaseGateCheckId,
  thresholds: ReleaseGateThresholds,
): number {
  switch (checkId) {
    case "structured_artifact_compliance_100pct":
      return thresholds.structured_artifact_compliance_rate_min;
    case "clarification_compliance_100pct":
      return thresholds.clarification_compliance_rate_min;
    case "restart_recovery_100pct":
      return thresholds.restart_recovery_success_rate_min;
    case "no_direct_to_main_bypasses":
      return thresholds.direct_to_main_bypass_count_max;
    case "issue_completion_rate_80pct":
      return thresholds.issue_completion_rate_min;
    case "human_interventions_within_threshold":
      return thresholds.human_interventions_per_10_issues_max;
    case "janus_minority_path":
      return thresholds.janus_invocation_rate_per_10_issues_max;
  }
}

function buildEvidence(
  checkId: ReleaseGateCheckId,
  artifacts: ReleaseArtifactCatalog,
): ReleaseEvidenceLink[] {
  return CHECK_EVIDENCE_SCENARIOS[checkId].map((scenarioId) => {
    const artifact = artifacts[scenarioId];
    return {
      scenario_id: artifact.scenario_id,
      result_path: artifact.result_path,
      summary_path: artifact.summary_path,
    };
  });
}

function evaluateCheckStatus(
  checkId: ReleaseGateCheckId,
  metricValue: number | null,
  thresholdKind: "min" | "max",
  thresholdValue: number,
): ReleaseGateStatus {
  if (metricValue === null) {
    return "pending";
  }

  if (thresholdKind === "min") {
    return metricValue >= thresholdValue ? "pass" : "fail";
  }

  // Janus minority path requires strictly less than half: < 5 per 10 issues.
  // A rate of exactly 5 (50%) is not a minority.
  const strictMax = checkId === "janus_minority_path";

  return strictMax
    ? metricValue < thresholdValue ? "pass" : "fail"
    : metricValue <= thresholdValue ? "pass" : "fail";
}

function resolveOverallStatus(checks: readonly ReleaseGateCheck[]): ReleaseGateStatus {
  if (checks.some((check) => check.status === "fail")) {
    return "fail";
  }

  if (checks.some((check) => check.status === "pending")) {
    return "pending";
  }

  return "pass";
}

export interface CreatePendingReleaseGateReportOptions {
  generatedAt?: string | null;
  checklistPath?: string;
  thresholds?: ReleaseGateThresholds;
  metrics?: ReleaseMetrics;
  artifacts: Partial<ReleaseArtifactCatalog>;
}

export function createPendingReleaseGateReport(
  options: CreatePendingReleaseGateReportOptions,
): ReleaseGateReport {
  const normalizedArtifacts = normalizeReleaseArtifactCatalog(options.artifacts);
  const artifacts = Object.fromEntries(
    normalizedArtifacts.map((artifact) => [artifact.scenario_id, artifact]),
  ) as ReleaseArtifactCatalog;
  const thresholds = options.thresholds ?? DEFAULT_RELEASE_GATE_THRESHOLDS;
  const metrics = options.metrics ?? createEmptyReleaseMetrics();

  const checks = RELEASE_GATE_CHECK_IDS.map((checkId) => {
    const metricKey = CHECK_METRIC_KEYS[checkId];

    return {
      id: checkId,
      label: CHECK_LABELS[checkId],
      metric_key: metricKey,
      threshold_kind: CHECK_THRESHOLD_KINDS[checkId],
      threshold_value: getThresholdValue(checkId, thresholds),
      status: "pending" as const,
      metric_value: metrics[metricKey],
      evidence: buildEvidence(checkId, artifacts),
    };
  });

  return {
    generated_at: options.generatedAt ?? null,
    overall_status: "pending",
    checklist_path: options.checklistPath ?? MVP_RELEASE_CHECKLIST_PATH,
    thresholds,
    metrics,
    checks,
  };
}

export function evaluateReleaseGateReport(
  report: ReleaseGateReport,
): ReleaseGateReport {
  const checks = report.checks.map((check) => {
    const metricValue = report.metrics[check.metric_key];

    return {
      ...check,
      metric_value: metricValue,
      status: evaluateCheckStatus(
        check.id,
        metricValue,
        check.threshold_kind,
        check.threshold_value,
      ),
    };
  });

  return {
    ...report,
    overall_status: resolveOverallStatus(checks),
    checks,
  };
}

export function createReleaseGateReport(
  options: CreatePendingReleaseGateReportOptions,
): ReleaseGateReport {
  return evaluateReleaseGateReport(createPendingReleaseGateReport(options));
}

// ---------------------------------------------------------------------------
// generateReleaseGateReportFromDisk — end-to-end report generator
// ---------------------------------------------------------------------------

export interface ReleaseReportOutput {
  report: ReleaseGateReport;
  scoreSummaries: Record<string, ScoreSummary>;
  reportPath: string;
}

/**
 * Discover persisted eval results from `.aegis/evals/`, validate them,
 * compute score summaries, and emit a release report artifact.
 *
 * @param evalRoot - Absolute path to the `.aegis/evals/` directory
 * @param reportsDir - Absolute path to write the report (defaults to `.aegis/evals/reports/`)
 * @returns The generated report, score summaries, and the path to the written report
 */
export function generateReleaseGateReportFromDisk(
  evalRoot: string,
  reportsDir?: string,
): ReleaseReportOutput {
  const defaultReportsDir = path.join(evalRoot, "reports");
  const outputReportsDir = reportsDir ?? defaultReportsDir;

  // 1. Discover result JSON files directly under evalRoot (not in subdirectories)
  const resultFiles = discoverResultFiles(evalRoot);

  // 2. Load and validate each result
  const results: EvalRunResult[] = [];
  for (const filePath of resultFiles) {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    const validation = validateEvalRunResult(parsed);
    if (!validation.valid) {
      throw new Error(
        `Invalid eval run result in ${filePath}: ${validation.errors.join(", ")}`,
      );
    }
    results.push(parsed as EvalRunResult);
  }

  // 3. Build artifact catalog and metrics from loaded results
  const artifacts: Partial<ReleaseArtifactCatalog> = {};
  const resultPaths: Record<string, string> = {};
  for (const result of results) {
    const scenarioId = result.scenario_id as MvpScenarioId;
    // Find the actual file path for this result
    const resultFile = resultFiles.find((f) => {
      const parsed = JSON.parse(readFileSync(f, "utf8"));
      return parsed.scenario_id === scenarioId;
    });
    if (resultFile) {
      resultPaths[scenarioId] = path.relative(evalRoot, resultFile);
    }
    artifacts[scenarioId] = {
      scenario_id: scenarioId,
      result_path: resultPaths[scenarioId] ?? `${scenarioId}.json`,
      summary_path: null,
    };
  }

  // 4. Compute metrics and create report
  const metrics = computeMetricsFromResults(results);
  
  // Build a partial artifact catalog (only for scenarios we have results for)
  const report: ReleaseGateReport = {
    generated_at: new Date().toISOString(),
    overall_status: "pending",
    checklist_path: MVP_RELEASE_CHECKLIST_PATH,
    thresholds: DEFAULT_RELEASE_GATE_THRESHOLDS,
    metrics,
    checks: RELEASE_GATE_CHECK_IDS.map((checkId) => {
      const metricKey = CHECK_METRIC_KEYS[checkId];
      const evidence = buildEvidenceForPartialCatalog(checkId, artifacts);
      
      return {
        id: checkId,
        label: CHECK_LABELS[checkId],
        metric_key: metricKey,
        threshold_kind: CHECK_THRESHOLD_KINDS[checkId],
        threshold_value: getThresholdValue(checkId, DEFAULT_RELEASE_GATE_THRESHOLDS),
        status: "pending" as const,
        metric_value: metrics[metricKey],
        evidence,
      };
    }),
  };

  // Evaluate the report
  const evaluatedReport = evaluateReleaseGateReport(report);

  // 5. Compute score summaries for each result
  const scoreSummaries: Record<string, ScoreSummary> = {};
  for (const result of results) {
    scoreSummaries[result.scenario_id] = computeScoreSummary(result);
  }

  // 6. Write report to disk
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportFileName = `${timestamp}-release-report.json`;
  mkdirSync(outputReportsDir, { recursive: true });
  const reportPath = path.join(outputReportsDir, reportFileName);
  writeFileSync(reportPath, JSON.stringify(evaluatedReport, null, 2), "utf8");

  return {
    report: evaluatedReport,
    scoreSummaries,
    reportPath,
  };
}

function buildEvidenceForPartialCatalog(
  checkId: ReleaseGateCheckId,
  artifacts: Partial<ReleaseArtifactCatalog>,
): ReleaseEvidenceLink[] {
  return CHECK_EVIDENCE_SCENARIOS[checkId]
    .filter((scenarioId) => scenarioId in artifacts)
    .map((scenarioId) => {
      const artifact = artifacts[scenarioId]!;
      return {
        scenario_id: artifact.scenario_id,
        result_path: artifact.result_path,
        summary_path: artifact.summary_path,
      };
    });
}

function discoverResultFiles(evalRoot: string): string[] {
  if (!existsSync(evalRoot)) {
    return [];
  }

  const files = readdirSync(evalRoot);
  return files
    .filter((file) => file.endsWith(".json") && !file.startsWith("."))
    .map((file) => path.join(evalRoot, file));
}

function filePathForScenario(evalRoot: string, scenarioId: string): string {
  // Convention: results are stored as <scenario_id>.json directly under evalRoot
  return path.join(evalRoot, `${scenarioId}.json`);
}

function computeMetricsFromResults(results: EvalRunResult[]): ReleaseMetrics {
  const metrics = createEmptyReleaseMetrics();
  metrics.scenario_count = results.length;

  if (results.length === 0) {
    return metrics;
  }

  // Aggregate metrics across all results
  let totalIssues = 0;
  let completedIssues = 0;
  let compliantArtifacts = 0;
  let totalArtifacts = 0;
  let expectedClarifications = 0;
  let compliantClarifications = 0;
  let expectedRestarts = 0;
  let recoveredRestarts = 0;
  let totalMergeConflicts = 0;
  let totalTitanInvocations = 0;
  let totalJanusInvocations = 0;
  let successfulJanus = 0;
  let totalReworkLoops = 0;
  let totalHumanInterventions = 0;
  let directToMainBypass = 0;
  const latencies: number[] = [];

  for (const result of results) {
    const issueCount = result.issue_count;
    totalIssues += issueCount;

    // Completion rate
    for (const outcome of Object.values(result.completion_outcomes)) {
      if (outcome === "completed") {
        completedIssues += 1;
      }
    }

    // Structured artifact compliance
    for (const evidence of Object.values(result.issue_evidence)) {
      for (const key of ["oracle", "titan", "sentinel", "janus"] as const) {
        const artifact = evidence.structured_artifacts[key];
        totalArtifacts += 1;
        if (artifact.expected && artifact.compliant) {
          compliantArtifacts += 1;
        }
      }
    }

    // Clarification compliance
    for (const evidence of Object.values(result.issue_evidence)) {
      if (evidence.clarification.expected) {
        expectedClarifications += 1;
        if (evidence.clarification.compliant) {
          compliantClarifications += 1;
        }
      }
    }

    // Restart recovery
    for (const evidence of Object.values(result.issue_evidence)) {
      if (evidence.restart_recovery.expected) {
        expectedRestarts += 1;
        if (evidence.restart_recovery.recovered) {
          recoveredRestarts += 1;
        }
      }
    }

    // Merge metrics
    for (const [issueId, mergeOutcome] of Object.entries(result.merge_outcomes)) {
      if (mergeOutcome !== "not_attempted") {
        totalTitanInvocations += 1;
      }
      if (mergeOutcome === "merged_after_rework" || mergeOutcome === "conflict_resolved_janus") {
        totalMergeConflicts += 1;
      }
    }

    // Janus and rework loops
    for (const evidence of Object.values(result.issue_evidence)) {
      if (evidence.merge_queue.janus_invoked) {
        totalJanusInvocations += 1;
        if (evidence.merge_queue.janus_succeeded) {
          successfulJanus += 1;
        }
        if (evidence.merge_queue.direct_to_main_bypass) {
          directToMainBypass += 1;
        }
      }
      // Count rework from ALL issues, not just Janus-invoked ones
      totalReworkLoops += evidence.merge_queue.rework_count;
    }

    // Human interventions
    totalHumanInterventions += result.human_intervention_issue_ids.length;

    // Latency (from evidence)
    for (const evidence of Object.values(result.issue_evidence)) {
      if (evidence.merge_queue.queued_at && evidence.merge_queue.merged_at) {
        const queuedMs = new Date(evidence.merge_queue.queued_at).getTime();
        const mergedMs = new Date(evidence.merge_queue.merged_at).getTime();
        if (!Number.isNaN(queuedMs) && !Number.isNaN(mergedMs)) {
          latencies.push(Math.max(0, mergedMs - queuedMs));
        }
      }
    }
  }

  // Compute rates
  metrics.issue_completion_rate = totalIssues > 0 ? completedIssues / totalIssues : 0;
  metrics.structured_artifact_compliance_rate = totalArtifacts > 0 ? compliantArtifacts / totalArtifacts : 1;
  metrics.clarification_compliance_rate = expectedClarifications > 0 ? compliantClarifications / expectedClarifications : 1;
  metrics.merge_conflict_rate_per_titan = totalTitanInvocations > 0 ? totalMergeConflicts / totalTitanInvocations : 0;
  metrics.merge_queue_latency_ms = latencies.length > 0 ? median(latencies) : 0;
  metrics.rework_loops_per_issue = totalIssues > 0 ? totalReworkLoops / totalIssues : 0;
  metrics.janus_invocation_rate_per_10_issues = totalIssues > 0 ? (totalJanusInvocations / totalIssues) * 10 : 0;
  metrics.janus_success_rate = totalJanusInvocations > 0 ? successfulJanus / totalJanusInvocations : null;
  metrics.human_interventions_per_10_issues = completedIssues > 0 ? (totalHumanInterventions / completedIssues) * 10 : 0;
  metrics.restart_recovery_success_rate = expectedRestarts > 0 ? recoveredRestarts / expectedRestarts : null;
  metrics.direct_to_main_bypass_count = directToMainBypass;

  return metrics;
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
}
