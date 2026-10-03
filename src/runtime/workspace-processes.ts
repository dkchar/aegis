import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Process supervision shared by CLI-backed and in-process runtime adapters.
 *
 * Aegis cannot trust an agent to stop the servers it starts, so adapters use
 * these helpers to (1) detect long-running dev/watch servers launched inside a
 * labor workspace, (2) kill them, and (3) kill whole adapter process trees on
 * abort or timeout.
 */

export interface ProcessSnapshot {
  pid: number;
  parentPid: number | null;
  commandLine: string;
}

const PACKAGE_MANAGERS = "(npm|npm\\.cmd|pnpm|pnpm\\.cmd|yarn|yarn\\.cmd|bun|bun\\.cmd)";

// Kept as regex sources so the same list feeds the PowerShell cleanup script.
export const FORBIDDEN_LONG_RUNNING_PATTERNS: readonly string[] = [
  `\\b${PACKAGE_MANAGERS}\\s+run\\s+(dev|preview|start)\\b`,
  `\\b${PACKAGE_MANAGERS}\\s+(dev|preview|start)\\b`,
  "\\b(vite|next|astro)\\s+dev\\b",
  "\\b(vite|vite\\.cmd|vite\\.js)\\s+(--host|--port|dev|preview|serve)\\b",
  "node_modules/(\\.bin/)?vite\\b.*\\s(dev|preview|serve|--host|--port)\\b",
  "vite/bin/vite\\.js\\b.*\\s(dev|preview|serve|--host|--port)\\b",
  "\\b(vitest|tsc)\\b.*\\s--watch\\b",
  "\\bwebpack\\s+serve\\b",
];

const FORBIDDEN_LONG_RUNNING_REGEXES = FORBIDDEN_LONG_RUNNING_PATTERNS.map((source) => new RegExp(source));

function normalizeCommandLine(commandLine: string) {
  return commandLine.replace(/\\/g, "/").replace(/\s+/g, " ").trim().toLowerCase();
}

/** True for dev servers, previews, and watchers that never return to the shell. */
export function isForbiddenLongRunningCommand(commandLine: string) {
  const normalized = normalizeCommandLine(commandLine);
  return FORBIDDEN_LONG_RUNNING_REGEXES.some((pattern) => pattern.test(normalized));
}

function isPlaywrightTestCommand(commandLine: string) {
  const normalized = normalizeCommandLine(commandLine);
  return /\bplaywright(\.cmd|\.exe|\.js)?\b.*\btest\b/.test(normalized)
    || /@playwright\/test\b.*\btest\b/.test(normalized);
}

/** Playwright's `webServer` legitimately starts a dev server for the test run. */
export function isAllowedPlaywrightManagedWorkspaceServer(
  processId: number,
  parentByPid: Map<number, number>,
  commandByPid: Map<number, string>,
) {
  let current = processId;
  const visited = new Set<number>();
  for (let depth = 0; depth < 20; depth += 1) {
    const parent = parentByPid.get(current);
    if (!parent || visited.has(parent)) {
      return false;
    }
    visited.add(parent);
    if (isPlaywrightTestCommand(commandByPid.get(parent) ?? "")) {
      return true;
    }
    current = parent;
  }
  return false;
}

export function normalizeProcessPath(candidate: string, platform: NodeJS.Platform) {
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

/** True when the command line mentions the workspace path (not a sibling prefix). */
export function commandLineReferencesWorkspace(
  commandLine: string,
  workingDirectory: string,
  platform: NodeJS.Platform = process.platform,
) {
  const normalizedCommand = commandLine.replace(/\\/g, "/");
  const comparableCommand = platform === "win32"
    ? normalizedCommand.toLowerCase()
    : normalizedCommand;
  return commandLineContainsWorkspace(comparableCommand, normalizeProcessPath(workingDirectory, platform));
}

export function listProcessSnapshots(platform: NodeJS.Platform = process.platform): ProcessSnapshot[] {
  if (platform === "win32") {
    const script = [
      "$ErrorActionPreference = 'SilentlyContinue'",
      "Get-CimInstance Win32_Process | ForEach-Object {",
      "  if ($_.CommandLine) { [Console]::Out.WriteLine(([string]$_.ProcessId) + \"`t\" + ([string]$_.ParentProcessId) + \"`t\" + $_.CommandLine) }",
      "}",
    ].join("\n");
    const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      encoding: "utf8",
      windowsHide: true,
    });
    if (result.status !== 0) {
      return [];
    }
    return result.stdout.split(/\r?\n/).flatMap((line) => {
      const [pidText, parentText, commandLine] = line.split("\t", 3);
      const pid = Number(pidText);
      const parentPid = Number(parentText);
      return Number.isFinite(pid) && commandLine
        ? [{ pid, parentPid: Number.isFinite(parentPid) ? parentPid : null, commandLine }]
        : [];
    });
  }

  const result = spawnSync("ps", ["-eo", "pid=,ppid=,command="], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    return [];
  }
  return result.stdout.split(/\r?\n/).flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
    if (!match) {
      return [];
    }
    return [{ pid: Number(match[1]), parentPid: Number(match[2]), commandLine: match[3] ?? "" }];
  });
}

