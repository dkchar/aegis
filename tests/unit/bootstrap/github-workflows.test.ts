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

  it("automerge workflow triggers on CI completion and uses label-gated merge", () => {
    const workflow = readText(".github/workflows/automerge.yml");

    expect(workflow).toContain("workflow_run:");
    expect(workflow).toContain("types: [completed]");
    expect(workflow).toContain("pull_request_review:");
    expect(workflow).toContain("pascalgn/automerge-action");
    expect(workflow).toContain("MERGE_METHOD: squash");
    expect(workflow).toContain('MERGE_LABELS: "automerge"');
    expect(workflow).toContain("MERGE_DELETE_BRANCH: true");
    expect(workflow).toContain("MERGE_RETRIES:");
    expect(workflow).toContain("UPDATE_METHOD: rebase");
  });
});
