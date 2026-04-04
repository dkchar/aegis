/**
 * Fixture schema — S03 contract seed.
 *
 * Defines the canonical Fixture interface and FixtureManifest types for the
 * Aegis eval harness benchmark corpus (SPECv2 §24.5 – §24.6).
 *
 * Naming conventions (enforced by contract, not runtime):
 * - Fixture directories: kebab-case under `evals/fixtures/<scenario-id>/`
 * - Each fixture directory contains `fixture.json` conforming to this interface
 * - Scenario IDs: kebab-case, must match between core-suite.json, index.json,
 *   and fixture directory names
 * - Result artifacts: `<results_path>/<scenario_id>/<timestamp>.json`
 *
 * Reset rules:
 * - "noop"       — fixture is stateless, no reset needed
 * - "git_reset"  — fixture includes a git repo that must be reset to HEAD before each run
 * - "file_copy"  — fixture includes template files that must be copied fresh before each run
 */

import type { CompletionOutcome, MergeOutcome } from "./result-schema.js";

// ---------------------------------------------------------------------------
// Const sets — exported for runtime validation and documentation
// ---------------------------------------------------------------------------

/**
 * Canonical fixture type identifiers corresponding to the 11 SPECv2 §24.6
 * required benchmark scenarios (mapped to 9 types since restart has two
 * scenarios sharing the same type).
 */
export const FIXTURE_TYPES: ReadonlySet<string> = new Set([
  "clean",           // single-clean-issue — happy-path baseline
  "complex_pause",   // issue that Oracle marks complex and pauses
  "decomposition",   // issue requiring child-issue decomposition
  "clarification",   // Titan ambiguity requiring a clarification issue
  "restart",         // orchestrator restart during implementation or merge
  "merge_conflict",  // hard merge conflict with preserved labor
  "rework",          // stale-branch merge requiring rework
  "janus",           // Tier 3 escalation or human-decision artifact path
  "polling_only",    // hooks disabled, polling is correctness path
]);

/**
 * Canonical reset rule identifiers.  Defines how a fixture is prepared
 * before each eval run.
 */
export const RESET_RULE_TYPES: ReadonlySet<string> = new Set([
  "noop",       // fixture is stateless — no reset needed
  "git_reset",  // fixture contains a git repo — reset to HEAD before each run
  "file_copy",  // fixture contains template files — copy fresh before each run
]);

// ---------------------------------------------------------------------------
// FixtureType / ResetRule union types (derived from the const sets)
// ---------------------------------------------------------------------------

export type FixtureType =
  | "clean"
  | "complex_pause"
  | "decomposition"
  | "clarification"
  | "restart"
  | "merge_conflict"
  | "rework"
  | "janus"
  | "polling_only";

export type ResetRule = "noop" | "git_reset" | "file_copy";

// ---------------------------------------------------------------------------
// FixtureIssue — per-issue fixture declaration
// ---------------------------------------------------------------------------

/**
 * Describes a single issue within a fixture.  The runner uses these fields
 * to simulate outcomes in Phase 0.5; the real pipeline wires them in S16A.
 */
export interface FixtureIssue {
  /** Stable issue identifier (scoped to the fixture, not globally unique). */
  id: string;
  /** Issue type label (e.g. "task", "bug", "feature"). */
  type: string;
  /** Expected completion outcome for the scenario. */
  expected_completion: CompletionOutcome;
  /** Expected merge outcome for the scenario. */
  expected_merge: MergeOutcome;
}

// ---------------------------------------------------------------------------
// Fixture — canonical fixture document interface (fixture.json)
// ---------------------------------------------------------------------------

/**
 * Canonical interface for a fixture document (`fixture.json`).
 *
 * This is a superset of the inline `Fixture` type that existed in
 * `run-scenario.ts` prior to S03.  The additional fields (`fixture_type`,
 * `reset_rules`, `scenario_tags`) are required for the benchmark corpus.
 *
 * Lane A and Lane B create the physical fixture directories and populate the
 * fixture.json files.  This interface is the contract they must conform to.
 */
export interface Fixture {
  /**
   * Fixture type — classifies the scenario this fixture exercises.
   * Must be a member of FIXTURE_TYPES.
   */
  fixture_type: FixtureType;

  /**
   * Reset rule — defines how this fixture is prepared before each eval run.
   * Must be a member of RESET_RULE_TYPES.
   */
  reset_rules: ResetRule;

  /**
   * Categorization tags for filtering, reporting, and grouping.
   * May be empty.  Each tag must be a non-empty string.
   */
  scenario_tags: string[];

  /** Issues that the runner will process during the scenario. */
  issues: FixtureIssue[];

  /**
   * Issue ids that required human intervention in the reference run.
   * Empty for fully automated scenarios.
   */
  human_interventions: string[];

