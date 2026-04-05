import path from "node:path";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

interface RootPackageJson {
  scripts?: Record<string, string>;
}

function readText(relativePath: string) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function readPackageJson() {
  return JSON.parse(readText("package.json")) as RootPackageJson;
}

describe("GitHub workflow contracts", () => {
  it("CI workflow build step uses a script that exists in package.json", () => {
    const workflow = readText(".github/workflows/ci.yml");
    const scripts = readPackageJson().scripts ?? {};

    expect(workflow).toContain("run: npm run build");
    expect(workflow).not.toContain("run: npm run build:all");
    expect(scripts.build).toBeDefined();
  });

  it("automerge workflow performs a preflight check before invoking the merge action", () => {
    const workflow = readText(".github/workflows/automerge.yml");

    expect(workflow).toContain("workflow_run:");
    expect(workflow).toContain("workflows: [\"CI\"]");
    expect(workflow).toContain("check_run:");
    expect(workflow).toContain("workflowRun?.conclusion !== \"success\"");
    expect(workflow).toContain("actions/github-script@v7");
    expect(workflow).toContain("name: Guard automerge on passing checks");
    expect(workflow).toContain("ignoring the automerge workflow's own check run");
    expect(workflow).toContain("status !== \"completed\"");
    expect(workflow).toContain("Auto-merge if checks pass");
    expect(workflow).toContain("MERGE_LABELS: \"automerge\"");
  });
});
