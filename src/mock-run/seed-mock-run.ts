import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { AgoraStore, type AgoraKind } from "../../packages/agora/dist/index.js";
import { createCasteConfig } from "../config/caste-config.js";
import { DEFAULT_AEGIS_CONFIG } from "../config/defaults.js";
import { initProject } from "../config/init-project.js";
import { resolveProjectRelativePath } from "../config/load-config.js";
import { AgoraTrackerClient } from "../tracker/agora-tracker.js";
import { writeJsonAtomic } from "../shared/atomic-write.js";
import { CLAUDE_DEFAULT_MODEL, CLAUDE_PROVIDER } from "../runtime/claude-caste-runtime.js";
import { isRuntimeAdapterName, type RuntimeAdapterName } from "../runtime/runtime-registry.js";
import { resolveDefaultMockWorkspaceRoot } from "./mock-paths.js";
import { TODO_MOCK_RUN_MANIFEST } from "./todo-manifest.js";
import type { MockRunIssueDefinition } from "./types.js";

export interface SeedMockRunOptions {
  workspaceRoot?: string;
  repoName?: string;
  runtime?: RuntimeAdapterName;
  modelReference?: string;
}

export interface SeedMockRunResult {
  repoRoot: string;
  databaseName: string;
  issueIdByKey: Record<string, string>;
  initialReadyKeys: string[];
}

export const MOCK_RUN_LABOR_BASE_PATH = ".aegis/labors";
const MOCK_RUN_CODEX_MODEL_REFERENCE = "openai-codex:gpt-5.4-mini";
const MOCK_RUN_PI_MODEL_REFERENCE = "github-copilot:gpt-5.4-mini";
const MOCK_RUN_CLAUDE_MODEL_REFERENCE = `${CLAUDE_PROVIDER}:${CLAUDE_DEFAULT_MODEL}`;
const MOCK_RUN_DEFAULT_THINKING_LEVEL = "medium";
const MOCK_RUN_CODEX_THINKING_LEVEL = "low";
const MOCK_RUN_STUCK_WARNING_SECONDS = 420;
const MOCK_RUN_STUCK_KILL_SECONDS = 1_200;

function sleepMs(milliseconds: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function removeDirectoryWithRetries(targetPath: string, maxAttempts: number = 8) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      rmSync(targetPath, { recursive: true, force: true });
      return;
    } catch (error) {
      const errorCode =
        error && typeof error === "object" && "code" in error
          ? String((error as NodeJS.ErrnoException).code)
          : null;
      const retriable = errorCode === "EBUSY" || errorCode === "ENOTEMPTY";

      if (!retriable || attempt === maxAttempts) {
        throw error;
      }

      sleepMs(attempt * 250);
    }
  }
}

function run(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  }).trim();
}

