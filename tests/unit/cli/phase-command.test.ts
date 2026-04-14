import { describe, expect, it, vi } from "vitest";

import { runDirectPhaseCommand } from "../../../src/cli/phase-command.js";
import type { RuntimeStateRecord } from "../../../src/cli/runtime-state.js";

function createRuntimeState(): RuntimeStateRecord {
  return {
    schema_version: 1,
    pid: 4242,
    server_state: "running",
    mode: "auto",
    started_at: "2026-04-14T12:00:00.000Z",
  };
}

describe("runDirectPhaseCommand", () => {
  it("runs locally when the daemon is not active", async () => {
    const runLocal = vi.fn(async () => ({ phase: "poll", source: "local" }));
    const routeToDaemon = vi.fn();

    const result = await runDirectPhaseCommand("C:/repo", "poll", {
      readRuntimeState: () => null,
      isProcessRunning: () => false,
      runLocal,
      routeToDaemon,
    });

    expect(result).toEqual({ phase: "poll", source: "local" });
    expect(runLocal).toHaveBeenCalledWith("C:/repo", "poll");
    expect(routeToDaemon).not.toHaveBeenCalled();
  });

  it("routes through the daemon when runtime ownership is active", async () => {
    const runLocal = vi.fn();
    const routeToDaemon = vi.fn(async () => ({ phase: "dispatch", source: "daemon" }));

    const result = await runDirectPhaseCommand("C:/repo", "dispatch", {
      readRuntimeState: () => createRuntimeState(),
      isProcessRunning: () => true,
      runLocal,
      routeToDaemon,
    });

    expect(result).toEqual({ phase: "dispatch", source: "daemon" });
    expect(runLocal).not.toHaveBeenCalled();
    expect(routeToDaemon).toHaveBeenCalledWith("C:/repo", "dispatch", 4242);
  });
});
