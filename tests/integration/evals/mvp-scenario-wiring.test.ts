import path from "node:path";
import fs from "node:fs";

import { describe, expect, it } from "vitest";

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

function loadCoreSuiteManifest(): ScenarioManifest {
  return JSON.parse(fs.readFileSync(coreSuitePath, "utf8")) as ScenarioManifest;
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
        LANE_B_MVP_SCENARIO_IDS.includes(scenarioId),
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
  for (const scenarioId of LANE_A_MVP_SCENARIO_IDS) {
    it.todo(`lane A runs ${scenarioId} through the landed Oracle/Titan/merge pipeline`);
  }

  for (const scenarioId of LANE_B_MVP_SCENARIO_IDS) {
    it.todo(`lane B runs ${scenarioId} through the landed merge, Janus, restart, and polling paths`);
  }
});
