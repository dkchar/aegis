import { describe, expect, it } from "vitest";

import { formatMockRunIssueDescription } from "../../../src/mock-run/seed-mock-run.js";
import { TODO_MOCK_RUN_ISSUES } from "../../../src/mock-run/todo-manifest.js";
import type { MockRunIssueDefinition } from "../../../src/mock-run/types.js";

function fileScopeOf(issue: MockRunIssueDefinition) {
  return (issue as MockRunIssueDefinition & { fileScope?: string[] }).fileScope ?? [];
}

describe("TODO_MOCK_RUN_ISSUES", () => {
  it("declares explicit file ownership for every executable issue", () => {
    const executableIssues = TODO_MOCK_RUN_ISSUES.filter((issue) => issue.queueRole === "executable");

    expect(executableIssues).not.toHaveLength(0);
    for (const issue of executableIssues) {
      expect(fileScopeOf(issue), issue.key).not.toHaveLength(0);
    }
  });

  it("keeps parallel executable lane ownership disjoint", () => {
    const grouped = new Map<string, MockRunIssueDefinition[]>();
    for (const issue of TODO_MOCK_RUN_ISSUES.filter((candidate) => candidate.queueRole === "executable")) {
      const key = `${issue.parentKey ?? "_root"}::${issue.blocks.slice().sort().join("|")}`;
      grouped.set(key, [...(grouped.get(key) ?? []), issue]);
    }

    for (const issues of grouped.values()) {
      if (issues.length < 2) {
        continue;
      }
      const ownerByFile = new Map<string, string>();
      for (const issue of issues) {
        for (const file of fileScopeOf(issue)) {
          expect(ownerByFile.get(file), `${file} is shared by ${ownerByFile.get(file)} and ${issue.key}`).toBeUndefined();
          ownerByFile.set(file, issue.key);
        }
      }
    }
  });

  it("formats file ownership into the seeded issue description", () => {
    const issue = {
      ...TODO_MOCK_RUN_ISSUES.find((candidate) => candidate.key === "setup.contract")!,
      fileScope: ["docs/setup-contract.md"],
    };

    expect(formatMockRunIssueDescription(issue)).toContain(
      "Aegis file ownership: docs/setup-contract.md",
    );
  });

  it("orders setup prerequisites before scaffold work", () => {
    const byKey = new Map(TODO_MOCK_RUN_ISSUES.map((issue) => [issue.key, issue]));

    expect(byKey.get("setup.dependencies")?.blocks).toEqual(["setup.contract"]);
    expect(byKey.get("setup.scaffold")?.blocks).toEqual(["setup.dependencies"]);
    expect(byKey.get("setup.tooling")?.blocks).toEqual(["setup.scaffold"]);
    expect(byKey.get("setup.gate")?.blocks).toContain("setup.scaffold");
  });

  it("lets setup tooling own package scripts after scaffold exists", () => {
    const toolingScope = fileScopeOf(TODO_MOCK_RUN_ISSUES.find((issue) => issue.key === "setup.tooling")!);

    expect(toolingScope).toContain("package.json");
    expect(toolingScope).toContain("package-lock.json");
  });

  it("keeps package-run commands in the setup dependency lane", () => {
    const dependencies = TODO_MOCK_RUN_ISSUES.find((issue) => issue.key === "setup.dependencies")!;
    const scaffold = TODO_MOCK_RUN_ISSUES.find((issue) => issue.key === "setup.scaffold")!;

    expect(dependencies.description).toContain("dev/build/preview");
    expect(dependencies.description).toContain("Vite");
    expect(dependencies.description).toContain("Do not require build or preview checks to pass");
    expect(dependencies.description).toContain("Do not create blockers for scaffold or tooling files");
    expect(scaffold.description).not.toContain("npm scripts");
  });

  it("lists blockers before dependents for deterministic seeding", () => {
    const seen = new Set<string>();

    for (const issue of TODO_MOCK_RUN_ISSUES) {
      for (const blocker of issue.blocks) {
        expect(seen.has(blocker), `${issue.key} references later blocker ${blocker}`).toBe(true);
      }
      seen.add(issue.key);
    }
  });
});
