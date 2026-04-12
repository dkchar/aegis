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

describe("lane B MVP scenario runners", () => {
  it(
    "replays a stale-branch merge through rework and then merges cleanly",
    async () => {
      const result = await runScenario({
        scenario: getScenario("stale-branch-rework"),
        projectRoot: repoRoot,
      });

      expect(result.completion_outcomes).toEqual({
        "stale-001": "completed",
      });
      expect(result.merge_outcomes).toEqual({
        "stale-001": "merged_after_rework",
      });
    },
    15_000,
  );

  it("preserves labor on a hard merge conflict and leaves the issue failed", async () => {
    const result = await runScenario({
      scenario: getScenario("hard-merge-conflict"),
      projectRoot: repoRoot,
    });

    expect(result.completion_outcomes).toEqual({
      "conflict-001": "failed",
    });
    expect(result.merge_outcomes).toEqual({
      "conflict-001": "conflict_unresolved",
    });
    expect(result.human_intervention_issue_ids).toEqual(["conflict-001"]);
  });

  it(
    "routes Janus escalation back through the queue and then completes",
    async () => {
      const result = await runScenario({
        scenario: getScenario("janus-escalation"),
        projectRoot: repoRoot,
      });

      expect(result.completion_outcomes).toEqual({
        "janus-esc-001": "completed",
      });
      expect(result.merge_outcomes).toEqual({
        "janus-esc-001": "conflict_resolved_janus",
      });
    },
    15_000,
  );

  it("stops on Janus manual decision without auto-resolving the ambiguity", async () => {
    const result = await runScenario({
      scenario: getScenario("janus-human-decision"),
      projectRoot: repoRoot,
    });

    expect(result.completion_outcomes).toEqual({
      "janus-hd-001": "failed",
    });
    expect(result.merge_outcomes).toEqual({
      "janus-hd-001": "conflict_unresolved",
    });
    expect(result.human_intervention_issue_ids).toEqual(["janus-hd-001"]);
  });

  it("reconciles active merge work after restart and still merges cleanly", async () => {
    const result = await runScenario({
      scenario: getScenario("restart-during-merge"),
      projectRoot: repoRoot,
    });

    expect(result.completion_outcomes).toEqual({
      "restart-merge-001": "completed",
    });
    expect(result.merge_outcomes).toEqual({
      "restart-merge-001": "merged_clean",
    });
  });

  it("uses polling to rediscover work when hooks are disabled", async () => {
    const result = await runScenario({
      scenario: getScenario("polling-only"),
      projectRoot: repoRoot,
    });

    expect(result.completion_outcomes).toEqual({
      "poll-001": "completed",
    });
    expect(result.merge_outcomes).toEqual({
      "poll-001": "merged_clean",
    });
  });
});
