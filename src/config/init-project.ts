import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { formatJson, writeTextAtomic } from "../shared/atomic-write.js";

import { DEFAULT_AEGIS_CONFIG } from "./defaults.js";
import {
  AEGIS_CONFIG_PATH,
  resolveProjectRelativePath,
} from "./load-config.js";
import { ensureAegisPackageJsonAliases } from "./package-json-aliases.js";
import { AEGIS_DIRECTORY, RUNTIME_STATE_FILES } from "./schema.js";
import { emptyDispatchState } from "../core/dispatch-state.js";
import { emptyMergeQueueState } from "../merge/merge-state.js";

export const REQUIRED_PROJECT_DIRECTORIES = [
  AEGIS_DIRECTORY,
  ".aegis/labors",
  ".aegis/logs",
] as const;

export const REQUIRED_PROJECT_FILES = [
  AEGIS_CONFIG_PATH,
  ...RUNTIME_STATE_FILES,
] as const;

export const DEFAULT_GITIGNORE_ENTRIES = [
  AEGIS_CONFIG_PATH,
  ".aegis/dispatch-state.json",
  ".aegis/merge-queue.json",
  ".aegis/final-app-verification.json",
  ".aegis/runtime-state.json",
  ".aegis/runtime-stop-request.json",
  ".aegis/runtime-commands/",
  ".aegis/olympus-state.json",
  ".aegis/labors/",
  ".aegis/logs/",
  ".aegis/oracle/",
  ".aegis/policy/",
  ".aegis/titan/",
  ".aegis/sentinel/",
  ".aegis/janus/",
  ".aegis/merge-artifacts/",
  ".aegis/transcripts/",
] as const;

export interface InitProjectPlan {
  repoRoot: string;
  directories: string[];
  files: string[];
  gitIgnoreEntries: readonly string[];
}

export interface InitProjectResult {
  repoRoot: string;
  createdDirectories: string[];
  createdFiles: string[];
  updatedGitIgnore: boolean;
}

export function buildInitProjectPlan(root = process.cwd()): InitProjectPlan {
  const repoRoot = path.resolve(root);

  return {
    repoRoot,
    directories: REQUIRED_PROJECT_DIRECTORIES.map((entry) =>
      resolveProjectRelativePath(repoRoot, entry),
    ),
    files: REQUIRED_PROJECT_FILES.map((entry) =>
      resolveProjectRelativePath(repoRoot, entry),
    ),
    gitIgnoreEntries: DEFAULT_GITIGNORE_ENTRIES,
  };
}

function seedFile(targetPath: string, contents: string) {
  if (existsSync(targetPath)) {
    return false;
  }

  try {
    // "wx" never clobbers a file created concurrently after the check above.
    writeFileSync(targetPath, contents, { encoding: "utf8", flag: "wx" });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return false;
    }
    throw error;
  }
}

function updateGitIgnore(
  repoRoot: string,
  entries: readonly string[],
): boolean {
  const gitIgnorePath = path.join(repoRoot, ".gitignore");
  const existingContents = existsSync(gitIgnorePath)
    ? readFileSync(gitIgnorePath, "utf8")
    : "";
  const existingLines = existingContents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const missingEntries = entries.filter((entry) => !existingLines.includes(entry));

  if (missingEntries.length === 0) {
    return false;
  }

  const prefix = existingContents.length > 0 && !existingContents.endsWith("\n")
    ? "\n"
    : "";
  const suffix = `${missingEntries.join("\n")}\n`;

  writeTextAtomic(gitIgnorePath, `${existingContents}${prefix}${suffix}`);
  return true;
}

function updatePackageJsonAliases(repoRoot: string): void {
  const packageJsonPath = path.join(repoRoot, "package.json");
  if (!existsSync(packageJsonPath)) {
    return;
  }

  let packageJsonText: string;

  try {
    packageJsonText = readFileSync(packageJsonPath, "utf8");
  } catch {
    return;
  }

  const result = ensureAegisPackageJsonAliases(packageJsonText);
  if (!result.changed) {
    return;
  }

  try {
    writeTextAtomic(packageJsonPath, result.packageJsonText);
  } catch {
    return;
  }
}

export function initProject(root = process.cwd()): InitProjectResult {
  const plan = buildInitProjectPlan(root);
  const createdDirectories: string[] = [];
  const createdFiles: string[] = [];

  for (const directory of plan.directories) {
    if (!existsSync(directory)) {
      mkdirSync(directory, { recursive: true });
      createdDirectories.push(directory);
    }
  }

  const seededFiles: Array<[string, unknown]> = [
    [AEGIS_CONFIG_PATH, DEFAULT_AEGIS_CONFIG],
    [".aegis/dispatch-state.json", emptyDispatchState()],
    [".aegis/merge-queue.json", emptyMergeQueueState()],
  ];
  for (const [relativePath, contents] of seededFiles) {
    const targetPath = resolveProjectRelativePath(plan.repoRoot, relativePath);
    if (seedFile(targetPath, formatJson(contents))) {
      createdFiles.push(targetPath);
    }
  }
  updatePackageJsonAliases(plan.repoRoot);

  return {
    repoRoot: plan.repoRoot,
    createdDirectories,
    createdFiles,
    updatedGitIgnore: updateGitIgnore(plan.repoRoot, plan.gitIgnoreEntries),
  };
}
