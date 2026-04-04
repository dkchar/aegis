/**
 * S02 manual gate verification script.
 *
 * Verifies:
 * 1. Running the same scenario twice yields comparable artifacts under .aegis/evals/
 * 2. A simulated failed run still records a clean failure artifact.
 *
 * Usage: npx tsx tests/manual/s02-gate-check.ts
 */

import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";

import { runScenario } from "../../src/evals/run-scenario.js";
import { writeResult, readResult } from "../../src/evals/write-result.js";
import { computeScoreSummary } from "../../src/evals/compute-score-summary.js";
import { compareScoreSummaries } from "../../src/evals/compare-runs.js";
import type { EvalScenario } from "../../src/evals/result-schema.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../..");
const RESULTS_PATH = path.join(PROJECT_ROOT, ".aegis", "evals");

// ── Load scenario from manifest ────────────────────────────────────────────

const manifestPath = path.join(PROJECT_ROOT, "evals", "scenarios", "index.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
  scenarios: EvalScenario[];
};
const scenario = manifest.scenarios[0];
if (!scenario) {
  throw new Error("No scenarios found in index.json");
}

console.log(`\nScenario: ${scenario.id} — "${scenario.name}"`);

// ── Run the scenario twice ─────────────────────────────────────────────────

console.log("\n[1] Running scenario (run 1)...");
const result1 = await runScenario({ scenario, projectRoot: PROJECT_ROOT });

// Introduce a small delay so the timestamps differ (started_at is used as filename)
await new Promise((r) => setTimeout(r, 10));

console.log("[2] Running scenario (run 2)...");
const result2 = await runScenario({ scenario, projectRoot: PROJECT_ROOT });

// ── Write both results ─────────────────────────────────────────────────────

console.log("\n[3] Writing result artifacts...");
const path1 = await writeResult(result1, RESULTS_PATH);
const path2 = await writeResult(result2, RESULTS_PATH);

console.log(`    run 1 artifact: ${path1}`);
console.log(`    run 2 artifact: ${path2}`);

// ── Read them back ─────────────────────────────────────────────────────────

console.log("\n[4] Reading artifacts back from disk...");
const read1 = await readResult(path1);
const read2 = await readResult(path2);

// ── Verify scenario_id matches ─────────────────────────────────────────────

if (read1.scenario_id !== scenario.id) {
  throw new Error(`run 1 scenario_id mismatch: expected "${scenario.id}", got "${read1.scenario_id}"`);
}
if (read2.scenario_id !== scenario.id) {
  throw new Error(`run 2 scenario_id mismatch: expected "${scenario.id}", got "${read2.scenario_id}"`);
}
console.log(`    Both artifacts have scenario_id="${scenario.id}" — OK`);

// ── Verify artifacts are valid (files exist and have required fields) ───────

for (const [label, p, r] of [["run 1", path1, read1], ["run 2", path2, read2]] as const) {
  if (!fs.existsSync(p)) throw new Error(`${label} artifact file does not exist: ${p}`);
  if (typeof r.aegis_version !== "string") throw new Error(`${label}: missing aegis_version`);
  if (typeof r.git_sha !== "string") throw new Error(`${label}: missing git_sha`);
  if (typeof r.scenario_id !== "string") throw new Error(`${label}: missing scenario_id`);
  if (typeof r.issue_count !== "number") throw new Error(`${label}: missing issue_count`);
}
console.log("    Both artifacts are valid JSON with all required fields — OK");

// ── Compute score summaries ────────────────────────────────────────────────

console.log("\n[5] Computing score summaries...");
const summary1 = computeScoreSummary(read1);
const summary2 = computeScoreSummary(read2);

console.log(`    run 1 completion_rate=${summary1.issue_completion_rate}, gates_all_pass=${Object.values(summary1.gates).every(Boolean)}`);
console.log(`    run 2 completion_rate=${summary2.issue_completion_rate}, gates_all_pass=${Object.values(summary2.gates).every(Boolean)}`);

// ── Compare summaries ─────────────────────────────────────────────────────

console.log("\n[6] Comparing run 1 (baseline) vs run 2 (current)...");
const report = compareScoreSummaries(summary1, summary2);

