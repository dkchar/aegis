/**
 * Eval harness result schema.
 *
 * Defines the canonical shape of every eval run artifact written under
 * `.aegis/evals/` (SPECv2 §24.5).
 */

// ---------------------------------------------------------------------------
// Directory constant
// ---------------------------------------------------------------------------

/** Default results directory, mirrors `evals.results_path` in AegisConfig. */
export const EVALS_RESULTS_PATH = ".aegis/evals" as const;

// ---------------------------------------------------------------------------
// Completion / merge outcomes
// ---------------------------------------------------------------------------

export const COMPLETION_OUTCOMES = [
  "completed",
  "failed",
  "paused_complex",
  "paused_ambiguous",
  "killed_budget",
  "killed_stuck",
  "skipped",
] as const;

export type CompletionOutcome = (typeof COMPLETION_OUTCOMES)[number];

export const MERGE_OUTCOMES = [
  "merged_clean",
  "merged_after_rework",
  "conflict_resolved_janus",
  "conflict_unresolved",
  "not_attempted",
] as const;

export type MergeOutcome = (typeof MERGE_OUTCOMES)[number];

// ---------------------------------------------------------------------------
// Cost / quota metering
// ---------------------------------------------------------------------------

/** Exact-dollar cost totals.  Present when `economics.metering_fallback` is "exact_usd". */
export interface CostTotals {
  total_usd: number;
  per_agent: Record<string, number>;
}

/** Quota or credit totals when exact dollars are unavailable. */
export interface QuotaTotals {
  kind: "quota" | "credits" | "stats_only";
  /** Raw quota units consumed, or null when the runtime does not report them. */
  units_consumed: number | null;
  /** Credit balance delta, or null when not applicable. */
  credit_delta: number | null;
}

// ---------------------------------------------------------------------------
// Per-scenario timing
// ---------------------------------------------------------------------------

export interface WallClockTiming {
  /** ISO-8601 timestamp when the scenario run started. */
  started_at: string;
  /** ISO-8601 timestamp when the scenario run finished. */
  finished_at: string;
  /** Total elapsed milliseconds. */
  elapsed_ms: number;
}

// ---------------------------------------------------------------------------
// Per-issue evidence used for SPECv2 §24.7 metrics
// ---------------------------------------------------------------------------

export type OracleEstimatedComplexity = "trivial" | "moderate" | "complex";
export type TitanEvidenceOutcome = "success" | "clarification" | "failure";
export type SentinelEvidenceVerdict = "pass" | "fail";
export type JanusEvidenceNextAction = "requeue" | "manual_decision" | "fail";
export type RestartRecoveryPhase = "implementation" | "merge";

export interface OracleArtifactEvidence {
  expected: boolean;
  compliant: boolean | null;
  assessment_ref: string | null;
  estimated_complexity: OracleEstimatedComplexity | null;
  ready: boolean | null;
  derived_issue_ids: string[];
}

export interface TitanArtifactEvidence {
  expected: boolean;
  compliant: boolean | null;
  outcome: TitanEvidenceOutcome | null;
  files_changed: string[];
  tests_and_checks_run: string[];
  clarification_issue_id: string | null;
}

export interface SentinelArtifactEvidence {
  expected: boolean;
  compliant: boolean | null;
  verdict_ref: string | null;
  verdict: SentinelEvidenceVerdict | null;
  created_fix_issue_ids: string[];
}

export interface JanusArtifactEvidence {
  expected: boolean;
  compliant: boolean | null;
  artifact_ref: string | null;
  recommended_next_action: JanusEvidenceNextAction | null;
}

export interface ClarificationEvidence {
  expected: boolean;
  compliant: boolean | null;
  clarification_issue_id: string | null;
  blocking_question: string | null;
}

export interface MergeQueueEvidence {
  queued_at: string | null;
  merged_at: string | null;
  direct_to_main_bypass: boolean;
  rework_count: number;
  janus_invoked: boolean;
  janus_succeeded: boolean;
  conflict_count: number;
}

export interface RestartRecoveryEvidence {
  expected: boolean;
  recovered: boolean | null;
  phase: RestartRecoveryPhase | null;
}

export interface IssueEvalEvidence {
  structured_artifacts: {
    oracle: OracleArtifactEvidence;
    titan: TitanArtifactEvidence;
    sentinel: SentinelArtifactEvidence;
    janus: JanusArtifactEvidence;
  };
  clarification: ClarificationEvidence;
  merge_queue: MergeQueueEvidence;
  restart_recovery: RestartRecoveryEvidence;
}

export function createEmptyIssueEvidence(): IssueEvalEvidence {
  return {
    structured_artifacts: {
      oracle: {
        expected: false,
        compliant: null,
        assessment_ref: null,
        estimated_complexity: null,
        ready: null,
        derived_issue_ids: [],
      },
      titan: {
        expected: false,
        compliant: null,
        outcome: null,
        files_changed: [],
        tests_and_checks_run: [],
        clarification_issue_id: null,
      },
      sentinel: {
        expected: false,
        compliant: null,
        verdict_ref: null,
        verdict: null,
        created_fix_issue_ids: [],
      },
      janus: {
        expected: false,
        compliant: null,
        artifact_ref: null,
        recommended_next_action: null,
      },
    },
    clarification: {
      expected: false,
      compliant: null,
      clarification_issue_id: null,
      blocking_question: null,
    },
    merge_queue: {
      queued_at: null,
      merged_at: null,
      direct_to_main_bypass: false,
      rework_count: 0,
      janus_invoked: false,
      janus_succeeded: false,
      conflict_count: 0,
    },
    restart_recovery: {
      expected: false,
      recovered: null,
      phase: null,
    },
  };
}

