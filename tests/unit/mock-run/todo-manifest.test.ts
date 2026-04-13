import { describe, expect, it } from "vitest";

import {
  TODO_BASELINE_FILES,
  TODO_MOCK_RUN_ISSUES,
  TODO_MOCK_RUN_MANIFEST,
  TODO_READY_QUEUE_EXPECTATION,
} from "../../../src/mock-run/todo-manifest.js";

describe("todo mock-run manifest", () => {
  it("defines a scratchpad baseline with no seeded src or tests tree", () => {
    expect(Object.keys(TODO_BASELINE_FILES)).toEqual([
      ".gitignore",
      ".pi/settings.json",
    ]);
    expect(Object.keys(TODO_BASELINE_FILES).some((key) => key.startsWith("src/"))).toBe(false);
    expect(Object.keys(TODO_BASELINE_FILES).some((key) => key.startsWith("tests/"))).toBe(false);
    expect(TODO_READY_QUEUE_EXPECTATION).toEqual(["foundation.contract"]);
  });

  it("defines the deterministic issue graph with 5 slices × 3 lanes", () => {
    expect(TODO_MOCK_RUN_ISSUES.map((issue) => issue.key)).toEqual([
      // Program epic
      "todo-system",
      // Slice 1: foundation (contract + 3 lanes + gate)
      "foundation",
      "foundation.contract",
      "foundation.lane_a",
      "foundation.lane_b",
      "foundation.lane_c",
      "foundation.gate",
      // Slice 2: commands (contract + 3 lanes + gate)
      "commands",
      "commands.contract",
      "commands.lane_a",
      "commands.lane_b",
      "commands.lane_c",
      "commands.gate",
      // Slice 3: cli (contract + 3 lanes + gate)
      "cli",
      "cli.contract",
      "cli.lane_a",
      "cli.lane_b",
      "cli.lane_c",
      "cli.gate",
      // Slice 4: integration (contract + 3 lanes + gate)
      "integration",
      "integration.contract",
      "integration.lane_a",
      "integration.lane_b",
      "integration.lane_c",
      "integration.gate",
      // Slice 5: stress (contract + 3 lanes + gate)
      "stress",
      "stress.contract",
      "stress.lane_a",
      "stress.lane_b",
      "stress.lane_c",
      "stress.gate",
    ]);

    expect(TODO_MOCK_RUN_MANIFEST.repoName).toBe("aegis-mock-run");
  });

  it("has exactly 5 slice epics with 3 lanes each", () => {
    const sliceEpics = TODO_MOCK_RUN_ISSUES.filter(
      (i) => i.issueType === "epic" && i.key !== "todo-system",
    );
    expect(sliceEpics).toHaveLength(5);

    for (const slice of sliceEpics) {
      const lanes = TODO_MOCK_RUN_ISSUES.filter(
        (i) => i.parentKey === slice.key && i.key.includes(".lane_"),
      );
      expect(lanes).toHaveLength(3);
    }
  });

  it("has overlapping file ownership documented in lane descriptions", () => {
    const overlappingLanes = TODO_MOCK_RUN_ISSUES.filter(
      (i) => i.description.includes("Shared file") || i.description.includes("Shared files"),
    );
    // All 15 lanes (5 slices × 3 lanes) should mention shared files
    expect(overlappingLanes.length).toBeGreaterThanOrEqual(12);
  });

  it("includes decomposable and conflict stress-testing scenarios", () => {
    const stressLaneC = TODO_MOCK_RUN_ISSUES.find((i) => i.key === "stress.lane_c");
    expect(stressLaneC).toBeDefined();
    expect(stressLaneC?.description).toContain("decomposable");

    const stressLaneB = TODO_MOCK_RUN_ISSUES.find((i) => i.key === "stress.lane_b");
    expect(stressLaneB).toBeDefined();
    expect(stressLaneB?.description).toContain("conflict");
  });

  it("maintains correct dependency chain across slices", () => {
    // Each slice's contract depends on the previous slice's gate
    const commandsContract = TODO_MOCK_RUN_ISSUES.find((i) => i.key === "commands.contract");
    expect(commandsContract?.blocks).toContain("foundation.gate");

    const cliContract = TODO_MOCK_RUN_ISSUES.find((i) => i.key === "cli.contract");
    expect(cliContract?.blocks).toContain("commands.gate");

    const integrationContract = TODO_MOCK_RUN_ISSUES.find((i) => i.key === "integration.contract");
    expect(integrationContract?.blocks).toContain("cli.gate");

    const stressContract = TODO_MOCK_RUN_ISSUES.find((i) => i.key === "stress.contract");
    expect(stressContract?.blocks).toContain("integration.gate");
  });

  it("only foundation.contract is ready at seed time", () => {
    // Every issue except foundation.contract has at least one block
    const blockedIssues = TODO_MOCK_RUN_ISSUES.filter(
      (i) => i.queueRole === "executable" && i.blocks.length > 0,
    );
    const readyIssues = TODO_MOCK_RUN_ISSUES.filter(
      (i) => i.queueRole === "executable" && i.blocks.length === 0,
    );

    expect(readyIssues).toHaveLength(1);
    expect(readyIssues[0]?.key).toBe("foundation.contract");
    expect(blockedIssues.length).toBeGreaterThan(0);
  });
});
