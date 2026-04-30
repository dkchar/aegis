import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

import type {
  CasteName,
  CasteRunInput,
  CasteRuntime,
  CasteSessionResult,
} from "./caste-runtime.js";
import type { AegisThinkingLevel } from "../config/schema.js";
import { createCasteConfig, type CasteConfigRecord } from "../config/caste-config.js";

interface CodexModelConfig {
  reference: string;
  provider: string;
  modelId: string;
  thinkingLevel: AegisThinkingLevel;
}

interface CodexRunRequest {
  cwd: string;
  modelId: string;
  thinkingLevel: AegisThinkingLevel;
  prompt: string;
  outputPath: string;
  timeoutMs: number;
}

interface CodexRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export interface CodexCasteRuntimeOptions {
  sessionTimeoutMs?: number;
  runner?: (request: CodexRunRequest) => Promise<CodexRunResult>;
}

const DEFAULT_CODEX_SESSION_TIMEOUT_MS = 1_800_000;

function parseModelReference(reference: string, thinkingLevel: AegisThinkingLevel): CodexModelConfig {
  const separator = reference.indexOf(":");
  if (separator === -1) {
    return {
      reference,
      provider: "openai-codex",
      modelId: reference,
      thinkingLevel,
    };
  }

  return {
    reference,
    provider: reference.slice(0, separator),
    modelId: reference.slice(separator + 1),
    thinkingLevel,
  };
}

function defaultModelConfigs() {
  return createCasteConfig(() => ({
    reference: "openai-codex:gpt-5.4-mini",
    provider: "openai-codex",
    modelId: "gpt-5.4-mini",
    thinkingLevel: "medium" as const,
  }));
}

function quotePowerShellString(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function resolveCodexSandboxMode(platform: NodeJS.Platform) {
  return platform === "win32" ? "danger-full-access" : "workspace-write";
}

function normalizeProcessPath(candidate: string, platform: NodeJS.Platform) {
  const normalized = (platform === "win32"
    ? path.win32.resolve(candidate)
    : path.posix.resolve(candidate)).replace(/\\/g, "/");
  return platform === "win32" ? normalized.toLowerCase() : normalized;
}

function commandLineContainsWorkspace(commandLine: string, workspace: string) {
  let searchFrom = 0;
  while (searchFrom < commandLine.length) {
    const index = commandLine.indexOf(workspace, searchFrom);
    if (index === -1) {
      return false;
    }
    const next = commandLine[index + workspace.length];
    if (next === undefined || next === "/" || next === "\"" || next === "'" || /\s/.test(next)) {
      return true;
    }
    searchFrom = index + workspace.length;
  }
  return false;
}

function resolveWindowsCommandPath(commandName: string) {
  const result = spawnSync("where.exe", [commandName], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    return null;
  }

  return result.stdout
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry.toLowerCase().endsWith(`\\${commandName.toLowerCase()}`))
    ?? null;
}

function writeCommandShim(shimDirectory: string, commandName: string, targetPath: string) {
  mkdirSync(shimDirectory, { recursive: true });
  writeFileSync(
    path.join(shimDirectory, commandName),
    [
      "@echo off",
      `"${targetPath}" %*`,
      "",
    ].join("\r\n"),
    "utf8",
  );
}

function writeRipgrepShim(shimDirectory: string, targetPath: string) {
  mkdirSync(shimDirectory, { recursive: true });
  writeFileSync(
    path.join(shimDirectory, "rg.cmd"),
    [
      "@echo off",
      `"${targetPath}" %*`,
      "if %ERRORLEVEL% EQU 1 exit /B 0",
      "exit /B %ERRORLEVEL%",
      "",
    ].join("\r\n"),
    "utf8",
  );
}

export function buildCodexRunEnvironment(
  baseEnv: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  resolveCommandPath: (commandName: string) => string | null = resolveWindowsCommandPath,
  shimDirectory = path.join(tmpdir(), "aegis-codex-runtime", "cmd-shims"),
) {
  if (platform !== "win32") {
    return baseEnv;
  }

  let wroteShim = false;
  for (const commandName of ["npm.cmd", "npx.cmd"]) {
    const targetPath = resolveCommandPath(commandName);
    if (!targetPath) {
      continue;
    }
    writeCommandShim(shimDirectory, commandName, targetPath);
    wroteShim = true;
  }
  const ripgrepPath = resolveCommandPath("rg.exe");
  if (ripgrepPath) {
    writeRipgrepShim(shimDirectory, ripgrepPath);
    wroteShim = true;
  }

  if (!wroteShim) {
    return baseEnv;
  }

  const currentPath = baseEnv.Path ?? baseEnv.PATH ?? "";
  return {
    ...baseEnv,
    Path: `${shimDirectory}${path.delimiter}${currentPath}`,
  };
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
  return commandLineContainsWorkspace(comparableCommand, workspace);
}

