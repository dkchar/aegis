import { spawnSync } from "node:child_process";
import path from "node:path";

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
    || /\b(vite|vite\.cmd|vite\.js)\s+(--host|--port|dev|preview|serve)\b/.test(normalized)
    || /node_modules\/(\.bin\/)?vite\b.*\s(dev|preview|serve|--host|--port)\b/.test(normalized)
    || /vite\/bin\/vite\.js\b.*\s(dev|preview|serve|--host|--port)\b/.test(normalized)
    || /\b(vitest|tsc)\b.*\s--watch\b/.test(normalized)
    || /\bwebpack\s+serve\b/.test(normalized);
}

function isPlaywrightTestCommand(commandLine: string) {
  const normalized = commandLine.replace(/\\/g, "/").replace(/\s+/g, " ").trim().toLowerCase();
  return /\bplaywright(\.cmd|\.exe|\.js)?\b.*\btest\b/.test(normalized)
    || /@playwright\/test\b.*\btest\b/.test(normalized);
}

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
    const commandLine = commandByPid.get(parent) ?? "";
    if (isPlaywrightTestCommand(commandLine)) {
      return true;
    }
    current = parent;
  }
  return false;
}

export function findForbiddenWorkspaceProcess(
  workingDirectory: string,
  platform: NodeJS.Platform = process.platform,
) {
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
      return null;
    }
    const parentByPid = new Map<number, number>();
    const commandByPid = new Map<number, string>();
    const snapshots: Array<{ pid: number; commandLine: string }> = [];
    for (const line of result.stdout.split(/\r?\n/)) {
      const [pidText, parentText, commandLine] = line.split("\t", 3);
      const pid = Number(pidText);
      const parent = Number(parentText);
      if (!Number.isFinite(pid) || !commandLine) {
        continue;
      }
      if (Number.isFinite(parent)) {
        parentByPid.set(pid, parent);
      }
      commandByPid.set(pid, commandLine);
      snapshots.push({ pid, commandLine });
    }
    for (const snapshot of snapshots) {
      const commandLine = snapshot.commandLine;
      if (
        commandLineReferencesWorkspace(commandLine, workingDirectory, platform)
        && isForbiddenLongRunningWorkspaceCommand(commandLine)
        && !isAllowedPlaywrightManagedWorkspaceServer(snapshot.pid, parentByPid, commandByPid)
      ) {
        return commandLine;
      }
    }
    return null;
  }

  const ps = spawnSync("ps", ["-eo", "pid=,ppid=,command="], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (ps.status !== 0) {
    return null;
  }
  const parentByPid = new Map<number, number>();
  const commandByPid = new Map<number, string>();
  const snapshots: Array<{ pid: number; commandLine: string }> = [];
  for (const line of ps.stdout.split(/\r?\n/)) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
    if (!match) {
      continue;
    }
    const pid = Number(match[1]);
    const parent = Number(match[2]);
    const commandLine = match[3] ?? "";
    if (!Number.isFinite(pid)) {
      continue;
    }
    if (Number.isFinite(parent)) {
      parentByPid.set(pid, parent);
    }
    commandByPid.set(pid, commandLine);
    snapshots.push({ pid, commandLine });
  }
  for (const snapshot of snapshots) {
    const commandLine = snapshot.commandLine;
    if (
      commandLineReferencesWorkspace(commandLine, workingDirectory, platform)
      && isForbiddenLongRunningWorkspaceCommand(commandLine)
      && !isAllowedPlaywrightManagedWorkspaceServer(snapshot.pid, parentByPid, commandByPid)
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
    "  '\\b(vite|vite\\.cmd|vite\\.js)\\s+(--host|--port|dev|preview|serve)\\b',",
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
