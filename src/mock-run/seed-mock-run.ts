import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { DEFAULT_AEGIS_CONFIG } from "../config/defaults.js";
import { initProject } from "../config/init-project.js";
import { resolveProjectRelativePath } from "../config/load-config.js";
import { TODO_MOCK_RUN_MANIFEST } from "./todo-manifest.js";
import type { MockRunIssueDefinition } from "./types.js";

export interface SeedMockRunOptions {
  workspaceRoot?: string;
  repoName?: string;
  beadsPrefix?: string;
}

export interface SeedMockRunResult {
  repoRoot: string;
  databaseName: string;
  issueIdByKey: Record<string, string>;
  initialReadyKeys: string[];
  manifestPath: string;
}

export interface MockRunBdSupport {
  supported: boolean;
  reason: string;
}

interface MockRunManifestFile {
  repoRoot: string;
  databaseName: string;
  generatedAt: string;
  issueIdByKey: Record<string, string>;
  initialReadyKeys: string[];
  configuredModels: Record<string, string>;
}

interface BdIssueRecord {
  id: string;
  title: string;
}

interface BdInitHelpProbeResult {
  found: boolean;
  status: number | null;
  output: string;
}

function run(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  }).trim();
}

function runGlobalBd(args: string[]): string {
  return run("bd", args, process.cwd());
}

