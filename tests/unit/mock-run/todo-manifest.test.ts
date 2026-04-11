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

  it("defines the deterministic issue graph", () => {
    expect(TODO_MOCK_RUN_ISSUES.map((issue) => issue.key)).toEqual([
      "todo-system",
      "foundation",
      "foundation.contract",
      "foundation.lane_a",
      "foundation.lane_b",
      "foundation.gate",
      "commands",
      "commands.contract",
      "commands.lane_a",
      "commands.lane_b",
      "commands.gate",
      "integration",
      "integration.contract",
      "integration.lane_a",
      "integration.lane_b",
      "integration.gate",
    ]);

    expect(TODO_MOCK_RUN_MANIFEST.repoName).toBe("aegis-mock-run");
  });
});
