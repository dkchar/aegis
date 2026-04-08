import path from "node:path";
import fs from "node:fs";

import { describe, expect, it } from "vitest";

import {
  createEmptyIssueEvidence,
  type EvalRunResult,
  type IssueEvalEvidence,
} from "../../../src/evals/result-schema.js";
import * as computeMetricsModule from "../../../src/evals/compute-metrics.js";
import {
  RELEASE_METRIC_KEYS,
  createEmptyReleaseMetrics,
  normalizeReleaseArtifactCatalog,
  type ReleaseArtifactCatalog,
} from "../../../src/evals/compute-metrics.js";
import { MVP_GATE_SCENARIO_IDS } from "../../../src/evals/wire-mvp-scenarios.js";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const fixturePath = path.join(
  repoRoot,
  "tests",
  "fixtures",
  "evals",
  "release-gate-contract.json",
);

function loadArtifactCatalog(): ReleaseArtifactCatalog {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as {
    artifacts: ReleaseArtifactCatalog;
  };

  return fixture.artifacts;
}

interface IssueEvidenceOverrides {
  oracle?: Partial<IssueEvalEvidence["structured_artifacts"]["oracle"]>;
  titan?: Partial<IssueEvalEvidence["structured_artifacts"]["titan"]>;
  sentinel?: Partial<IssueEvalEvidence["structured_artifacts"]["sentinel"]>;
  janus?: Partial<IssueEvalEvidence["structured_artifacts"]["janus"]>;
  clarification?: Partial<IssueEvalEvidence["clarification"]>;
  merge_queue?: Partial<IssueEvalEvidence["merge_queue"]>;
  restart_recovery?: Partial<IssueEvalEvidence["restart_recovery"]>;
}

function makeIssueEvidence(
  overrides: IssueEvidenceOverrides = {},
): IssueEvalEvidence {
  const base = createEmptyIssueEvidence();

  return {
    structured_artifacts: {
      oracle: {
        ...base.structured_artifacts.oracle,
        ...(overrides.oracle ?? {}),
      },
      titan: {
        ...base.structured_artifacts.titan,
        ...(overrides.titan ?? {}),
      },
      sentinel: {
        ...base.structured_artifacts.sentinel,
        ...(overrides.sentinel ?? {}),
      },
      janus: {
        ...base.structured_artifacts.janus,
        ...(overrides.janus ?? {}),
      },
    },
    clarification: {
      ...base.clarification,
      ...(overrides.clarification ?? {}),
    },
    merge_queue: {
      ...base.merge_queue,
      ...(overrides.merge_queue ?? {}),
    },
    restart_recovery: {
      ...base.restart_recovery,
      ...(overrides.restart_recovery ?? {}),
    },
  };
}

function makeEvalResult(
  overrides: Omit<Partial<EvalRunResult>, "issue_evidence"> & {
    issue_evidence?: Record<string, unknown>;
  } = {},
): EvalRunResult {
  return {
    aegis_version: "0.1.0",
    git_sha: "abc1234def5678901234567890123456789012345",
    config_fingerprint: "sha256:deadbeef",
    runtime: "pi",
    model_mapping: {
      oracle: "pi:oracle",
      titan: "pi:titan",
      sentinel: "pi:sentinel",
      janus: "pi:janus",
    },
    scenario_id: "single-clean-issue",
    issue_count: 1,
    issue_types: { task: 1 },
    completion_outcomes: { "issue-1": "completed" },
    merge_outcomes: { "issue-1": "merged_clean" },
    issue_evidence: {
      "issue-1": makeIssueEvidence(),
    },
    human_intervention_issue_ids: [],
    cost_totals: { total_usd: 0.5, per_agent: { titan: 0.25, oracle: 0.25 } },
    quota_totals: null,
    timing: {
      started_at: "2026-04-08T19:00:00.000Z",
      finished_at: "2026-04-08T19:05:00.000Z",
      elapsed_ms: 300_000,
    },
    ...overrides,
  } as EvalRunResult;
}

