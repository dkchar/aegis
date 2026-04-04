import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { initProject } from "../../../src/config/init-project.js";

interface LaunchSequenceFixture {
  startCommand: string;
  statusCommand: string;
  stopCommand: string;
  startOverrides: string[];
  launchSequenceSteps: string[];
  shutdownSequenceSteps: string[];
}

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const tsxCliPath = path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
const entrypointPath = path.join(repoRoot, "src", "index.ts");
const temporaryRoots: string[] = [];

function readJsonFixture<T>(fixtureName: string) {
  return JSON.parse(
    readFileSync(
      path.join(repoRoot, "tests", "fixtures", "s06", fixtureName),
      "utf8",
    ),
  ) as T;
}

interface CliRunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function createTempRepo() {
  const tempRepo = mkdtempSync(path.join(tmpdir(), "aegis-s06-cli-"));
  temporaryRoots.push(tempRepo);
  return tempRepo;
}

async function reservePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();

      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Failed to reserve a local test port."));
        return;
      }

      const { port } = address;

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

function initializeGitRepo(root: string) {
  const gitInit = spawnSync("git", ["init"], {
    cwd: root,
    encoding: "utf8",
  });

  expect(gitInit.status, gitInit.stderr).toBe(0);
}

function runCliCommand(root: string, commandArgs: string[]): CliRunResult {
  const result = spawnSync(process.execPath, [tsxCliPath, entrypointPath, ...commandArgs], {
    cwd: root,
    encoding: "utf8",
    timeout: 20_000,
  });

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

interface CliStatusSnapshot {
  server_state: string;
  mode: string;
  active_agents: number;
  queue_depth: number;
  uptime_ms: number;
}

function parseStatusOutput(stdout: string): CliStatusSnapshot {
  return JSON.parse(stdout) as CliStatusSnapshot;
}

async function waitForStatus(
  root: string,
  expectedState: "running" | "stopped",
  timeoutMs = 10_000,
) {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const statusRun = runCliCommand(root, ["status"]);

    if (statusRun.status === 0) {
      const snapshot = parseStatusOutput(statusRun.stdout);
      if (snapshot.server_state === expectedState) {
        return snapshot;
      }
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });
  }

  throw new Error(`Timed out waiting for status=${expectedState}`);
}

async function waitForChildExit(
  child: ReturnType<typeof spawn>,
  timeoutMs = 10_000,
) {
  return new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    let completed = false;
    const timeout = setTimeout(() => {
      if (!completed) {
        reject(new Error("Timed out waiting for start process to exit."));
      }
    }, timeoutMs);

    child.once("exit", (code, signal) => {
      completed = true;
      clearTimeout(timeout);
      resolve({ code, signal });
    });
  });
}

