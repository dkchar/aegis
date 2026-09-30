import { spawnSync, type SpawnSyncReturns } from "node:child_process";

import { normalizeScopeFile } from "./file-scope.js";

export type GitResult = SpawnSyncReturns<string>;

export function runGit(workingDirectory: string, args: readonly string[]): GitResult {
  return spawnSync("git", [...args], {
    cwd: workingDirectory,
    encoding: "utf8",
    windowsHide: true,
  });
}

/** Combined stdout + stderr, trimmed; used for error details. */
export function formatGitOutput(result: GitResult) {
  return `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
}

export function isGitWorkingTree(workingDirectory: string) {
  const probe = runGit(workingDirectory, ["rev-parse", "--is-inside-work-tree"]);
  return probe.status === 0 && probe.stdout.trim() === "true";
}

/** Extracts the (post-rename) path from one `git status --porcelain` line. */
export function parseGitStatusPath(line: string): string | null {
  if (line.startsWith("##")) {
    return null;
  }

  const rawPath = line.length > 3 ? line.slice(3).trim() : "";
  if (rawPath.length === 0) {
    return null;
  }

  const finalPath = rawPath.includes(" -> ")
    ? rawPath.split(" -> ").at(-1) ?? rawPath
    : rawPath;
  return normalizeScopeFile(finalPath.replace(/^"|"$/g, ""));
}

/** Sorted, de-duplicated dirty paths (tracked and untracked), or `null` on git failure. */
export function listDirtyFiles(workingDirectory: string): string[] | null {
  const result = runGit(workingDirectory, ["status", "--porcelain", "--untracked-files=all"]);
  if (result.status !== 0) {
    return null;
  }

  return [...new Set(
    result.stdout
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0)
      .map((line) => parseGitStatusPath(line))
      .filter((entry): entry is string => entry !== null),
  )].sort();
}

export function isAegisControlPlanePath(candidate: string) {
  return candidate === ".aegis"
    || candidate.startsWith(".aegis/")
    || candidate === ".agora"
    || candidate.startsWith(".agora/");
}
