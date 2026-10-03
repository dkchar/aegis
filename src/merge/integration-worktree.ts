import { rmSync } from "node:fs";
import path from "node:path";

import { runSupervisedProcess } from "../runtime/workspace-processes.js";
import { formatGitOutput, isRegisteredWorktree, runGit, type GitResult } from "../shared/git.js";

/**
 * The merge queue builds each merge result in one detached worktree instead of
 * the project root. The root only fast-forwards to a result that merged
 * cleanly and passed verification, so it never holds a half-merged or
 * unverified tree.
 */

export interface MergeVerification {
  command: string;
  idleTimeoutSeconds: number;
}

export interface MergeVerificationResult {
  passed: boolean;
  detail: string;
}

const VERIFICATION_OUTPUT_TAIL_CHARS = 4_000;

export function resolveIntegrationWorktreePath(root: string) {
  return path.join(path.resolve(root), ".aegis", "integration");
}

function assertGitSucceeded(result: GitResult, action: string) {
  if (result.status !== 0) {
    throw new Error(`${action} failed: ${formatGitOutput(result) || `git exited ${result.status}`}`);
  }
}

/**
 * Resets the integration worktree to `commit` on a detached HEAD. Untracked
 * files are removed; ignored ones (installed dependencies, build caches) stay
 * so verification does not reinstall on every merge.
 */
export function prepareIntegrationWorktree(root: string, commit: string) {
  const worktreePath = resolveIntegrationWorktreePath(root);
  if (!isRegisteredWorktree(root, worktreePath)) {
    // A deleted directory leaves a stale registration that blocks `add`.
    runGit(root, ["worktree", "prune"]);
    rmSync(worktreePath, { recursive: true, force: true });
    assertGitSucceeded(
      runGit(root, ["worktree", "add", "--detach", worktreePath, commit]),
      "Creating integration worktree",
    );
    return worktreePath;
  }

  // No merge may be in progress; a failed abort only means there was none.
  runGit(worktreePath, ["merge", "--abort"]);
  assertGitSucceeded(
    runGit(worktreePath, ["checkout", "--force", "--detach", commit]),
    "Resetting integration worktree",
  );
  assertGitSucceeded(runGit(worktreePath, ["clean", "-fd"]), "Cleaning integration worktree");
  return worktreePath;
}

function tail(text: string, maxChars: number) {
  return text.length > maxChars ? `...${text.slice(text.length - maxChars)}` : text;
}

/** Runs the configured verification command in the integration worktree. */
export async function runMergeVerification(
  worktreePath: string,
  verification: MergeVerification,
): Promise<MergeVerificationResult> {
  const result = await runSupervisedProcess({
    label: "Merge verification",
    command: verification.command,
    args: [],
    shell: true,
    cwd: worktreePath,
    stdin: "",
    inactivityTimeoutMs: verification.idleTimeoutSeconds * 1_000,
  });
  const output = tail(`${result.stdout}\n${result.stderr}`.trim(), VERIFICATION_OUTPUT_TAIL_CHARS);
  const status = result.exitCode === 0 ? "passed" : `failed (exit ${result.exitCode ?? "signal"})`;
  return {
    passed: result.exitCode === 0,
    detail: `Merge verification \`${verification.command}\` ${status}.${output ? `\n${output}` : ""}`,
  };
}