describe("S16B contract seed - compute-metrics", () => {
  it("exports the canonical release metric key set from SPECv2 section 24.7", () => {
    expect(RELEASE_METRIC_KEYS).toEqual([
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
    ]);
  });

  it("creates an empty release-metrics scaffold without precomputing any lane-owned values", () => {
    const metrics = createEmptyReleaseMetrics();

    expect(metrics.scenario_count).toBe(0);
    expect(metrics.direct_to_main_bypass_count).toBeNull();

    for (const metricKey of RELEASE_METRIC_KEYS) {
      expect(metrics[metricKey]).toBeNull();
    }
  });

  it("normalizes a full release artifact catalog into canonical MVP scenario order", () => {
    const orderedArtifacts = normalizeReleaseArtifactCatalog(loadArtifactCatalog());

    expect(orderedArtifacts.map((artifact) => artifact.scenario_id)).toEqual(
      MVP_GATE_SCENARIO_IDS,
    );
  });

  it("rejects artifact catalogs that do not cover the full MVP release suite", () => {
    const { ["polling-only"]: _omitted, ...incompleteCatalog } = loadArtifactCatalog();

    expect(() => normalizeReleaseArtifactCatalog(incompleteCatalog)).toThrow(
      /polling-only/i,
    );
  });

  it("computes aggregate release metrics from structured per-issue evidence without depending on gate evaluation logic", () => {
    const computeReleaseMetrics = (
      computeMetricsModule as unknown as {
      computeReleaseMetrics?: (results: EvalRunResult[]) => Record<string, number | null>;
    }).computeReleaseMetrics;

    expect(typeof computeReleaseMetrics).toBe("function");

    const firstResult = makeEvalResult({
      scenario_id: "single-clean-issue",
      issue_count: 2,
      completion_outcomes: {
        "clean-001": "completed",
        "janus-001": "completed",
      },
      merge_outcomes: {
        "clean-001": "merged_clean",
        "janus-001": "conflict_resolved_janus",
      },
      cost_totals: { total_usd: 1.2, per_agent: { titan: 0.8, oracle: 0.4 } },
      issue_evidence: {
        "clean-001": makeIssueEvidence({
          oracle: {
            expected: true,
            compliant: true,
            assessment_ref: ".aegis/oracle/clean-001.json",
          },
          titan: {
            expected: true,
            compliant: true,
            outcome: "success",
          },
          sentinel: {
            expected: true,
            compliant: false,
            verdict_ref: ".aegis/sentinel/clean-001.json",
          },
          merge_queue: {
            queued_at: "2026-04-08T19:00:00.000Z",
            merged_at: "2026-04-08T19:00:02.000Z",
            direct_to_main_bypass: true,
          },
        }),
        "janus-001": makeIssueEvidence({
          oracle: {
            expected: true,
            compliant: true,
            assessment_ref: ".aegis/oracle/janus-001.json",
          },
          titan: {
            expected: true,
            compliant: true,
            outcome: "success",
          },
          sentinel: {
            expected: true,
            compliant: true,
            verdict_ref: ".aegis/sentinel/janus-001.json",
          },
          janus: {
            expected: true,
            compliant: true,
            recommended_next_action: "requeue",
          },
          merge_queue: {
            queued_at: "2026-04-08T19:01:00.000Z",
            merged_at: "2026-04-08T19:01:06.000Z",
            rework_count: 1,
            janus_invoked: true,
            janus_succeeded: true,
            conflict_count: 1,
          },
        }),
      },
    });

    const secondResult = makeEvalResult({
      scenario_id: "clarification",
      issue_count: 1,
      completion_outcomes: {
        "clarify-001": "paused_ambiguous",
      },
      merge_outcomes: {
        "clarify-001": "not_attempted",
      },
      human_intervention_issue_ids: ["clarify-001"],
      cost_totals: { total_usd: 0.3, per_agent: { titan: 0.2, oracle: 0.1 } },
      issue_evidence: {
        "clarify-001": makeIssueEvidence({
          oracle: {
            expected: true,
            compliant: true,
            assessment_ref: ".aegis/oracle/clarify-001.json",
          },
          titan: {
            expected: true,
            compliant: true,
            outcome: "clarification",
          },
          clarification: {
            expected: true,
            compliant: true,
            clarification_issue_id: "clarify-child-001",
          },
        }),
      },
    });

    const metrics = computeReleaseMetrics?.([firstResult, secondResult]);

    expect(metrics).toMatchObject({
      scenario_count: 2,
      direct_to_main_bypass_count: 1,
    });
    expect(metrics?.issue_completion_rate).toBeCloseTo(2 / 3);
    expect(metrics?.structured_artifact_compliance_rate).toBeCloseTo(8 / 9);
    expect(metrics?.clarification_compliance_rate).toBe(1);
    expect(metrics?.merge_conflict_rate_per_titan).toBeCloseTo(1 / 3);
    expect(metrics?.merge_queue_latency_ms).toBe(4_000);
    expect(metrics?.rework_loops_per_issue).toBeCloseTo(1 / 3);
    expect(metrics?.janus_invocation_rate_per_10_issues).toBeCloseTo(10 / 3);
    expect(metrics?.janus_success_rate).toBe(1);
    expect(metrics?.human_interventions_per_10_issues).toBe(5);
    expect(metrics?.cost_per_completed_issue_usd).toBeCloseTo(0.75);
    expect(metrics?.restart_recovery_success_rate).toBeNull();
  });
});
