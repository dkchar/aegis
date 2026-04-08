import path from "node:path";
import fs from "node:fs";
import os from "node:os";

import { describe, expect, it, afterEach } from "vitest";

import {
  createEmptyReleaseMetrics,
  type ReleaseArtifactCatalog,
  type ReleaseMetrics,
} from "../../../src/evals/compute-metrics.js";
import {
  DEFAULT_RELEASE_GATE_THRESHOLDS,
  MVP_RELEASE_CHECKLIST_PATH,
  RELEASE_GATE_CHECK_IDS,
  createReleaseGateReport,
  createPendingReleaseGateReport,
  evaluateReleaseGateReport,
  generateReleaseGateReportFromDisk,
} from "../../../src/evals/release-gate.js";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const fixturePath = path.join(
  repoRoot,
  "tests",
  "fixtures",
  "evals",
  "release-gate-contract.json",
);

const expectedEvidenceByCheck = {
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
} as const;

function loadArtifactCatalog(): ReleaseArtifactCatalog {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as {
    artifacts: ReleaseArtifactCatalog;
  };

  return fixture.artifacts;
}

function makeReleaseMetrics(
  overrides: Partial<ReleaseMetrics> = {},
): ReleaseMetrics {
  return {
    ...createEmptyReleaseMetrics(),
    scenario_count: 11,
    direct_to_main_bypass_count: 0,
    issue_completion_rate: 0.91,
    structured_artifact_compliance_rate: 1,
    clarification_compliance_rate: 1,
    merge_conflict_rate_per_titan: 0.18,
    merge_queue_latency_ms: 120000,
    rework_loops_per_issue: 0.27,
    janus_invocation_rate_per_10_issues: 1.8,
    janus_success_rate: 1,
    messaging_token_overhead: 0.11,
    human_interventions_per_10_issues: 1.4,
    cost_per_completed_issue_usd: 2.75,
    restart_recovery_success_rate: 1,
    ...overrides,
  };
}

function findCheck(
  report: ReturnType<typeof createPendingReleaseGateReport>,
  id: (typeof RELEASE_GATE_CHECK_IDS)[number],
) {
  const check = report.checks.find((candidate) => candidate.id === id);

  expect(check).toBeDefined();

  return check!;
}

describe("S16B contract seed - release gate", () => {
  it("defines the PRD release-threshold defaults without evaluating them yet", () => {
    expect(DEFAULT_RELEASE_GATE_THRESHOLDS).toEqual({
      structured_artifact_compliance_rate_min: 1,
      clarification_compliance_rate_min: 1,
      restart_recovery_success_rate_min: 1,
      direct_to_main_bypass_count_max: 0,
      issue_completion_rate_min: 0.8,
      human_interventions_per_10_issues_max: 2,
      janus_invocation_rate_per_10_issues_max: 5,
    });
  });

  it("creates a pending release report scaffold with one check per PRD gate", () => {
    const report = createPendingReleaseGateReport({
      generatedAt: "2026-04-08T19:30:00.000Z",
      artifacts: loadArtifactCatalog(),
      metrics: createEmptyReleaseMetrics(),
    });

    expect(report.generated_at).toBe("2026-04-08T19:30:00.000Z");
    expect(report.overall_status).toBe("pending");
    expect(report.checklist_path).toBe(MVP_RELEASE_CHECKLIST_PATH);
    expect(report.checks.map((check) => check.id)).toEqual(RELEASE_GATE_CHECK_IDS);

    for (const check of report.checks) {
      expect(check.status).toBe("pending");
      expect(check.metric_value).toBeNull();
      expect(check.evidence.map((evidence) => evidence.scenario_id)).toEqual(
        expectedEvidenceByCheck[check.id],
      );
    }
  });

  it("documents the static release checklist that the gate report will reference", () => {
    const checklistPath = path.join(repoRoot, MVP_RELEASE_CHECKLIST_PATH);
    const checklist = fs.readFileSync(checklistPath, "utf8");

    expect(checklist).toContain("evals/scenarios/mvp-gate.json");

    for (const checkId of RELEASE_GATE_CHECK_IDS) {
      expect(checklist).toContain(`\`${checkId}\``);
    }
  });

  it("evaluates aggregated metrics into a passing release report with evidence links", () => {
    const metrics = makeReleaseMetrics();
    const report = createReleaseGateReport({
      generatedAt: "2026-04-08T20:00:00.000Z",
      artifacts: loadArtifactCatalog(),
      metrics,
    });

    expect(report.generated_at).toBe("2026-04-08T20:00:00.000Z");
    expect(report.overall_status).toBe("pass");
    expect(report.metrics).toEqual(metrics);

    for (const check of report.checks) {
      expect(check.status).toBe("pass");
    }

    expect(findCheck(report, "issue_completion_rate_80pct")).toMatchObject({
      status: "pass",
      threshold_kind: "min",
      threshold_value: 0.8,
      metric_value: 0.91,
    });
    expect(findCheck(report, "janus_minority_path")).toMatchObject({
      status: "pass",
      threshold_kind: "max",
      threshold_value: 5,
      metric_value: 1.8,
    });
    expect(
      findCheck(report, "structured_artifact_compliance_100pct").evidence[0],
    ).toEqual(loadArtifactCatalog()["single-clean-issue"]);
  });

  it("marks individual gate checks as failed when aggregated metrics miss PRD thresholds", () => {
    const report = createReleaseGateReport({
      artifacts: loadArtifactCatalog(),
      metrics: makeReleaseMetrics({
        direct_to_main_bypass_count: 1,
        issue_completion_rate: 0.79,
        human_interventions_per_10_issues: 2.4,
        janus_invocation_rate_per_10_issues: 5.2,
      }),
    });

    expect(report.overall_status).toBe("fail");
    expect(findCheck(report, "structured_artifact_compliance_100pct").status).toBe(
      "pass",
    );
    expect(findCheck(report, "no_direct_to_main_bypasses")).toMatchObject({
      status: "fail",
      metric_value: 1,
      threshold_value: 0,
    });
    expect(findCheck(report, "issue_completion_rate_80pct")).toMatchObject({
      status: "fail",
      metric_value: 0.79,
      threshold_value: 0.8,
    });
    expect(
      findCheck(report, "human_interventions_within_threshold"),
    ).toMatchObject({
      status: "fail",
      metric_value: 2.4,
      threshold_value: 2,
    });
    expect(findCheck(report, "janus_minority_path")).toMatchObject({
      status: "fail",
      metric_value: 5.2,
      threshold_value: 5,
    });
  });

  it("keeps the report pending when required aggregate metrics are still missing", () => {
    const pending = createPendingReleaseGateReport({
      artifacts: loadArtifactCatalog(),
      metrics: makeReleaseMetrics({
        issue_completion_rate: null,
      }),
    });
    const evaluated = evaluateReleaseGateReport(pending);

    expect(evaluated.overall_status).toBe("pending");
    expect(findCheck(evaluated, "issue_completion_rate_80pct")).toMatchObject({
      status: "pending",
      metric_value: null,
      threshold_value: 0.8,
    });
    expect(findCheck(evaluated, "structured_artifact_compliance_100pct").status).toBe(
      "pass",
    );
  });
});

