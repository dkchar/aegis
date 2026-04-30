import {
  type BashOperations,
  type AgentSessionEvent,
  type FindOperations,
  type ToolDefinition,
} from "@mariozechner/pi-coding-agent";
import { spawn, spawnSync, type SpawnOptions } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { globSync } from "glob";

import {
  createOracleEmitAssessmentTool,
  enforceOracleToolPayloadContract,
  extractOracleAssessmentFromToolEvent,
  ORACLE_EMIT_ASSESSMENT_TOOL_NAME,
  stringifyOracleAssessment,
} from "../castes/oracle/oracle-tool-contract.js";
import {
  createTitanEmitArtifactTool,
  enforceTitanToolPayloadContract,
  extractTitanArtifactFromToolEvent,
  stringifyTitanArtifact,
  TITAN_EMIT_ARTIFACT_TOOL_NAME,
} from "../castes/titan/titan-tool-contract.js";
import {
  createSentinelEmitVerdictTool,
  enforceSentinelToolPayloadContract,
  extractSentinelVerdictFromToolEvent,
  SENTINEL_EMIT_VERDICT_TOOL_NAME,
  stringifySentinelVerdict,
} from "../castes/sentinel/sentinel-tool-contract.js";
import {
  createJanusEmitResolutionTool,
  enforceJanusToolPayloadContract,
  extractJanusResolutionFromToolEvent,
  JANUS_EMIT_RESOLUTION_TOOL_NAME,
  stringifyJanusResolutionArtifact,
} from "../castes/janus/janus-tool-contract.js";
import type {
  CasteName,
  CasteRunInput,
  CasteRuntime,
  CasteSessionMessage,
  CasteSessionResult,
} from "./caste-runtime.js";
import type { ResolvedConfiguredCasteModel } from "./pi-model-config.js";
import { buildCodexRunEnvironment } from "./codex-caste-runtime.js";

type PiCodingAgentModule = typeof import("@mariozechner/pi-coding-agent");
const require = createRequire(import.meta.url);
let childProcessPatched = false;
let piCodingAgentModulePromise: Promise<PiCodingAgentModule> | null = null;
const DEFAULT_PI_SESSION_TIMEOUT_MS = 60_000;
const DEFAULT_PI_SESSION_TIMEOUT_BY_CASTE: Record<CasteName, number> = {
  oracle: 300_000,
  titan: 180_000,
  sentinel: 180_000,
  janus: 180_000,
};
const DEFAULT_PI_TIMEOUT_RETRY_COUNT = 1;
const DEFAULT_PI_TIMEOUT_RETRY_DELAY_MS = 1_000;

function withWindowsHide<T>(value: T): T | (T & { windowsHide: true }) {
  if (process.platform !== "win32") {
    return value;
  }

  if (value && typeof value === "object") {
    return {
      ...(value as Record<string, unknown>),
      windowsHide: true,
    } as T & { windowsHide: true };
  }

  return { windowsHide: true } as T & { windowsHide: true };
}

function patchChildProcessWindowsDefaults() {
  if (process.platform !== "win32" || childProcessPatched) {
    return;
  }

  const childProcess = require("node:child_process") as typeof import("node:child_process");
  const originalSpawn = childProcess.spawn;
  const originalSpawnSync = childProcess.spawnSync;
  const originalExecFile = childProcess.execFile;
  const originalExecFileSync = childProcess.execFileSync;

  childProcess.spawn = ((...args: unknown[]) => {
    if (Array.isArray(args[1])) {
      args[2] = withWindowsHide(args[2]);
    } else {
      args[1] = withWindowsHide(args[1]);
    }

    return (originalSpawn as (...innerArgs: unknown[]) => ReturnType<typeof originalSpawn>)(...args);
  }) as typeof childProcess.spawn;

  childProcess.spawnSync = ((...args: unknown[]) => {
    if (Array.isArray(args[1])) {
      args[2] = withWindowsHide(args[2]);
    } else {
      args[1] = withWindowsHide(args[1]);
    }

    return (originalSpawnSync as (...innerArgs: unknown[]) => ReturnType<typeof originalSpawnSync>)(...args);
  }) as typeof childProcess.spawnSync;

  childProcess.execFile = ((...args: unknown[]) => {
    const callbackIndex = typeof args[args.length - 1] === "function" ? args.length - 1 : -1;

    if (Array.isArray(args[1])) {
      if (callbackIndex === 2) {
        args.splice(2, 0, withWindowsHide(undefined));
      } else {
        args[2] = withWindowsHide(args[2]);
      }
    } else if (callbackIndex === 1) {
      args.splice(1, 0, withWindowsHide(undefined));
    } else {
      args[1] = withWindowsHide(args[1]);
    }

    return (originalExecFile as (...innerArgs: unknown[]) => ReturnType<typeof originalExecFile>)(...args);
  }) as typeof childProcess.execFile;

  childProcess.execFileSync = ((...args: unknown[]) => {
    if (Array.isArray(args[1])) {
      args[2] = withWindowsHide(args[2]);
    } else {
      args[1] = withWindowsHide(args[1]);
    }

    return (originalExecFileSync as (...innerArgs: unknown[]) => ReturnType<typeof originalExecFileSync>)(...args);
  }) as typeof childProcess.execFileSync;

  childProcessPatched = true;
}