// ---------------------------------------------------------------------------
// EvalRunResult — the canonical per-scenario artifact (SPECv2 §24.5)
// ---------------------------------------------------------------------------

export interface EvalRunResult {
  // ── Identity ──────────────────────────────────────────────────────────────
  /** Aegis package version (semver string) at the time of the run. */
  aegis_version: string;
  /** Git SHA of the Aegis checkout used for the run. */
  git_sha: string;
  /** SHA-256 fingerprint of the resolved AegisConfig for reproducibility. */
  config_fingerprint: string;

  // ── Runtime / model mapping ───────────────────────────────────────────────
  /** Name of the runtime plugin in use (e.g. "pi", "openai"). */
  runtime: string;
  /** Snapshot of the model mapping at run time. */
  model_mapping: Record<string, string>;

  // ── Scenario identity ─────────────────────────────────────────────────────
  /** Stable scenario identifier from the scenario manifest. */
  scenario_id: string;

  // ── Issue statistics ──────────────────────────────────────────────────────
  /** Total number of issues processed in this scenario run. */
  issue_count: number;
  /** Breakdown of issue counts by type label (e.g. { task: 3, bug: 1 }). */
  issue_types: Record<string, number>;

  // ── Outcomes ──────────────────────────────────────────────────────────────
  /** Completion outcome for each issue, keyed by issue id. */
  completion_outcomes: Record<string, CompletionOutcome>;
  /** Merge outcome for each issue, keyed by issue id. */
  merge_outcomes: Record<string, MergeOutcome>;
  /** Structured per-issue evidence for SPECv2 §24.7 metric computation. */
  issue_evidence: Record<string, IssueEvalEvidence>;

  // ── Human interventions ───────────────────────────────────────────────────
  /**
   * List of issue ids that required a human intervention during the run.
   * An intervention is any operator action that the harness would not have
   * taken autonomously (e.g. resolving an unresolvable conflict, unblocking
   * a paused complex issue).
   */
  human_intervention_issue_ids: string[];

  // ── Cost / quota ──────────────────────────────────────────────────────────
  /** Present when exact-dollar metering is available; null otherwise. */
  cost_totals: CostTotals | null;
  /** Present when quota/credit metering is used; null when cost_totals is set. */
  quota_totals: QuotaTotals | null;

  // ── Timing ────────────────────────────────────────────────────────────────
  timing: WallClockTiming;
}

// ---------------------------------------------------------------------------
// EvalScenario — scenario definition shape
// ---------------------------------------------------------------------------

/** Expected outcomes for a scenario, used to compare against actual results. */
export interface ScenarioExpectedOutcomes {
  /** Minimum fraction of issues that must reach a "completed" outcome (0–1). */
  min_completion_rate: number;
  /** Whether a human intervention is expected (i.e. scenario is designed for it). */
  expects_human_intervention: boolean;
  /** Whether Janus invocation is expected in this scenario. */
  expects_janus: boolean;
  /** Whether the scenario is designed to test restart recovery. */
  expects_restart_recovery: boolean;
}

export interface EvalScenario {
  /** Stable, URL-safe identifier (e.g. "single-clean-issue"). */
  id: string;
  /** Human-readable name shown in reports. */
  name: string;
  /** Description of what this scenario exercises. */
  description: string;
  /**
   * Path to the fixture repository or fixture branch configuration, relative
   * to `evals/fixtures/`.
   */
  fixture_path: string;
  expected_outcomes: ScenarioExpectedOutcomes;
}

// ---------------------------------------------------------------------------
// ScoreSummary — machine-readable summary for regression comparison (SPECv2 §24.7)
// ---------------------------------------------------------------------------

export interface ScoreSummary {
  /** Scenario id this summary belongs to. */
  scenario_id: string;
  /** ISO-8601 timestamp of the run that produced this summary. */
  run_timestamp: string;

  // ── SPECv2 §24.7 canonical metrics ────────────────────────────────────────
  /** Fraction of issues that reached "completed" outcome (0–1). */
  issue_completion_rate: number;
  /** Fraction of structured artifacts that were compliant (0–1). */
  structured_artifact_compliance_rate: number;
  /** Fraction of ambiguous scenarios where a clarification was correctly raised (0–1). */
  clarification_compliance_rate: number;
  /** Number of merge conflicts per Titan invocation. */
  merge_conflict_rate_per_titan: number;
  /** Median milliseconds from `queued_for_merge` to `merged`. */
  merge_queue_latency_ms: number;
  /** Average rework loops per issue. */
  rework_loops_per_issue: number;
  /** Janus invocations per 10 issues processed. */
  janus_invocation_rate_per_10_issues: number;
  /** Fraction of Janus invocations that succeeded (0–1).  Null if no Janus invocations occurred. */
  janus_success_rate: number | null;
  /** Token overhead attributable to messaging, when messaging is enabled.  Null when not measured. */
  messaging_token_overhead: number | null;
  /** Human interventions per 10 completed issues. */
  human_interventions_per_10_issues: number;
  /** Average cost in USD per completed issue.  Null when exact-dollar metering is unavailable. */
  cost_per_completed_issue_usd: number | null;
  /** Fraction of restart scenarios where recovery succeeded (0–1).  Null if no restart scenarios ran. */
  restart_recovery_success_rate: number | null;

  // ── Release gate pass/fail flags (SPECv2 §24.8) ───────────────────────────
  gates: {
    structured_artifact_compliance_100pct: boolean;
    clarification_compliance_100pct: boolean;
    restart_recovery_100pct: boolean;
    no_direct_to_main_bypasses: boolean;
    issue_completion_rate_80pct: boolean;
    human_interventions_within_threshold: boolean;
    janus_minority_path: boolean;
  };
}
