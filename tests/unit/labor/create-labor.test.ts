import { describe, expect, it } from "vitest";

import { buildLaborBranchName, planLaborCreation } from "../../../src/labor/create-labor.js";

describe("planLaborCreation", () => {
  it("creates a deterministic labor branch and worktree path per issue", () => {
    const plan = planLaborCreation({
      issueId: "aegis-123",
      projectRoot: "C:/repo",
      baseBranch: "feat/emergency-mvp-rewrite",
    });

    expect(buildLaborBranchName("aegis-123")).toBe("aegis/aegis-123");
    expect(plan.laborPath).toContain(".aegis");
    expect(plan.createWorktreeCommand.args).toEqual([
      "worktree",
      "add",
      "-b",
      "aegis/aegis-123",
      plan.laborPath,
      "feat/emergency-mvp-rewrite",
    ]);
  });
});
