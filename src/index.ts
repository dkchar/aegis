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
import { loadConfig } from "./config/load-config.js";
import { initProject, type InitProjectOptions } from "./config/init-project.js";
import type { LoopPhase } from "./core/loop-runner.js";
import type { RuntimeCasteAction } from "./cli/runtime-command.js";
import { assertRuntimeAdapterName, RUNTIME_ADAPTER_NAMES } from "./runtime/runtime-registry.js";
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
  "  init [--runtime <name>]  Create .aegis/ state files and ignore rules",
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

export function parseInitOptions(args: readonly string[]): InitProjectOptions {
  const [flag, value, ...rest] = args;
  if (flag === undefined) {
    return {};
  }

  const inline = flag.startsWith("--runtime=") ? flag.slice("--runtime=".length) : null;
  const runtime = inline ?? (flag === "--runtime" ? value : undefined);
  const extra = inline !== null ? [value, ...rest] : rest;
  if (!runtime || extra.some((entry) => entry !== undefined)) {
    throw new Error(`Usage: aegis init [--runtime <${RUNTIME_ADAPTER_NAMES.join("|")}>]`);
  }
  return { runtime: assertRuntimeAdapterName(runtime) };
}

function describeInitRuntime(root: string, seededConfig: boolean) {
  if (!seededConfig) {
    return "existing .aegis/config.json kept";
  }

  const { runtime } = loadConfig(root);
  return runtime === "scripted"
    ? "runtime=scripted, the deterministic test runtime that fakes agent work; run `aegis init --runtime claude|codex|pi` in a fresh repo or edit .aegis/config.json for real work"
    : `runtime=${runtime}`;
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
    const result = initProject(root, parseInitOptions(args));
    const createdPathCount = result.createdDirectories.length + result.createdFiles.length;
    const gitIgnoreNote = result.updatedGitIgnore ? "; .gitignore updated" : "";
    console.log(
      `Aegis project initialized at ${manifest.paths.repoRoot} (${createdPathCount} paths created${gitIgnoreNote}; ${describeInitRuntime(root, result.seededConfig)})`,
    );
    return manifest;
  }

  if (command === "start") {
    const result = await startAegis(root, parseStartOverrides(args));
    console.log(`Aegis started in ${result.mode} mode with runtime=${result.adapter} (pid ${process.pid})`);
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
