import { describe, expect, it, vi } from "vitest";

describe("runCli phase commands", () => {
  it("supports poll, dispatch, monitor, and reap through the shared phase runner", async () => {
    vi.resetModules();

    const runDirectPhaseCommand = vi.fn(async (_root: string, phase: string) => ({
      phase,
      source: "test",
    }));
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);

    vi.doMock("../../../src/cli/phase-command.js", async () => {
      const actual = await vi.importActual<object>("../../../src/cli/phase-command.js");
      return {
        ...actual,
        runDirectPhaseCommand,
      };
    });

    const { runCli } = await import("../../../src/index.js");

    await runCli("C:/repo", ["poll"]);
    await runCli("C:/repo", ["dispatch"]);
    await runCli("C:/repo", ["monitor"]);
    await runCli("C:/repo", ["reap"]);

    expect(runDirectPhaseCommand).toHaveBeenNthCalledWith(1, "C:/repo", "poll");
    expect(runDirectPhaseCommand).toHaveBeenNthCalledWith(2, "C:/repo", "dispatch");
    expect(runDirectPhaseCommand).toHaveBeenNthCalledWith(3, "C:/repo", "monitor");
    expect(runDirectPhaseCommand).toHaveBeenNthCalledWith(4, "C:/repo", "reap");
    expect(consoleLog).toHaveBeenCalledTimes(4);

    consoleLog.mockRestore();
  });
});