if (report.has_regressions) {
  throw new Error(
    `Regressions detected between identical runs: ${JSON.stringify(report.regressions, null, 2)}`
  );
}
console.log(`    No regressions detected — regressions=0, improvements=${report.improvements.length} — OK`);

// ── Simulated failed run ───────────────────────────────────────────────────

console.log("\n[7] Testing failed run: creating temporary failed fixture...");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aegis-gate-"));
const tmpFixtureDir = path.join(tmpDir, "evals", "fixtures", "failed-scenario");
fs.mkdirSync(tmpFixtureDir, { recursive: true });

// Write a fixture where the single issue has expected_completion: "failed"
const failedFixture = {
  issues: [
    {
      id: "fail-001",
      type: "task",
      expected_completion: "failed",
      expected_merge: "not_attempted",
    },
  ],
  human_interventions: [],
  config_overrides: {},
};
fs.writeFileSync(
  path.join(tmpFixtureDir, "fixture.json"),
  JSON.stringify(failedFixture, null, 2),
  "utf8"
);

// Copy package.json to the temp dir so readAegisVersion() works
fs.copyFileSync(
  path.join(PROJECT_ROOT, "package.json"),
  path.join(tmpDir, "package.json")
);

// Init a minimal git repo in tmpDir so readGitSha() doesn't throw
try {
  const { execSync } = await import("node:child_process");
  execSync("git init -q", { cwd: tmpDir, stdio: "pipe" });
  execSync('git config user.email "gate@aegis.local"', { cwd: tmpDir, stdio: "pipe" });
  execSync('git config user.name "Gate"', { cwd: tmpDir, stdio: "pipe" });
  execSync("git commit --allow-empty -m init -q", { cwd: tmpDir, stdio: "pipe" });
} catch {
  // Not critical; runScenario handles missing git gracefully
}

const failedScenario: EvalScenario = {
  id: "failed-scenario",
  name: "Simulated failed run",
  description: "Scenario where the single issue fails — gate test for failure artifact recording.",
  fixture_path: "failed-scenario/fixture.json",
  expected_outcomes: {
    min_completion_rate: 0,
    expects_human_intervention: false,
    expects_janus: false,
    expects_restart_recovery: false,
  },
};

const failedResult = await runScenario({
  scenario: failedScenario,
  projectRoot: tmpDir,
});

const failedResultsPath = path.join(tmpDir, ".aegis", "evals");
const failedPath = await writeResult(failedResult, failedResultsPath);
const failedRead = await readResult(failedPath);

// Verify artifact exists and is valid JSON
if (!fs.existsSync(failedPath)) {
  throw new Error(`Failed run artifact does not exist: ${failedPath}`);
}
console.log(`    Failed run artifact written: ${failedPath}`);

// Verify the outcome is NOT "completed"
const outcomeValues = Object.values(failedRead.completion_outcomes);
if (outcomeValues.some((o) => o === "completed")) {
  throw new Error(`Expected no "completed" outcomes in failed run, but got: ${JSON.stringify(outcomeValues)}`);
}
console.log(`    All completion outcomes are non-completed: ${JSON.stringify(outcomeValues)} — OK`);

// Verify it's valid JSON with all required fields
if (typeof failedRead.scenario_id !== "string") throw new Error("failed artifact: missing scenario_id");
if (typeof failedRead.issue_count !== "number") throw new Error("failed artifact: missing issue_count");
console.log("    Failed artifact is valid JSON with all required fields — OK");

// Clean up temp directory
fs.rmSync(tmpDir, { recursive: true, force: true });

// ── Final summary ─────────────────────────────────────────────────────────

console.log("\n========================================");
console.log("S02 MANUAL GATE: ALL CHECKS PASSED");
console.log("========================================");
console.log("  ✓ Scenario ran twice with comparable artifacts");
console.log("  ✓ Both artifacts have matching scenario_id and valid fields");
console.log("  ✓ Score summaries computed correctly for both runs");
console.log("  ✓ Comparison shows zero regressions between identical runs");
console.log("  ✓ Failed run produced a clean, valid failure artifact");
console.log("  ✓ No 'completed' outcomes in the failed run artifact");
