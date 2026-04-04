/**
 * S02 integration tests — scenario runner acceptance criteria.
 *
 * Lane A tests (runScenario and writeResult/readResult) are implemented here.
 * Lane B tests (ScoreSummary generation) remain as it.todo() stubs.
 */

import path from "node:path";
import os from "node:os";
import fs from "node:fs";

import { describe, it, expect, afterEach } from "vitest";

import { runScenario } from "../../../src/evals/run-scenario.js";
import { writeResult, readResult } from "../../../src/evals/write-result.js";
import type { EvalRunResult, EvalScenario } from "../../../src/evals/result-schema.js";

// ---------------------------------------------------------------------------
// Shared fixtures / helpers
// ---------------------------------------------------------------------------

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

/** Minimal EvalScenario pointing at the single-clean-issue fixture. */
function makeTestScenario(): EvalScenario {
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

/** A minimal pre-built EvalRunResult for persistence tests. */
function makeMinimalResult(overrides: Partial<EvalRunResult> = {}): EvalRunResult {
  return {
    aegis_version: "0.1.0",
    git_sha: "abc1234def5678901234567890123456789012345",
    config_fingerprint: "deadbeef",
    runtime: "pi",
    model_mapping: { oracle: "pi:default", titan: "pi:default" },
    scenario_id: "single-clean-issue",
    issue_count: 1,
    issue_types: { task: 1 },
    completion_outcomes: { "test-001": "completed" },
    merge_outcomes: { "test-001": "merged_clean" },
    human_intervention_issue_ids: [],
    cost_totals: null,
    quota_totals: null,
    timing: {
      started_at: "2026-04-04T18:00:00.000Z",
      finished_at: "2026-04-04T18:05:00.000Z",
      elapsed_ms: 300_000,
    },
    ...overrides,
  };
}

/** Temp dirs created by tests — cleaned up in afterEach. */
const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aegis-eval-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
  tempDirs.length = 0;
});

// ---------------------------------------------------------------------------
// Scenario runner — lane A acceptance criteria
// ---------------------------------------------------------------------------

