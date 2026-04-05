import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  LABOR_BRANCH_PREFIX,
  LABOR_DIRECTORY_PREFIX,
  LABOR_DIRECTORY_SEGMENT,
  buildLaborBranchName,
  planLaborCreation,
  resolveLaborPath,
} from "../../../src/labor/create-labor.js";
import {
  planLaborCleanup,
  type LaborCleanupOutcome,
} from "../../../src/labor/cleanup-labor.js";

describe("S09 labor contract seed", () => {
  it("derives the canonical labor path and Titan branch name from an issue id", () => {
    const projectRoot = path.resolve("C:/dev/aegis");
    const issueId = "aegis-fjm.10.1";

    expect(resolveLaborPath(projectRoot, issueId)).toBe(
      path.join(projectRoot, ".aegis", "labors", "labor-aegis-fjm.10.1"),
    );
    expect(buildLaborBranchName(issueId)).toBe("aegis/aegis-fjm.10.1");
    expect(
      planLaborCreation({
        issueId,
        projectRoot,
        baseBranch: "main",
      }),
    ).toEqual({
      issueId,
      laborPath: path.join(projectRoot, ".aegis", "labors", "labor-aegis-fjm.10.1"),
      branchName: "aegis/aegis-fjm.10.1",
      baseBranch: "main",
    });
  });

  it("pins the labor directory constants used by the contract seed", () => {
    expect(LABOR_DIRECTORY_SEGMENT).toBe(".aegis/labors");
    expect(LABOR_DIRECTORY_PREFIX).toBe("labor-");
    expect(LABOR_BRANCH_PREFIX).toBe("aegis/");
  });

  it("preserves the labor and branch after failure or conflict, but removes both after merge success", () => {
    const issueId = "aegis-fjm.10.1";
    const laborPath = path.join("C:/dev/aegis", ".aegis", "labors", "labor-aegis-fjm.10.1");
    const branchName = "aegis/aegis-fjm.10.1";

    const outcomes: Array<{
      outcome: LaborCleanupOutcome;
      preserveLabor: boolean;
      removeWorktree: boolean;
      deleteBranch: boolean;
    }> = [
      {
        outcome: "merged",
        preserveLabor: false,
        removeWorktree: true,
        deleteBranch: true,
      },
      {
        outcome: "failed",
        preserveLabor: true,
        removeWorktree: false,
        deleteBranch: false,
      },
      {
        outcome: "conflict",
        preserveLabor: true,
        removeWorktree: false,
        deleteBranch: false,
      },
      {
        outcome: "manual_recovery",
        preserveLabor: true,
        removeWorktree: false,
        deleteBranch: false,
      },
    ];

    for (const expected of outcomes) {
      expect(
        planLaborCleanup({
          issueId,
          laborPath,
          branchName,
          outcome: expected.outcome,
        }),
      ).toEqual({
        issueId,
        laborPath,
        branchName,
        outcome: expected.outcome,
        preserveLabor: expected.preserveLabor,
        removeWorktree: expected.removeWorktree,
        deleteBranch: expected.deleteBranch,
      });
    }
  });
});