export function isForbiddenLongRunningWorkspaceCommand(commandLine: string) {
  const normalized = commandLine.replace(/\\/g, "/").replace(/\s+/g, " ").trim().toLowerCase();
  return /\b(npm|npm\.cmd|pnpm|pnpm\.cmd|yarn|yarn\.cmd|bun|bun\.cmd)\s+run\s+(dev|preview|start)\b/.test(normalized)
    || /\b(npm|npm\.cmd|pnpm|pnpm\.cmd|yarn|yarn\.cmd|bun|bun\.cmd)\s+(dev|preview|start)\b/.test(normalized)
    || /\b(vite|next|astro)\s+dev\b/.test(normalized)
    || /node_modules\/(\.bin\/)?vite\b.*\s(dev|preview|serve|--host|--port)\b/.test(normalized)
    || /vite\/bin\/vite\.js\b.*\s(dev|preview|serve|--host|--port)\b/.test(normalized)
    || /\b(vitest|tsc)\b.*\s--watch\b/.test(normalized)
    || /\bwebpack\s+serve\b/.test(normalized);
}

function findForbiddenWorkspaceProcess(
  workingDirectory: string,
  platform: NodeJS.Platform = process.platform,
) {
  if (platform === "win32") {
    const script = [
      "$ErrorActionPreference = 'SilentlyContinue'",
      "Get-CimInstance Win32_Process | ForEach-Object {",
      "  if ($_.CommandLine) { [Console]::Out.WriteLine(([string]$_.ProcessId) + \"`t\" + $_.CommandLine) }",
      "}",
    ].join("\n");
    const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      encoding: "utf8",
      windowsHide: true,
    });
    if (result.status !== 0) {
      return null;
    }
    for (const line of result.stdout.split(/\r?\n/)) {
      const separator = line.indexOf("\t");
      if (separator === -1) {
        continue;
      }
      const commandLine = line.slice(separator + 1);
      if (
        commandLineReferencesWorkspace(commandLine, workingDirectory, platform)
        && isForbiddenLongRunningWorkspaceCommand(commandLine)
      ) {
        return commandLine;
      }
    }
    return null;
  }

  const ps = spawnSync("ps", ["-eo", "pid=,command="], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (ps.status !== 0) {
    return null;
  }
  for (const line of ps.stdout.split(/\r?\n/)) {
    const match = line.trim().match(/^(\d+)\s+(.+)$/);
    if (!match) {
      continue;
    }
    const commandLine = match[2] ?? "";
    if (
      commandLineReferencesWorkspace(commandLine, workingDirectory, platform)
      && isForbiddenLongRunningWorkspaceCommand(commandLine)
    ) {
      return commandLine;
    }
  }
  return null;
}

export function buildTerminateWorkspaceProcessesScript(workingDirectory: string) {
  const workspace = normalizeProcessPath(workingDirectory, "win32");
  const rawWorkspace = path.resolve(workingDirectory);
  return [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `$workspace = ${JSON.stringify(workspace)}`,
    `$rawWorkspace = ${JSON.stringify(rawWorkspace)}`,
    "$current = $PID",
    "$forbiddenPatterns = @(",
    "  '\\b(npm|npm\\.cmd|pnpm|pnpm\\.cmd|yarn|yarn\\.cmd|bun|bun\\.cmd)\\s+run\\s+(dev|preview|start)\\b',",
    "  '\\b(npm|npm\\.cmd|pnpm|pnpm\\.cmd|yarn|yarn\\.cmd|bun|bun\\.cmd)\\s+(dev|preview|start)\\b',",
    "  '\\b(vite|next|astro)\\s+dev\\b',",
    "  'node_modules/(\\.bin/)?vite\\b.*\\s(dev|preview|serve|--host|--port)\\b',",
    "  'vite/bin/vite\\.js\\b.*\\s(dev|preview|serve|--host|--port)\\b',",
    "  '\\b(vitest|tsc)\\b.*\\s--watch\\b',",
    "  '\\bwebpack\\s+serve\\b'",
    ")",
    "Get-CimInstance Win32_Process | Where-Object {",
    "  if ($_.ProcessId -eq $current -or -not $_.CommandLine) { return $false }",
    "  $normalized = ($_.CommandLine.Replace('\\','/').ToLowerInvariant() -replace '\\s+', ' ').Trim()",
    "  $matchesWorkspace = $_.CommandLine.ToLowerInvariant().Contains($rawWorkspace.ToLowerInvariant()) -or $normalized.Contains($workspace)",
    "  if (-not $matchesWorkspace) { return $false }",
    "  foreach ($pattern in $forbiddenPatterns) { if ($normalized -match $pattern) { return $true } }",
    "  return $false",
    "} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
  ].join("\n");
}

