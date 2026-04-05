import path from "node:path";

export interface ProjectPaths {
  repoRoot: string;
  srcRoot: string;
  distRoot: string;
}

function buildProjectPaths(repoRoot: string): ProjectPaths {
  return {
    repoRoot,
    srcRoot: path.join(repoRoot, "src"),
    distRoot: path.join(repoRoot, "dist"),
  };
}

export function resolveProjectPaths(root = process.cwd()): ProjectPaths {
  const repoRoot = path.resolve(root);

  return buildProjectPaths(repoRoot);
}

export const projectPaths = resolveProjectPaths();
