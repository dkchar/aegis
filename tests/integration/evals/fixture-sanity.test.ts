/**
 * S03 automated gate — fixture sanity tests.
 *
 * Validates the benchmark corpus against SPECv2 §24.6:
 *   a) Every fixture.json is structurally valid
 *   b) Every core-suite.json scenario has a matching fixture directory
 *   c) Every fixture directory has a matching scenario entry (no orphans)
 *   d) The suite covers all 11 required SPECv2 §24.6 scenario IDs
 *   e) Every FIXTURE_TYPES member has at least one fixture using it
 *   f) Each scenario produces a valid EvalRunResult via runScenario()
 *   g) Score summaries can be computed for completed scenarios
 */

import path from "node:path";
import fs from "node:fs";

import { describe, it, expect } from "vitest";

import { validateFixture, FIXTURE_TYPES } from "../../../src/evals/fixture-schema.js";
import { runScenario } from "../../../src/evals/run-scenario.js";
import { validateEvalRunResult } from "../../../src/evals/validate-result.js";
import { computeScoreSummary } from "../../../src/evals/compute-score-summary.js";
import type { EvalScenario } from "../../../src/evals/result-schema.js";

// ---------------------------------------------------------------------------
// Shared paths / helpers
// ---------------------------------------------------------------------------

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const fixturesDir = path.resolve(repoRoot, "evals", "fixtures");
const coreSuitePath = path.resolve(repoRoot, "evals", "scenarios", "core-suite.json");
const indexPath = path.resolve(repoRoot, "evals", "scenarios", "index.json");

/** SPECv2 §24.6 required benchmark scenario IDs (exactly 11). */
const REQUIRED_SCENARIO_IDS: ReadonlySet<string> = new Set([
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
]);

interface CoreSuiteManifest {
  scenarios: EvalScenario[];
}

function loadCoreSuite(): CoreSuiteManifest {
  const raw = fs.readFileSync(coreSuitePath, "utf8");
  return JSON.parse(raw) as CoreSuiteManifest;
}

function loadFixtureJson(scenarioId: string): unknown {
  const fixturePath = path.join(fixturesDir, scenarioId, "fixture.json");
  const raw = fs.readFileSync(fixturePath, "utf8");
  return JSON.parse(raw);
}

