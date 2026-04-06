import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { createCommandExecutor, type CommandExecutionContext } from "../../../src/core/command-executor.js";
import { createAutoLoopState } from "../../../src/core/auto-loop.js";
import { createOperatingModeState } from "../../../src/core/operating-mode.js";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

function makeContext(): CommandExecutionContext {
  return {
    operatingMode: createOperatingModeState(),
    autoLoop: createAutoLoopState(),
    issueId: null,
  };
}

describe("S07 command executor routing", () => {
  describe("declined commands", () => {
    it.each([
      {
        command: "scout aegis-fjm.8.2",
        kind: "scout" as const,
        expectedReason: "scout dispatch requires S08 (Oracle)",
      },
      {
        command: "implement aegis-fjm.9.1",
        kind: "implement" as const,
        expectedReason: "implement dispatch requires Titan caste (S10)",
      },
      {
        command: "review aegis-fjm.10.3",
        kind: "review" as const,
        expectedReason: "review dispatch requires Sentinel caste (S09)",
      },
      {
        command: "process aegis-fjm.8.5",
        kind: "process" as const,
        expectedReason: "process dispatch requires auto-loop (Lane B, S07)",
      },
    ])("declines $kind with clear reason", async ({ command, kind, expectedReason }) => {
      const module = (await import(
        pathToFileURL(path.join(repoRoot, "src", "cli", "parse-command.ts")).href
      )) as {
        parseCommand: (input: string) => unknown;
      };
      const parsed = module.parseCommand(command);
      const context = makeContext();
      const executor = createCommandExecutor(context);
      const result = await executor(parsed as any, context);

      expect(result.status).toBe("declined");
      expect(result.kind).toBe(kind);
      expect(result.message).toBe(expectedReason);
    });
  });

  describe("handled commands", () => {
    it.each([
      "status",
      "pause",
      "resume",
      "auto on",
      "auto off",
      "scale",
      "kill",
      "restart",
      "focus",
      "tell",
      "add_learning",
      "reprioritize",
      "summarize",
    ] as const)("handles %s as a fixed command", async (commandName) => {
      const module = (await import(
        pathToFileURL(path.join(repoRoot, "src", "cli", "parse-command.ts")).href
      )) as {
        parseCommand: (input: string) => unknown;
      };
      const parsed = module.parseCommand(commandName);
      const context = makeContext();
      const executor = createCommandExecutor(context);
      const result = await executor(parsed as any, context);

      expect(result.status).toBe("handled");
      expect(result.message).toContain("acknowledged");
    });
  });

  it("returns unsupported for unrecognized input", async () => {
    const module = (await import(
      pathToFileURL(path.join(repoRoot, "src", "cli", "parse-command.ts")).href
    )) as {
      parseCommand: (input: string) => unknown;
    };
    const parsed = module.parseCommand("foobar");
    const context = makeContext();
    const executor = createCommandExecutor(context);
    const result = await executor(parsed as any, context);

    expect(result.status).toBe("unsupported");
    expect(result.kind).toBe("unsupported");
  });
});
