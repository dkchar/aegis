import path from "node:path";

import { assertSafeIssueId } from "../shared/issue-id.js";

export const LABOR_DIRECTORY_SEGMENT = ".aegis/labors";
export const LABOR_DIRECTORY_PREFIX = "labor-";
export const LABOR_BRANCH_PREFIX = "aegis/";

export interface LaborGitCommand {
  command: string;
  args: readonly string[];
}

export interface LaborCreationRequest {
  issueId: string;
  projectRoot: string;
  baseBranch: string;
}

export interface LaborCreationPlan {
  issueId: string;
  laborPath: string;
  branchName: string;
  baseBranch: string;
  createWorktreeCommand: LaborGitCommand;
}

export function resolveLaborPath(projectRoot: string, issueId: string): string {
  const safeIssueId = assertSafeIssueId(issueId);

  return path.join(
    path.resolve(projectRoot),
    ...LABOR_DIRECTORY_SEGMENT.split("/"),
    `${LABOR_DIRECTORY_PREFIX}${safeIssueId}`,
  );
}

export function buildLaborBranchName(issueId: string): string {
  const safeIssueId = assertSafeIssueId(issueId);

  return `${LABOR_BRANCH_PREFIX}${safeIssueId}`;
}

export function planLaborCreation(request: LaborCreationRequest): LaborCreationPlan {
  const issueId = assertSafeIssueId(request.issueId);
  const laborPath = resolveLaborPath(request.projectRoot, issueId);
  const branchName = buildLaborBranchName(issueId);

  return {
    issueId,
    laborPath,
    branchName,
    baseBranch: request.baseBranch,
    createWorktreeCommand: {
      command: "git",
      args: ["worktree", "add", "-b", branchName, laborPath, request.baseBranch],
    },
  };
}
