#!/usr/bin/env node
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { formatStatusSnapshot, getAegisStatus } from "./cli/status.js";
import { parseStartOverrides, startAegis } from "./cli/start.js";
import { stopAegis } from "./cli/stop.js";
import { initProject } from "./config/init-project.js";
import { resolveProjectPaths, type ProjectPaths } from "./shared/paths.js";

export interface BootstrapManifest {
  appName: "aegis";
  paths: ProjectPaths;
}

function normalizeExecutionPath(candidate: string) {
  const resolvedPath = path.resolve(candidate);

  try {
    return realpathSync.native(resolvedPath);
  } catch {
    return resolvedPath;
  }
}

export function buildBootstrapManifest(root = process.cwd()): BootstrapManifest {
  return {
    appName: "aegis",
    paths: resolveProjectPaths(root),
  };
}

export function runCli(
  root = process.cwd(),
  argv = process.argv.slice(2),
): Promise<BootstrapManifest> {
  const manifest = buildBootstrapManifest(root);
  const [command] = argv;

  if (!command) {
    console.log(`Aegis CLI scaffold ready at ${manifest.paths.repoRoot}`);
    return Promise.resolve(manifest);
  }

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
    return Promise.resolve(manifest);
  }

  if (command === "start") {
    const overrides = parseStartOverrides(argv.slice(1));

    return startAegis(root, overrides).then((result) => {
      console.log(`Aegis started at ${result.url} (pid ${process.pid})`);
      return manifest;
    });
  }

  if (command === "status") {
    return getAegisStatus(root).then((snapshot) => {
      console.log(formatStatusSnapshot(snapshot));
      return manifest;
    });
  }

  if (command === "stop") {
    return stopAegis(root, "manual").then((result) => {
      const forcedSuffix = result.forced ? " (forced)" : "";
      console.log(`Aegis stopped${forcedSuffix}.`);
      return manifest;
    });
  }

  return Promise.reject(new Error(`Unknown command: ${command}`));
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
  runCli().catch((error) => {
    const details = error instanceof Error ? error.message : String(error);
    console.error(details);
    process.exitCode = 1;
  });
}
