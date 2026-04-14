import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const MOCK_DIR = path.join(process.cwd(), "aegis-mock-run");

export interface RunMockCommandOptions {
  mockDir?: string;
  execFileSync?: typeof execFileSync;
}

function normalizeExecutable(command: string) {
  return command === "node" ? process.execPath : command;
}

export function runMockCommand(
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
  const mockDir = options.mockDir ?? MOCK_DIR;

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
  runMockCommand(args);
}
