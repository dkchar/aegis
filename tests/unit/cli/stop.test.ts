import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("stopAegis persistent-failure behavior", () => {
  it("does not mark runtime state stopped when the target pid survives SIGKILL", async () => {
    vi.useFakeTimers();

    const runtimeState = {
      schema_version: 1 as const,
      pid: 4242,
      host: "127.0.0.1",
      port: 3847,
      server_state: "running" as const,
      mode: "conversational" as const,
      started_at: "2026-04-05T00:00:00.000Z",
      browser_opened: false,
    };
    const readRuntimeState = vi.fn(() => runtimeState);
    const isProcessRunning = vi.fn(() => true);
    const isAegisOwned = vi.fn(async () => false);
    const writeStopRequest = vi.fn();
    const clearStopRequest = vi.fn();
    const writeRuntimeState = vi.fn();

    vi.doMock("../../../src/cli/runtime-state.js", () => ({
      readRuntimeState,
      isProcessRunning,
      isAegisOwned,
      writeStopRequest,
      clearStopRequest,
      writeRuntimeState,
    }));

    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    const stopModule = await import("../../../src/cli/stop.js");

    const stopPromise = stopModule.stopAegis("C:/fake", "manual", 0);
    const rejection = expect(stopPromise).rejects.toThrow(/still running|failed to stop/i);
    await vi.runAllTimersAsync();

    await rejection;
    expect(killSpy).toHaveBeenNthCalledWith(1, runtimeState.pid, "SIGTERM");
    expect(killSpy).toHaveBeenNthCalledWith(2, runtimeState.pid, "SIGKILL");
    expect(writeStopRequest).toHaveBeenCalledTimes(1);
    expect(clearStopRequest).toHaveBeenCalledTimes(1);
    expect(writeRuntimeState).not.toHaveBeenCalled();
  });
});