export function buildTerminateCodexSessionProcessesScript(workingDirectory: string) {
  const workspace = normalizeProcessPath(workingDirectory, "win32");
  const rawWorkspace = path.resolve(workingDirectory);
  return [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `$workspace = ${JSON.stringify(workspace)}`,
    `$rawWorkspace = ${JSON.stringify(rawWorkspace)}`,
    "$current = $PID",
    "Get-CimInstance Win32_Process | Where-Object {",
    "  if ($_.ProcessId -eq $current -or -not $_.CommandLine) { return $false }",
    "  $normalized = ($_.CommandLine.Replace('\\','/').ToLowerInvariant() -replace '\\s+', ' ').Trim()",
    "  $matchesWorkspace = $_.CommandLine.ToLowerInvariant().Contains($rawWorkspace.ToLowerInvariant()) -or $normalized.Contains($workspace)",
    "  if (-not $matchesWorkspace) { return $false }",
    "  return $normalized -match '\\bcodex(\\.cmd|\\.exe|\\.js)?\\b'",
    "} | ForEach-Object { taskkill /PID $_.ProcessId /T /F | Out-Null }",
  ].join("\n");
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

export function terminateWorkspaceProcesses(
  workingDirectory: string,
  platform: NodeJS.Platform = process.platform,
) {
  if (platform === "win32") {
    spawnSync("powershell.exe", ["-NoProfile", "-Command", buildTerminateWorkspaceProcessesScript(workingDirectory)], {
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
    if (
      pid > 0
      && pid !== process.pid
      && commandLineReferencesWorkspace(commandLine, workingDirectory, platform)
      && isForbiddenLongRunningWorkspaceCommand(commandLine)
    ) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // Ignore missing process.
      }
    }
  }
}

export function terminateCodexSessionProcesses(
  workingDirectory: string,
  platform: NodeJS.Platform = process.platform,
) {
  if (platform === "win32") {
    spawnSync("powershell.exe", ["-NoProfile", "-Command", buildTerminateCodexSessionProcessesScript(workingDirectory)], {
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
    if (
      pid > 0
      && pid !== process.pid
      && commandLineReferencesWorkspace(commandLine, workingDirectory, platform)
      && /\bcodex(\.cmd|\.exe|\.js)?\b/i.test(commandLine)
    ) {
      terminateProcessTree(pid);
    }
  }
}

export function buildCodexExecArgs(
  request: CodexRunRequest,
  platform: NodeJS.Platform = process.platform,
): string[] {
  return [
    "-a",
    "never",
    "exec",
    "-C",
    request.cwd,
    "-s",
    resolveCodexSandboxMode(platform),
    "-m",
    request.modelId,
    "-c",
    `model_reasoning_effort="${request.thinkingLevel}"`,
    "--ignore-user-config",
    "--ignore-rules",
    "--json",
    "--output-last-message",
    request.outputPath,
    "-",
  ];
}

export function buildCodexSpawnInvocation(
  codexArgs: string[],
  platform: NodeJS.Platform = process.platform,
) {
  if (platform === "win32") {
    return {
      command: "powershell.exe",
      args: [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        `& 'codex.cmd' ${codexArgs.map(quotePowerShellString).join(" ")}; exit $LASTEXITCODE`,
      ],
    };
  }

  return {
    command: "codex",
    args: codexArgs,
  };
}

function runCodexExec(request: CodexRunRequest): Promise<CodexRunResult> {
  return new Promise((resolve) => {
    const invocation = buildCodexSpawnInvocation(buildCodexExecArgs(request));
    const child = spawn(invocation.command, invocation.args, {
      cwd: request.cwd,
      env: buildCodexRunEnvironment(),
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timeout: ReturnType<typeof setTimeout>;
    let workspaceMonitor: ReturnType<typeof setInterval>;
    const scheduleInactivityTimeout = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        if (typeof child.pid === "number") {
          terminateProcessTree(child.pid);
        } else {
          child.kill("SIGKILL");
        }
        settle({
          exitCode: 1,
          stdout,
          stderr: `${stderr}${stderr.length > 0 ? "\n" : ""}Codex session timed out after ${request.timeoutMs}ms without output.`,
        });
      }, request.timeoutMs);
    };
    const settle = (result: CodexRunResult) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      clearInterval(workspaceMonitor);
      cleanup();
      resolve(result);
    };
    const cleanup = () => {
      terminateWorkspaceProcesses(request.cwd);
    };
    scheduleInactivityTimeout();
    workspaceMonitor = setInterval(() => {
      const forbiddenCommand = findForbiddenWorkspaceProcess(request.cwd);
      if (!forbiddenCommand) {
        return;
      }
      if (typeof child.pid === "number") {
        terminateProcessTree(child.pid);
      } else {
        child.kill("SIGKILL");
      }
      settle({
        exitCode: 1,
        stdout,
        stderr: `${stderr}${stderr.length > 0 ? "\n" : ""}Codex session launched forbidden long-running workspace process: ${forbiddenCommand}`,
      });
    }, 5_000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      scheduleInactivityTimeout();
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      scheduleInactivityTimeout();
      stderr += chunk;
    });
    child.on("error", (error) => {
      settle({
        exitCode: 1,
        stdout,
        stderr: `${stderr}${stderr.length > 0 ? "\n" : ""}${error.message}`,
      });
    });
    child.on("close", (exitCode) => {
      settle({ exitCode, stdout, stderr });
    });
    child.stdin.end(request.prompt);
  });
}

