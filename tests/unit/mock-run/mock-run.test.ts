import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { resolveDefaultMockRepoRoot } from "../../../src/mock-run/mock-paths.js";
import {
  buildMockDaemonSpawnOptions,
  buildWindowsBackgroundLaunchScript,
  runMockCommand,
} from "../../../src/mock-run/mock-run.js";

describe("runMockCommand", () => {
  it("uses process.execPath when the mock command starts with node", async () => {
    const execFileSync = vi.fn();

    await runMockCommand(["node", "../dist/index.js", "status"], {
      mockDir: "repo/aegis-mock-run",
      execFileSync,
    });

    expect(execFileSync).toHaveBeenCalledTimes(1);
    const call = execFileSync.mock.calls[0] as unknown[];
    const command = call[0] as string;
    const args = call[1] as string[];
    const options = call[2] as Record<string, unknown>;
    expect(command).toBe(process.execPath);
    expect(args[0]).toMatch(/dist[\\/]index\.js$/);
    expect(path.isAbsolute(args[0])).toBe(true);
    expect(args[1]).toBe("status");
    expect(options).toEqual(expect.objectContaining({
      cwd: "repo/aegis-mock-run",
      stdio: "inherit",
    }));
  });

  it("backgrounds aegis start and waits for runtime-state confirmation", async () => {
    const execFileSyncMock = vi.fn(() => "4242");
    const execFileSync = execFileSyncMock as unknown as typeof import("node:child_process").execFileSync;
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
      mockDir: "repo/aegis-mock-run",
      execFileSync,
      spawn: spawn as never,
      waitForDaemonStart,
      startTimeoutMs: 5_000,
    });

    if (process.platform === "win32") {
      expect(spawn).not.toHaveBeenCalled();
      expect(execFileSyncMock).toHaveBeenCalledTimes(1);
      const call = execFileSyncMock.mock.calls[0] as unknown[];
      const launchCommand = call[0] as string;
      const launchArgs = call[1] as string[];
      const launchOptions = call[2] as Record<string, unknown>;
      expect(launchCommand).toBe("powershell");
      expect(launchArgs).toEqual(expect.arrayContaining([
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
      ]));
      expect(String(launchArgs[launchArgs.length - 1])).toContain("Start-Process");
      expect(launchOptions).toEqual(expect.objectContaining({
        cwd: "repo/aegis-mock-run",
        windowsHide: true,
      }));
    } else {
      expect(execFileSyncMock).not.toHaveBeenCalled();
      expect(spawn).toHaveBeenCalledTimes(1);
      const call = spawn.mock.calls[0] as unknown[];
      const spawnCommand = call[0] as string;
      const spawnArgs = call[1] as string[];
      const spawnOptions = call[2] as Record<string, unknown>;
      expect(spawnCommand).toBe(process.execPath);
      expect(spawnArgs[0]).toMatch(/dist[\\/]index\.js$/);
      expect(path.isAbsolute(spawnArgs[0])).toBe(true);
      expect(spawnArgs[1]).toBe("start");
      expect(spawnOptions).toEqual(expect.objectContaining({
        cwd: "repo/aegis-mock-run",
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      }));
      expect(unref).toHaveBeenCalledTimes(1);
    }
    expect(waitForDaemonStart).toHaveBeenCalledWith("repo/aegis-mock-run", 4242, 5_000);
    expect(consoleLog).toHaveBeenCalledWith("Aegis started in auto mode (pid 4242)");

    consoleLog.mockRestore();
  });

  it("defaults mock-run cwd to ../aegis-qa/aegis-mock-run from current cwd", async () => {
    const execFileSync = vi.fn();

    await runMockCommand(["node", "../dist/index.js", "status"], {
      execFileSync,
    });

    expect(execFileSync).toHaveBeenCalledTimes(1);
    const call = execFileSync.mock.calls[0] as unknown[];
    const command = call[0] as string;
    const args = call[1] as string[];
    const options = call[2] as Record<string, unknown>;
    expect(command).toBe(process.execPath);
    expect(args[0]).toMatch(/dist[\\/]index\.js$/);
    expect(path.isAbsolute(args[0])).toBe(true);
    expect(args[1]).toBe("status");
    expect(options).toEqual(expect.objectContaining({
      cwd: resolveDefaultMockRepoRoot(),
      stdio: "inherit",
    }));
  });

  it("does not detach background mock daemon on Windows", () => {
    const options = buildMockDaemonSpawnOptions("repo/aegis-mock-run");
    const isWindows = process.platform === "win32";

    expect(options).toEqual(expect.objectContaining({
      cwd: "repo/aegis-mock-run",
      detached: !isWindows,
      stdio: "ignore",
      windowsHide: true,
    }));
  });

  it("builds a hidden Start-Process launcher script for Windows background daemon start", () => {
    const script = buildWindowsBackgroundLaunchScript(
      "C:\\Program Files\\nodejs\\node.exe",
      ["C:\\repo\\dist\\index.js", "start"],
      "C:\\repo",
    );

    expect(script).toContain("Start-Process");
    expect(script).toContain("'C:\\Program Files\\nodejs\\node.exe'");
    expect(script).toContain("'C:\\repo\\dist\\index.js'");
    expect(script).toContain("'start'");
    expect(script).toContain("'C:\\repo'");
    expect(script).toContain("-WindowStyle Hidden");
  });
});
