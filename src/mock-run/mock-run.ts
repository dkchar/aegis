import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { isProcessRunning, readRuntimeState, type RuntimeStateRecord } from "../cli/runtime-state.js";
import { resolveDefaultMockRepoRoot } from "./mock-paths.js";

const MOCK_START_TIMEOUT_MS = 10_000;
const MOCK_START_POLL_MS = 100;

export interface RunMockCommandOptions {
  mockDir?: string;
  execFileSync?: typeof execFileSync;
  spawn?: typeof spawn;
  waitForDaemonStart?: (
    mockDir: string,
    expectedPid: number,
    timeoutMs?: number,
  ) => Promise<RuntimeStateRecord>;
  startTimeoutMs?: number;
}

function normalizeExecutable(command: string) {
  return command === "node" ? process.execPath : command;
}

function isMockAegisStartCommand(args: readonly string[]) {
  if (args.length < 3) {
    return false;
  }

  const executable = normalizeExecutable(args[0]!);
  return executable === process.execPath
    && path.basename(args[1] ?? "") === "index.js"
    && args[2] === "start";
}

async function sleep(milliseconds: number) {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export async function waitForMockDaemonStart(
  mockDir: string,
  expectedPid: number,
  timeoutMs = MOCK_START_TIMEOUT_MS,
): Promise<RuntimeStateRecord> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const runtimeState = readRuntimeState(mockDir);
    if (
      runtimeState
      && runtimeState.server_state === "running"
      && runtimeState.pid === expectedPid
      && isProcessRunning(runtimeState.pid)
    ) {
      return runtimeState;
    }

    await sleep(MOCK_START_POLL_MS);
  }

  throw new Error(`Timed out waiting for mock-run daemon start after ${timeoutMs}ms`);
}

export async function runMockCommand(
  args: string[],
  options: RunMockCommandOptions = {},
) {
  if (args.length === 0) {
    console.log("Usage: npm run mock:run -- <command> [args...]");
    console.log("  npm run mock:run -- node ../dist/index.js status");
    console.log("  npm run mock:run -- node ../dist/index.js start");
    process.exit(1);
  }

  const executeFile = options.execFileSync ?? execFileSync;
  const spawnProcess = options.spawn ?? spawn;
  const waitForDaemonStart = options.waitForDaemonStart ?? waitForMockDaemonStart;
  const mockDir = options.mockDir ?? resolveDefaultMockRepoRoot();
  const startTimeoutMs = options.startTimeoutMs ?? MOCK_START_TIMEOUT_MS;

  if (isMockAegisStartCommand(args)) {
    const existingRuntime = readRuntimeState(mockDir);
    if (
      existingRuntime
      && existingRuntime.server_state === "running"
      && isProcessRunning(existingRuntime.pid)
    ) {
      throw new Error(`Aegis is already running on pid ${existingRuntime.pid}.`);
    }

    const child = spawnProcess(normalizeExecutable(args[0]!), args.slice(1), {
      cwd: mockDir,
      env: { ...process.env },
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });

    if (typeof child.pid !== "number") {
      throw new Error("Failed to determine mock-run daemon pid.");
    }

    child.unref();
    const runtimeState = await waitForDaemonStart(mockDir, child.pid, startTimeoutMs);
    console.log(`Aegis started in auto mode (pid ${runtimeState.pid})`);
    return;
  }

  executeFile(normalizeExecutable(args[0]!), args.slice(1), {
    cwd: mockDir,
    stdio: "inherit",
    env: { ...process.env },
  });
}

function isDirectExecution(entryPoint = process.argv[1]): boolean {
  if (!entryPoint) {
    return false;
  }

  return path.resolve(entryPoint) === path.resolve(fileURLToPath(import.meta.url));
}

if (isDirectExecution()) {
  const args = process.argv.slice(2);
  runMockCommand(args).catch((error) => {
    const details = error instanceof Error ? error.message : String(error);
    console.error(details);
    process.exitCode = 1;
  });
}