function defaultBdInitHelpProbe(): BdInitHelpProbeResult {
  const result = spawnSync("bd", ["init", "--help"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  const errorCode =
    result.error && "code" in result.error ? String(result.error.code) : null;

  if (errorCode === "ENOENT") {
    return {
      found: false,
      status: null,
      output: "",
    };
  }

  return {
    found: !result.error,
    status: result.status ?? null,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

export function getMockRunBdSupport(
  probe: () => BdInitHelpProbeResult = defaultBdInitHelpProbe,
): MockRunBdSupport {
  const result = probe();

  if (!result.found) {
    return {
      supported: false,
      reason: "bd CLI not found on PATH",
    };
  }

  if (result.status !== 0) {
    return {
      supported: false,
      reason: "bd init --help failed",
    };
  }

  const missingFlags = ["--shared-server", "--skip-agents"].filter(
    (flag) => !result.output.includes(flag),
  );

  if (missingFlags.length > 0) {
    return {
      supported: false,
      reason: `bd CLI is missing required init flags: ${missingFlags.join(", ")}`,
    };
  }

  return {
    supported: true,
    reason: "compatible",
  };
}

function parseBdIssue(raw: string): BdIssueRecord {
  const parsed = JSON.parse(raw) as BdIssueRecord | BdIssueRecord[];
  return Array.isArray(parsed) ? parsed[0]! : parsed;
}

function parseBdReady(raw: string): BdIssueRecord[] {
  const parsed = JSON.parse(raw) as BdIssueRecord[];
  return Array.isArray(parsed) ? parsed : [];
}

function writeProjectFile(root: string, relativePath: string, contents: string) {
  const targetPath = path.join(root, relativePath);
  mkdirSync(path.dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, contents.endsWith("\n") ? contents : `${contents}\n`, "utf8");
}

function createDatabaseName(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}`;
}

function buildMockRunConfig(options?: { uncapped?: boolean }) {
  const uncapped = options?.uncapped ?? true;

  const baseConfig = {
    ...DEFAULT_AEGIS_CONFIG,
    models: {
      ...DEFAULT_AEGIS_CONFIG.models,
      oracle: "pi:gemma-4-31b-it",
      titan: "pi:gemma-4-31b-it",
      sentinel: "pi:gemma-4-31b-it",
    },
    olympus: {
      ...DEFAULT_AEGIS_CONFIG.olympus,
      open_browser: false,
    },
  };

  if (!uncapped) return baseConfig;

  // Uncapped profile for stress testing observation
  return {
    ...baseConfig,
    concurrency: {
      max_agents: 10,
      max_oracles: 5,
      max_titans: 10,
      max_sentinels: 3,
      max_janus: 2,
    },
    budgets: {
      oracle: { turns: 50, tokens: 500_000 },
      titan: { turns: 100, tokens: 2_000_000 },
      sentinel: { turns: 30, tokens: 500_000 },
      janus: { turns: 50, tokens: 1_000_000 },
    },
    economics: {
      ...baseConfig.economics,
      daily_cost_warning_usd: 100,
      daily_hard_stop_usd: 200,
    },
  };
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

function writeMockRunManifest(
  repoRoot: string,
  manifest: MockRunManifestFile,
): string {
  const manifestPath = resolveProjectRelativePath(repoRoot, ".aegis/mock-run-manifest.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifestPath;
}

function createIssue(
  repoRoot: string,
  issue: MockRunIssueDefinition,
  issueIdByKey: Record<string, string>,
): string {
  const args = [
    "create",
    "--title",
    issue.title,
    "--description",
    issue.description,
    "--type",
    issue.issueType,
    "--priority",
    String(issue.priority),
    "--labels",
    issue.labels.join(","),
    "--json",
  ];

  if (issue.parentKey) {
    args.splice(args.length - 1, 0, "--parent", issueIdByKey[issue.parentKey]!);
  }

  const created = parseBdIssue(run("bd", args, repoRoot));
  issueIdByKey[issue.key] = created.id;

  for (const blockerKey of issue.blocks) {
    run("bd", ["link", created.id, issueIdByKey[blockerKey]!, "--type", "blocks"], repoRoot);
  }

  if (issue.queueRole === "coordination") {
    run("bd", ["update", created.id, "--status", "blocked", "--json"], repoRoot);
  }

  return created.id;
}

export async function seedMockRun(options: SeedMockRunOptions = {}): Promise<SeedMockRunResult> {
  const bdSupport = getMockRunBdSupport();
  if (!bdSupport.supported) {
    throw new Error(
      `seedMockRun requires a compatible bd CLI with --shared-server and --skip-agents support: ${bdSupport.reason}`,
    );
  }

  const workspaceRoot = path.resolve(options.workspaceRoot ?? process.cwd());
  const repoName = options.repoName ?? TODO_MOCK_RUN_MANIFEST.repoName;
  const beadsPrefix = options.beadsPrefix ?? TODO_MOCK_RUN_MANIFEST.beadsPrefix;
  const repoRoot = path.join(workspaceRoot, repoName);
  const databaseName = createDatabaseName(beadsPrefix);

  rmSync(repoRoot, { recursive: true, force: true });
  mkdirSync(repoRoot, { recursive: true });

  for (const [relativePath, contents] of Object.entries(TODO_MOCK_RUN_MANIFEST.baselineFiles)) {
    writeProjectFile(repoRoot, relativePath, contents);
  }

  run("git", ["init"], repoRoot);
  run("git", ["config", "user.email", "mock-run@aegis.local"], repoRoot);
  run("git", ["config", "user.name", "Aegis Mock Run"], repoRoot);
  runGlobalBd(["dolt", "start"]);
  run(
    "bd",
    [
      "init",
      "-p",
      beadsPrefix,
      "--server",
      "--shared-server",
      "--server-port",
      "3308",
      "--database",
      databaseName,
      "--skip-hooks",
      "--skip-agents",
    ],
    repoRoot,
  );
  initProject(repoRoot);

  const mockRunConfig = buildMockRunConfig();

  writeFileSync(
    resolveProjectRelativePath(repoRoot, ".aegis/config.json"),
    `${JSON.stringify(mockRunConfig, null, 2)}\n`,
    "utf8",
  );

  const issueIdByKey: Record<string, string> = {};
  for (const issue of TODO_MOCK_RUN_MANIFEST.issues) {
    createIssue(repoRoot, issue, issueIdByKey);
  }

  run("git", ["add", "--all"], repoRoot);
  run("git", ["commit", "-m", "mock baseline"], repoRoot);
  run("git", ["branch", "-M", "main"], repoRoot);

  const initialReady = parseBdReady(run("bd", ["ready", "--json"], repoRoot));
  const initialReadyKeys = initialReady.map((readyIssue) => {
    const match = Object.entries(issueIdByKey).find(([, issueId]) => issueId === readyIssue.id);
    return match?.[0] ?? readyIssue.id;
  });
  assertExpectedReadyQueue(initialReadyKeys, TODO_MOCK_RUN_MANIFEST.expectedInitialReadyKeys);
  const manifestPath = writeMockRunManifest(repoRoot, {
    repoRoot,
    databaseName,
    generatedAt: new Date().toISOString(),
    issueIdByKey,
    initialReadyKeys,
    configuredModels: {
      oracle: mockRunConfig.models.oracle,
      titan: mockRunConfig.models.titan,
      sentinel: mockRunConfig.models.sentinel,
    },
  });

  return {
    repoRoot,
    databaseName,
    issueIdByKey,
    initialReadyKeys,
    manifestPath,
  };
}

function isDirectExecution(entryPoint = process.argv[1]): boolean {
  if (!entryPoint) {
    return false;
  }

  return path.resolve(entryPoint) === path.resolve(fileURLToPath(import.meta.url));
}

if (isDirectExecution()) {
  seedMockRun().then(
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
