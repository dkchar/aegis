import path from "node:path";
import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it, vi } from "vitest";

import { initProject } from "../../../src/config/init-project.js";
import { runCli } from "../../../src/index.js";
import { startAegis } from "../../../src/cli/start.js";
import { getAegisStatus } from "../../../src/cli/status.js";
import { readRuntimeState } from "../../../src/cli/runtime-state.js";
import type { CommandExecutionContext, CommandExecutionResult, CommandExecutor } from "../../../src/core/command-executor.js";

const temporaryRoots: string[] = [];

function createTempRepo() {
  const tempRepo = mkdtempSync(path.join(tmpdir(), "aegis-live-cli-"));
  temporaryRoots.push(tempRepo);
  return tempRepo;
}

function initializeGitRepo(root: string) {
  const gitInit = spawnSync("git", ["init"], {
    cwd: root,
    encoding: "utf8",
  });
  expect(gitInit.status, gitInit.stderr).toBe(0);
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

function captureConsole(fn: () => Promise<void>) {
  const logs: string[] = [];
  const errors: string[] = [];
  const origLog = console.log;
  const origError = console.error;

  console.log = (...args) => {
    logs.push(args.map(String).join(" "));
  };
  console.error = (...args) => {
    errors.push(args.map(String).join(" "));
  };

  return fn().finally(() => {
    console.log = origLog;
    console.error = origError;
  }).then(() => ({ logs, errors }));
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const tempRoot of temporaryRoots.splice(0)) {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

describe("live direct CLI commands", () => {
  it("forwards auto on/off to the running server and persists runtime-state mode", async () => {
    const tempRepo = createTempRepo();
    const port = await reservePort();
    initProject(tempRepo);
    initializeGitRepo(tempRepo);

    const started = await startAegis(
      tempRepo,
      { port, noBrowser: true },
      {
        verifyTracker: () => undefined,
        verifyGitRepo: () => undefined,
        registerSignalHandlers: false,
      },
    );

    try {
      await runCli(tempRepo, ["auto", "on"]);
      expect((await getAegisStatus(tempRepo)).mode).toBe("auto");
      expect(readRuntimeState(tempRepo)?.mode).toBe("auto");

      await runCli(tempRepo, ["auto", "off"]);
      expect((await getAegisStatus(tempRepo)).mode).toBe("conversational");
      expect(readRuntimeState(tempRepo)?.mode).toBe("conversational");
    } finally {
      await started.runtime.stop();
    }
  });

  it("forwards issue-scoped commands to the live server instead of printing local slice placeholders", async () => {
    const tempRepo = createTempRepo();
    const port = await reservePort();
    initProject(tempRepo);
    initializeGitRepo(tempRepo);

    const executedCommands: string[] = [];
    const started = await startAegis(
      tempRepo,
      { port, noBrowser: true },
      {
        verifyTracker: () => undefined,
        verifyGitRepo: () => undefined,
        registerSignalHandlers: false,
        httpServerBindings: {
          executeCommand: async (
            commandText: string,
            _context: CommandExecutionContext,
            _executor: CommandExecutor,
          ): Promise<CommandExecutionResult> => {
            executedCommands.push(commandText);
            return {
              kind: "scout",
              status: "handled",
              message: `Live dispatch executed: ${commandText}`,
            };
          },
        },
      },
    );

    try {
      const { logs } = await captureConsole(async () => {
        await runCli(tempRepo, ["scout", "liveaegis-1n2"]);
      });

      expect(executedCommands).toEqual(["scout liveaegis-1n2"]);
      expect(logs.some((line) => line.includes("Live dispatch executed: scout liveaegis-1n2"))).toBe(true);
      expect(logs.some((line) => line.includes("requires S08"))).toBe(false);
    } finally {
      await started.runtime.stop();
    }
  });
});