/** Returns the first forbidden long-running command rooted in the workspace. */
export function findForbiddenWorkspaceProcess(
  workingDirectory: string,
  platform: NodeJS.Platform = process.platform,
  snapshots: ProcessSnapshot[] = listProcessSnapshots(platform),
) {
  const parentByPid = new Map<number, number>();
  const commandByPid = new Map<number, string>();
  for (const snapshot of snapshots) {
    if (snapshot.parentPid !== null) {
      parentByPid.set(snapshot.pid, snapshot.parentPid);
    }
    commandByPid.set(snapshot.pid, snapshot.commandLine);
  }

  return snapshots.find((snapshot) =>
    commandLineReferencesWorkspace(snapshot.commandLine, workingDirectory, platform)
    && isForbiddenLongRunningCommand(snapshot.commandLine)
    && !isAllowedPlaywrightManagedWorkspaceServer(snapshot.pid, parentByPid, commandByPid))?.commandLine ?? null;
}

/**
 * Kills a process and its descendants. On POSIX this relies on the child being
 * spawned with `detached: true` so it leads its own process group.
 */
export function terminateProcessTree(pid: number) {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }

  for (const target of [-pid, pid]) {
    try {
      process.kill(target, "SIGTERM");
    } catch {
      // Missing process or process group.
    }
  }
}

export type WorkspaceProcessFilter = "forbidden" | "all" | RegExp;

function matchesFilter(commandLine: string, filter: WorkspaceProcessFilter) {
  if (filter === "all") {
    return true;
  }
  if (filter === "forbidden") {
    return isForbiddenLongRunningCommand(commandLine);
  }
  return filter.test(commandLine);
}

function buildPowerShellWorkspaceMatch(workingDirectory: string) {
  return [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `$workspace = ${JSON.stringify(normalizeProcessPath(workingDirectory, "win32"))}`,
    `$rawWorkspace = ${JSON.stringify(path.resolve(workingDirectory))}`,
    "$current = $PID",
  ];
}

const POWERSHELL_WORKSPACE_WHERE = [
  "  if ($_.ProcessId -eq $current -or -not $_.CommandLine) { return $false }",
  "  $normalized = ($_.CommandLine.Replace('\\','/').ToLowerInvariant() -replace '\\s+', ' ').Trim()",
  "  $matchesWorkspace = $_.CommandLine.ToLowerInvariant().Contains($rawWorkspace.ToLowerInvariant()) -or $normalized.Contains($workspace)",
  "  if (-not $matchesWorkspace) { return $false }",
];

/** PowerShell script that stops forbidden long-running processes in the workspace. */
export function buildTerminateWorkspaceProcessesScript(workingDirectory: string) {
  return [
    ...buildPowerShellWorkspaceMatch(workingDirectory),
    "$forbiddenPatterns = @(",
    FORBIDDEN_LONG_RUNNING_PATTERNS.map((pattern) => `  '${pattern}'`).join(",\n"),
    ")",
    "Get-CimInstance Win32_Process | Where-Object {",
    ...POWERSHELL_WORKSPACE_WHERE,
    "  foreach ($pattern in $forbiddenPatterns) { if ($normalized -match $pattern) { return $true } }",
    "  return $false",
    "} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
  ].join("\n");
}

