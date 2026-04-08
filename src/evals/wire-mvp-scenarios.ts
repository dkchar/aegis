import { readFileSync } from "node:fs";
import path from "node:path";

import type { FixtureType } from "./fixture-schema.js";
import type { EvalScenario } from "./result-schema.js";

export const MVP_GATE_MANIFEST_RELATIVE_PATH = path.join(
  "evals",
  "scenarios",
  "mvp-gate.json",
);

export const MVP_GATE_SCENARIO_IDS = [
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
] as const;

export type MvpScenarioId = (typeof MVP_GATE_SCENARIO_IDS)[number];

export const LANE_A_MVP_SCENARIO_IDS = [
  "single-clean-issue",
  "complex-pause",
  "decomposition",
  "clarification",
  "restart-during-implementation",
] as const satisfies readonly MvpScenarioId[];

export const LANE_B_MVP_SCENARIO_IDS = [
  "stale-branch-rework",
  "hard-merge-conflict",
  "janus-escalation",
  "janus-human-decision",
  "restart-during-merge",
  "polling-only",
] as const satisfies readonly MvpScenarioId[];

export type MvpScenarioLane = "lane_a" | "lane_b";

export type MvpScenarioCapability =
  | "oracle"
  | "titan"
  | "merge_queue"
  | "sentinel"
  | "janus"
  | "restart_recovery"
  | "polling";

export interface MvpScenarioBinding {
  scenarioId: MvpScenarioId;
  lane: MvpScenarioLane;
  fixtureType: FixtureType;
  capabilities: readonly MvpScenarioCapability[];
}

export interface MvpGateManifest {
  scenarios: EvalScenario[];
}

const MVP_SCENARIO_BINDINGS_BY_ID: Record<MvpScenarioId, MvpScenarioBinding> = {
  "single-clean-issue": {
    scenarioId: "single-clean-issue",
    lane: "lane_a",
    fixtureType: "clean",
    capabilities: ["oracle", "titan", "merge_queue", "sentinel"],
  },
  "complex-pause": {
    scenarioId: "complex-pause",
    lane: "lane_a",
    fixtureType: "complex_pause",
    capabilities: ["oracle"],
  },
  decomposition: {
    scenarioId: "decomposition",
    lane: "lane_a",
    fixtureType: "decomposition",
    capabilities: ["oracle", "titan", "merge_queue", "sentinel"],
  },
  clarification: {
    scenarioId: "clarification",
    lane: "lane_a",
    fixtureType: "clarification",
    capabilities: ["oracle", "titan"],
  },
  "stale-branch-rework": {
    scenarioId: "stale-branch-rework",
    lane: "lane_b",
    fixtureType: "rework",
    capabilities: ["oracle", "titan", "merge_queue", "sentinel"],
  },
  "hard-merge-conflict": {
    scenarioId: "hard-merge-conflict",
    lane: "lane_b",
    fixtureType: "merge_conflict",
    capabilities: ["oracle", "titan", "merge_queue"],
  },
  "janus-escalation": {
    scenarioId: "janus-escalation",
    lane: "lane_b",
    fixtureType: "janus",
    capabilities: ["oracle", "titan", "merge_queue", "janus", "sentinel"],
  },
  "janus-human-decision": {
    scenarioId: "janus-human-decision",
    lane: "lane_b",
    fixtureType: "janus",
    capabilities: ["oracle", "titan", "merge_queue", "janus"],
  },
  "restart-during-implementation": {
    scenarioId: "restart-during-implementation",
    lane: "lane_a",
    fixtureType: "restart",
    capabilities: ["oracle", "titan", "restart_recovery", "merge_queue", "sentinel"],
  },
  "restart-during-merge": {
    scenarioId: "restart-during-merge",
    lane: "lane_b",
    fixtureType: "restart",
    capabilities: ["oracle", "titan", "merge_queue", "restart_recovery", "sentinel"],
  },
  "polling-only": {
    scenarioId: "polling-only",
    lane: "lane_b",
    fixtureType: "polling_only",
    capabilities: ["oracle", "titan", "merge_queue", "sentinel", "polling"],
  },
};

export const MVP_GATE_SCENARIO_BINDINGS = MVP_GATE_SCENARIO_IDS.map(
  (scenarioId) => MVP_SCENARIO_BINDINGS_BY_ID[scenarioId],
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isMvpScenarioId(value: string): value is MvpScenarioId {
  return (MVP_GATE_SCENARIO_IDS as readonly string[]).includes(value);
}

export function getMvpScenarioBinding(scenarioId: string): MvpScenarioBinding {
  if (!isMvpScenarioId(scenarioId)) {
    throw new Error(`Unknown MVP gate scenario id: ${scenarioId}`);
  }

  return MVP_SCENARIO_BINDINGS_BY_ID[scenarioId];
}

export function loadMvpGateManifest(repoRoot: string): MvpGateManifest {
  const manifestPath = path.resolve(repoRoot, MVP_GATE_MANIFEST_RELATIVE_PATH);
  const raw = readFileSync(manifestPath, "utf8");
  const parsed: unknown = JSON.parse(raw);

  if (!isRecord(parsed) || !Array.isArray(parsed["scenarios"])) {
    throw new Error(`Invalid MVP gate manifest at ${manifestPath}`);
  }

  const scenarioIds = parsed["scenarios"].map((scenario) => {
    if (!isRecord(scenario) || typeof scenario["id"] !== "string") {
      throw new Error(`Invalid scenario entry in ${manifestPath}`);
    }

    return scenario["id"];
  });

  if (scenarioIds.length !== MVP_GATE_SCENARIO_IDS.length) {
    throw new Error(
      `MVP gate manifest must contain ${MVP_GATE_SCENARIO_IDS.length} scenarios`,
    );
  }

  for (const [index, scenarioId] of MVP_GATE_SCENARIO_IDS.entries()) {
    if (scenarioIds[index] !== scenarioId) {
      throw new Error(
        `MVP gate manifest scenario ${index} must be ${scenarioId}, got ${scenarioIds[index]}`,
      );
    }
  }

  return parsed as MvpGateManifest;
}