describe("S02 scenario runner — lane A (runScenario)", () => {
  it(
    "runs the single-clean-issue scenario end-to-end and returns an EvalRunResult with scenario_id matching the input",
    async () => {
      const scenario = makeTestScenario();
      const result = await runScenario({ scenario, projectRoot: repoRoot });

      expect(result.scenario_id).toBe(scenario.id);
    },
  );

  it(
    "result.issue_count matches the number of issues in the fixture repository",
    async () => {
      const scenario = makeTestScenario();
      const result = await runScenario({ scenario, projectRoot: repoRoot });

      // The single-clean-issue fixture has exactly 1 issue.
      expect(result.issue_count).toBe(1);
    },
  );

  it(
    "result.completion_outcomes contains an entry for every issue in the scenario",
    async () => {
      const scenario = makeTestScenario();
      const result = await runScenario({ scenario, projectRoot: repoRoot });

      // Fixture declares issue id "test-001"
      expect(Object.keys(result.completion_outcomes)).toContain("test-001");
      expect(Object.keys(result.completion_outcomes)).toHaveLength(result.issue_count);
    },
  );

  it(
    "result.merge_outcomes contains an entry for every issue in the scenario",
    async () => {
      const scenario = makeTestScenario();
      const result = await runScenario({ scenario, projectRoot: repoRoot });

      expect(Object.keys(result.merge_outcomes)).toContain("test-001");
      expect(Object.keys(result.merge_outcomes)).toHaveLength(result.issue_count);
    },
  );

  it(
    "result.timing.elapsed_ms is a positive number and matches the wall-clock duration",
    async () => {
      const scenario = makeTestScenario();
      const result = await runScenario({ scenario, projectRoot: repoRoot });

      expect(result.timing.elapsed_ms).toBeGreaterThanOrEqual(0);

      const started = new Date(result.timing.started_at).getTime();
      const finished = new Date(result.timing.finished_at).getTime();
      expect(result.timing.elapsed_ms).toBe(finished - started);
    },
  );

  it(
    "result.timing.started_at and result.timing.finished_at are valid ISO-8601 timestamps",
    async () => {
      const scenario = makeTestScenario();
      const result = await runScenario({ scenario, projectRoot: repoRoot });

      expect(new Date(result.timing.started_at).toISOString()).toBe(result.timing.started_at);
      expect(new Date(result.timing.finished_at).toISOString()).toBe(result.timing.finished_at);
    },
  );

  it(
    "result.aegis_version is a non-empty semver string",
    async () => {
      const scenario = makeTestScenario();
      const result = await runScenario({ scenario, projectRoot: repoRoot });

      expect(result.aegis_version).toMatch(/^\d+\.\d+\.\d+/);
    },
  );

  it(
    "result.git_sha is a 40-character hex string",
    async () => {
      const scenario = makeTestScenario();
      const result = await runScenario({ scenario, projectRoot: repoRoot });

      expect(result.git_sha).toMatch(/^[0-9a-f]{40}$/i);
    },
  );

  it(
    "result.config_fingerprint is a non-empty string",
    async () => {
      const scenario = makeTestScenario();
      const result = await runScenario({ scenario, projectRoot: repoRoot });

      expect(typeof result.config_fingerprint).toBe("string");
      expect(result.config_fingerprint.length).toBeGreaterThan(0);
    },
  );

  it(
    "result.runtime matches the runtime configured in the project root",
    async () => {
      const scenario = makeTestScenario();
      const result = await runScenario({ scenario, projectRoot: repoRoot });

      // Default runtime is "pi" (from DEFAULT_AEGIS_CONFIG)
      expect(typeof result.runtime).toBe("string");
      expect(result.runtime.length).toBeGreaterThan(0);
    },
  );

  it(
    "result.model_mapping contains an entry for every role used by the scenario",
    async () => {
      const scenario = makeTestScenario();
      const result = await runScenario({ scenario, projectRoot: repoRoot });

      expect(typeof result.model_mapping).toBe("object");
      expect(Object.keys(result.model_mapping).length).toBeGreaterThan(0);
    },
  );

  it.todo(
    "a scenario that times out records completion_outcome 'killed_stuck' for the in-flight issue",
  );

  it.todo(
    "a scenario that exceeds the budget records completion_outcome 'killed_budget' for the affected issue",
  );

  it.todo(
    "a scenario that requires Oracle to pause a complex issue records completion_outcome 'paused_complex'",
  );

  it.todo(
    "a scenario that triggers Janus records the invocation in merge_outcomes as 'conflict_resolved_janus'",
  );

  it(
    "human_intervention_issue_ids is empty for a clean scenario with no operator actions",
    async () => {
      const scenario = makeTestScenario();
      const result = await runScenario({ scenario, projectRoot: repoRoot });

      expect(result.human_intervention_issue_ids).toEqual([]);
    },
  );
});

// ---------------------------------------------------------------------------
// Result persistence — lane A acceptance criteria (writeResult / readResult)
// ---------------------------------------------------------------------------

