/**
 * Unit tests for the eval harness result schema.
 *
 * These tests verify EvalRunResult and ScoreSummary shapes, canonical outcome
 * vocabularies, manifest parsing, and the runtime guards used by the eval
 * harness modules.
 */

import path from "node:path";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  EVALS_RESULTS_PATH,
  COMPLETION_OUTCOMES,
  MERGE_OUTCOMES,
  type EvalRunResult,
  type EvalScenario,
  type ScoreSummary,
} from "../../../src/evals/result-schema.js";
import { DEFAULT_AEGIS_CONFIG } from "../../../src/config/defaults.js";
import { computeScoreSummary } from "../../../src/evals/compute-score-summary.js";
import { validateEvalRunResult } from "../../../src/evals/validate-result.js";
import { compareScoreSummaries } from "../../../src/evals/compare-runs.js";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Typed helper for tests that need a real EvalRunResult. */
function makeMinimalResult(): EvalRunResult {
  return {
    aegis_version: "0.1.0",
    git_sha: "abc1234def5678901234567890123456789012345",
    config_fingerprint: "sha256:deadbeef",
    runtime: "pi",
    model_mapping: { oracle: "pi:default", titan: "pi:default" },
    scenario_id: "single-clean-issue",
    issue_count: 1,
    issue_types: { task: 1 },
    completion_outcomes: { "issue-1": "completed" },
    merge_outcomes: { "issue-1": "merged_clean" },
    human_intervention_issue_ids: [],
    cost_totals: null,
    quota_totals: null,
    timing: {
      started_at: "2026-04-04T18:00:00.000Z",
      finished_at: "2026-04-04T18:05:00.000Z",
      elapsed_ms: 300_000,
    },
  };
}

/** Untyped helper for validation tests that need to mutate/delete fields. */
function makeMinimalResultData(): Record<string, unknown> {
  return {
    aegis_version: "0.1.0",
    git_sha: "abc1234def5678901234567890123456789012345",
    config_fingerprint: "sha256:deadbeef",
    runtime: "pi",
    model_mapping: { oracle: "pi:default", titan: "pi:default" },
    scenario_id: "single-clean-issue",
    issue_count: 1,
    issue_types: { task: 1 },
    completion_outcomes: { "issue-1": "completed" },
    merge_outcomes: { "issue-1": "merged_clean" },
    human_intervention_issue_ids: [],
    cost_totals: null,
    quota_totals: null,
    timing: {
      started_at: "2026-04-04T18:00:00.000Z",
      finished_at: "2026-04-04T18:05:00.000Z",
      elapsed_ms: 300_000,
    },
  };
}

function makeMinimalScenario(): EvalScenario {
  return {
    id: "single-clean-issue",
    name: "Single clean issue with no blockers",
    description: "Happy-path baseline scenario.",
    fixture_path: "single-clean-issue/fixture.json",
    expected_outcomes: {
      min_completion_rate: 1.0,
      expects_human_intervention: false,
      expects_janus: false,
      expects_restart_recovery: false,
    },
  };
}

function makeMinimalScoreSummary(): ScoreSummary {
  return {
    scenario_id: "single-clean-issue",
    run_timestamp: "2026-04-04T18:00:00.000Z",
    issue_completion_rate: 1.0,
    structured_artifact_compliance_rate: 1.0,
    clarification_compliance_rate: 1.0,
    merge_conflict_rate_per_titan: 0,
    merge_queue_latency_ms: 1500,
    rework_loops_per_issue: 0,
    janus_invocation_rate_per_10_issues: 0,
    janus_success_rate: 1.0,
    messaging_token_overhead: null,
    human_interventions_per_10_issues: 0,
    cost_per_completed_issue_usd: null,
    restart_recovery_success_rate: null,
    gates: {
      structured_artifact_compliance_100pct: true,
      clarification_compliance_100pct: true,
      restart_recovery_100pct: true,
      no_direct_to_main_bypasses: true,
      issue_completion_rate_80pct: true,
      human_interventions_within_threshold: true,
      janus_minority_path: true,
    },
  };
}