function normalizeMockScopeFile(candidate: string) {
  return candidate.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

export function formatMockRunIssueDescription(issue: MockRunIssueDefinition) {
  const files = (issue.fileScope ?? [])
    .map((entry) => normalizeMockScopeFile(entry))
    .filter((entry) => entry.length > 0);

  if (files.length === 0) {
    return issue.description;
  }

  return [
    issue.description.trim(),
    "",
    `Aegis file ownership: ${files.join(", ")}`,
    "Only edit these owned files. If required work is outside this scope, emit a blocking mutation proposal instead of editing sibling-lane files.",
  ].join("\n");
}

export function buildMockRunConfig(options?: {
  uncapped?: boolean;
  runtime?: RuntimeAdapterName;
  modelReference?: string;
}) {
  const uncapped = options?.uncapped ?? true;
  const runtime = options?.runtime ?? "scripted";
  const modelReference = options?.modelReference ?? resolveDefaultMockModelReference(runtime);
  const thinkingLevel = runtime === "codex"
    ? MOCK_RUN_CODEX_THINKING_LEVEL
    : MOCK_RUN_DEFAULT_THINKING_LEVEL;

  const baseConfig = {
    ...DEFAULT_AEGIS_CONFIG,
    runtime,
    models: createCasteConfig(() => modelReference),
    thinking: createCasteConfig(() => thinkingLevel),
    thresholds: {
      ...DEFAULT_AEGIS_CONFIG.thresholds,
      stuck_warning_seconds: MOCK_RUN_STUCK_WARNING_SECONDS,
      stuck_kill_seconds: MOCK_RUN_STUCK_KILL_SECONDS,
    },
    labor: {
      ...DEFAULT_AEGIS_CONFIG.labor,
      base_path: MOCK_RUN_LABOR_BASE_PATH,
    },
  };

  if (!uncapped) return baseConfig;

  // Uncapped profile for stress testing observation.
  return {
    ...baseConfig,
    concurrency: {
      max_agents: 10,
      max_oracles: 5,
      max_titans: 10,
      max_sentinels: 3,
      max_janus: 2,
    },
  };
}

function resolveDefaultMockModelReference(runtime: RuntimeAdapterName) {
  if (runtime === "pi") {
    return MOCK_RUN_PI_MODEL_REFERENCE;
  }
  if (runtime === "claude") {
    return MOCK_RUN_CLAUDE_MODEL_REFERENCE;
  }
  return MOCK_RUN_CODEX_MODEL_REFERENCE;
}

function assertExpectedReadyQueue(actualKeys: string[], expectedKeys: readonly string[]) {
  if (actualKeys.length !== expectedKeys.length) {
    throw new Error(
      `Mock run ready queue mismatch: expected ${expectedKeys.join(", ")}, got ${actualKeys.join(", ")}`,
    );
  }

  for (const [index, expectedKey] of expectedKeys.entries()) {
    if (actualKeys[index] !== expectedKey) {
      throw new Error(
        `Mock run ready queue mismatch at index ${index}: expected ${expectedKey}, got ${actualKeys[index]}`,
      );
    }
  }
}

function toAgoraKind(issue: MockRunIssueDefinition): AgoraKind {
  if (issue.queueRole === "coordination") {
    return "task";
  }

  return issue.issueType === "task" ? "task" : "feature";
}

function seedAgoraIssue(
  store: AgoraStore,
  issue: MockRunIssueDefinition,
  issueIdByKey: Record<string, string>,
): string {
  const blockedBy = issue.blocks.map((key) => {
    const blockerId = issueIdByKey[key];
    if (!blockerId) {
      throw new Error(`Mock issue "${issue.key}" depends on unknown key "${key}".`);
    }

    return blockerId;
  });
  const parent = issue.parentKey ? issueIdByKey[issue.parentKey] ?? null : null;
  if (issue.parentKey && !parent) {
    throw new Error(`Mock issue "${issue.key}" parent "${issue.parentKey}" is unknown.`);
  }
  const labels = [
    ...issue.labels,
    `key:${issue.key}`,
    `priority:${issue.priority}`,
    `role:${issue.queueRole}`,
  ];
  const ticket = store.createTicket({
    title: issue.title,
    body: formatMockRunIssueDescription(issue),
    kind: toAgoraKind(issue),
    column: issue.queueRole === "coordination"
      ? "backlog"
      : blockedBy.length === 0
        ? "ready"
        : "blocked",
    parent,
    blockedBy,
    scope: issue.fileScope ?? [],
    labels,
    actor: "seed",
  });
  issueIdByKey[issue.key] = ticket.id;
  return ticket.id;
}

export async function seedMockRun(options: SeedMockRunOptions = {}): Promise<SeedMockRunResult> {
  const workspaceRoot = path.resolve(options.workspaceRoot ?? resolveDefaultMockWorkspaceRoot());
  const repoName = options.repoName ?? TODO_MOCK_RUN_MANIFEST.repoName;
  const repoRoot = path.join(workspaceRoot, repoName);
  const databaseName = "agora";

  removeDirectoryWithRetries(repoRoot);
  mkdirSync(repoRoot, { recursive: true });

  run("git", ["init"], repoRoot);
  run("git", ["config", "user.email", "mock-run@aegis.local"], repoRoot);
  run("git", ["config", "user.name", "Aegis Mock Run"], repoRoot);
  initProject(repoRoot);

  const mockRunConfig = buildMockRunConfig({
    runtime: options.runtime,
    modelReference: options.modelReference,
  });

  writeJsonAtomic(resolveProjectRelativePath(repoRoot, ".aegis/config.json"), mockRunConfig);

  const issueIdByKey: Record<string, string> = {};
  const store = new AgoraStore({ root: repoRoot });
  store.init("seed");
  for (const issue of TODO_MOCK_RUN_MANIFEST.issues) {
    seedAgoraIssue(store, issue, issueIdByKey);
  }

  run("git", ["add", "--all"], repoRoot);
  run("git", ["commit", "-m", "mock baseline"], repoRoot);
  run("git", ["branch", "-M", "main"], repoRoot);

  const tracker = new AgoraTrackerClient();
  const initialReady = await tracker.listReadyIssues(repoRoot);
  const initialReadyKeys = initialReady.map((readyIssue) => {
    const match = Object.entries(issueIdByKey).find(([, issueId]) => issueId === readyIssue.id);
    return match?.[0] ?? readyIssue.id;
  });
  assertExpectedReadyQueue(initialReadyKeys, TODO_MOCK_RUN_MANIFEST.expectedInitialReadyKeys);

  return {
    repoRoot,
    databaseName,
    issueIdByKey,
    initialReadyKeys,
  };
}

function isDirectExecution(entryPoint = process.argv[1]): boolean {
  if (!entryPoint) {
    return false;
  }

  return path.resolve(entryPoint) === path.resolve(fileURLToPath(import.meta.url));
}

if (isDirectExecution()) {
  const runtime = process.env.AEGIS_MOCK_RUN_RUNTIME;
  const modelReference = process.env.AEGIS_MOCK_RUN_MODEL_REFERENCE;
  seedMockRun({
    runtime: isRuntimeAdapterName(runtime) ? runtime : undefined,
    modelReference,
  }).then(
    (result) => {
      console.log(`Mock repo seeded at ${result.repoRoot}`);
    },
    (error: unknown) => {
      const details = error instanceof Error ? error.message : String(error);
      console.error(details);
      process.exitCode = 1;
    },
  );
}
