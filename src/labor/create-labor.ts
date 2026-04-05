import path from "node:path";

export const LABOR_DIRECTORY_SEGMENT = ".aegis/labors";
export const LABOR_DIRECTORY_PREFIX = "labor-";
export const LABOR_BRANCH_PREFIX = "aegis/";

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
}

export function resolveLaborPath(projectRoot: string, issueId: string): string {
  return path.join(path.resolve(projectRoot), ".aegis", "labors", `${LABOR_DIRECTORY_PREFIX}${issueId}`);
}

export function buildLaborBranchName(issueId: string): string {
  return `${LABOR_BRANCH_PREFIX}${issueId}`;
}

export function planLaborCreation(request: LaborCreationRequest): LaborCreationPlan {
  return {
    issueId: request.issueId,
    laborPath: resolveLaborPath(request.projectRoot, request.issueId),
    branchName: buildLaborBranchName(request.issueId),
    baseBranch: request.baseBranch,
  };
}
