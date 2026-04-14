import { describe, expect, it, vi } from "vitest";

describe("runCli caste commands", () => {
  it("supports scout, implement, review, and process through the shared caste runner", async () => {
    vi.resetModules();

    const runDirectCasteCommand = vi.fn(
      async (_root: string, action: string, issueId: string) => ({
        action,
        issueId,
        source: "test",
      }),
    );
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);

    vi.doMock("../../../src/cli/caste-command.js", async () => {
      const actual = await vi.importActual<object>("../../../src/cli/caste-command.js");
      return {
        ...actual,
        runDirectCasteCommand,
      };
    });

    const { runCli } = await import("../../../src/index.js");

    await runCli("C:/repo", ["scout", "aegis-1"]);
    await runCli("C:/repo", ["implement", "aegis-2"]);
    await runCli("C:/repo", ["review", "aegis-3"]);
    await runCli("C:/repo", ["process", "aegis-4"]);

    expect(runDirectCasteCommand).toHaveBeenNthCalledWith(1, "C:/repo", "scout", "aegis-1");
    expect(runDirectCasteCommand).toHaveBeenNthCalledWith(2, "C:/repo", "implement", "aegis-2");
    expect(runDirectCasteCommand).toHaveBeenNthCalledWith(3, "C:/repo", "review", "aegis-3");
    expect(runDirectCasteCommand).toHaveBeenNthCalledWith(4, "C:/repo", "process", "aegis-4");
    expect(consoleLog).toHaveBeenCalledTimes(4);

    consoleLog.mockRestore();
  });
});
