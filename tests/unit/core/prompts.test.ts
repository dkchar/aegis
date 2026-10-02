import { describe, expect, it } from "vitest";

import { buildTerminalGuard, buildTitanPrompt } from "../../../src/core/caste/prompts.js";
import type { AegisIssue } from "../../../src/tracker/issue-model.js";

const issue: AegisIssue = {
  id: "AG-1",
  title: "Add todo list",
  description: "Render todos.",
  issueClass: "primary",
  status: "open",
  priority: 1,
  blockers: [],
  parentId: null,
  childIds: [],
  labels: [],
};

describe("buildTerminalGuard", () => {
  it("keeps POSIX prompts free of PowerShell instructions", () => {
    const guard = buildTerminalGuard("linux").join("\n");

    expect(guard).toContain("npm run build");
    expect(guard).toContain("Do not run dev, preview, watch, or server commands");
    expect(guard).not.toMatch(/npm\.cmd|PowerShell|Test-Path|LASTEXITCODE/);
  });

  it("adds the Windows command guard on win32", () => {
    const guard = buildTerminalGuard("win32").join("\n");

    expect(guard).toContain("npm.cmd run build");
    expect(guard).toContain("Windows command guard");
    expect(guard).toContain("$LASTEXITCODE -eq 1");
  });

  it("states the long-running command rule once in Titan prompts", () => {
    const prompt = buildTitanPrompt(issue, "/repo/.aegis/labors/AG-1");

    expect(prompt.match(/server commands/g)).toHaveLength(1);
  });
});
