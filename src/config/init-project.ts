import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { DEFAULT_AEGIS_CONFIG } from "./defaults.js";
import {
  AEGIS_CONFIG_PATH,
  resolveProjectRelativePath,
} from "./load-config.js";
import { AEGIS_DIRECTORY, RUNTIME_STATE_FILES } from "./schema.js";
import { emptyDispatchState } from "../core/dispatch-state.js";

export const REQUIRED_PROJECT_DIRECTORIES = [
  AEGIS_DIRECTORY,
  ".aegis/labors",
  ".aegis/evals",
] as const;

export const REQUIRED_PROJECT_FILES = [
  AEGIS_CONFIG_PATH,
  ...RUNTIME_STATE_FILES,
] as const;

export const DEFAULT_GITIGNORE_ENTRIES = [
  AEGIS_CONFIG_PATH,
  ".aegis/dispatch-state.json",
  ".aegis/merge-queue.json",
  ".aegis/mnemosyne.jsonl",
  ".aegis/runtime-state.json",
  ".aegis/labors/",
  ".aegis/evals/",
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

  writeFileSync(targetPath, contents, "utf8");
  return true;
}

function formatJsonFile(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
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

  writeFileSync(gitIgnorePath, `${existingContents}${prefix}${suffix}`, "utf8");
  return true;
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

  if (
    seedFile(
      resolveProjectRelativePath(plan.repoRoot, AEGIS_CONFIG_PATH),
      formatJsonFile(DEFAULT_AEGIS_CONFIG),
    )
  ) {
    createdFiles.push(resolveProjectRelativePath(plan.repoRoot, AEGIS_CONFIG_PATH));
  }
  if (
    seedFile(
      resolveProjectRelativePath(plan.repoRoot, ".aegis/dispatch-state.json"),
      formatJsonFile(emptyDispatchState()),
    )
  ) {
    createdFiles.push(
      resolveProjectRelativePath(plan.repoRoot, ".aegis/dispatch-state.json"),
    );
  }
  if (
    seedFile(
      resolveProjectRelativePath(plan.repoRoot, ".aegis/merge-queue.json"),
      "{}\n",
    )
  ) {
    createdFiles.push(
      resolveProjectRelativePath(plan.repoRoot, ".aegis/merge-queue.json"),
    );
  }
  if (
    seedFile(
      resolveProjectRelativePath(plan.repoRoot, ".aegis/mnemosyne.jsonl"),
      "",
    )
  ) {
    createdFiles.push(
      resolveProjectRelativePath(plan.repoRoot, ".aegis/mnemosyne.jsonl"),
    );
  }

  return {
    repoRoot: plan.repoRoot,
    createdDirectories,
    createdFiles,
    updatedGitIgnore: updateGitIgnore(plan.repoRoot, plan.gitIgnoreEntries),
  };
}