/** Returns the list of fixture directory names (excludes .gitkeep and non-directories). */
function listFixtureDirs(): string[] {
  return fs
    .readdirSync(fixturesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

// ---------------------------------------------------------------------------
// a) Fixture validation
// ---------------------------------------------------------------------------

describe("S03 fixture sanity", () => {
  describe("fixture validation", () => {
    it("validates each fixture.json against the schema", () => {
      const fixtureDirs = listFixtureDirs();
      expect(fixtureDirs.length).toBeGreaterThan(0);

      const failures: Array<{ dir: string; errors: string[] }> = [];

      for (const dir of fixtureDirs) {
        const fixturePath = path.join(fixturesDir, dir, "fixture.json");
        expect(
          fs.existsSync(fixturePath),
          `fixture.json missing for directory "${dir}"`,
        ).toBe(true);

        let data: unknown;
        try {
          const raw = fs.readFileSync(fixturePath, "utf8");
          data = JSON.parse(raw);
        } catch (err) {
          failures.push({ dir, errors: [`Failed to parse fixture.json: ${String(err)}`] });
          continue;
        }

        const result = validateFixture(data);
        if (!result.valid) {
          failures.push({ dir, errors: result.errors });
        }
      }

      if (failures.length > 0) {
        const summary = failures
          .map((f) => `  ${f.dir}: ${f.errors.join("; ")}`)
          .join("\n");
        throw new Error(`${failures.length} fixture(s) failed validation:\n${summary}`);
      }
    });
  });

  // -------------------------------------------------------------------------
  // b) + c) Manifest-fixture sync
  // -------------------------------------------------------------------------

  describe("manifest-fixture sync", () => {
    it("every core-suite scenario has a matching fixture", () => {
      const suite = loadCoreSuite();
      const missing: string[] = [];

      for (const scenario of suite.scenarios) {
        const fixturePath = path.join(fixturesDir, scenario.id, "fixture.json");
        if (!fs.existsSync(fixturePath)) {
          missing.push(scenario.id);
          continue;
        }

        const raw = fs.readFileSync(fixturePath, "utf8");
        const data = JSON.parse(raw) as unknown;
        const result = validateFixture(data);
        if (!result.valid) {
          missing.push(`${scenario.id} (invalid: ${result.errors.join("; ")})`);
        }
      }

      if (missing.length > 0) {
        throw new Error(
          `${missing.length} scenario(s) from core-suite.json lack a valid fixture:\n  ${missing.join("\n  ")}`,
        );
      }
    });

    it("index.json and core-suite.json contain the same scenario IDs", () => {
      const suite = loadCoreSuite();
      const indexRaw = fs.readFileSync(indexPath, "utf8");
      const index = JSON.parse(indexRaw) as CoreSuiteManifest;

      const suiteIds = suite.scenarios.map((s) => s.id).sort();
      const indexIds = index.scenarios.map((s) => s.id).sort();

      expect(indexIds).toEqual(suiteIds);
    });

    it("every fixture directory has a matching scenario", () => {
      const suite = loadCoreSuite();
      const scenarioIds = new Set(suite.scenarios.map((s) => s.id));
      const fixtureDirs = listFixtureDirs();

      const orphans = fixtureDirs.filter((dir) => !scenarioIds.has(dir));

      if (orphans.length > 0) {
        throw new Error(
          `${orphans.length} fixture director(ies) have no matching scenario in core-suite.json:\n  ${orphans.join("\n  ")}`,
        );
      }
    });
  });

  // -------------------------------------------------------------------------
  // d) SPECv2 §24.6 coverage
  // -------------------------------------------------------------------------

  describe("SPECv2 §24.6 coverage", () => {
    it("covers all 11 required benchmark scenarios", () => {
      const suite = loadCoreSuite();
      const suiteIds = new Set(suite.scenarios.map((s) => s.id));

      const missing = [...REQUIRED_SCENARIO_IDS].filter((id) => !suiteIds.has(id));
      const extra = [...suiteIds].filter((id) => !REQUIRED_SCENARIO_IDS.has(id));

      expect(
        missing,
        `Missing required SPECv2 §24.6 scenarios: ${missing.join(", ")}`,
      ).toHaveLength(0);

      // The suite may not have extra scenarios beyond the 11 required ones
      // (extras would indicate scope creep or orphan entries)
      expect(
        extra,
        `core-suite.json contains scenarios not in SPECv2 §24.6 required set: ${extra.join(", ")}`,
      ).toHaveLength(0);

      expect(suite.scenarios).toHaveLength(11);
    });
  });

  // -------------------------------------------------------------------------
  // e) Fixture type coverage
  // -------------------------------------------------------------------------

  describe("fixture type coverage", () => {
    it("every FIXTURE_TYPES member has at least one fixture using it", () => {
      const fixtureDirs = listFixtureDirs();
      const usedTypes = new Set<string>();

      for (const dir of fixtureDirs) {
        try {
          const data = loadFixtureJson(dir) as Record<string, unknown>;
          if (typeof data["fixture_type"] === "string") {
            usedTypes.add(data["fixture_type"]);
          }
        } catch {
          // Skip unreadable fixtures — the validation test above covers this
        }
      }

      const uncovered = [...FIXTURE_TYPES].filter((t) => !usedTypes.has(t));

      if (uncovered.length > 0) {
        throw new Error(
          `${uncovered.length} FIXTURE_TYPES member(s) have no fixture exercising them:\n  ${uncovered.join("\n  ")}`,
        );
      }
    });
  });

  // -------------------------------------------------------------------------
  // f) Scenario round-trip through the runner
  // -------------------------------------------------------------------------

  describe("scenario round-trip", () => {
    it(
      "each scenario produces a valid EvalRunResult via runScenario()",
      async () => {
        const suite = loadCoreSuite();
        const failures: Array<{ id: string; errors: string[] }> = [];

        for (const scenario of suite.scenarios) {
          let result: Awaited<ReturnType<typeof runScenario>>;
          try {
            result = await runScenario({ scenario, projectRoot: repoRoot });
          } catch (err) {
            failures.push({
              id: scenario.id,
              errors: [`runScenario threw: ${String(err)}`],
            });
            continue;
          }

          const validation = validateEvalRunResult(result);
          if (!validation.valid) {
            failures.push({ id: scenario.id, errors: validation.errors });
          } else if (result.scenario_id !== scenario.id) {
            failures.push({
              id: scenario.id,
              errors: [
                `scenario_id mismatch: expected "${scenario.id}", got "${result.scenario_id}"`,
              ],
            });
          }
        }

        if (failures.length > 0) {
          const summary = failures
            .map((f) => `  ${f.id}: ${f.errors.join("; ")}`)
            .join("\n");
          throw new Error(`${failures.length} scenario(s) failed the round-trip:\n${summary}`);
        }
      },
      // Allow up to 30s for all 11 scenarios to run
      30_000,
    );
  });

  // -------------------------------------------------------------------------
  // g) Score summary generation
  // -------------------------------------------------------------------------

  describe("score summary generation", () => {
    it("produces valid score summaries for completed scenarios", async () => {
      const suite = loadCoreSuite();

      // Pick scenarios where min_completion_rate > 0 (i.e. at least one issue
      // is expected to complete) so we exercise more of the summary metrics.
      const completedScenarios = suite.scenarios.filter(
        (s) => s.expected_outcomes.min_completion_rate > 0,
      );

      // Ensure we have at least one scenario to test against
      expect(completedScenarios.length).toBeGreaterThan(0);

      const requiredSummaryFields: Array<keyof ReturnType<typeof computeScoreSummary>> = [
        "scenario_id",
        "run_timestamp",
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
        "gates",
      ];

      const requiredGateFields: Array<keyof ReturnType<typeof computeScoreSummary>["gates"]> = [
        "structured_artifact_compliance_100pct",
        "clarification_compliance_100pct",
        "restart_recovery_100pct",
        "no_direct_to_main_bypasses",
        "issue_completion_rate_80pct",
        "human_interventions_within_threshold",
        "janus_minority_path",
      ];

      for (const scenario of completedScenarios) {
        const result = await runScenario({ scenario, projectRoot: repoRoot });
        const summary = computeScoreSummary(result);

        // Verify all required top-level fields are present
        for (const field of requiredSummaryFields) {
          expect(
            field in summary,
            `ScoreSummary for "${scenario.id}" is missing field "${field}"`,
          ).toBe(true);
        }

        // Verify scenario_id and run_timestamp are set correctly
        expect(summary.scenario_id).toBe(scenario.id);
        expect(typeof summary.run_timestamp).toBe("string");
        expect(summary.run_timestamp.length).toBeGreaterThan(0);

        // Verify all gate fields are present and are booleans
        for (const gateField of requiredGateFields) {
          expect(
            gateField in summary.gates,
            `ScoreSummary.gates for "${scenario.id}" is missing field "${gateField}"`,
          ).toBe(true);
          expect(
            typeof summary.gates[gateField],
            `ScoreSummary.gates.${gateField} for "${scenario.id}" should be a boolean`,
          ).toBe("boolean");
        }
      }
    }, 30_000);
  });
});