async function loadPiCodingAgentModule(): Promise<PiCodingAgentModule> {
  if (!piCodingAgentModulePromise) {
    patchChildProcessWindowsDefaults();
    piCodingAgentModulePromise = import("@mariozechner/pi-coding-agent");
  }

  return piCodingAgentModulePromise;
}

function extractAssistantText(event: AgentSessionEvent): string {
  if (event.type !== "message_end") {
    return "";
  }

  const message = event.message as { content?: unknown } | undefined;
  const content = message?.content;
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .filter((part) => {
      return (
        part !== null
        && typeof part === "object"
        && "type" in part
        && (part as { type?: string }).type === "text"
      );
    })
    .map((part) => (part as { text?: string }).text ?? "")
    .join("");
}

function extractMessageRole(event: AgentSessionEvent): CasteSessionMessage["role"] | null {
  if (event.type !== "message_end") {
    return null;
  }

  const message = event.message as { role?: unknown } | undefined;
  return message?.role === "user" || message?.role === "assistant"
    ? message.role
    : null;
}

function resolveShellInvocation(command: string) {
  if (process.platform === "win32") {
    return {
      shell: process.env.ComSpec ?? "cmd.exe",
      args: ["/d", "/s", "/c", command],
    };
  }

  return {
    shell: process.env.SHELL ?? "/bin/bash",
    args: ["-lc", command],
  };
}

export function buildHiddenShellSpawnOptions(
  cwd: string,
  env?: NodeJS.ProcessEnv,
): SpawnOptions {
  return {
    cwd,
    detached: process.platform !== "win32",
    env: buildCodexRunEnvironment(env ?? process.env),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  };
}

function terminateProcessTree(pid: number) {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }

  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    // Ignore missing process group.
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // Ignore missing process.
  }
}

function normalizeProcessPath(candidate: string, platform: NodeJS.Platform) {
  const normalized = path.resolve(candidate).replace(/\\/g, "/");
  return platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function commandLineReferencesWorkspace(
  commandLine: string,
  workingDirectory: string,
  platform: NodeJS.Platform = process.platform,
) {
  const normalizedCommand = commandLine.replace(/\\/g, "/");
  const comparableCommand = platform === "win32"
    ? normalizedCommand.toLowerCase()
    : normalizedCommand;
  const workspace = normalizeProcessPath(workingDirectory, platform);
  return comparableCommand.includes(`${workspace}/`) || comparableCommand.includes(workspace);
}

export function terminateWorkspaceProcesses(
  workingDirectory: string,
  platform: NodeJS.Platform = process.platform,
) {
  const workspace = normalizeProcessPath(workingDirectory, platform);
  if (platform === "win32") {
    const script = [
      "$ErrorActionPreference = 'SilentlyContinue'",
      `$workspace = ${JSON.stringify(workspace)}`,
      `$rawWorkspace = ${JSON.stringify(path.resolve(workingDirectory))}`,
      "$current = $PID",
      "Get-CimInstance Win32_Process | Where-Object {",
      "  $_.ProcessId -ne $current -and $_.CommandLine -and (",
      "    $_.CommandLine.ToLowerInvariant().Contains($rawWorkspace.ToLowerInvariant()) -or",
      "    $_.CommandLine.Replace('\\','/').ToLowerInvariant().Contains($workspace)",
      "  )",
      "} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
    ].join("\n");
    spawnSync("powershell.exe", ["-NoProfile", "-Command", script], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }

  const ps = spawnSync("ps", ["-eo", "pid=,command="], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (ps.status !== 0) {
    return;
  }
  for (const line of ps.stdout.split(/\r?\n/)) {
    const match = line.trim().match(/^(\d+)\s+(.+)$/);
    if (!match) {
      continue;
    }
    const pid = Number(match[1]);
    const commandLine = match[2] ?? "";
    if (pid > 0 && pid !== process.pid && commandLineReferencesWorkspace(commandLine, workingDirectory, platform)) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // Ignore missing process.
      }
    }
  }
}

function createHiddenShellBashOperations(): BashOperations {
  return {
    exec: (command, cwd, { onData, signal, timeout, env }) =>
      new Promise((resolve, reject) => {
        const { shell, args } = resolveShellInvocation(command);
        const child = spawn(shell, args, buildHiddenShellSpawnOptions(cwd, env));

        let timeoutHandle: NodeJS.Timeout | undefined;
        let timedOut = false;
        let settled = false;

        const settleResolve = (exitCode: number | null) => {
          if (settled) {
            return;
          }
          settled = true;
          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
          }
          if (signal) {
            signal.removeEventListener("abort", onAbort);
          }
          resolve({ exitCode });
        };

        const settleReject = (error: unknown) => {
          if (settled) {
            return;
          }
          settled = true;
          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
          }
          if (signal) {
            signal.removeEventListener("abort", onAbort);
          }
          reject(error);
        };

        const onAbort = () => {
          if (typeof child.pid === "number") {
            terminateProcessTree(child.pid);
          }
        };

        if (timeout !== undefined && timeout > 0) {
          timeoutHandle = setTimeout(() => {
            timedOut = true;
            onAbort();
          }, timeout * 1_000);
        }

        if (signal) {
          if (signal.aborted) {
            onAbort();
          } else {
            signal.addEventListener("abort", onAbort, { once: true });
          }
        }

        child.stdout?.on("data", onData);
        child.stderr?.on("data", onData);
        child.on("error", settleReject);
        child.on("close", (code) => {
          if (timedOut) {
            settleReject(new Error(`timeout:${timeout}`));
            return;
          }

          if (signal?.aborted) {
            settleReject(new Error("aborted"));
            return;
          }

          settleResolve(code);
        });
      }),
  };
}

