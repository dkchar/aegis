#!/usr/bin/env node
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { formatStatusSnapshot, getAegisStatus } from "./cli/status.js";
import { formatCasteCommandResult, runDirectCasteCommand } from "./cli/caste-command.js";
import { formatMergeCommandResult, runDirectMergeCommand } from "./cli/merge-command.js";
import { formatPhaseCommandResult, runDirectPhaseCommand } from "./cli/phase-command.js";
import { parseStartOverrides, startAegis } from "./cli/start.js";
import { stopAegis } from "./cli/stop.js";
import { streamDaemonView } from "./cli/stream.js";
import { initProject } from "./config/init-project.js";
import type { LoopPhase } from "./core/loop-runner.js";
import type { RuntimeCasteAction } from "./cli/runtime-command.js";
import { RUNTIME_ADAPTER_NAMES } from "./runtime/runtime-registry.js";
import { resolveProjectPaths, type ProjectPaths } from "./shared/paths.js";

export interface BootstrapManifest {
  appName: "aegis";
  paths: ProjectPaths;
}

const PHASE_COMMANDS = new Set<string>(["poll", "dispatch", "monitor", "reap"]);
const CASTE_COMMANDS = new Set<string>(["scout", "implement", "review", "process"]);

export const CLI_USAGE = [
  "Usage: aegis <command> [args]",
  "",
  "Project",
  "  init                    Create .aegis/ state files and ignore rules",
  "  start                   Run the daemon (poll -> triage -> dispatch -> monitor -> reap)",
  "  stop                    Stop the running daemon and release active sessions",
  "  status                  Print daemon, queue, and operational-failure status as JSON",
  "  stream [daemon]         Follow daemon and phase logs",
  "",
  "Loop phases (routed to the daemon when one is running)",
  "  poll | dispatch | monitor | reap",
  "",
  "Caste commands",
  "  scout <issue>           Run Oracle",
  "  implement <issue>       Run Titan",
  "  review <issue>          Run Sentinel",
  "  process <issue>         Advance the issue one step from its current stage",
  "  merge next              Land the next queued candidate",
  "",
  `Runtime adapters: ${RUNTIME_ADAPTER_NAMES.join(", ")} (set "runtime" in .aegis/config.json)`,
].join("\n");

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

function fail(message: string) {
  console.error(message);
  process.exitCode = 1;
}

export async function runCli(
  root = process.cwd(),
  argv = process.argv.slice(2),
): Promise<BootstrapManifest> {
  const manifest = buildBootstrapManifest(root);
  const [command, ...args] = argv;

  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(`Aegis CLI ready at ${manifest.paths.repoRoot}\n\n${CLI_USAGE}`);
    return manifest;
  }

  if (command === "init") {
    const result = initProject(root);
    const createdPathCount = result.createdDirectories.length + result.createdFiles.length;
    const gitIgnoreNote = result.updatedGitIgnore ? "; .gitignore updated" : "";
    console.log(
      `Aegis project initialized at ${manifest.paths.repoRoot} (${createdPathCount} paths created${gitIgnoreNote})`,
    );
    return manifest;
  }

  if (command === "start") {
    const result = await startAegis(root, parseStartOverrides(args));
    console.log(`Aegis started in ${result.mode} mode (pid ${process.pid})`);
    return manifest;
  }

  if (command === "status") {
    console.log(formatStatusSnapshot(await getAegisStatus(root)));
    return manifest;
  }

  if (command === "stream") {
    const target = args[0] ?? "daemon";
    if (target !== "daemon") {
      fail(`Unsupported stream target: ${target}`);
      return manifest;
    }

    await streamDaemonView(root);
    return manifest;
  }

  if (PHASE_COMMANDS.has(command)) {
    const result = await runDirectPhaseCommand(root, command as LoopPhase);
    console.log(formatPhaseCommandResult(result));
    return manifest;
  }

  if (CASTE_COMMANDS.has(command)) {
    const issueId = args[0];
    if (!issueId) {
      fail(`Missing issue id for ${command}`);
      return manifest;
    }

    const result = await runDirectCasteCommand(root, command as RuntimeCasteAction, issueId);
    console.log(formatCasteCommandResult(result));
    return manifest;
  }

  if (command === "merge" && args[0] === "next") {
    const result = await runDirectMergeCommand(root, "next");
    console.log(formatMergeCommandResult(result));
    return manifest;
  }

  if (command === "stop") {
    const result = await stopAegis(root, "manual");
    console.log(`Aegis stopped${result.forced ? " (forced)" : ""}.`);
    return manifest;
  }

  fail(`Unsupported command: ${command}\n\n${CLI_USAGE}`);
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
