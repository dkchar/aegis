import path from "node:path";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

interface LaunchSequenceFixture {
  startCommand: string;
  statusCommand: string;
  stopCommand: string;
  startOverrides: string[];
  launchSequenceSteps: string[];
  shutdownSequenceSteps: string[];
}

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

function readJsonFixture<T>(fixtureName: string) {
  return JSON.parse(
    readFileSync(
      path.join(repoRoot, "tests", "fixtures", "s06", fixtureName),
      "utf8",
    ),
  ) as T;
}

describe("S06 launch lifecycle contract seed", () => {
  it("defines the canonical command names", async () => {
    const fixture = readJsonFixture<LaunchSequenceFixture>(
      "launch-sequence-contract.json",
    );
    const startModule = (await import(
      pathToFileURL(path.join(repoRoot, "src", "cli", "start.ts")).href
    )) as {
      START_COMMAND_NAME: string;
    };
    const statusModule = (await import(
      pathToFileURL(path.join(repoRoot, "src", "cli", "status.ts")).href
    )) as {
      STATUS_COMMAND_NAME: string;
    };
    const stopModule = (await import(
      pathToFileURL(path.join(repoRoot, "src", "cli", "stop.ts")).href
    )) as {
      STOP_COMMAND_NAME: string;
    };

    expect(startModule.START_COMMAND_NAME).toBe(fixture.startCommand);
    expect(statusModule.STATUS_COMMAND_NAME).toBe(fixture.statusCommand);
    expect(stopModule.STOP_COMMAND_NAME).toBe(fixture.stopCommand);
  });

  it("defines launch and shutdown sequence rules from SPECv2", async () => {
    const fixture = readJsonFixture<LaunchSequenceFixture>(
      "launch-sequence-contract.json",
    );
    const startModule = (await import(
      pathToFileURL(path.join(repoRoot, "src", "cli", "start.ts")).href
    )) as {
      START_OVERRIDE_FLAGS: readonly string[];
      CANONICAL_LAUNCH_SEQUENCE: readonly string[];
      CANONICAL_SHUTDOWN_SEQUENCE: readonly string[];
    };

    expect(startModule.START_OVERRIDE_FLAGS).toEqual(fixture.startOverrides);
    expect(startModule.CANONICAL_LAUNCH_SEQUENCE).toEqual(
      fixture.launchSequenceSteps,
    );
    expect(startModule.CANONICAL_SHUTDOWN_SEQUENCE).toEqual(
      fixture.shutdownSequenceSteps,
    );
  });
});