afterEach(() => {
  vi.restoreAllMocks();

  for (const tempRoot of temporaryRoots.splice(0)) {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

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

  it("fails start prerequisites clearly when config is missing", async () => {
    const tempRepo = createTempRepo();
    initializeGitRepo(tempRepo);
    const startModule = (await import(
      pathToFileURL(path.join(repoRoot, "src", "cli", "start.ts")).href
    )) as {
      startAegis: (
        root?: string,
        overrides?: {
          port?: number;
          noBrowser?: boolean;
        },
        options?: {
          verifyTracker?: () => void;
          verifyGitRepo?: () => void;
        },
      ) => Promise<unknown>;
    };

    await expect(
      startModule.startAegis(
        tempRepo,
        { noBrowser: true },
        {
          verifyGitRepo: () => undefined,
          verifyTracker: () => undefined,
        },
      ),
    ).rejects.toThrow("Missing Aegis config");
  });

  it("opens the browser by default and honors --no-browser overrides", async () => {
    const tempRepo = createTempRepo();
    const port = await reservePort();
    initProject(tempRepo);
    initializeGitRepo(tempRepo);

    const startModule = (await import(
      pathToFileURL(path.join(repoRoot, "src", "cli", "start.ts")).href
    )) as {
      startAegis: (
        root?: string,
        overrides?: {
          port?: number;
          noBrowser?: boolean;
        },
        options?: {
          verifyTracker?: () => void;
          verifyGitRepo?: () => void;
          openBrowser?: (url: string) => boolean;
        },
      ) => Promise<{
        runtime: {
          stop: () => Promise<void>;
        };
        openedBrowser: boolean;
      }>;
    };

    const openBrowser = vi.fn(() => true);
    const startedWithBrowser = await startModule.startAegis(
      tempRepo,
      { port, noBrowser: false },
      {
        verifyGitRepo: () => undefined,
        verifyTracker: () => undefined,
        openBrowser,
      },
    );

    expect(startedWithBrowser.openedBrowser).toBe(true);
    expect(openBrowser).toHaveBeenCalledTimes(1);
    expect(openBrowser).toHaveBeenCalledWith(`http://127.0.0.1:${port}/`);
    await startedWithBrowser.runtime.stop();

    const openBrowserDisabled = vi.fn(() => true);
    const startedWithoutBrowser = await startModule.startAegis(
      tempRepo,
      { port, noBrowser: true },
      {
        verifyGitRepo: () => undefined,
        verifyTracker: () => undefined,
        openBrowser: openBrowserDisabled,
      },
    );

    expect(startedWithoutBrowser.openedBrowser).toBe(false);
    expect(openBrowserDisabled).not.toHaveBeenCalled();
    await startedWithoutBrowser.runtime.stop();
  });

  it("runs start, status, and stop commands with graceful shutdown semantics", async () => {
    const tempRepo = createTempRepo();
    const port = await reservePort();
    initProject(tempRepo);
    initializeGitRepo(tempRepo);

    const configPath = path.join(tempRepo, ".aegis", "config.json");
    const existingConfig = JSON.parse(readFileSync(configPath, "utf8")) as {
      olympus: {
        port: number;
        open_browser: boolean;
      };
    };
    existingConfig.olympus.port = port;
    existingConfig.olympus.open_browser = false;
    writeFileSync(configPath, `${JSON.stringify(existingConfig, null, 2)}\n`, "utf8");

    const startProcess = spawn(
      process.execPath,
      [tsxCliPath, entrypointPath, "start", "--port", String(port), "--no-browser"],
      {
        cwd: tempRepo,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let startStdout = "";
    let startStderr = "";

    startProcess.stdout?.on("data", (chunk: Buffer | string) => {
      startStdout += chunk.toString();
    });
    startProcess.stderr?.on("data", (chunk: Buffer | string) => {
      startStderr += chunk.toString();
    });

    try {
      const runningStatus = await waitForStatus(tempRepo, "running");

      expect(runningStatus.server_state).toBe("running");
      expect(runningStatus.mode).toBe("conversational");
      expect(runningStatus.uptime_ms).toBeGreaterThanOrEqual(0);

      const rootResponse = await fetch(`http://127.0.0.1:${port}/`);
      const shellHtml = await rootResponse.text();

      expect(rootResponse.status).toBe(200);
      expect(shellHtml).toContain("Olympus");

      const assetMatch = shellHtml.match(/src="([^"]*\/assets\/[^"]+)"/);
      expect(assetMatch).not.toBeNull();
      const assetUrl = new URL(assetMatch![1], `http://127.0.0.1:${port}/`);
      const assetResponse = await fetch(assetUrl);

      expect(assetResponse.status).toBe(200);
      expect(assetResponse.headers.get("content-type")).toContain("javascript");

      const stateResponse = await fetch(`http://127.0.0.1:${port}/api/state`);
      const statePayload = await stateResponse.json() as {
        orchestrator: {
          server_state: string;
          mode: string;
        };
      };

      expect(stateResponse.status).toBe(200);
      expect(statePayload.orchestrator.server_state).toBe("running");
      expect(statePayload.orchestrator.mode).toBe("conversational");

      const eventsResponse = await fetch(`http://127.0.0.1:${port}/api/events`);
      expect(eventsResponse.status).toBe(200);
      expect(eventsResponse.headers.get("content-type")).toContain(
        "text/event-stream",
      );
      await eventsResponse.body?.cancel();

      const stopRun = runCliCommand(tempRepo, ["stop"]);
      expect(stopRun.status, stopRun.stderr).toBe(0);
      expect(stopRun.stdout).toContain("stopped");

      const exitResult = await waitForChildExit(startProcess);
      expect(
        exitResult.code,
        `start stdout:\n${startStdout}\nstart stderr:\n${startStderr}`,
      ).toBe(0);

      const stoppedStatus = await waitForStatus(tempRepo, "stopped");
      expect(stoppedStatus.server_state).toBe("stopped");

      const runtimeStatePath = path.join(tempRepo, ".aegis", "runtime-state.json");
      expect(existsSync(runtimeStatePath)).toBe(true);
      const runtimeState = JSON.parse(readFileSync(runtimeStatePath, "utf8")) as {
        server_state: string;
        last_stop_reason?: string;
      };

      expect(runtimeState.server_state).toBe("stopped");
      expect(runtimeState.last_stop_reason).toBe("manual");
    } finally {
      if (!startProcess.killed) {
        startProcess.kill("SIGKILL");
      }
    }
  });
});
