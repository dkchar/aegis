/**
 * S03 contract seed — unit tests for the fixture schema.
 *
 * These tests drive the design of src/evals/fixture-schema.ts and verify
 * the fixture validation contract before the lane workers create real fixtures.
 *
 * Test coverage:
 *   1. validateFixture accepts a valid fixture with all required + optional fields
 *   2. validateFixture rejects missing required fields
 *   3. validateFixture rejects invalid fixture_type values
 *   4. validateFixture rejects invalid reset_rules values
 *   5. validateFixture rejects invalid issue fields
 *   6. FIXTURE_TYPES and RESET_RULE_TYPES const sets contain all expected members
 *
 * NOTE: These are structural / contract tests only — they do not create files
 * on disk, do not run scenarios, and do not implement lanes.
 */

import { describe, expect, it } from "vitest";

import {
  validateFixture,
  FIXTURE_TYPES,
  RESET_RULE_TYPES,
  type Fixture,
  type FixtureIssue,
} from "../../../src/evals/fixture-schema.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal valid FixtureIssue. */
function makeIssue(overrides: Partial<FixtureIssue> = {}): FixtureIssue {
  return {
    id: "test-001",
    type: "task",
    expected_completion: "completed",
    expected_merge: "merged_clean",
    ...overrides,
  };
}

/** Build a minimal valid Fixture with all required fields. */
function makeFixture(overrides: Partial<Fixture> = {}): Fixture {
  return {
    fixture_type: "clean",
    reset_rules: "noop",
    scenario_tags: ["happy-path"],
    issues: [makeIssue()],
    human_interventions: [],
    config_overrides: {},
    ...overrides,
  };
}

