import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

interface DirectCommandFixture {
  supportedCommands: string[];
  issueIdCommands: string[];
  unsupportedSample: string;
}

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

function readJsonFixture<T>(relativePath: string): T {
  return JSON.parse(readFileSync(path.join(repoRoot, relativePath), "utf8")) as T;
}

function expectedKind(commandName: string): string {
  return commandName.replace(/\s+/g, "_");
}

describe("S07 direct command contract seed", () => {
  it("exports the canonical direct command names and kinds", async () => {
    const fixture = readJsonFixture<DirectCommandFixture>(
      "tests/fixtures/s07/direct-command-contract.json",
    );
    const module = (await import(
      pathToFileURL(path.join(repoRoot, "src", "cli", "parse-command.ts")).href
    )) as {
      DIRECT_COMMAND_NAMES: readonly string[];
      DIRECT_COMMAND_KINDS: readonly string[];
    };

    expect(module.DIRECT_COMMAND_NAMES).toEqual(fixture.supportedCommands);
    expect(module.DIRECT_COMMAND_KINDS).toEqual(
      fixture.supportedCommands.map(expectedKind),
    );
  });

  it.each(["scout", "implement", "review", "process"] as const)(
    "parses %s commands with explicit issue ids",
    async (commandName) => {
      const module = (await import(
        pathToFileURL(path.join(repoRoot, "src", "cli", "parse-command.ts")).href
      )) as {
        parseCommand: (input: string) => {
          kind: string;
          issueId?: string;
          reason?: string;
        };
      };

      expect(module.parseCommand(`${commandName} aegis-fjm.8.123`)).toEqual({
        kind: commandName,
        issueId: "aegis-fjm.8.123",
      });
    },
  );

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
  ] as const)("parses %s as a deterministic direct command", async (commandName) => {
    const module = (await import(
      pathToFileURL(path.join(repoRoot, "src", "cli", "parse-command.ts")).href
    )) as {
      parseCommand: (input: string) => {
        kind: string;
        reason?: string;
      };
    };

    expect(module.parseCommand(commandName)).toEqual({
      kind: expectedKind(commandName),
    });
  });

  it("trims surrounding whitespace before parsing", async () => {
    const module = (await import(
      pathToFileURL(path.join(repoRoot, "src", "cli", "parse-command.ts")).href
    )) as {
      parseCommand: (input: string) => {
        kind: string;
      };
    };

    expect(module.parseCommand("  status  ")).toEqual({ kind: "status" });
  });

  it("returns a clear unsupported result for unknown commands", async () => {
    const fixture = readJsonFixture<DirectCommandFixture>(
      "tests/fixtures/s07/direct-command-contract.json",
    );
    const module = (await import(
      pathToFileURL(path.join(repoRoot, "src", "cli", "parse-command.ts")).href
    )) as {
      parseCommand: (input: string) => {
        kind: string;
        reason?: string;
      };
    };

    expect(module.parseCommand(fixture.unsupportedSample)).toMatchObject({
      kind: "unsupported",
    });
  });

  it("rejects issue-scoped commands that omit an issue id", async () => {
    const module = (await import(
      pathToFileURL(path.join(repoRoot, "src", "cli", "parse-command.ts")).href
    )) as {
      parseCommand: (input: string) => {
        kind: string;
        reason?: string;
      };
    };

    expect(module.parseCommand("scout")).toMatchObject({
      kind: "unsupported",
    });
  });

  it.each([
    "scout aegis-fjm.8.123 extra",
    "status now",
    "auto maybe",
    "auto on now",
    "process ../outside",
    "review aegis/fjm.9.1",
    "implement aegis-fjm\\9.1",
  ])("rejects malformed deterministic command: %s", async (input) => {
    const module = (await import(
      pathToFileURL(path.join(repoRoot, "src", "cli", "parse-command.ts")).href
    )) as {
      parseCommand: (value: string) => {
        kind: string;
        reason?: string;
      };
    };

    expect(module.parseCommand(input)).toMatchObject({
      kind: "unsupported",
    });
  });
});
