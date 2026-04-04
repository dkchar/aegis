#!/usr/bin/env node
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { initProject } from "./config/init-project.js";
import type { ProjectPaths } from "./shared/paths.js";

export interface BootstrapManifest {
  appName: "aegis";
  paths: ProjectPaths;
}

function resolveProjectPaths(root = process.cwd()): ProjectPaths {
  const repoRoot = path.resolve(root);

  return {
    repoRoot,
    srcRoot: path.join(repoRoot, "src"),
    distRoot: path.join(repoRoot, "dist"),
  };
}

function normalizeExecutionPath(candidate: string) {
  const resolvedPath = path.resolve(candidate);

  try {
    return realpathSync.native(resolvedPath);
  } catch {
    return resolvedPath;
  }
}

export function buildBootstrapManifest(
  root = process.cwd(),
): BootstrapManifest {
  return {
    appName: "aegis",
    paths: resolveProjectPaths(root),
  };
}

export function runCli(
  root = process.cwd(),
  argv = process.argv.slice(2),
): BootstrapManifest {
  const manifest = buildBootstrapManifest(root);
  const [command] = argv;

  if (command === "init") {
    const result = initProject(root);
    const createdPathCount =
      result.createdDirectories.length + result.createdFiles.length;
    const gitIgnoreNote = result.updatedGitIgnore
      ? "; .gitignore updated"
      : "";

    console.log(
      `Aegis project initialized at ${manifest.paths.repoRoot} (${createdPathCount} paths created${gitIgnoreNote})`,
    );
    return manifest;
  }

  console.log(`Aegis CLI scaffold ready at ${manifest.paths.repoRoot}`);
  return manifest;
}

export function isDirectExecution(
  entrypoint = process.argv[1],
  moduleUrl = import.meta.url,
) {
  const resolvedEntrypoint = entrypoint ? normalizeExecutionPath(entrypoint) : "";

  if (!resolvedEntrypoint) {
    return false;
  }

  return resolvedEntrypoint === normalizeExecutionPath(fileURLToPath(moduleUrl));
}

if (isDirectExecution()) {
  runCli();
}