export class CodexCasteRuntime implements CasteRuntime {
  private readonly modelConfigs: CasteConfigRecord<CodexModelConfig>;
  private readonly sessionTimeoutMs: number;
  private readonly runner: (request: CodexRunRequest) => Promise<CodexRunResult>;

  constructor(
    modelConfigs: Partial<CasteConfigRecord<CodexModelConfig>> = {},
    options: CodexCasteRuntimeOptions = {},
  ) {
    this.modelConfigs = {
      ...defaultModelConfigs(),
      ...modelConfigs,
    };
    this.sessionTimeoutMs = options.sessionTimeoutMs ?? DEFAULT_CODEX_SESSION_TIMEOUT_MS;
    this.runner = options.runner ?? runCodexExec;
  }

  async run(input: CasteRunInput): Promise<CasteSessionResult> {
    const sessionId = randomUUID();
    const startedAt = new Date().toISOString();
    const modelConfig = this.modelConfigs[input.caste];
    const outputDirectory = path.join(tmpdir(), "aegis-codex-runtime");
    mkdirSync(outputDirectory, { recursive: true });
    const outputPath = path.join(outputDirectory, `${sessionId}.txt`);
    writeFileSync(outputPath, "", "utf8");

    const result = await this.runner({
      cwd: input.workingDirectory,
      modelId: modelConfig.modelId,
      thinkingLevel: modelConfig.thinkingLevel,
      prompt: input.prompt,
      outputPath,
      timeoutMs: this.sessionTimeoutMs,
    });
    const finishedAt = new Date().toISOString();
    const outputText = readFileSync(outputPath, "utf8").trim();
    rmSync(outputPath, { force: true });
    const error = result.exitCode === 0
      ? undefined
      : [result.stderr.trim(), result.stdout.trim()].filter((chunk) => chunk.length > 0).join("\n");

    return {
      sessionId,
      caste: input.caste,
      modelRef: modelConfig.reference,
      provider: modelConfig.provider,
      modelId: modelConfig.modelId,
      thinkingLevel: modelConfig.thinkingLevel,
      status: result.exitCode === 0 ? "succeeded" : "failed",
      outputText,
      toolsUsed: ["codex exec"],
      messageLog: [
        {
          role: "user",
          content: input.prompt,
        },
        {
          role: "assistant",
          content: outputText,
        },
      ],
      startedAt,
      finishedAt,
      ...(error ? { error } : {}),
    };
  }
}

export function createCodexModelConfigs(
  models: CasteConfigRecord<string>,
  thinking: CasteConfigRecord<AegisThinkingLevel>,
) {
  return createCasteConfig((caste: CasteName) => parseModelReference(models[caste], thinking[caste]));
}
