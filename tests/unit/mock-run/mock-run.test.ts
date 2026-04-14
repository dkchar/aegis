import { describe, expect, it, vi } from "vitest";

import { runMockCommand } from "../../../src/mock-run/mock-run.js";

describe("runMockCommand", () => {
  it("uses process.execPath when the mock command starts with node", async () => {
    const execFileSync = vi.fn();

    await runMockCommand(["node", "../dist/index.js", "status"], {
      mockDir: "C:/repo/aegis-mock-run",
      execFileSync,
    });

    expect(execFileSync).toHaveBeenCalledWith(
      process.execPath,
      ["../dist/index.js", "status"],
      expect.objectContaining({
        cwd: "C:/repo/aegis-mock-run",
        stdio: "inherit",
      }),
    );
  });

  it("backgrounds aegis start and waits for runtime-state confirmation", async () => {
    const execFileSync = vi.fn();
    const unref = vi.fn();
    const spawn = vi.fn(() => ({
      pid: 4242,
      unref,
    }));
    const waitForDaemonStart = vi.fn(async () => ({
      schema_version: 1 as const,
      pid: 4242,
      server_state: "running" as const,
      mode: "auto" as const,
      started_at: "2026-04-14T00:00:00.000Z",
    }));
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runMockCommand(["node", "../dist/index.js", "start"], {
      mockDir: "C:/repo/aegis-mock-run",
      execFileSync,
      spawn: spawn as never,
      waitForDaemonStart,
      startTimeoutMs: 5_000,
    });

    expect(execFileSync).not.toHaveBeenCalled();
    expect(spawn).toHaveBeenCalledWith(
      process.execPath,
      ["../dist/index.js", "start"],
      expect.objectContaining({
        cwd: "C:/repo/aegis-mock-run",
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      }),
    );
    expect(unref).toHaveBeenCalledTimes(1);
    expect(waitForDaemonStart).toHaveBeenCalledWith("C:/repo/aegis-mock-run", 4242, 5_000);
    expect(consoleLog).toHaveBeenCalledWith("Aegis started in auto mode (pid 4242)");

    consoleLog.mockRestore();
  });
});