  /**
   * AegisConfig key-value overrides applied during this scenario.
   * Empty object when no overrides are needed.
   */
  config_overrides: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Reused from validate-result.ts pattern — keeps validation self-contained. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Valid completion outcome strings (mirrors validate-result.ts). */
const VALID_COMPLETION_OUTCOMES: ReadonlySet<string> = new Set<CompletionOutcome>([
  "completed",
  "failed",
  "paused_complex",
  "paused_ambiguous",
  "killed_budget",
  "killed_stuck",
  "skipped",
]);

/** Valid merge outcome strings (mirrors validate-result.ts). */
const VALID_MERGE_OUTCOMES: ReadonlySet<string> = new Set<MergeOutcome>([
  "merged_clean",
  "merged_after_rework",
  "conflict_resolved_janus",
  "conflict_unresolved",
  "not_attempted",
]);

export interface FixtureValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate that an unknown object conforms to the Fixture interface.
 *
 * Returns `{ valid: true, errors: [] }` on success, or
 * `{ valid: false, errors: [...] }` listing every violation found.
 *
 * Follows the same pattern as `validateEvalRunResult` in validate-result.ts.
 */
export function validateFixture(data: unknown): FixtureValidationResult {
  const errors: string[] = [];

  if (!isRecord(data)) {
    return { valid: false, errors: ["Expected an object, got " + typeof data] };
  }

  // ── fixture_type ──────────────────────────────────────────────────────────

  if (typeof data["fixture_type"] !== "string" || !FIXTURE_TYPES.has(data["fixture_type"])) {
    errors.push(
      `"fixture_type" must be one of: ${[...FIXTURE_TYPES].join(", ")}` +
        (typeof data["fixture_type"] === "string"
          ? `; got "${data["fixture_type"]}"`
          : `; got ${typeof data["fixture_type"]}`),
    );
  }

  // ── reset_rules ───────────────────────────────────────────────────────────

  if (typeof data["reset_rules"] !== "string" || !RESET_RULE_TYPES.has(data["reset_rules"])) {
    errors.push(
      `"reset_rules" must be one of: ${[...RESET_RULE_TYPES].join(", ")}` +
        (typeof data["reset_rules"] === "string"
          ? `; got "${data["reset_rules"]}"`
          : `; got ${typeof data["reset_rules"]}`),
    );
  }

  // ── scenario_tags ─────────────────────────────────────────────────────────

  if (!Array.isArray(data["scenario_tags"])) {
    errors.push('"scenario_tags" must be an array');
  } else {
    for (const [i, tag] of (data["scenario_tags"] as unknown[]).entries()) {
      if (typeof tag !== "string" || tag.length === 0) {
        errors.push(`"scenario_tags[${i}]" must be a non-empty string`);
      }
    }
  }

  // ── issues ────────────────────────────────────────────────────────────────

  if (!Array.isArray(data["issues"])) {
    errors.push('"issues" must be an array');
  } else {
    for (const [i, issue] of (data["issues"] as unknown[]).entries()) {
      if (!isRecord(issue)) {
        errors.push(`"issues[${i}]" must be an object`);
        continue;
      }

      // id
      if (typeof issue["id"] !== "string" || (issue["id"] as string).length === 0) {
        errors.push(`"issues[${i}].id" must be a non-empty string`);
      }

      // type
      if (typeof issue["type"] !== "string" || (issue["type"] as string).length === 0) {
        errors.push(`"issues[${i}].type" must be a non-empty string`);
      }

      // expected_completion
      if (
        typeof issue["expected_completion"] !== "string" ||
        !VALID_COMPLETION_OUTCOMES.has(issue["expected_completion"])
      ) {
        errors.push(
          `"issues[${i}].expected_completion" has invalid value "${String(issue["expected_completion"])}"; ` +
            `must be one of: ${[...VALID_COMPLETION_OUTCOMES].join(", ")}`,
        );
      }

      // expected_merge
      if (
        typeof issue["expected_merge"] !== "string" ||
        !VALID_MERGE_OUTCOMES.has(issue["expected_merge"])
      ) {
        errors.push(
          `"issues[${i}].expected_merge" has invalid value "${String(issue["expected_merge"])}"; ` +
            `must be one of: ${[...VALID_MERGE_OUTCOMES].join(", ")}`,
        );
      }
    }
  }

  // ── human_interventions ───────────────────────────────────────────────────

  if (!Array.isArray(data["human_interventions"])) {
    errors.push('"human_interventions" must be an array');
  } else {
    for (const [i, v] of (data["human_interventions"] as unknown[]).entries()) {
      if (typeof v !== "string" || (v as string).length === 0) {
        errors.push(`"human_interventions[${i}]" must be a non-empty string`);
      }
    }
  }

  // ── config_overrides ──────────────────────────────────────────────────────

  if (!isRecord(data["config_overrides"])) {
    errors.push('"config_overrides" must be an object');
  }

  return { valid: errors.length === 0, errors };
}
