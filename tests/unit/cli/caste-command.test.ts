import { describe, expect, it, vi } from "vitest";

import { runDirectCasteCommand } from "../../../src/cli/caste-command.js";
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

describe("runDirectCasteCommand", () => {
  it("runs locally when the daemon is not active", async () => {
    const runLocal = vi.fn(async () => ({ action: "scout", issueId: "aegis-123", source: "local" }));
    const routeToDaemon = vi.fn();

    const result = await runDirectCasteCommand("C:/repo", "scout", "aegis-123", {
      readRuntimeState: () => null,
      isProcessRunning: () => false,
      runLocal,
      routeToDaemon,
    });

    expect(result).toEqual({ action: "scout", issueId: "aegis-123", source: "local" });
    expect(runLocal).toHaveBeenCalledWith("C:/repo", "scout", "aegis-123");
    expect(routeToDaemon).not.toHaveBeenCalled();
  });

  it("routes through the daemon when runtime ownership is active", async () => {
    const runLocal = vi.fn();
    const routeToDaemon = vi.fn(async () => ({
      action: "implement",
      issueId: "aegis-123",
      source: "daemon",
    }));

    const result = await runDirectCasteCommand("C:/repo", "implement", "aegis-123", {
      readRuntimeState: () => createRuntimeState(),
      isProcessRunning: () => true,
      runLocal,
      routeToDaemon,
    });

    expect(result).toEqual({
      action: "implement",
      issueId: "aegis-123",
      source: "daemon",
    });
    expect(runLocal).not.toHaveBeenCalled();
    expect(routeToDaemon).toHaveBeenCalledWith("C:/repo", "implement", "aegis-123", 4242);
  });
});