// ---------------------------------------------------------------------------
// generateReleaseGateReportFromDisk tests
// ---------------------------------------------------------------------------

describe("generateReleaseGateReportFromDisk", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup failures
      }
    }
    tempDirs.length = 0;
  });

  function makeTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aegis-release-test-"));
    tempDirs.push(dir);
    return dir;
  }

  it("discovers persisted result files and generates a report", () => {
    const evalRoot = makeTempDir();
    const reportsDir = path.join(evalRoot, "reports");

    // Create a minimal valid eval result
    const result = {
      aegis_version: "0.1.0",
      git_sha: "abc123def4567890123456789012345678901234",
      config_fingerprint: "test-fingerprint",
      runtime: "pi",
      model_mapping: { oracle: "pi", titan: "pi" },
      scenario_id: "single-clean-issue",
      issue_count: 1,
      issue_types: { task: 1 },
      completion_outcomes: { "issue-1": "completed" },
      merge_outcomes: { "issue-1": "merged_clean" },
      issue_evidence: {
        "issue-1": {
          structured_artifacts: {
            oracle: { expected: true, compliant: true, assessment_ref: null, estimated_complexity: "trivial", ready: true, derived_issue_ids: [] },
            titan: { expected: true, compliant: true, outcome: "success", files_changed: [], tests_and_checks_run: [], clarification_issue_id: null },
            sentinel: { expected: false, compliant: null, verdict_ref: null, verdict: null, created_fix_issue_ids: [] },
            janus: { expected: false, compliant: null, artifact_ref: null, recommended_next_action: null },
          },
          clarification: { expected: false, compliant: null, clarification_issue_id: null, blocking_question: null },
          merge_queue: { queued_at: "2026-04-08T00:00:00.000Z", merged_at: "2026-04-08T00:00:02.000Z", direct_to_main_bypass: false, rework_count: 0, janus_invoked: false, janus_succeeded: false, conflict_count: 0 },
          restart_recovery: { expected: false, recovered: null, phase: null },
        },
      },
      human_intervention_issue_ids: [],
      cost_totals: null,
      quota_totals: null,
      timing: {
        started_at: "2026-04-08T00:00:00.000Z",
        finished_at: "2026-04-08T00:00:05.000Z",
        elapsed_ms: 5000,
      },
    };

    // Write the result file
    fs.writeFileSync(
      path.join(evalRoot, "single-clean-issue.json"),
      JSON.stringify(result, null, 2),
      "utf8",
    );

    // Generate the report
    const output = generateReleaseGateReportFromDisk(evalRoot, reportsDir);

    // Verify report was written
    expect(output.report).toBeDefined();
    expect(output.report.overall_status).toBeDefined();
    expect(output.scoreSummaries).toBeDefined();
    expect(output.scoreSummaries["single-clean-issue"]).toBeDefined();
    expect(output.reportPath).toMatch(/release-report\.json$/);
    expect(fs.existsSync(output.reportPath)).toBe(true);

    // Verify the report content
    expect(output.report.checks.length).toBe(RELEASE_GATE_CHECK_IDS.length);
    expect(output.report.metrics.scenario_count).toBe(1);
    expect(output.report.metrics.issue_completion_rate).toBe(1.0);
  });

  it("throws when result files are invalid", () => {
    const evalRoot = makeTempDir();
    const reportsDir = path.join(evalRoot, "reports");

    // Write an invalid result (missing required field)
    fs.writeFileSync(
      path.join(evalRoot, "bad-result.json"),
      JSON.stringify({ aegis_version: "0.1.0" }),
      "utf8",
    );

    expect(() => {
      generateReleaseGateReportFromDisk(evalRoot, reportsDir);
    }).toThrow(/Invalid eval run result/);
  });

  it("returns empty results when no result files exist", () => {
    const evalRoot = makeTempDir();
    const reportsDir = path.join(evalRoot, "reports");

    const output = generateReleaseGateReportFromDisk(evalRoot, reportsDir);

    expect(output.report.metrics.scenario_count).toBe(0);
    expect(Object.keys(output.scoreSummaries).length).toBe(0);
  });

  it("enforces Janus minority path fails at exactly 5/10", () => {
    const evalRoot = makeTempDir();
    const reportsDir = path.join(evalRoot, "reports");

    // Create a result with exactly 5 Janus invocations per 10 issues (50%)
    const issueEvidence: Record<string, any> = {};
    const completionOutcomes: Record<string, string> = {};
    const mergeOutcomes: Record<string, string> = {};

    for (let i = 1; i <= 10; i++) {
      const issueId = `issue-${i}`;
      completionOutcomes[issueId] = "completed";
      mergeOutcomes[issueId] = i <= 5 ? "conflict_resolved_janus" : "merged_clean";
      issueEvidence[issueId] = {
        structured_artifacts: {
          oracle: { expected: true, compliant: true, assessment_ref: null, estimated_complexity: "moderate", ready: true, derived_issue_ids: [] },
          titan: { expected: true, compliant: true, outcome: "success", files_changed: [], tests_and_checks_run: [], clarification_issue_id: null },
          sentinel: { expected: true, compliant: true, verdict_ref: null, verdict: "pass", created_fix_issue_ids: [] },
          janus: { expected: i <= 5, compliant: i <= 5, artifact_ref: null, recommended_next_action: i <= 5 ? "requeue" : null },
        },
        clarification: { expected: false, compliant: null, clarification_issue_id: null, blocking_question: null },
        merge_queue: { queued_at: "2026-04-08T00:00:00.000Z", merged_at: "2026-04-08T00:00:02.000Z", direct_to_main_bypass: false, rework_count: 0, janus_invoked: i <= 5, janus_succeeded: i <= 5, conflict_count: i <= 5 ? 1 : 0 },
        restart_recovery: { expected: false, recovered: null, phase: null },
      };
    }

    const result = {
      aegis_version: "0.1.0",
      git_sha: "abc123def4567890123456789012345678901234",
      config_fingerprint: "test-fingerprint",
      runtime: "pi",
      model_mapping: { oracle: "pi", titan: "pi" },
      scenario_id: "janus-escalation",
      issue_count: 10,
      issue_types: { task: 10 },
      completion_outcomes: completionOutcomes,
      merge_outcomes: mergeOutcomes,
      issue_evidence: issueEvidence,
      human_intervention_issue_ids: [],
      cost_totals: null,
      quota_totals: null,
      timing: {
        started_at: "2026-04-08T00:00:00.000Z",
        finished_at: "2026-04-08T00:00:05.000Z",
        elapsed_ms: 5000,
      },
    };

    fs.writeFileSync(
      path.join(evalRoot, "janus-escalation.json"),
      JSON.stringify(result, null, 2),
      "utf8",
    );

    const output = generateReleaseGateReportFromDisk(evalRoot, reportsDir);

    // Janus rate is exactly 5/10, which should FAIL (not a minority)
    const janusCheck = output.report.checks.find((c) => c.id === "janus_minority_path");
    expect(janusCheck).toBeDefined();
    expect(janusCheck!.metric_value).toBe(5.0);
    expect(janusCheck!.status).toBe("fail");
    expect(output.report.overall_status).toBe("fail");
  });
});
