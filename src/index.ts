#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveProjectPaths } from "./shared/paths.js";

export interface BootstrapManifest {
  appName: "aegis";
  paths: ReturnType<typeof resolveProjectPaths>;
}

export function buildBootstrapManifest(
  root = process.cwd(),
): BootstrapManifest {
  return {
    appName: "aegis",
    paths: resolveProjectPaths(root),
  };
}

export function runCli(root = process.cwd()): BootstrapManifest {
  const manifest = buildBootstrapManifest(root);
  console.log(`Aegis CLI scaffold ready at ${manifest.paths.repoRoot}`);
  return manifest;
}

function isDirectExecution() {
  const entrypoint = process.argv[1];

  if (!entrypoint) {
    return false;
  }

  return path.resolve(entrypoint) === fileURLToPath(import.meta.url);
}

if (isDirectExecution()) {
  runCli();
}
