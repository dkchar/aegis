import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

interface OperatingModeFixture {
  modes: string[];
  autoEnabledAt: string;
  backlogIssueId: string;
  laterIssueId: string;
}

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

function readJsonFixture<T>(relativePath: string): T {
  return JSON.parse(readFileSync(path.join(repoRoot, relativePath), "utf8")) as T;
}

describe("S07 operating mode contract seed", () => {
  it("exports the canonical operating modes and immutable state transitions", async () => {
    const fixture = readJsonFixture<OperatingModeFixture>(
      "tests/fixtures/s07/operating-mode-contract.json",
    );
    const module = (await import(
      pathToFileURL(path.join(repoRoot, "src", "core", "operating-mode.ts")).href
    )) as {
      OPERATING_MODES: readonly string[];
      createOperatingModeState: () => {
        mode: string;
        paused: boolean;
      };
      enableAutoMode: (state: { mode: string; paused: boolean }) => {
        mode: string;
        paused: boolean;
      };
      disableAutoMode: (state: { mode: string; paused: boolean }) => {
        mode: string;
        paused: boolean;
      };
      pauseOperatingMode: (state: { mode: string; paused: boolean }) => {
        mode: string;
        paused: boolean;
      };
      resumeOperatingMode: (state: { mode: string; paused: boolean }) => {
        mode: string;
        paused: boolean;
      };
      isAutoModeActive: (state: { mode: string; paused: boolean }) => boolean;
    };

    expect(module.OPERATING_MODES).toEqual(fixture.modes);

    const initial = module.createOperatingModeState();
    expect(initial).toEqual({ mode: "conversational", paused: false });

    const auto = module.enableAutoMode(initial);
    expect(auto).toEqual({ mode: "auto", paused: false });
    expect(auto).not.toBe(initial);
    expect(initial).toEqual({ mode: "conversational", paused: false });

    const paused = module.pauseOperatingMode(auto);
    expect(paused).toEqual({ mode: "auto", paused: true });
    expect(paused).not.toBe(auto);
    expect(auto).toEqual({ mode: "auto", paused: false });
    expect(module.isAutoModeActive(paused)).toBe(false);

    const resumed = module.resumeOperatingMode(paused);
    expect(resumed).toEqual({ mode: "auto", paused: false });
    expect(resumed).not.toBe(paused);
    expect(paused).toEqual({ mode: "auto", paused: true });
    expect(module.isAutoModeActive(resumed)).toBe(true);

    const conversational = module.disableAutoMode(resumed);
    expect(conversational).toEqual({ mode: "conversational", paused: false });
    expect(conversational).not.toBe(resumed);
    expect(resumed).toEqual({ mode: "auto", paused: false });
  });

  it("tracks backlog-sweep auto dispatch semantics", async () => {
    const fixture = readJsonFixture<OperatingModeFixture>(
      "tests/fixtures/s07/operating-mode-contract.json",
    );
    const autoLoopModule = (await import(
      pathToFileURL(path.join(repoRoot, "src", "core", "auto-loop.ts")).href
    )) as {
      createAutoLoopState: () => {
        enabledAt: string | null;
      };
      enableAutoLoop: (enabledAt: string) => {
        enabledAt: string;
      };
      disableAutoLoop: () => {
        enabledAt: null;
      };
      isAutoLoopEligible: (state: { enabledAt: string | null }) => boolean;
    };
    const commandExecutorModule = (await import(
      pathToFileURL(path.join(repoRoot, "src", "core", "command-executor.ts")).href
    )) as {
      SUPPORTED_DIRECT_COMMAND_KINDS: readonly string[];
    };

    expect(commandExecutorModule.SUPPORTED_DIRECT_COMMAND_KINDS).toEqual([
      "scout",
      "implement",
      "review",
      "process",
      "status",
      "pause",
      "resume",
      "auto_on",
      "auto_off",
      "scale",
      "kill",
      "restart",
      "focus",
      "tell",
      "add_learning",
      "reprioritize",
      "summarize",
    ]);

    const initial = autoLoopModule.createAutoLoopState();
    expect(initial).toEqual({ enabledAt: null });
    expect(autoLoopModule.isAutoLoopEligible(initial)).toBe(false);

    const enabled = autoLoopModule.enableAutoLoop(fixture.autoEnabledAt);
    expect(enabled).toEqual({ enabledAt: fixture.autoEnabledAt });
    expect(autoLoopModule.isAutoLoopEligible(enabled)).toBe(true);
    expect(fixture.backlogIssueId).toBe("aegis-fjm.8.2");
    expect(fixture.laterIssueId).toBe("aegis-fjm.8.99");

    expect(autoLoopModule.disableAutoLoop()).toEqual({ enabledAt: null });
  });
});