/** Untyped helper for tests that need to omit or mutate fields at the data level. */
function makeFixtureData(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    fixture_type: "clean",
    reset_rules: "noop",
    scenario_tags: ["happy-path"],
    issues: [
      {
        id: "test-001",
        type: "task",
        expected_completion: "completed",
        expected_merge: "merged_clean",
      },
    ],
    human_interventions: [],
    config_overrides: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// FIXTURE_TYPES and RESET_RULE_TYPES const sets
// ---------------------------------------------------------------------------

describe("S03 fixture schema — FIXTURE_TYPES const set", () => {
  it("contains all 9 expected fixture type values", () => {
    const expected = [
      "clean",
      "complex_pause",
      "decomposition",
      "clarification",
      "restart",
      "merge_conflict",
      "rework",
      "janus",
      "polling_only",
    ];

    for (const value of expected) {
      expect(FIXTURE_TYPES.has(value)).toBe(true);
    }
  });

  it("contains exactly the expected number of values (no extras)", () => {
    expect(FIXTURE_TYPES.size).toBe(9);
  });
});

describe("S03 fixture schema — RESET_RULE_TYPES const set", () => {
  it("contains all 3 expected reset rule values", () => {
    const expected = ["noop", "git_reset", "file_copy"];

    for (const value of expected) {
      expect(RESET_RULE_TYPES.has(value)).toBe(true);
    }
  });

  it("contains exactly 3 values (no extras)", () => {
    expect(RESET_RULE_TYPES.size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// validateFixture — accepts valid fixtures
// ---------------------------------------------------------------------------

describe("S03 fixture schema — validateFixture accepts valid input", () => {
  it("accepts a minimal valid fixture (clean / noop)", () => {
    const result = validateFixture(makeFixture());

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("accepts each valid fixture_type individually", () => {
    const types = [
      "clean",
      "complex_pause",
      "decomposition",
      "clarification",
      "restart",
      "merge_conflict",
      "rework",
      "janus",
      "polling_only",
    ] as const;

    for (const fixture_type of types) {
      const result = validateFixture(makeFixture({ fixture_type }));
      expect(result.valid).toBe(true);
    }
  });

  it("accepts each valid reset_rules value individually", () => {
    const rules = ["noop", "git_reset", "file_copy"] as const;

    for (const reset_rules of rules) {
      const result = validateFixture(makeFixture({ reset_rules }));
      expect(result.valid).toBe(true);
    }
  });

  it("accepts empty scenario_tags array", () => {
    const result = validateFixture(makeFixture({ scenario_tags: [] }));
    expect(result.valid).toBe(true);
  });

  it("accepts multiple scenario_tags", () => {
    const result = validateFixture(makeFixture({ scenario_tags: ["happy-path", "baseline", "phase0"] }));
    expect(result.valid).toBe(true);
  });

  it("accepts multiple issues in the issues array", () => {
    const result = validateFixture(
      makeFixture({
        issues: [
          makeIssue({ id: "issue-1" }),
          makeIssue({ id: "issue-2", type: "bug", expected_completion: "failed", expected_merge: "not_attempted" }),
        ],
      }),
    );
    expect(result.valid).toBe(true);
  });

  it("accepts empty issues array", () => {
    const result = validateFixture(makeFixture({ issues: [] }));
    expect(result.valid).toBe(true);
  });

  it("accepts all valid CompletionOutcome values in issues", () => {
    const completions = [
      "completed",
      "failed",
      "paused_complex",
      "paused_ambiguous",
      "killed_budget",
      "killed_stuck",
      "skipped",
    ] as const;

    for (const expected_completion of completions) {
      const result = validateFixture(makeFixture({ issues: [makeIssue({ expected_completion })] }));
      expect(result.valid).toBe(true);
    }
  });

  it("accepts all valid MergeOutcome values in issues", () => {
    const merges = [
      "merged_clean",
      "merged_after_rework",
      "conflict_resolved_janus",
      "conflict_unresolved",
      "not_attempted",
    ] as const;

    for (const expected_merge of merges) {
      const result = validateFixture(makeFixture({ issues: [makeIssue({ expected_merge })] }));
      expect(result.valid).toBe(true);
    }
  });

  it("accepts human_interventions with issue ids", () => {
    const result = validateFixture(
      makeFixture({
        human_interventions: ["issue-1", "issue-2"],
      }),
    );
    expect(result.valid).toBe(true);
  });

  it("accepts config_overrides with arbitrary keys", () => {
    const result = validateFixture(
      makeFixture({
        config_overrides: { runtime: "pi", "economics.max_budget_usd": 5 },
      }),
    );
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateFixture — rejects missing required fields
// ---------------------------------------------------------------------------

describe("S03 fixture schema — validateFixture rejects missing required fields", () => {
  it("rejects non-object input", () => {
    const result = validateFixture("not an object");
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("rejects null input", () => {
    const result = validateFixture(null);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("rejects missing fixture_type", () => {
    const data = makeFixtureData();
    delete data["fixture_type"];

    const result = validateFixture(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("fixture_type"))).toBe(true);
  });

  it("rejects missing reset_rules", () => {
    const data = makeFixtureData();
    delete data["reset_rules"];

    const result = validateFixture(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("reset_rules"))).toBe(true);
  });

  it("rejects missing scenario_tags", () => {
    const data = makeFixtureData();
    delete data["scenario_tags"];

    const result = validateFixture(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("scenario_tags"))).toBe(true);
  });

  it("rejects missing issues array", () => {
    const data = makeFixtureData();
    delete data["issues"];

    const result = validateFixture(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("issues"))).toBe(true);
  });

  it("rejects missing human_interventions", () => {
    const data = makeFixtureData();
    delete data["human_interventions"];

    const result = validateFixture(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("human_interventions"))).toBe(true);
  });

  it("rejects missing config_overrides", () => {
    const data = makeFixtureData();
    delete data["config_overrides"];

    const result = validateFixture(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("config_overrides"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateFixture — rejects invalid fixture_type
// ---------------------------------------------------------------------------

describe("S03 fixture schema — validateFixture rejects invalid fixture_type", () => {
  it("rejects an unknown fixture_type string", () => {
    const data = makeFixtureData({ fixture_type: "unknown_type" });

    const result = validateFixture(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("fixture_type"))).toBe(true);
  });

  it("rejects a numeric fixture_type", () => {
    const data = makeFixtureData({ fixture_type: 42 });

    const result = validateFixture(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("fixture_type"))).toBe(true);
  });

  it("rejects an empty string as fixture_type", () => {
    const data = makeFixtureData({ fixture_type: "" });

    const result = validateFixture(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("fixture_type"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateFixture — rejects invalid reset_rules
// ---------------------------------------------------------------------------

describe("S03 fixture schema — validateFixture rejects invalid reset_rules", () => {
  it("rejects an unknown reset_rules string", () => {
    const data = makeFixtureData({ reset_rules: "wipe_and_reinstall" });

    const result = validateFixture(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("reset_rules"))).toBe(true);
  });

  it("rejects a numeric reset_rules", () => {
    const data = makeFixtureData({ reset_rules: 0 });

    const result = validateFixture(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("reset_rules"))).toBe(true);
  });

  it("rejects an empty string as reset_rules", () => {
    const data = makeFixtureData({ reset_rules: "" });

    const result = validateFixture(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("reset_rules"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateFixture — rejects invalid issue fields
// ---------------------------------------------------------------------------

describe("S03 fixture schema — validateFixture rejects invalid issue fields", () => {
  it("rejects issues that is not an array", () => {
    const data = makeFixtureData({ issues: { id: "test" } });

    const result = validateFixture(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("issues"))).toBe(true);
  });

  it("rejects issue missing id field", () => {
    const issueData: Record<string, unknown> = { type: "task", expected_completion: "completed", expected_merge: "merged_clean" };
    const data = makeFixtureData({ issues: [issueData] });

    const result = validateFixture(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("id"))).toBe(true);
  });

  it("rejects issue with empty id string", () => {
    const data = makeFixtureData({
      issues: [{ id: "", type: "task", expected_completion: "completed", expected_merge: "merged_clean" }],
    });

    const result = validateFixture(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("id"))).toBe(true);
  });

  it("rejects issue missing type field", () => {
    const issueData: Record<string, unknown> = { id: "test-001", expected_completion: "completed", expected_merge: "merged_clean" };
    const data = makeFixtureData({ issues: [issueData] });

    const result = validateFixture(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("type"))).toBe(true);
  });

  it("rejects issue with invalid expected_completion value", () => {
    const data = makeFixtureData({
      issues: [{ id: "test-001", type: "task", expected_completion: "totally_invalid", expected_merge: "merged_clean" }],
    });

    const result = validateFixture(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("expected_completion"))).toBe(true);
  });

  it("rejects issue with invalid expected_merge value", () => {
    const data = makeFixtureData({
      issues: [{ id: "test-001", type: "task", expected_completion: "completed", expected_merge: "bad_merge" }],
    });

    const result = validateFixture(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("expected_merge"))).toBe(true);
  });

  it("rejects scenario_tags that is not an array", () => {
    const data = makeFixtureData({ scenario_tags: "not-an-array" });

    const result = validateFixture(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("scenario_tags"))).toBe(true);
  });

  it("rejects scenario_tags array containing non-string values", () => {
    const data = makeFixtureData({ scenario_tags: ["valid-tag", 42] });

    const result = validateFixture(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("scenario_tags"))).toBe(true);
  });

  it("rejects scenario_tags array containing empty strings", () => {
    const data = makeFixtureData({ scenario_tags: ["valid-tag", ""] });

    const result = validateFixture(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("scenario_tags[1]"))).toBe(true);
  });

  it("rejects human_interventions array containing empty strings", () => {
    const data = makeFixtureData({ human_interventions: [""] });

    const result = validateFixture(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("human_interventions[0]"))).toBe(true);
  });

  it("rejects human_interventions that is not an array", () => {
    const data = makeFixtureData({ human_interventions: "issue-1" });

    const result = validateFixture(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("human_interventions"))).toBe(true);
  });

  it("rejects config_overrides that is not an object", () => {
    const data = makeFixtureData({ config_overrides: "not-an-object" });

    const result = validateFixture(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("config_overrides"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Type compatibility — Fixture interface extends legacy inline types
// ---------------------------------------------------------------------------

describe("S03 fixture schema — Fixture type compatibility with S02 run-scenario inline types", () => {
  it("a valid Fixture object satisfies all fields expected by the S02 runner", () => {
    // The S02 runner previously relied on inline FixtureIssue and Fixture types.
    // This test verifies the formalized Fixture is a superset of those fields.
    const fixture: Fixture = makeFixture();

    // Fields required by the S02 runner
    expect(Array.isArray(fixture.issues)).toBe(true);
    expect(Array.isArray(fixture.human_interventions)).toBe(true);
    expect(typeof fixture.config_overrides).toBe("object");

    // New S03 fields
    expect(typeof fixture.fixture_type).toBe("string");
    expect(typeof fixture.reset_rules).toBe("string");
    expect(Array.isArray(fixture.scenario_tags)).toBe(true);
  });
});
