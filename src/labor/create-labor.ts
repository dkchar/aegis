import path from "node:path";

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

function sanitizeIssueId(issueId: string) {
  return issueId.replace(/[^a-zA-Z0-9._-]/g, "-");
}

export function buildLaborBranchName(issueId: string) {
  return `aegis/${sanitizeIssueId(issueId)}`;
}

export function planLaborCreation(request: LaborCreationRequest): LaborCreationPlan {
  const safeIssueId = sanitizeIssueId(request.issueId);
  const laborPath = path.join(
    path.resolve(request.projectRoot),
    ".aegis",
    "labors",
    `labor-${safeIssueId}`,
  );
  const branchName = buildLaborBranchName(request.issueId);

  return {
    issueId: request.issueId,
    laborPath,
    branchName,
    baseBranch: request.baseBranch,
    createWorktreeCommand: {
      command: "git",
      args: ["worktree", "add", "-b", branchName, laborPath, request.baseBranch],
    },
  };
}
