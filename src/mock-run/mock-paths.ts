import path from "node:path";

export const DEFAULT_MOCK_QA_DIRECTORY_NAME = "aegis-qa";
export const DEFAULT_MOCK_REPO_NAME = "aegis-mock-run";

export function resolveDefaultMockWorkspaceRoot(cwd = process.cwd()) {
  return path.resolve(cwd, "..", DEFAULT_MOCK_QA_DIRECTORY_NAME);
}

export function resolveDefaultMockRepoRoot(cwd = process.cwd()) {
  return path.join(resolveDefaultMockWorkspaceRoot(cwd), DEFAULT_MOCK_REPO_NAME);
}