/** PowerShell script that tree-kills processes in the workspace matching `commandPattern`. */
export function buildTerminateMatchingWorkspaceProcessesScript(workingDirectory: string, commandPattern: string | null) {
  return [
    ...buildPowerShellWorkspaceMatch(workingDirectory),
    "Get-CimInstance Win32_Process | Where-Object {",
    ...POWERSHELL_WORKSPACE_WHERE,
    commandPattern ? `  return $normalized -match '${commandPattern}'` : "  return $true",
    "} | ForEach-Object { taskkill /PID $_.ProcessId /T /F | Out-Null }",
  ].join("\n");
}

/** Kills processes whose command line references `workingDirectory` and matches `filter`. */
export function terminateWorkspaceProcesses(
  workingDirectory: string,
  filter: WorkspaceProcessFilter = "forbidden",
  platform: NodeJS.Platform = process.platform,
) {
  if (platform === "win32") {
    const script = filter === "forbidden"
      ? buildTerminateWorkspaceProcessesScript(workingDirectory)
      : buildTerminateMatchingWorkspaceProcessesScript(workingDirectory, filter === "all" ? null : filter.source);
    spawnSync("powershell.exe", ["-NoProfile", "-Command", script], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }

  for (const snapshot of listProcessSnapshots(platform)) {
    if (
      snapshot.pid > 0
      && snapshot.pid !== process.pid
      && commandLineReferencesWorkspace(snapshot.commandLine, workingDirectory, platform)
      && matchesFilter(snapshot.commandLine, filter)
    ) {
      terminateProcessTree(snapshot.pid);
    }
  }
}

// In-process registry of adapter child processes keyed by workspace. CLI
// adapters (Claude Code) do not always put the workspace on their command
// line, so abort cannot rely on command-line matching alone.
const ACTIVE_SESSION_PROCESSES = new Map<string, Set<number>>();

function workspaceKey(workingDirectory: string) {
  return normalizeProcessPath(workingDirectory, process.platform);
}

export function registerSessionProcess(workingDirectory: string, pid: number) {
  const key = workspaceKey(workingDirectory);
  const pids = ACTIVE_SESSION_PROCESSES.get(key) ?? new Set<number>();
  pids.add(pid);
  ACTIVE_SESSION_PROCESSES.set(key, pids);
  return () => {
    pids.delete(pid);
    if (pids.size === 0) {
      ACTIVE_SESSION_PROCESSES.delete(key);
    }
  };
}

export function terminateRegisteredSessionProcesses(workingDirectory: string) {
  const key = workspaceKey(workingDirectory);
  const pids = ACTIVE_SESSION_PROCESSES.get(key);
  if (!pids) {
    return 0;
  }
  for (const pid of pids) {
    terminateProcessTree(pid);
  }
  ACTIVE_SESSION_PROCESSES.delete(key);
  return pids.size;
}

function quotePowerShellString(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * npm-installed CLIs are `.cmd` shims on Windows, which Node refuses to spawn
 * without a shell. Route them through PowerShell with every argument quoted.
 */
export function buildCliSpawnInvocation(
  commandName: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
) {
  if (platform === "win32") {
    const executable = /\.(cmd|exe|bat)$/i.test(commandName) ? commandName : `${commandName}.cmd`;
    return {
      command: "powershell.exe",
      args: [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        `& ${quotePowerShellString(executable)} ${args.map(quotePowerShellString).join(" ")}; exit $LASTEXITCODE`,
      ],
    };
  }

  return {
    command: commandName,
    args,
  };
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

function writeCmdShim(shimDirectory: string, fileName: string, lines: string[]) {
  mkdirSync(shimDirectory, { recursive: true });
  writeFileSync(path.join(shimDirectory, fileName), [...lines, ""].join("\r\n"), "utf8");
}

/**
 * Agent shell environment. On Windows, prepends `.cmd` shims so `npm`/`npx`
 * resolve without PowerShell script policy prompts and `rg` no-match (exit 1)
 * does not fail exploratory searches.
 */
export function buildAgentShellEnvironment(
  baseEnv: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  resolveCommandPath: (commandName: string) => string | null = resolveWindowsCommandPath,
  shimDirectory = path.join(tmpdir(), "aegis-agent-runtime", "cmd-shims"),
) {
  if (platform !== "win32") {
    return baseEnv;
  }

  let wroteShim = false;
  for (const commandName of ["npm.cmd", "npx.cmd"]) {
    const targetPath = resolveCommandPath(commandName);
    if (targetPath) {
      writeCmdShim(shimDirectory, commandName, ["@echo off", `"${targetPath}" %*`]);
      wroteShim = true;
    }
  }
  const ripgrepPath = resolveCommandPath("rg.exe");
  if (ripgrepPath) {
    writeCmdShim(shimDirectory, "rg.cmd", [
      "@echo off",
      `"${ripgrepPath}" %*`,
      "if %ERRORLEVEL% EQU 1 exit /B 0",
      "exit /B %ERRORLEVEL%",
    ]);
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

export interface SupervisedProcessRequest {
  label: string;
  command: string;
  args: string[];
  /** Run `command` through the platform shell (`/bin/sh` or `cmd.exe`). */
  shell?: boolean;
  cwd: string;
  stdin: string;
  env?: NodeJS.ProcessEnv;
  inactivityTimeoutMs: number;
  forbiddenProcessPollMs?: number;
  maxCapturedChars?: number;
  onStdoutLine?: (line: string) => void;
}

export interface SupervisedProcessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

const DEFAULT_MAX_CAPTURED_CHARS = 4_000_000;

function appendBounded(current: string, chunk: string, limit: number) {
  const next = current + chunk;
  return next.length > limit ? next.slice(next.length - limit) : next;
}

/**
 * Runs an agent CLI with an inactivity timeout, a forbidden-server monitor,
 * bounded output capture, and workspace cleanup on exit.
 */
export function runSupervisedProcess(request: SupervisedProcessRequest): Promise<SupervisedProcessResult> {
  const maxCapturedChars = request.maxCapturedChars ?? DEFAULT_MAX_CAPTURED_CHARS;

  return new Promise((resolve) => {
    const child = spawn(request.command, request.args, {
      cwd: request.cwd,
      shell: request.shell ?? false,
      env: request.env ?? buildAgentShellEnvironment(),
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const unregister = typeof child.pid === "number"
      ? registerSessionProcess(request.cwd, child.pid)
      : () => undefined;

    let stdout = "";
    let stderr = "";
    let pendingLine = "";
    let settled = false;
    let inactivityTimer: ReturnType<typeof setTimeout> | undefined;

    const kill = () => {
      if (typeof child.pid === "number") {
        terminateProcessTree(child.pid);
      } else {
        child.kill("SIGKILL");
      }
    };
    const appendError = (message: string) => `${stderr}${stderr.length > 0 ? "\n" : ""}${message}`;
    const settle = (result: SupervisedProcessResult) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(inactivityTimer);
      clearInterval(workspaceMonitor);
      unregister();
      terminateWorkspaceProcesses(request.cwd, "forbidden");
      resolve(result);
    };
    const refreshInactivityTimer = () => {
      clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => {
        kill();
        settle({
          exitCode: 1,
          stdout,
          stderr: appendError(`${request.label} session timed out after ${request.inactivityTimeoutMs}ms without output.`),
        });
      }, request.inactivityTimeoutMs);
    };
    const workspaceMonitor = setInterval(() => {
      const forbiddenCommand = findForbiddenWorkspaceProcess(request.cwd);
      if (!forbiddenCommand) {
        return;
      }
      kill();
      settle({
        exitCode: 1,
        stdout,
        stderr: appendError(`${request.label} session launched forbidden long-running workspace process: ${forbiddenCommand}`),
      });
    }, request.forbiddenProcessPollMs ?? 5_000);

    refreshInactivityTimer();
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      refreshInactivityTimer();
      stdout = appendBounded(stdout, chunk, maxCapturedChars);
      if (!request.onStdoutLine) {
        return;
      }
      const lines = `${pendingLine}${chunk}`.split(/\r?\n/);
      pendingLine = lines.pop() ?? "";
      for (const line of lines) {
        request.onStdoutLine(line);
      }
    });
    child.stderr.on("data", (chunk: string) => {
      refreshInactivityTimer();
      stderr = appendBounded(stderr, chunk, maxCapturedChars);
    });
    child.on("error", (error) => {
      settle({ exitCode: 1, stdout, stderr: appendError(error.message) });
    });
    child.on("close", (exitCode) => {
      if (pendingLine && request.onStdoutLine) {
        request.onStdoutLine(pendingLine);
      }
      settle({ exitCode, stdout, stderr });
    });
    child.stdin.on("error", () => {
      // The child may exit before reading stdin; the close handler reports it.
    });
    child.stdin.end(request.stdin);
  });
}
