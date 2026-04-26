import path from "node:path";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

export interface LaborGitCommand {
  command: string;
  args: readonly string[];
}

export interface LaborCreationRequest {
  issueId: string;
  projectRoot: string;
  baseBranch: string;
  laborBasePath: string;
}

export interface LaborCreationPlan {
  issueId: string;
  projectRoot: string;
  laborPath: string;
  branchName: string;
  baseBranch: string;
  createWorktreeCommand: LaborGitCommand;
}

const LABOR_GIT_EXCLUDE_PATTERNS = [
  "node_modules/",
  "dist/",
  "coverage/",
  ".vite/",
];

function sanitizeIssueId(issueId: string) {
  return issueId.replace(/[^a-zA-Z0-9._-]/g, "-");
}

export function buildLaborBranchName(issueId: string) {
  return `aegis/${sanitizeIssueId(issueId)}`;
}

export function planLaborCreation(request: LaborCreationRequest): LaborCreationPlan {
  const safeIssueId = sanitizeIssueId(request.issueId);
  const laborRoot = path.isAbsolute(request.laborBasePath)
    ? request.laborBasePath
    : path.join(path.resolve(request.projectRoot), request.laborBasePath);
  const laborPath = path.join(laborRoot, safeIssueId);
  const branchName = buildLaborBranchName(request.issueId);

  return {
    issueId: request.issueId,
    projectRoot: path.resolve(request.projectRoot),
    laborPath,
    branchName,
    baseBranch: request.baseBranch,
    createWorktreeCommand: {
      command: "git",
      args: ["worktree", "add", "-b", branchName, laborPath, request.baseBranch],
    },
  };
}

function runGit(projectRoot: string, args: string[]) {
  return spawnSync("git", args, {
    cwd: projectRoot,
    encoding: "utf8",
    windowsHide: true,
  });
}

function normalizePath(candidate: string) {
  return path.resolve(candidate).toLowerCase();
}

function isKnownWorktreePath(projectRoot: string, laborPath: string) {
  const listed = runGit(projectRoot, ["worktree", "list", "--porcelain"]);
  if (listed.status !== 0) {
    return false;
  }

  const expected = normalizePath(laborPath);
  return listed.stdout
    .split(/\r?\n/)
    .filter((line) => line.startsWith("worktree "))
    .some((line) => normalizePath(line.slice("worktree ".length)) === expected);
}

function formatGitFailure(result: ReturnType<typeof runGit>) {
  return `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
}

function resolveWorktreeGitDirectory(laborPath: string) {
  const commonGitDirectory = runGit(laborPath, ["rev-parse", "--git-common-dir"]);
  if (commonGitDirectory.status === 0) {
    const gitDirectory = commonGitDirectory.stdout.trim();
    if (gitDirectory.length > 0) {
      return path.isAbsolute(gitDirectory)
        ? gitDirectory
        : path.resolve(laborPath, gitDirectory);
    }
  }

  const dotGit = path.join(laborPath, ".git");
  if (!existsSync(dotGit)) {
    return null;
  }

  if (statSync(dotGit).isDirectory()) {
    return dotGit;
  }

  const match = readFileSync(dotGit, "utf8").match(/^gitdir:\s*(.+)$/im);
  if (!match) {
    return null;
  }

  const gitDirectory = match[1]!.trim();
  return path.isAbsolute(gitDirectory)
    ? gitDirectory
    : path.resolve(laborPath, gitDirectory);
}

function ensureLaborGitInfoExcludes(laborPath: string) {
  const gitDirectory = resolveWorktreeGitDirectory(laborPath);
  if (!gitDirectory) {
    return;
  }

  const infoDirectory = path.join(gitDirectory, "info");
  const excludePath = path.join(infoDirectory, "exclude");
  mkdirSync(infoDirectory, { recursive: true });

  const current = existsSync(excludePath) ? readFileSync(excludePath, "utf8") : "";
  const currentLines = new Set(
    current
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0),
  );
  const missing = LABOR_GIT_EXCLUDE_PATTERNS.filter((pattern) => !currentLines.has(pattern));
  if (missing.length === 0) {
    return;
  }

  const prefix = current.endsWith("\n") || current.length === 0 ? "" : "\n";
  const header = currentLines.has("# Aegis labor-generated artifacts")
    ? ""
    : "# Aegis labor-generated artifacts\n";
  writeFileSync(excludePath, `${current}${prefix}${header}${missing.join("\n")}\n`, "utf8");
}

export function prepareLaborWorktree(plan: LaborCreationPlan) {
  if (isKnownWorktreePath(plan.projectRoot, plan.laborPath)) {
    ensureLaborGitInfoExcludes(plan.laborPath);
    return;
  }

  mkdirSync(path.dirname(plan.laborPath), { recursive: true });

  const created = runGit(plan.projectRoot, [...plan.createWorktreeCommand.args]);
  if (created.status === 0) {
    ensureLaborGitInfoExcludes(plan.laborPath);
    return;
  }

  const fallback = runGit(plan.projectRoot, [
    "worktree",
    "add",
    plan.laborPath,
    plan.branchName,
  ]);
  if (fallback.status === 0) {
    ensureLaborGitInfoExcludes(plan.laborPath);
    return;
  }

  const createError = formatGitFailure(created);
  const fallbackError = formatGitFailure(fallback);
  const detail = [createError, fallbackError].filter((value) => value.length > 0).join(" | ");
  throw new Error(
    `Failed to prepare labor worktree ${plan.laborPath} for issue ${plan.issueId}.${detail.length > 0 ? ` ${detail}` : ""}`,
  );
}