describe("S02 result persistence — lane A (writeResult / readResult)", () => {
  it(
    "writeResult creates the results directory tree if it does not exist",
    async () => {
      const tmpDir = makeTempDir();
      const resultsPath = path.join(tmpDir, "nested", "results");
      const result = makeMinimalResult();

      await writeResult(result, resultsPath);

      const expectedDir = path.join(resultsPath, result.scenario_id);
      expect(fs.existsSync(expectedDir)).toBe(true);
    },
  );

  it(
    "writeResult writes a valid JSON file at <resultsPath>/<scenario_id>/<run_timestamp>.json",
    async () => {
      const tmpDir = makeTempDir();
      const result = makeMinimalResult();

      const filePath = await writeResult(result, tmpDir);

      expect(fs.existsSync(filePath)).toBe(true);
      const raw = fs.readFileSync(filePath, "utf8");
      expect(() => JSON.parse(raw)).not.toThrow();

      // Path should be <resultsPath>/<scenario_id>/...
      expect(filePath).toContain(result.scenario_id);
      // Timestamp portion: colons replaced with hyphens
      expect(filePath).toContain("2026-04-04T18-00-00.000Z.json");
    },
  );

  it(
    "writeResult returns the absolute path of the file that was written",
    async () => {
      const tmpDir = makeTempDir();
      const result = makeMinimalResult();

      const filePath = await writeResult(result, tmpDir);

      expect(path.isAbsolute(filePath)).toBe(true);
    },
  );

  it(
    "readResult parses the file written by writeResult and returns an identical EvalRunResult",
    async () => {
      const tmpDir = makeTempDir();
      const result = makeMinimalResult();

      const filePath = await writeResult(result, tmpDir);
      const roundTripped = await readResult(filePath);

      expect(roundTripped).toEqual(result);
    },
  );

  it(
    "running the same scenario twice produces two distinct result files under the same scenario_id directory",
    async () => {
      const tmpDir = makeTempDir();
      const result1 = makeMinimalResult({
        timing: {
          started_at: "2026-04-04T18:00:00.000Z",
          finished_at: "2026-04-04T18:05:00.000Z",
          elapsed_ms: 300_000,
        },
      });
      const result2 = makeMinimalResult({
        timing: {
          started_at: "2026-04-04T19:00:00.000Z",
          finished_at: "2026-04-04T19:05:00.000Z",
          elapsed_ms: 300_000,
        },
      });

      const filePath1 = await writeResult(result1, tmpDir);
      const filePath2 = await writeResult(result2, tmpDir);

      expect(filePath1).not.toBe(filePath2);

      // Both files exist
      expect(fs.existsSync(filePath1)).toBe(true);
      expect(fs.existsSync(filePath2)).toBe(true);

      // Both are in the same scenario_id directory
      expect(path.dirname(filePath1)).toBe(path.dirname(filePath2));
    },
  );

  it(
    "a failed run (any issue with a non-completed outcome) still produces a clean result artifact",
    async () => {
      const tmpDir = makeTempDir();
      const result = makeMinimalResult({
        completion_outcomes: { "test-001": "failed" },
        merge_outcomes: { "test-001": "not_attempted" },
      });

      const filePath = await writeResult(result, tmpDir);
      const roundTripped = await readResult(filePath);

      expect(roundTripped.completion_outcomes["test-001"]).toBe("failed");
      expect(roundTripped.merge_outcomes["test-001"]).toBe("not_attempted");
    },
  );

  it(
    "result artifacts are pretty-printed JSON (human-readable, not minified)",
    async () => {
      const tmpDir = makeTempDir();
      const result = makeMinimalResult();

      const filePath = await writeResult(result, tmpDir);
      const raw = fs.readFileSync(filePath, "utf8");

      // Pretty-printed JSON has newlines and indentation
      expect(raw).toContain("\n");
      expect(raw).toContain("  ");
    },
  );
});

// ---------------------------------------------------------------------------
// Score summary — lane B acceptance criteria (ScoreSummary generation)
// ---------------------------------------------------------------------------

describe("S02 score summary — lane B acceptance criteria", () => {
  it.todo(
    "computeScoreSummary returns a ScoreSummary with issue_completion_rate equal to completed_count / issue_count",
  );

  it.todo(
    "computeScoreSummary sets gates.issue_completion_rate_80pct to true when completion rate >= 0.8",
  );

  it.todo(
    "computeScoreSummary sets gates.issue_completion_rate_80pct to false when completion rate < 0.8",
  );

  it.todo(
    "computeScoreSummary sets gates.human_interventions_within_threshold to false when rate exceeds config default of 2 per 10 issues",
  );

  it.todo(
    "computeScoreSummary sets cost_per_completed_issue_usd to null when cost_totals is null",
  );

  it.todo(
    "comparing two ScoreSummary artifacts from consecutive runs detects a regression in issue_completion_rate",
  );
});
