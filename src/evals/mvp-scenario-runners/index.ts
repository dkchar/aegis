import type { MvpScenarioId } from "../wire-mvp-scenarios.js";
import { isMvpScenarioId } from "../wire-mvp-scenarios.js";
import { laneAScenarioRunners } from "./lane-a.js";
import { laneBScenarioRunners } from "./lane-b.js";
import type { ScenarioExecutionContext } from "./shared.js";

const scenarioRunners: Partial<Record<MvpScenarioId, typeof laneAScenarioRunners[MvpScenarioId]>> = {
  ...laneAScenarioRunners,
  ...laneBScenarioRunners,
};

export async function tryRunMvpScenario(
  context: ScenarioExecutionContext,
) {
  if (!isMvpScenarioId(context.scenario.id)) {
    return null;
  }

  const runner = scenarioRunners[context.scenario.id];
  if (!runner) {
    throw new Error(`Missing live MVP scenario runner for ${context.scenario.id}`);
  }

  return runner(context);
}
