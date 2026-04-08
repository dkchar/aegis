import path from "node:path";
import fs from "node:fs";

import { describe, expect, it } from "vitest";

import { runScenario } from "../../../src/evals/run-scenario.js";
import {
  MVP_GATE_SCENARIO_IDS,
  MVP_GATE_SCENARIO_BINDINGS,
  LANE_A_MVP_SCENARIO_IDS,
  LANE_B_MVP_SCENARIO_IDS,
  getMvpScenarioBinding,
  loadMvpGateManifest,
} from "../../../src/evals/wire-mvp-scenarios.js";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const coreSuitePath = path.join(repoRoot, "evals", "scenarios", "core-suite.json");

interface ScenarioManifest {
  scenarios: Array<{
    id: string;
    fixture_path: string;
    expected_outcomes: {
      expects_human_intervention: boolean;
      expects_janus: boolean;
      expects_restart_recovery: boolean;
    };
  }>;
}

interface FixtureDefinition {
  issues: Array<{
    id: string;
    expected_completion: string;
    expected_merge: string;
  }>;
  human_interventions: string[];
}

function loadCoreSuiteManifest(): ScenarioManifest {
  return JSON.parse(fs.readFileSync(coreSuitePath, "utf8")) as ScenarioManifest;
}

function loadFixtureDefinition(relativeFixturePath: string): FixtureDefinition {
  const fixturePath = path.join(repoRoot, "evals", "fixtures", relativeFixturePath);
  return JSON.parse(fs.readFileSync(fixturePath, "utf8")) as FixtureDefinition;
}

async function expectScenarioToRunWithCompleteArtifacts(
  scenarioId: string,
): Promise<void> {
  const manifest = loadMvpGateManifest(repoRoot);
  const scenario = manifest.scenarios.find((entry) => entry.id === scenarioId);

  if (!scenario) {
    throw new Error(`Scenario ${scenarioId} not found in MVP gate manifest`);
  }

  const fixture = loadFixtureDefinition(scenario.fixture_path);
  const result = await runScenario({ scenario, projectRoot: repoRoot });

  expect(result.scenario_id).toBe(scenarioId);
  expect(result.issue_count).toBe(fixture.issues.length);
  expect(Object.keys(result.completion_outcomes).sort()).toEqual(
    fixture.issues.map((issue) => issue.id).sort(),
  );
  expect(Object.keys(result.merge_outcomes).sort()).toEqual(
    fixture.issues.map((issue) => issue.id).sort(),
  );
  expect(result.human_intervention_issue_ids.sort()).toEqual(
    [...fixture.human_interventions].sort(),
  );

  for (const issue of fixture.issues) {
    expect(result.completion_outcomes[issue.id]).toBe(issue.expected_completion);
    expect(result.merge_outcomes[issue.id]).toBe(issue.expected_merge);
  }
}

describe("S16A contract seed", () => {
  it("defines the exact MVP gate scenario set and a non-overlapping lane split", () => {
    expect(MVP_GATE_SCENARIO_IDS).toEqual([
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

    expect(LANE_A_MVP_SCENARIO_IDS).toEqual([
      "single-clean-issue",
      "complex-pause",
      "decomposition",
      "clarification",
      "restart-during-implementation",
    ]);

    expect(LANE_B_MVP_SCENARIO_IDS).toEqual([
      "stale-branch-rework",
      "hard-merge-conflict",
      "janus-escalation",
      "janus-human-decision",
      "restart-during-merge",
      "polling-only",
    ]);

    expect(new Set(MVP_GATE_SCENARIO_IDS)).toHaveLength(MVP_GATE_SCENARIO_IDS.length);
    expect(
      [...LANE_A_MVP_SCENARIO_IDS, ...LANE_B_MVP_SCENARIO_IDS].sort(),
    ).toEqual([...MVP_GATE_SCENARIO_IDS].sort());
    expect(
      LANE_A_MVP_SCENARIO_IDS.filter((scenarioId) =>
        (LANE_B_MVP_SCENARIO_IDS as readonly string[]).includes(scenarioId),
      ),
    ).toEqual([]);
  });

  it("loads mvp-gate.json with the canonical gate ordering", () => {
    const manifest = loadMvpGateManifest(repoRoot);

    expect(manifest.scenarios.map((scenario) => scenario.id)).toEqual(
      MVP_GATE_SCENARIO_IDS,
    );
  });

  it("keeps mvp-gate.json in sync with core-suite.json for the MVP scenario definitions", () => {
    const mvpGate = loadMvpGateManifest(repoRoot);
    const coreSuite = loadCoreSuiteManifest();

    expect(mvpGate.scenarios).toEqual(coreSuite.scenarios);
  });

  it("binds every MVP gate scenario to a fixture type and the required live-pipeline capabilities", () => {
    const manifest = loadMvpGateManifest(repoRoot);

    expect(MVP_GATE_SCENARIO_BINDINGS).toHaveLength(MVP_GATE_SCENARIO_IDS.length);

    for (const scenario of manifest.scenarios) {
      const binding = getMvpScenarioBinding(scenario.id);

      expect(binding.scenarioId).toBe(scenario.id);
      expect(binding.capabilities.length).toBeGreaterThan(0);
      expect(scenario.fixture_path).toBe(`${scenario.id}/fixture.json`);

      if (scenario.expected_outcomes.expects_janus) {
        expect(binding.capabilities).toContain("janus");
      }

      if (scenario.expected_outcomes.expects_restart_recovery) {
        expect(binding.capabilities).toContain("restart_recovery");
      }

      if (scenario.id === "polling-only") {
        expect(binding.capabilities).toContain("polling");
      }
    }

    expect(getMvpScenarioBinding("single-clean-issue")).toEqual({
      scenarioId: "single-clean-issue",
      lane: "lane_a",
      fixtureType: "clean",
      capabilities: ["oracle", "titan", "merge_queue", "sentinel"],
    });

    expect(getMvpScenarioBinding("janus-escalation")).toEqual({
      scenarioId: "janus-escalation",
      lane: "lane_b",
      fixtureType: "janus",
      capabilities: ["oracle", "titan", "merge_queue", "janus", "sentinel"],
    });

    expect(getMvpScenarioBinding("restart-during-merge")).toEqual({
      scenarioId: "restart-during-merge",
      lane: "lane_b",
      fixtureType: "restart",
      capabilities: ["oracle", "titan", "merge_queue", "restart_recovery", "sentinel"],
    });
  });
});

describe("S16A lane execution scaffolding", () => {
  it(
    "lane A scenarios run through the landed Oracle, Titan, merge, and restart paths",
    async () => {
      for (const scenarioId of LANE_A_MVP_SCENARIO_IDS) {
        await expectScenarioToRunWithCompleteArtifacts(scenarioId);
      }
    },
    30_000,
  );

  it(
    "lane B scenarios run through the landed merge, Janus, restart, and polling paths",
    async () => {
      for (const scenarioId of LANE_B_MVP_SCENARIO_IDS) {
        await expectScenarioToRunWithCompleteArtifacts(scenarioId);
      }
    },
    30_000,
  );
});
