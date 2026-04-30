import path from "node:path";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { buildLaborBranchName, planLaborCreation, prepareLaborWorktree } from "../../../src/labor/create-labor.js";

function runGit(cwd: string, args: string[]) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

describe("planLaborCreation", () => {
  it("creates a deterministic labor branch and worktree path per issue", () => {
    const plan = planLaborCreation({
      issueId: "aegis-123",
      projectRoot: "repo",
      baseBranch: "main",
      laborBasePath: "scratchpad",
    });

    expect(buildLaborBranchName("aegis-123")).toBe("aegis/aegis-123");
    expect(plan.laborPath).toBe(path.join(path.resolve("repo"), "scratchpad", "aegis-123"));
    expect(plan.createWorktreeCommand.args).toEqual([
      "worktree",
      "add",
      "-b",
      "aegis/aegis-123",
      plan.laborPath,
      "main",
    ]);
  });

  it("adds labor-local excludes for generated dependency artifacts", () => {
    const root = mkdtempSync(path.join(tmpdir(), "aegis-labor-"));
    try {
      runGit(root, ["init", "-b", "main"]);
      runGit(root, ["config", "user.email", "test@example.com"]);
      runGit(root, ["config", "user.name", "Test User"]);
      writeFileSync(path.join(root, ".gitignore"), "labors/\n", "utf8");
      writeFileSync(path.join(root, "README.md"), "baseline\n", "utf8");
      runGit(root, ["add", ".gitignore", "README.md"]);
      runGit(root, ["commit", "-m", "baseline"]);

      const plan = planLaborCreation({
        issueId: "aegis-123",
        projectRoot: root,
        baseBranch: "main",
        laborBasePath: "labors",
      });
      prepareLaborWorktree(plan);

      const commonGitDir = runGit(plan.laborPath, ["rev-parse", "--git-common-dir"]).trim();
      const excludePath = path.join(path.resolve(plan.laborPath, commonGitDir), "info", "exclude");
      const exclude = readFileSync(excludePath, "utf8");
      expect(exclude).toContain("node_modules/");
      expect(exclude).toContain("dist/");

      mkdirSync(path.join(plan.laborPath, "node_modules", ".bin"), { recursive: true });
      writeFileSync(path.join(plan.laborPath, "node_modules", ".bin", "vite"), "", "utf8");
      expect(runGit(plan.laborPath, ["status", "--porcelain", "--untracked-files=all"])).toBe("");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refreshes an existing labor worktree from the current base branch when requested", () => {
    const root = mkdtempSync(path.join(tmpdir(), "aegis-labor-refresh-"));
    try {
      runGit(root, ["init", "-b", "main"]);
      runGit(root, ["config", "user.email", "test@example.com"]);
      runGit(root, ["config", "user.name", "Test User"]);
      writeFileSync(path.join(root, ".gitignore"), "labors/\n", "utf8");
      writeFileSync(path.join(root, "README.md"), "baseline\n", "utf8");
      runGit(root, ["add", "."]);
      runGit(root, ["commit", "-m", "baseline"]);

      const plan = planLaborCreation({
        issueId: "aegis-123",
        projectRoot: root,
        baseBranch: "main",
        laborBasePath: "labors",
      });
      prepareLaborWorktree(plan);
      writeFileSync(path.join(plan.laborPath, "README.md"), "stale labor\n", "utf8");
      writeFileSync(path.join(plan.laborPath, "scratch.txt"), "delete me\n", "utf8");

      writeFileSync(path.join(root, "README.md"), "fresh main\n", "utf8");
      runGit(root, ["add", "README.md"]);
      runGit(root, ["commit", "-m", "update main"]);

      prepareLaborWorktree({ ...plan, refreshExisting: true });

      expect(readFileSync(path.join(plan.laborPath, "README.md"), "utf8").replace(/\r\n/g, "\n")).toBe("fresh main\n");
      expect(runGit(plan.laborPath, ["status", "--porcelain", "--untracked-files=all"])).toBe("");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
