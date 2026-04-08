import path from "node:path";

import { describe, expect, it } from "vitest";

import { runScenario } from "../../../src/evals/run-scenario.js";
import { loadMvpGateManifest } from "../../../src/evals/wire-mvp-scenarios.js";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const manifest = loadMvpGateManifest(repoRoot);

function getScenario(id: string) {
  const scenario = manifest.scenarios.find((candidate) => candidate.id === id);
  if (!scenario) {
    throw new Error(`Scenario not found: ${id}`);
  }

  return scenario;
}

describe("lane A MVP scenario runners", () => {
  it("runs the clean issue through Oracle, Titan, admission, merge, and Sentinel", async () => {
    const result = await runScenario({
      scenario: getScenario("single-clean-issue"),
      projectRoot: repoRoot,
    });

    expect(result.completion_outcomes).toEqual({
      "test-001": "completed",
    });
    expect(result.merge_outcomes).toEqual({
      "test-001": "merged_clean",
    });
    expect(result.human_intervention_issue_ids).toEqual([]);
  });

  it("keeps complex issues paused before Titan dispatch", async () => {
    const result = await runScenario({
      scenario: getScenario("complex-pause"),
      projectRoot: repoRoot,
    });

    expect(result.completion_outcomes).toEqual({
      "complex-001": "paused_complex",
    });
    expect(result.merge_outcomes).toEqual({
      "complex-001": "not_attempted",
    });
    expect(result.human_intervention_issue_ids).toEqual(["complex-001"]);
  });

  it("creates decomposition children and carries them plus the parent to completion", async () => {
    const result = await runScenario({
      scenario: getScenario("decomposition"),
      projectRoot: repoRoot,
    });

    expect(result.completion_outcomes).toEqual({
      "decomp-parent-001": "completed",
      "decomp-child-001": "completed",
      "decomp-child-002": "completed",
    });
    expect(result.merge_outcomes).toEqual({
      "decomp-parent-001": "merged_clean",
      "decomp-child-001": "merged_clean",
      "decomp-child-002": "merged_clean",
    });
  });

  it("forces Titan ambiguity into the clarification path", async () => {
    const result = await runScenario({
      scenario: getScenario("clarification"),
      projectRoot: repoRoot,
    });

    expect(result.completion_outcomes).toEqual({
      "ambiguous-001": "paused_ambiguous",
    });
    expect(result.merge_outcomes).toEqual({
      "ambiguous-001": "not_attempted",
    });
    expect(result.human_intervention_issue_ids).toEqual(["ambiguous-001"]);
  });

  it("reconciles a restart during implementation and still completes cleanly", async () => {
    const result = await runScenario({
      scenario: getScenario("restart-during-implementation"),
      projectRoot: repoRoot,
    });

    expect(result.completion_outcomes).toEqual({
      "restart-impl-001": "completed",
    });
    expect(result.merge_outcomes).toEqual({
      "restart-impl-001": "merged_clean",
    });
    expect(result.human_intervention_issue_ids).toEqual([]);
  });
});
