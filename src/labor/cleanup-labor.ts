export type LaborCleanupOutcome = "merged" | "failed" | "conflict" | "manual_recovery";

export interface LaborCleanupRequest {
  issueId: string;
  laborPath: string;
  branchName: string;
  outcome: LaborCleanupOutcome;
}

export interface LaborCleanupPlan {
  issueId: string;
  laborPath: string;
  branchName: string;
  outcome: LaborCleanupOutcome;
  preserveLabor: boolean;
  removeWorktree: boolean;
  deleteBranch: boolean;
}

export function planLaborCleanup(request: LaborCleanupRequest): LaborCleanupPlan {
  const preserveLabor = request.outcome !== "merged";

  return {
    issueId: request.issueId,
    laborPath: request.laborPath,
    branchName: request.branchName,
    outcome: request.outcome,
    preserveLabor,
    removeWorktree: !preserveLabor,
    deleteBranch: !preserveLabor,
  };
}
