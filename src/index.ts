#!/usr/bin/env node
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { formatStatusSnapshot, getAegisStatus } from "./cli/status.js";
import { formatCasteCommandResult, runDirectCasteCommand } from "./cli/caste-command.js";
import { formatPhaseCommandResult, runDirectPhaseCommand } from "./cli/phase-command.js";
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

export async function runCli(
  root = process.cwd(),
  argv = process.argv.slice(2),
): Promise<BootstrapManifest> {
  const manifest = buildBootstrapManifest(root);
  const [command] = argv;

  if (!command) {
    console.log(`Aegis CLI scaffold ready at ${manifest.paths.repoRoot}`);
    return manifest;
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
    return manifest;
  }

  if (command === "start") {
    const overrides = parseStartOverrides(argv.slice(1));
    const result = await startAegis(root, overrides);
    console.log(`Aegis started in ${result.mode} mode (pid ${process.pid})`);
    return manifest;
  }

  if (command === "status") {
    const snapshot = await getAegisStatus(root);
    console.log(formatStatusSnapshot(snapshot));
    return manifest;
  }

  if (
    command === "poll"
    || command === "dispatch"
    || command === "monitor"
    || command === "reap"
  ) {
    const result = await runDirectPhaseCommand(root, command);
    console.log(formatPhaseCommandResult(result));
    return manifest;
  }

  if (
    command === "scout"
    || command === "implement"
    || command === "review"
    || command === "process"
  ) {
    const issueId = argv[1];

    if (!issueId) {
      console.error(`Missing issue id for ${command}`);
      process.exitCode = 1;
      return manifest;
    }

    const result = await runDirectCasteCommand(root, command, issueId);
    console.log(formatCasteCommandResult(result));
    return manifest;
  }

  if (command === "stop") {
    const result = await stopAegis(root, "manual");
    const forcedSuffix = result.forced ? " (forced)" : "";
    console.log(`Aegis stopped${forcedSuffix}.`);
    return manifest;
  }
  console.error(`Unsupported command: ${command}`);
  process.exitCode = 1;

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
  runCli().catch((error) => {
    const details = error instanceof Error ? error.message : String(error);
    console.error(details);
    process.exitCode = 1;
  });
}
