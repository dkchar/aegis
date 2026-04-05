import type { LaborGitCommand } from "./create-labor.js";

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
  cleanupCommands: readonly LaborGitCommand[];
}

export function planLaborCleanup(request: LaborCleanupRequest): LaborCleanupPlan {
  const preserveLabor = request.outcome !== "merged";
  const cleanupCommands: readonly LaborGitCommand[] = preserveLabor
    ? []
    : [
        {
          command: "git",
          args: ["worktree", "remove", request.laborPath],
        },
        {
          command: "git",
          args: ["branch", "-d", request.branchName],
        },
      ];

  return {
    issueId: request.issueId,
    laborPath: request.laborPath,
    branchName: request.branchName,
    outcome: request.outcome,
    preserveLabor,
    removeWorktree: !preserveLabor,
    deleteBranch: !preserveLabor,
    cleanupCommands,
  };
}
