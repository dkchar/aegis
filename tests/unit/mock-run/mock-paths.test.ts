import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_MOCK_QA_DIRECTORY_NAME,
  DEFAULT_MOCK_REPO_NAME,
  resolveDefaultMockRepoRoot,
  resolveDefaultMockWorkspaceRoot,
} from "../../../src/mock-run/mock-paths.js";

describe("mock paths", () => {
  it("resolves default workspace root to ../aegis-qa from cwd", () => {
    expect(resolveDefaultMockWorkspaceRoot("/repo/aegis")).toBe(
      path.resolve("/repo/aegis", "..", DEFAULT_MOCK_QA_DIRECTORY_NAME),
    );
  });

  it("resolves default mock repo root under default workspace", () => {
    expect(resolveDefaultMockRepoRoot("/repo/aegis")).toBe(
      path.resolve("/repo/aegis", "..", DEFAULT_MOCK_QA_DIRECTORY_NAME, DEFAULT_MOCK_REPO_NAME),
    );
  });
});