const HIDDEN_BASH_TOOL_OPTIONS = {
  operations: createHiddenShellBashOperations(),
};

const HIDDEN_SHELL_TOOL_OPTIONS = {
  bash: HIDDEN_BASH_TOOL_OPTIONS,
};

const HIDDEN_FIND_OPERATIONS: FindOperations = {
  exists: (absolutePath) => existsSync(absolutePath),
  glob: (pattern, cwd, options) =>
    globSync(pattern, {
      cwd,
      dot: true,
      absolute: true,
      ignore: options.ignore,
    }).slice(0, options.limit),
};

function stripShellQuotes(candidate: string) {
  return candidate.replace(/^['"]|['"]$/g, "");
}

function normalizePathCandidate(candidate: string) {
  const stripped = stripShellQuotes(candidate.trim());
  if (
    process.platform === "win32"
    && /^\/[a-zA-Z]\//.test(stripped)
  ) {
    const driveLetter = stripped[1]!.toUpperCase();
    const remainder = stripped.slice(3).replace(/\//g, "\\");
    return `${driveLetter}:\\${remainder}`;
  }

  return stripped;
}

function resolvePathWithinWorkingDirectory(candidate: string, workingDirectory: string) {
  const normalized = normalizePathCandidate(candidate);
  return path.isAbsolute(normalized)
    ? path.resolve(normalized)
    : path.resolve(workingDirectory, normalized);
}

function isWithinWorkingDirectory(candidate: string, workingDirectory: string) {
  const resolvedWorkingDirectory = path.resolve(workingDirectory);
  const resolvedCandidate = resolvePathWithinWorkingDirectory(candidate, workingDirectory);
  return resolvedCandidate === resolvedWorkingDirectory
    || resolvedCandidate.startsWith(`${resolvedWorkingDirectory}${path.sep}`);
}

function assertPathWithinWorkingDirectory(
  candidate: string,
  workingDirectory: string,
  toolName: string,
) {
  if (!isWithinWorkingDirectory(candidate, workingDirectory)) {
    throw new Error(
      `${toolName} path escapes working directory: ${candidate}`,
    );
  }
}

function normalizeScopedPath(candidate: string, workingDirectory: string) {
  const resolvedWorkingDirectory = path.resolve(workingDirectory);
  const resolvedCandidate = resolvePathWithinWorkingDirectory(candidate, workingDirectory);
  return path.relative(resolvedWorkingDirectory, resolvedCandidate)
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .trim();
}

function assertPathWithinAllowedFileScope(
  candidate: string,
  workingDirectory: string,
  allowedFileScope: string[],
  toolName: string,
) {
  if (allowedFileScope.length === 0) {
    return;
  }

  const normalizedCandidate = normalizeScopedPath(candidate, workingDirectory);
  if (isPathAllowedByScope(normalizedCandidate, allowedFileScope)) {
    return;
  }

  throw new Error(
    `${toolName} path is outside allowed file scope: ${normalizedCandidate}`,
  );
}

function isPathAllowedByScope(normalizedCandidate: string, allowedFileScope: string[]) {
  if (allowedFileScope.length === 0) {
    return true;
  }

  return allowedFileScope.some((entry) => {
    const normalizedEntry = entry.replace(/\\/g, "/").replace(/^\.\//, "").trim();
    return normalizedCandidate === normalizedEntry
      || (normalizedEntry.endsWith("/") && normalizedCandidate.startsWith(normalizedEntry));
  });
}

function tokenizeShellCommand(command: string) {
  return command.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
}

function looksLikePathToken(token: string) {
  const normalized = normalizePathCandidate(token);
  return normalized.startsWith("..")
    || normalized.startsWith("~/")
    || normalized === "~"
    || path.isAbsolute(normalized);
}

function assertCommandWithinWorkingDirectory(command: string, workingDirectory: string) {
  const tokens = tokenizeShellCommand(command).map((token) => stripShellQuotes(token));

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;

    if (token === "cd" && index + 1 < tokens.length) {
      assertPathWithinWorkingDirectory(tokens[index + 1]!, workingDirectory, "bash");
      continue;
    }

    if (token === "git" && tokens[index + 1] === "-C" && index + 2 < tokens.length) {
      assertPathWithinWorkingDirectory(tokens[index + 2]!, workingDirectory, "bash");
      continue;
    }

    if (token === "git" && index + 1 < tokens.length) {
      assertTitanGitCommandAllowed(tokens.slice(index + 1));
      continue;
    }

    if (looksLikePathToken(token)) {
      assertPathWithinWorkingDirectory(token, workingDirectory, "bash");
    }
  }
}

function extractAllowedFileScopeFromPrompt(prompt: string): string[] {
  const match = prompt.match(/^Allowed file scope:\s*(.+)$/im);
  if (!match) {
    return [];
  }

  return match[1]!
    .split(",")
    .map((entry) => entry.replace(/\\/g, "/").replace(/^\.\//, "").trim())
    .filter((entry) => entry.length > 0);
}

function normalizeExecutableToken(token: string) {
  return path.basename(stripShellQuotes(token)).replace(/\.(cmd|exe|ps1|bat)$/i, "").toLowerCase();
}

function isPackageInstallCommand(tokens: string[]) {
  for (let index = 0; index < tokens.length; index += 1) {
    const executable = normalizeExecutableToken(tokens[index]!);
    const subcommand = tokens[index + 1]?.toLowerCase();

    if (executable === "npm" && (
      subcommand === "install"
      || subcommand === "i"
      || subcommand === "add"
      || subcommand === "ci"
      || subcommand === "create"
      || subcommand === "init"
      || subcommand === "exec"
      || subcommand === "x"
      || subcommand === "update"
      || subcommand === "remove"
      || subcommand === "uninstall"
    )) {
      return true;
    }

    if ((executable === "pnpm" || executable === "yarn" || executable === "bun") && (
      subcommand === "install"
      || subcommand === "add"
      || subcommand === "create"
      || subcommand === "init"
      || subcommand === "exec"
      || subcommand === "x"
      || subcommand === "update"
      || subcommand === "remove"
      || subcommand === "uninstall"
    )) {
      return true;
    }
  }

  return false;
}

function scopeAllowsPackageMutation(allowedFileScope: string[]) {
  if (allowedFileScope.length === 0) {
    return true;
  }

  const packageFiles = new Set([
    "package.json",
    "package-lock.json",
    "npm-shrinkwrap.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "bun.lock",
    "bun.lockb",
  ]);

  return allowedFileScope.some((entry) => packageFiles.has(entry));
}

function assertPackageCommandAllowed(command: string, allowedFileScope: string[]) {
  const tokens = tokenizeShellCommand(command).map((token) => stripShellQuotes(token));
  if (!isPackageInstallCommand(tokens) || scopeAllowsPackageMutation(allowedFileScope)) {
    return;
  }

  throw new Error(
    "Titan package install requires package files in allowed scope.",
  );
}

function assertTerminalOnlyCommand(command: string) {
  const tokens = tokenizeShellCommand(command).map((token) => stripShellQuotes(token));
  for (const token of tokens) {
    const executable = normalizeExecutableToken(token);
    if (/\.ps1$/i.test(token)) {
      throw new Error("Titan bash command cannot invoke PowerShell scripts directly; use .cmd launchers.");
    }
    if (executable === "start" || executable === "start-process" || executable === "invoke-item" || executable === "ii") {
      throw new Error("Titan bash command cannot launch GUI/open/start commands.");
    }
  }
}

export function isForbiddenLongRunningShellCommand(command: string) {
  const normalized = command.replace(/\\/g, "/").replace(/\s+/g, " ").trim().toLowerCase();
  return /\b(npm|npm\.cmd|pnpm|pnpm\.cmd|yarn|yarn\.cmd|bun|bun\.cmd)\s+run\s+(dev|preview|start)\b/.test(normalized)
    || /\b(npm|npm\.cmd|pnpm|pnpm\.cmd|yarn|yarn\.cmd|bun|bun\.cmd)\s+(dev|preview|start)\b/.test(normalized)
    || /\b(vite|next|astro)\s+dev\b/.test(normalized)
    || /\b(vite|vite\.cmd|vite\.js)\s+(--host|--port|dev|preview|serve)\b/.test(normalized)
    || /node_modules\/(\.bin\/)?vite\b.*\s(dev|preview|serve|--host|--port)\b/.test(normalized)
    || /vite\/bin\/vite\.js\b.*\s(dev|preview|serve|--host|--port)\b/.test(normalized)
    || /\b(vitest|tsc)\b.*\s--watch\b/.test(normalized)
    || /\bwebpack\s+serve\b/.test(normalized);
}

function assertNoLongRunningShellCommand(command: string) {
  if (!isForbiddenLongRunningShellCommand(command)) {
    return;
  }

  throw new Error(
    "Titan bash command cannot run dev, preview, watch, or server processes; use finite build/test checks.",
  );
}

function readGitChangedFiles(workingDirectory: string) {
  const probe = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], {
    cwd: workingDirectory,
    encoding: "utf8",
    windowsHide: true,
  });
  if (probe.status !== 0) {
    return [];
  }

  return probe.stdout
    .split(/\r?\n/)
    .map((line) => line.slice(3).trim())
    .filter((line) => line.length > 0)
    .map((line) => line.includes(" -> ") ? line.split(" -> ").at(-1)! : line)
    .map((line) => line.replace(/\\/g, "/").replace(/^\.\//, ""));
}

function assertBashDidNotDirtyOutOfScope(workingDirectory: string, allowedFileScope: string[]) {
  if (allowedFileScope.length === 0) {
    return;
  }

  const outOfScope = readGitChangedFiles(workingDirectory)
    .filter((file) => !isPathAllowedByScope(file, allowedFileScope));
  if (outOfScope.length === 0) {
    return;
  }

  throw new Error(
    `Titan bash command changed files outside allowed scope: ${outOfScope.join(", ")}`,
  );
}

function assertTitanGitCommandAllowed(args: string[]) {
  const subcommand = args.find((arg) => !arg.startsWith("-"));
  if (!subcommand) {
    return;
  }

  const forbiddenSubcommands = new Set([
    "branch",
    "checkout",
    "merge",
    "pull",
    "push",
    "rebase",
    "reset",
    "switch",
    "worktree",
  ]);
  if (!forbiddenSubcommands.has(subcommand)) {
    return;
  }

  throw new Error(
    `Titan bash command cannot change git branch state: git ${subcommand}`,
  );
}

function wrapTitanFileTool<TTool extends { name: string; execute: (...args: any[]) => any }>(
  tool: TTool,
  workingDirectory: string,
  options: {
    allowedFileScope?: string[];
    enforceAllowedScope?: boolean;
  } = {},
) {
  return {
    ...tool,
    async execute(toolCallId: string, params: { path?: string }, signal: AbortSignal | undefined, onUpdate: unknown) {
      let normalizedParams = params;
      if (typeof params?.path === "string") {
        assertPathWithinWorkingDirectory(params.path, workingDirectory, tool.name);
        if (options.enforceAllowedScope) {
          assertPathWithinAllowedFileScope(
            params.path,
            workingDirectory,
            options.allowedFileScope ?? [],
            tool.name,
          );
        }
        normalizedParams = {
          ...params,
          path: resolvePathWithinWorkingDirectory(params.path, workingDirectory),
        };
      }

      return tool.execute(toolCallId, normalizedParams, signal, onUpdate);
    },
  };
}

function wrapTitanBashTool<TTool extends { execute: (...args: any[]) => any }>(
  tool: TTool,
  workingDirectory: string,
  allowedFileScope: string[],
) {
  return {
    ...tool,
    async execute(
      toolCallId: string,
      params: { command?: string },
      signal: AbortSignal | undefined,
      onUpdate: unknown,
    ) {
      if (typeof params?.command === "string") {
        assertCommandWithinWorkingDirectory(params.command, workingDirectory);
        assertTerminalOnlyCommand(params.command);
        assertNoLongRunningShellCommand(params.command);
        assertPackageCommandAllowed(params.command, allowedFileScope);
      }

      const result = await tool.execute(toolCallId, params, signal, onUpdate);
      if (typeof params?.command === "string") {
        assertBashDidNotDirtyOutOfScope(workingDirectory, allowedFileScope);
      }
      return result;
    },
  };
}

function resolveTools(
  piCodingAgent: PiCodingAgentModule,
  caste: CasteName,
  workingDirectory: string,
  prompt: string,
) {
  if (caste === "titan") {
    const allowedFileScope = extractAllowedFileScopeFromPrompt(prompt);
    return [
      wrapTitanFileTool(piCodingAgent.createReadTool(workingDirectory), workingDirectory),
      wrapTitanBashTool(
        piCodingAgent.createBashTool(workingDirectory, HIDDEN_BASH_TOOL_OPTIONS),
        workingDirectory,
        allowedFileScope,
      ),
      wrapTitanFileTool(piCodingAgent.createEditTool(workingDirectory), workingDirectory, {
        allowedFileScope,
        enforceAllowedScope: true,
      }),
      wrapTitanFileTool(piCodingAgent.createWriteTool(workingDirectory), workingDirectory, {
        allowedFileScope,
        enforceAllowedScope: true,
      }),
    ];
  }

  return [
    piCodingAgent.createReadTool(workingDirectory),
    piCodingAgent.createFindTool(workingDirectory, { operations: HIDDEN_FIND_OPERATIONS }),
    piCodingAgent.createLsTool(workingDirectory),
    piCodingAgent.createGrepTool(workingDirectory),
  ];
}

interface CasteToolContract {
  label: string;
  toolName: string;
  createTool: () => ToolDefinition;
  enforcePayloadContract: (payload: unknown) => unknown | undefined;
  extractStructuredOutput: (event: AgentSessionEvent) => string | null;
}

const CASTE_TOOL_CONTRACTS: Record<CasteName, CasteToolContract> = {
  oracle: {
    label: "Oracle",
    toolName: ORACLE_EMIT_ASSESSMENT_TOOL_NAME,
    createTool: createOracleEmitAssessmentTool,
    enforcePayloadContract: enforceOracleToolPayloadContract,
    extractStructuredOutput(event) {
      const assessment = extractOracleAssessmentFromToolEvent(event);
      return assessment ? stringifyOracleAssessment(assessment) : null;
    },
  },
  titan: {
    label: "Titan",
    toolName: TITAN_EMIT_ARTIFACT_TOOL_NAME,
    createTool: createTitanEmitArtifactTool,
    enforcePayloadContract: enforceTitanToolPayloadContract,
    extractStructuredOutput(event) {
      const artifact = extractTitanArtifactFromToolEvent(event);
      return artifact ? stringifyTitanArtifact(artifact) : null;
    },
  },
  sentinel: {
    label: "Sentinel",
    toolName: SENTINEL_EMIT_VERDICT_TOOL_NAME,
    createTool: createSentinelEmitVerdictTool,
    enforcePayloadContract: enforceSentinelToolPayloadContract,
    extractStructuredOutput(event) {
      const verdict = extractSentinelVerdictFromToolEvent(event);
      return verdict ? stringifySentinelVerdict(verdict) : null;
    },
  },
  janus: {
    label: "Janus",
    toolName: JANUS_EMIT_RESOLUTION_TOOL_NAME,
    createTool: createJanusEmitResolutionTool,
    enforcePayloadContract: enforceJanusToolPayloadContract,
    extractStructuredOutput(event) {
      const artifact = extractJanusResolutionFromToolEvent(event);
      return artifact ? stringifyJanusResolutionArtifact(artifact) : null;
    },
  },
};

function resolveCustomTools(caste: CasteName): ToolDefinition[] {
  return [CASTE_TOOL_CONTRACTS[caste].createTool()];
}

function installPayloadContractHook(
  contract: CasteToolContract,
  session: Awaited<ReturnType<PiCodingAgentModule["createAgentSession"]>>["session"],
  shouldEnforce: () => boolean,
) {

  const existingOnPayload = session.agent.onPayload;
  session.agent.onPayload = async (payload, model) => {
    const existingPayload = existingOnPayload
      ? await existingOnPayload(payload, model)
      : undefined;
    const effectivePayload = existingPayload === undefined ? payload : existingPayload;
    if (!shouldEnforce()) {
      if (existingPayload !== undefined) {
        return effectivePayload;
      }

      return undefined;
    }
    const enforcedPayload = contract.enforcePayloadContract(effectivePayload);

    if (enforcedPayload !== undefined) {
      return enforcedPayload;
    }

    if (existingPayload !== undefined) {
      return effectivePayload;
    }

    return undefined;
  };
}

function createContractRepairPrompt(contract: CasteToolContract) {
  return [
    `Tool contract repair required: no '${contract.toolName}' output was captured.`,
    `Call '${contract.toolName}' now with the final artifact payload.`,
    "Do not call any other tools.",
    "Do not return prose or markdown.",
  ].join("\n");
}

async function createIsolatedResourceLoader(
  piCodingAgent: PiCodingAgentModule,
  workingDirectory: string,
) {
  const resourceLoader = new piCodingAgent.DefaultResourceLoader({
    cwd: workingDirectory,
    noExtensions: true,
    skillsOverride: () => ({ skills: [], diagnostics: [] }),
    agentsFilesOverride: () => ({ agentsFiles: [] }),
    promptsOverride: () => ({ prompts: [], diagnostics: [] }),
    systemPromptOverride: () => "You are an Aegis caste subagent. Follow the user prompt exactly and use only the provided tools.",
  });
  await resourceLoader.reload();
  return resourceLoader;
}

export class PiCasteRuntime implements CasteRuntime {
  private readonly sessionTimeoutMs: number;
  private readonly sessionTimeoutMsByCaste: Record<CasteName, number>;
  private readonly timeoutRetryCount: number;
  private readonly timeoutRetryDelayMs: number;

  constructor(
    private readonly modelConfigs: Partial<Record<CasteName, ResolvedConfiguredCasteModel>> = {},
    options: {
      sessionTimeoutMs?: number;
      sessionTimeoutMsByCaste?: Partial<Record<CasteName, number>>;
      timeoutRetryCount?: number;
      timeoutRetryDelayMs?: number;
    } = {},
  ) {
    this.sessionTimeoutMs = Math.max(1, options.sessionTimeoutMs ?? DEFAULT_PI_SESSION_TIMEOUT_MS);
    const hasGlobalTimeoutOverride = options.sessionTimeoutMs !== undefined;
    this.sessionTimeoutMsByCaste = {
      oracle: Math.max(
        1,
        options.sessionTimeoutMsByCaste?.oracle
          ?? (hasGlobalTimeoutOverride ? this.sessionTimeoutMs : DEFAULT_PI_SESSION_TIMEOUT_BY_CASTE.oracle),
      ),
      titan: Math.max(
        1,
        options.sessionTimeoutMsByCaste?.titan
          ?? (hasGlobalTimeoutOverride ? this.sessionTimeoutMs : DEFAULT_PI_SESSION_TIMEOUT_BY_CASTE.titan),
      ),
      sentinel: Math.max(
        1,
        options.sessionTimeoutMsByCaste?.sentinel
          ?? (hasGlobalTimeoutOverride ? this.sessionTimeoutMs : DEFAULT_PI_SESSION_TIMEOUT_BY_CASTE.sentinel),
      ),
      janus: Math.max(
        1,
        options.sessionTimeoutMsByCaste?.janus
          ?? (hasGlobalTimeoutOverride ? this.sessionTimeoutMs : DEFAULT_PI_SESSION_TIMEOUT_BY_CASTE.janus),
      ),
    };
    this.timeoutRetryCount = Math.max(0, options.timeoutRetryCount ?? DEFAULT_PI_TIMEOUT_RETRY_COUNT);
    this.timeoutRetryDelayMs = Math.max(0, options.timeoutRetryDelayMs ?? DEFAULT_PI_TIMEOUT_RETRY_DELAY_MS);
  }

  private getSessionTimeoutMs(caste: CasteName): number {
    return this.sessionTimeoutMsByCaste[caste] ?? this.sessionTimeoutMs;
  }

  async run(input: CasteRunInput): Promise<CasteSessionResult> {
    const piCodingAgent = await loadPiCodingAgentModule();
    const modelConfig = this.modelConfigs[input.caste];
    if (!modelConfig) {
      throw new Error(`Missing configured Pi model for caste "${input.caste}".`);
    }

    const maxAttempts = this.timeoutRetryCount + 1;
    let latestResult: CasteSessionResult | null = null;
    const sessionTimeoutMs = this.getSessionTimeoutMs(input.caste);

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const attemptResult = await this.runSingleAttempt(
        input,
        piCodingAgent,
        modelConfig,
        sessionTimeoutMs,
      );
      latestResult = attemptResult;

      const timedOut = attemptResult.status === "failed"
        && typeof attemptResult.error === "string"
        && attemptResult.error.includes(`Pi ${input.caste} session timed out`);
      const hasRetry = attempt < maxAttempts;

      if (!timedOut || !hasRetry) {
        return attemptResult;
      }

      if (this.timeoutRetryDelayMs > 0) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, this.timeoutRetryDelayMs);
        });
      }
    }

    return latestResult ?? {
      sessionId: "unknown",
      caste: input.caste,
      modelRef: modelConfig.reference,
      provider: modelConfig.provider,
      modelId: modelConfig.modelId,
      thinkingLevel: modelConfig.thinkingLevel,
      status: "failed",
      outputText: "",
      toolsUsed: [],
      messageLog: [{
        role: "user",
        content: input.prompt,
      }],
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      error: `Pi ${input.caste} session failed without result.`,
    };
  }

  private async runSingleAttempt(
    input: CasteRunInput,
    piCodingAgent: PiCodingAgentModule,
    modelConfig: ResolvedConfiguredCasteModel,
    sessionTimeoutMs: number,
  ): Promise<CasteSessionResult> {
    const startedAt = new Date().toISOString();
    const messageLog: CasteSessionMessage[] = [{
      role: "user",
      content: input.prompt,
    }];
    const toolContract = CASTE_TOOL_CONTRACTS[input.caste];
    const baseTools = resolveTools(piCodingAgent, input.caste, input.workingDirectory, input.prompt);
    const customTools = resolveCustomTools(input.caste);
    const activeToolNames = [...new Set([
      ...baseTools.map((tool) => tool.name),
      ...customTools.map((tool) => tool.name),
    ])];
    const resourceLoader = await createIsolatedResourceLoader(piCodingAgent, input.workingDirectory);
    const { session } = await piCodingAgent.createAgentSession({
      cwd: input.workingDirectory,
      model: modelConfig.model,
      thinkingLevel: modelConfig.thinkingLevel,
      tools: baseTools,
      customTools,
      resourceLoader,
    });
    session.setActiveToolsByName(activeToolNames);
    let enforceContractPayload = false;
    installPayloadContractHook(toolContract, session, () => enforceContractPayload);
    const messages: string[] = [];
    const toolsUsed: string[] = [];
    let structuredOutput: string | null = null;

    try {
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        let repairAttempted = false;
        let sessionTimeout: ReturnType<typeof setTimeout> | null = null;
        let unsubscribe: () => void = () => undefined;

        const settle = (action: () => void) => {
          if (settled) {
            return;
          }

          settled = true;
          if (sessionTimeout) {
            clearTimeout(sessionTimeout);
            sessionTimeout = null;
          }
          unsubscribe();
          action();
        };

        const refreshSessionTimeout = () => {
          if (sessionTimeout) {
            clearTimeout(sessionTimeout);
          }

          sessionTimeout = setTimeout(() => {
            void session.abort().catch(() => undefined);
            settle(() => {
              reject(new Error(
                `Pi ${input.caste} session timed out after ${sessionTimeoutMs}ms.`,
              ));
            });
          }, sessionTimeoutMs);
        };

        unsubscribe = session.subscribe((event: AgentSessionEvent) => {
          refreshSessionTimeout();
          const casteOutput = toolContract.extractStructuredOutput(event);
          if (casteOutput) {
            structuredOutput = casteOutput;
            settle(() => {
              resolve();
            });
            return;
          }

          if (event.type === "tool_execution_start") {
            toolsUsed.push(event.toolName);
            return;
          }

          const text = extractAssistantText(event);
          const role = extractMessageRole(event);
          if (text.length > 0) {
            messages.push(text);
            if (role) {
              messageLog.push({
                role,
                content: text,
              });
            }
            return;
          }

          if (event.type === "agent_end") {
            const state = session.state as { error?: string | null };
            if (state.error) {
              const errorMessage = typeof state.error === "string"
                ? state.error
                : "Unknown Pi session error.";
              settle(() => {
                reject(new Error(errorMessage));
              });
              return;
            }

            if (structuredOutput) {
              settle(() => {
                resolve();
              });
              return;
            }

            if (!repairAttempted) {
              repairAttempted = true;
              enforceContractPayload = true;
              const repairPrompt = createContractRepairPrompt(toolContract);
              messageLog.push({
                role: "user",
                content: repairPrompt,
              });

              void session.prompt(repairPrompt, { streamingBehavior: "followUp" }).catch((error: unknown) => {
                settle(() => {
                  reject(error);
                });
              });
              return;
            }

            settle(() => {
              reject(new Error(
                `${toolContract.label} tool contract violation: missing '${toolContract.toolName}' output.`,
              ));
            });
          }
        });

        refreshSessionTimeout();
        void session.prompt(input.prompt).catch((error: unknown) => {
          settle(() => {
            reject(error);
          });
        });
      });

      return {
        sessionId: session.sessionId,
        caste: input.caste,
        modelRef: modelConfig.reference,
        provider: modelConfig.provider,
        modelId: modelConfig.modelId,
        thinkingLevel: modelConfig.thinkingLevel,
        status: "succeeded",
        outputText: structuredOutput ?? messages.at(-1) ?? "",
        toolsUsed,
        messageLog,
        startedAt,
        finishedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        sessionId: session.sessionId,
        caste: input.caste,
        modelRef: modelConfig.reference,
        provider: modelConfig.provider,
        modelId: modelConfig.modelId,
        thinkingLevel: modelConfig.thinkingLevel,
        status: "failed",
        outputText: structuredOutput ?? messages.at(-1) ?? "",
        toolsUsed,
        messageLog,
        startedAt,
        finishedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      session.dispose();
      terminateWorkspaceProcesses(input.workingDirectory);
    }
  }
}
