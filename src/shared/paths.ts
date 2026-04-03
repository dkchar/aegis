import path from "node:path";

export interface ProjectPaths {
  repoRoot: string;
  srcRoot: string;
  distRoot: string;
}

export function resolveProjectPaths(root = process.cwd()): ProjectPaths {
  const repoRoot = path.resolve(root);

  return {
    repoRoot,
    srcRoot: path.join(repoRoot, "src"),
    distRoot: path.join(repoRoot, "dist"),
  };
}

export const projectPaths = resolveProjectPaths();