// ---------------------------------------------------------------------------
// EVALS_RESULTS_PATH constant
// ---------------------------------------------------------------------------

describe("S02 eval result schema — constants", () => {
  it("EVALS_RESULTS_PATH matches the default config evals.results_path", () => {
    expect(EVALS_RESULTS_PATH).toBe(DEFAULT_AEGIS_CONFIG.evals.results_path);
    expect(EVALS_RESULTS_PATH).toBe(".aegis/evals");
  });

  it("exports canonical completion and merge outcome vocabularies", () => {
    expect(COMPLETION_OUTCOMES).toEqual([
      "completed",
      "failed",
      "paused_complex",
      "paused_ambiguous",
      "killed_budget",
      "killed_stuck",
      "skipped",
    ]);
    expect(MERGE_OUTCOMES).toEqual([
      "merged_clean",
      "merged_after_rework",
      "conflict_resolved_janus",
      "conflict_unresolved",
      "not_attempted",
    ]);
  });
});

// ---------------------------------------------------------------------------
// EvalRunResult — required fields from SPECv2 §24.5
// ---------------------------------------------------------------------------

describe("S02 eval result schema — EvalRunResult required fields (SPECv2 §24.5)", () => {
  it("accepts a fully-populated valid EvalRunResult", () => {
    const result = makeMinimalResult();

    // Identity fields
    expect(result.aegis_version).toBeDefined();
    expect(result.git_sha).toBeDefined();
    expect(result.config_fingerprint).toBeDefined();

    // Runtime / model mapping
    expect(result.runtime).toBeDefined();
    expect(result.model_mapping).toBeDefined();

    // Scenario identity
    expect(result.scenario_id).toBeDefined();

    // Issue statistics
    expect(typeof result.issue_count).toBe("number");
    expect(result.issue_types).toBeDefined();

    // Outcomes
    expect(result.completion_outcomes).toBeDefined();
    expect(result.merge_outcomes).toBeDefined();

    // Human interventions
    expect(Array.isArray(result.human_intervention_issue_ids)).toBe(true);

    // Cost / quota (may be null)
    expect("cost_totals" in result).toBe(true);
    expect("quota_totals" in result).toBe(true);

    // Timing
    expect(result.timing.started_at).toBeDefined();
    expect(result.timing.finished_at).toBeDefined();
    expect(typeof result.timing.elapsed_ms).toBe("number");
  });

  it("captures completion outcomes for each issue id", () => {
    const result = makeMinimalResult();

    result.completion_outcomes["issue-2"] = "failed";
    result.completion_outcomes["issue-3"] = "paused_complex";

    expect(result.completion_outcomes["issue-1"]).toBe("completed");
    expect(result.completion_outcomes["issue-2"]).toBe("failed");
    expect(result.completion_outcomes["issue-3"]).toBe("paused_complex");
  });

  it("captures merge outcomes for each issue id", () => {
    const result = makeMinimalResult();

    result.merge_outcomes["issue-2"] = "conflict_resolved_janus";

    expect(result.merge_outcomes["issue-1"]).toBe("merged_clean");
    expect(result.merge_outcomes["issue-2"]).toBe("conflict_resolved_janus");
  });

  it("records human intervention issue ids", () => {
    const result = makeMinimalResult();

    result.human_intervention_issue_ids.push("issue-3");

    expect(result.human_intervention_issue_ids).toContain("issue-3");
  });

  it("accepts exact-dollar cost totals when available", () => {
    const result = makeMinimalResult();

    result.cost_totals = {
      total_usd: 0.42,
      per_agent: { titan: 0.30, oracle: 0.12 },
    };

    expect(result.cost_totals.total_usd).toBe(0.42);
    expect(result.cost_totals.per_agent["titan"]).toBe(0.30);
  });

  it("accepts quota totals when exact dollars are unavailable", () => {
    const result = makeMinimalResult();

    result.quota_totals = {
      kind: "quota",
      units_consumed: 1200,
      credit_delta: null,
    };

    expect(result.quota_totals.kind).toBe("quota");
    expect(result.quota_totals.units_consumed).toBe(1200);
  });

  it("timing.elapsed_ms is a non-negative number", () => {
    const result = makeMinimalResult();

    expect(result.timing.elapsed_ms).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// EvalScenario — scenario definition shape
// ---------------------------------------------------------------------------

describe("S02 eval result schema — EvalScenario shape", () => {
  it("accepts a valid minimal scenario definition", () => {
    const scenario = makeMinimalScenario();

    expect(scenario.id).toMatch(/^[a-z0-9-]+$/);
    expect(typeof scenario.name).toBe("string");
    expect(typeof scenario.description).toBe("string");
    expect(typeof scenario.fixture_path).toBe("string");
    expect(scenario.expected_outcomes.min_completion_rate).toBeGreaterThanOrEqual(0);
    expect(scenario.expected_outcomes.min_completion_rate).toBeLessThanOrEqual(1);
    expect(typeof scenario.expected_outcomes.expects_human_intervention).toBe("boolean");
    expect(typeof scenario.expected_outcomes.expects_janus).toBe("boolean");
    expect(typeof scenario.expected_outcomes.expects_restart_recovery).toBe("boolean");
  });
});

// ---------------------------------------------------------------------------
// ScoreSummary — machine-readable metrics shape (SPECv2 §24.7 / §24.8)
// ---------------------------------------------------------------------------

describe("S02 eval result schema — ScoreSummary shape", () => {
  it("accepts a valid minimal score summary", () => {
    const summary = makeMinimalScoreSummary();

    // All §24.7 canonical metrics are present
    expect(typeof summary.issue_completion_rate).toBe("number");
    expect(typeof summary.structured_artifact_compliance_rate).toBe("number");
    expect(typeof summary.clarification_compliance_rate).toBe("number");
    expect(typeof summary.merge_conflict_rate_per_titan).toBe("number");
    expect(typeof summary.merge_queue_latency_ms).toBe("number");
    expect(typeof summary.rework_loops_per_issue).toBe("number");
    expect(typeof summary.janus_invocation_rate_per_10_issues).toBe("number");
    expect(typeof summary.janus_success_rate).toBe("number");
    expect(typeof summary.human_interventions_per_10_issues).toBe("number");

    // Nullable fields are present (may be null)
    expect("messaging_token_overhead" in summary).toBe(true);
    expect("cost_per_completed_issue_usd" in summary).toBe(true);
    expect("restart_recovery_success_rate" in summary).toBe(true);
  });

  it("includes all §24.8 release gate flags", () => {
    const summary = makeMinimalScoreSummary();
    const gates = summary.gates;

    expect(typeof gates.structured_artifact_compliance_100pct).toBe("boolean");
    expect(typeof gates.clarification_compliance_100pct).toBe("boolean");
    expect(typeof gates.restart_recovery_100pct).toBe("boolean");
    expect(typeof gates.no_direct_to_main_bypasses).toBe("boolean");
    expect(typeof gates.issue_completion_rate_80pct).toBe("boolean");
    expect(typeof gates.human_interventions_within_threshold).toBe("boolean");
    expect(typeof gates.janus_minority_path).toBe("boolean");
  });

  it("a passing run has all gate flags set to true", () => {
    const summary = makeMinimalScoreSummary();

    expect(Object.values(summary.gates).every((v) => v === true)).toBe(true);
  });

  it("a failing run can have individual gate flags set to false", () => {
    const summary = makeMinimalScoreSummary();

    summary.issue_completion_rate = 0.6;
    summary.gates.issue_completion_rate_80pct = false;

    expect(summary.gates.issue_completion_rate_80pct).toBe(false);
    // Other gates unaffected
    expect(summary.gates.structured_artifact_compliance_100pct).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Scenario manifest — can be loaded and parsed
// ---------------------------------------------------------------------------

describe("S02 eval result schema — scenario manifest (evals/scenarios/index.json)", () => {
  const manifestPath = path.join(repoRoot, "evals", "scenarios", "index.json");

  it("manifest file exists and is valid JSON", () => {
    const raw = readFileSync(manifestPath, "utf8");
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it("manifest has a 'scenarios' array", () => {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      scenarios: unknown[];
    };

    expect(Array.isArray(manifest.scenarios)).toBe(true);
  });

  it("each scenario entry has the required EvalScenario fields", () => {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      scenarios: Record<string, unknown>[];
    };

    for (const entry of manifest.scenarios) {
      expect(typeof entry["id"]).toBe("string");
      expect(typeof entry["name"]).toBe("string");
      expect(typeof entry["description"]).toBe("string");
      expect(typeof entry["fixture_path"]).toBe("string");
      expect(entry["expected_outcomes"]).toBeDefined();

      const outcomes = entry["expected_outcomes"] as Record<string, unknown>;
      expect(typeof outcomes["min_completion_rate"]).toBe("number");
      expect(typeof outcomes["expects_human_intervention"]).toBe("boolean");
      expect(typeof outcomes["expects_janus"]).toBe("boolean");
      expect(typeof outcomes["expects_restart_recovery"]).toBe("boolean");
    }
  });

  it("placeholder scenario id matches the SPECv2 §24.6 happy-path scenario name", () => {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      scenarios: Array<{ id: string }>;
    };

    const ids = manifest.scenarios.map((s) => s.id);
    expect(ids).toContain("single-clean-issue");
  });
});

// ---------------------------------------------------------------------------
// computeScoreSummary
// ---------------------------------------------------------------------------

describe("computeScoreSummary", () => {
  it("all completed issues → completion_rate 1.0 and gate passes", () => {
    const result = makeMinimalResult(); // 1 issue, "completed"
    const summary = computeScoreSummary(result);

    expect(summary.issue_completion_rate).toBe(1.0);
    expect(summary.gates.issue_completion_rate_80pct).toBe(true);
  });

  it("mixed outcomes → correct completion rate", () => {
    const result = makeMinimalResult();
    result.issue_count = 4;
    result.completion_outcomes = {
      "issue-1": "completed",
      "issue-2": "completed",
      "issue-3": "failed",
      "issue-4": "paused_complex",
    };
    result.merge_outcomes = {
      "issue-1": "merged_clean",
      "issue-2": "merged_clean",
      "issue-3": "not_attempted",
      "issue-4": "not_attempted",
    };

    const summary = computeScoreSummary(result);

    expect(summary.issue_completion_rate).toBeCloseTo(0.5);
    expect(summary.gates.issue_completion_rate_80pct).toBe(false);
  });

  it("zero issue_count → handles division by zero gracefully (returns 0 / safe defaults)", () => {
    const result = makeMinimalResult();
    result.issue_count = 0;
    result.completion_outcomes = {};
    result.merge_outcomes = {};

    const summary = computeScoreSummary(result);

    expect(summary.issue_completion_rate).toBe(0);
    expect(summary.merge_conflict_rate_per_titan).toBe(0);
    expect(summary.janus_invocation_rate_per_10_issues).toBe(0);
    expect(summary.human_interventions_per_10_issues).toBe(0);
    expect(summary.cost_per_completed_issue_usd).toBeNull();
  });

  it("gate edge case: completion_rate exactly 0.8 → issue_completion_rate_80pct is true", () => {
    const result = makeMinimalResult();
    result.issue_count = 5;
    result.completion_outcomes = {
      "issue-1": "completed",
      "issue-2": "completed",
      "issue-3": "completed",
      "issue-4": "completed",
      "issue-5": "failed",
    };
    result.merge_outcomes = {
      "issue-1": "merged_clean",
      "issue-2": "merged_clean",
      "issue-3": "merged_clean",
      "issue-4": "merged_clean",
      "issue-5": "not_attempted",
    };

    const summary = computeScoreSummary(result);

    expect(summary.issue_completion_rate).toBeCloseTo(0.8);
    expect(summary.gates.issue_completion_rate_80pct).toBe(true);
  });

  it("cost_per_completed_issue_usd is null when cost_totals is null", () => {
    const result = makeMinimalResult();
    result.cost_totals = null;

    const summary = computeScoreSummary(result);

    expect(summary.cost_per_completed_issue_usd).toBeNull();
  });

  it("cost_per_completed_issue_usd computed correctly when cost_totals is present", () => {
    const result = makeMinimalResult();
    result.issue_count = 2;
    result.completion_outcomes = {
      "issue-1": "completed",
      "issue-2": "completed",
    };
    result.merge_outcomes = {
      "issue-1": "merged_clean",
      "issue-2": "merged_clean",
    };
    result.cost_totals = { total_usd: 1.0, per_agent: { titan: 0.6, oracle: 0.4 } };

    const summary = computeScoreSummary(result);

    expect(summary.cost_per_completed_issue_usd).toBeCloseTo(0.5);
  });

  it("human intervention rate calculation: 1 intervention / 1 completed → 10 per 10", () => {
    const result = makeMinimalResult();
    result.human_intervention_issue_ids = ["issue-1"];

    const summary = computeScoreSummary(result);

    expect(summary.human_interventions_per_10_issues).toBe(10);
    expect(summary.gates.human_interventions_within_threshold).toBe(false);
  });

  it("human_interventions_within_threshold passes when rate is within config default of 2 per 10", () => {
    const result = makeMinimalResult();
    result.issue_count = 10;
    // 10 completed issues, 2 interventions → exactly 2 per 10
    const outcomes: Record<string, "completed"> = {};
    const merges: Record<string, "merged_clean"> = {};
    for (let i = 1; i <= 10; i++) {
      outcomes[`issue-${i}`] = "completed";
      merges[`issue-${i}`] = "merged_clean";
    }
    result.completion_outcomes = outcomes;
    result.merge_outcomes = merges;
    result.human_intervention_issue_ids = ["issue-1", "issue-2"];

    const summary = computeScoreSummary(result);

    expect(summary.human_interventions_per_10_issues).toBeCloseTo(2);
    expect(summary.gates.human_interventions_within_threshold).toBe(true);
  });

  it("janus_minority_path gate passes when fewer than 5 per 10 issues use Janus", () => {
    const result = makeMinimalResult();
    result.issue_count = 10;
    const outcomes: Record<string, "completed"> = {};
    const merges: Record<string, "merged_clean" | "conflict_resolved_janus"> = {};
    for (let i = 1; i <= 10; i++) {
      outcomes[`issue-${i}`] = "completed";
      merges[`issue-${i}`] = i <= 4 ? "conflict_resolved_janus" : "merged_clean";
    }
    result.completion_outcomes = outcomes;
    result.merge_outcomes = merges;

    const summary = computeScoreSummary(result);

    // 4 janus out of 10 → 4 per 10, which is < 5
    expect(summary.janus_invocation_rate_per_10_issues).toBeCloseTo(4);
    expect(summary.gates.janus_minority_path).toBe(true);
  });

  it("MVP MVP fields have expected defaults: merge_queue_latency_ms=0, rework_loops_per_issue=0", () => {
    const result = makeMinimalResult();
    const summary = computeScoreSummary(result);

    expect(summary.merge_queue_latency_ms).toBe(0);
    expect(summary.rework_loops_per_issue).toBe(0);
    expect(summary.messaging_token_overhead).toBeNull();
    expect(summary.restart_recovery_success_rate).toBeNull();
  });

  it("structured_artifact_compliance_100pct gate always true for MVP", () => {
    const result = makeMinimalResult();
    const summary = computeScoreSummary(result);

    expect(summary.structured_artifact_compliance_rate).toBe(1.0);
    expect(summary.gates.structured_artifact_compliance_100pct).toBe(true);
  });

  it("restart_recovery_100pct gate is true when restart_recovery_success_rate is null", () => {
    const result = makeMinimalResult();
    const summary = computeScoreSummary(result);

    expect(summary.restart_recovery_success_rate).toBeNull();
    expect(summary.gates.restart_recovery_100pct).toBe(true);
  });

  it("no_direct_to_main_bypasses gate always true for MVP", () => {
    const result = makeMinimalResult();
    const summary = computeScoreSummary(result);

    expect(summary.gates.no_direct_to_main_bypasses).toBe(true);
  });

  it("config threshold override affects human_interventions_within_threshold gate", () => {
    const result = makeMinimalResult();
    // 1 intervention / 1 completed → 10 per 10
    result.human_intervention_issue_ids = ["issue-1"];

    const summaryStrict = computeScoreSummary(result, {
      max_human_interventions_per_10_issues: 5,
    });
    // 10 > 5 → still fails
    expect(summaryStrict.gates.human_interventions_within_threshold).toBe(false);

    const summaryLoose = computeScoreSummary(result, {
      max_human_interventions_per_10_issues: 10,
    });
    // 10 <= 10 → passes
    expect(summaryLoose.gates.human_interventions_within_threshold).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateEvalRunResult
// ---------------------------------------------------------------------------

describe("validateEvalRunResult", () => {
  it("valid minimal result passes without errors", () => {
    const result = validateEvalRunResult(makeMinimalResult());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("non-object input is rejected immediately", () => {
    const result = validateEvalRunResult("not an object");
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("missing top-level field 'scenario_id' is detected", () => {
    const data = makeMinimalResultData();
    delete data["scenario_id"];

    const result = validateEvalRunResult(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("scenario_id"))).toBe(true);
  });

  it("missing 'timing' object is detected", () => {
    const data = makeMinimalResultData();
    delete data["timing"];

    const result = validateEvalRunResult(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("timing"))).toBe(true);
  });

  it("invalid completion_outcome enum value is detected", () => {
    const data = makeMinimalResultData();
    data["completion_outcomes"] = { "issue-1": "totally_invalid_outcome" };

    const result = validateEvalRunResult(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("completion_outcomes"))).toBe(true);
  });

  it("invalid merge_outcome enum value is detected", () => {
    const data = makeMinimalResultData();
    data["merge_outcomes"] = { "issue-1": "bad_merge" };

    const result = validateEvalRunResult(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("merge_outcomes"))).toBe(true);
  });

  it("invalid ISO-8601 timestamp in timing.started_at is detected", () => {
    const data = makeMinimalResultData();
    data["timing"] = {
      started_at: "not-a-date",
      finished_at: "2026-04-04T18:05:00.000Z",
      elapsed_ms: 300_000,
    };

    const result = validateEvalRunResult(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("timing.started_at"))).toBe(true);
  });

  it("invalid ISO-8601 timestamp in timing.finished_at is detected", () => {
    const data = makeMinimalResultData();
    data["timing"] = {
      started_at: "2026-04-04T18:00:00.000Z",
      finished_at: "garbage",
      elapsed_ms: 300_000,
    };

    const result = validateEvalRunResult(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("timing.finished_at"))).toBe(true);
  });

  it("negative issue_count is detected", () => {
    const data = makeMinimalResultData();
    data["issue_count"] = -1;

    const result = validateEvalRunResult(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("issue_count"))).toBe(true);
  });

  it("empty scenario_id string is detected", () => {
    const data = makeMinimalResultData();
    data["scenario_id"] = "";

    const result = validateEvalRunResult(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("scenario_id"))).toBe(true);
  });

  it("valid result with cost_totals present also passes", () => {
    const data = makeMinimalResult();
    data.cost_totals = { total_usd: 0.5, per_agent: { titan: 0.5 } };

    const result = validateEvalRunResult(data);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("all valid CompletionOutcome values are accepted", () => {
    const validOutcomes = [
      "completed",
      "failed",
      "paused_complex",
      "paused_ambiguous",
      "killed_budget",
      "killed_stuck",
      "skipped",
    ] as const;

    for (const outcome of validOutcomes) {
      const data = makeMinimalResult();
      data.completion_outcomes["issue-1"] = outcome;
      const result = validateEvalRunResult(data);
      expect(result.valid).toBe(true);
    }
  });

  it("all valid MergeOutcome values are accepted", () => {
    const validOutcomes = [
      "merged_clean",
      "merged_after_rework",
      "conflict_resolved_janus",
      "conflict_unresolved",
      "not_attempted",
    ] as const;

    for (const outcome of validOutcomes) {
      const data = makeMinimalResult();
      data.merge_outcomes["issue-1"] = outcome;
      const result = validateEvalRunResult(data);
      expect(result.valid).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// compareScoreSummaries
// ---------------------------------------------------------------------------

describe("compareScoreSummaries", () => {
  it("identical summaries produce no regressions and no improvements", () => {
    const summary = makeMinimalScoreSummary();
    const report = compareScoreSummaries(summary, summary);

    expect(report.has_regressions).toBe(false);
    expect(report.regressions).toHaveLength(0);
    expect(report.improvements).toHaveLength(0);
  });

  it("regression detected when completion rate drops", () => {
    const baseline = makeMinimalScoreSummary();
    baseline.issue_completion_rate = 1.0;

    const current = makeMinimalScoreSummary();
    current.issue_completion_rate = 0.6;

    const report = compareScoreSummaries(baseline, current);

    expect(report.has_regressions).toBe(true);
    const reg = report.regressions.find((r) => r.metric === "issue_completion_rate");
    expect(reg).toBeDefined();
    expect(reg!.baseline_value).toBe(1.0);
    expect(reg!.current_value).toBe(0.6);
    expect(reg!.delta).toBeCloseTo(-0.4);
  });

  it("improvement detected when completion rate rises", () => {
    const baseline = makeMinimalScoreSummary();
    baseline.issue_completion_rate = 0.7;

    const current = makeMinimalScoreSummary();
    current.issue_completion_rate = 1.0;

    const report = compareScoreSummaries(baseline, current);

    expect(report.has_regressions).toBe(false);
    expect(report.improvements.length).toBeGreaterThan(0);
    const imp = report.improvements.find((i) => i.metric === "issue_completion_rate");
    expect(imp).toBeDefined();
    expect(imp!.delta).toBeGreaterThan(0);
  });

  it("regression detected when merge_conflict_rate_per_titan increases", () => {
    const baseline = makeMinimalScoreSummary();
    baseline.merge_conflict_rate_per_titan = 0.1;

    const current = makeMinimalScoreSummary();
    current.merge_conflict_rate_per_titan = 0.5;

    const report = compareScoreSummaries(baseline, current);

    expect(report.has_regressions).toBe(true);
    expect(report.regressions.some((r) => r.metric === "merge_conflict_rate_per_titan")).toBe(true);
  });

  it("improvement detected when human interventions per 10 issues decreases", () => {
    const baseline = makeMinimalScoreSummary();
    baseline.human_interventions_per_10_issues = 3;

    const current = makeMinimalScoreSummary();
    current.human_interventions_per_10_issues = 1;

    const report = compareScoreSummaries(baseline, current);

    expect(report.improvements.some((i) => i.metric === "human_interventions_per_10_issues")).toBe(true);
  });

  it("has_regressions is false when there are only improvements", () => {
    const baseline = makeMinimalScoreSummary();
    baseline.issue_completion_rate = 0.5;
    baseline.clarification_compliance_rate = 0.8;

    const current = makeMinimalScoreSummary();
    current.issue_completion_rate = 1.0;
    current.clarification_compliance_rate = 1.0;

    const report = compareScoreSummaries(baseline, current);

    expect(report.has_regressions).toBe(false);
    expect(report.improvements.length).toBeGreaterThan(0);
  });
});
