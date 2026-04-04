/**
 * Scenario runner — S02 lane A implementation.
 *
 * Implements the runScenario function using a fixture-driven simulation model.
 * The actual Aegis orchestration pipeline (S04-S15) does not exist yet, so
 * outcomes are simulated from the fixture file declarations.
 */

import path from "node:path";
import { readFileSync } from "node:fs";
import crypto from "node:crypto";
import { execSync } from "node:child_process";

import { DEFAULT_AEGIS_CONFIG } from "../config/defaults.js";
import { loadConfig } from "../config/load-config.js";
import type {
  EvalRunResult,
  EvalScenario,
  CompletionOutcome,
  MergeOutcome,
} from "./result-schema.js";
import type { Fixture } from "./fixture-schema.js";
import { validateFixture } from "./fixture-schema.js";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface RunScenarioOptions {
  /** The scenario definition to run. */
  scenario: EvalScenario;
  /**
   * Absolute path to the project root (repository) the scenario should run
   * against. Lane A will clone or set up the fixture repo here.
   */
  projectRoot: string;
  /**
   * Absolute path to the Aegis checkout whose provenance and fixture corpus
   * should be used for the run.
   */
  aegisRoot?: string;
  /**
   * Absolute path to the Aegis binary or entry point to invoke.
   * Defaults to the current process when undefined.
   */
  aegisBin?: string;
  /**
   * Whether to capture verbose output from the Aegis process.
   * Defaults to false.
   */
  verbose?: boolean;
  /**
   * Maximum wall-clock milliseconds before the runner forcibly terminates the
   * scenario. Defaults to 30 minutes (1_800_000 ms).
   */
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Fixture format
//
// The Fixture type is now defined canonically in fixture-schema.ts (S03
// contract seed). The inline FixtureIssue and Fixture interfaces that
// previously lived here have been replaced with the formalized imports above.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function defaultAegisRoot(): string {
  return path.resolve(import.meta.dirname, "..", "..");
}

function readAegisVersion(aegisRoot: string): string {
  const pkgPath = path.join(aegisRoot, "package.json");
  const raw = readFileSync(pkgPath, "utf8");
  const pkg = JSON.parse(raw) as { version?: unknown };
  if (typeof pkg.version !== "string" || pkg.version.length === 0) {
    throw new Error(`Cannot read aegis_version from ${pkgPath}`);
  }
  return pkg.version;
}

function readGitSha(aegisRoot: string): string {
  try {
    const sha = execSync("git rev-parse HEAD", {
      cwd: aegisRoot,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return sha;
  } catch {
    // Fallback for environments where git is unavailable (e.g. CI containers
    // running without a .git directory).
    return "0000000000000000000000000000000000000000";
  }
}

function loadResolvedConfig(projectRoot: string) {
  try {
    return loadConfig(projectRoot);
  } catch (error) {
    if (
      error instanceof Error
      && error.message.startsWith("Missing Aegis config at ")
    ) {
      return DEFAULT_AEGIS_CONFIG;
    }

    throw error;
  }
}

function buildConfigFingerprint(config: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(config)).digest("hex");
}

function loadFixture(aegisRoot: string, fixturePath: string): Fixture {
  const base = path.resolve(aegisRoot, "evals", "fixtures");
  const fullPath = path.resolve(base, fixturePath);
  if (!fullPath.startsWith(base + path.sep) && fullPath !== base) {
    throw new Error(`fixture_path "${fixturePath}" escapes the fixtures directory`);
  }
  const raw = readFileSync(fullPath, "utf8");
  const parsed: unknown = JSON.parse(raw);
  const validation = validateFixture(parsed);
  if (!validation.valid) {
    throw new Error(`Invalid fixture at "${fullPath}": ${validation.errors.join("; ")}`);
  }
  return parsed as Fixture;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run a single eval scenario and return the canonical result artifact.
 *
 * Phase 0.5 scaffolding: outcomes are simulated from fixture metadata.
 * The real pipeline wiring arrives in S16A.
 */
export async function runScenario(options: RunScenarioOptions): Promise<EvalRunResult> {
  const { scenario } = options;
  const projectRoot = path.resolve(options.projectRoot);
  const aegisRoot = path.resolve(options.aegisRoot ?? defaultAegisRoot());
  const resolvedConfig = loadResolvedConfig(projectRoot);

  const startedAt = new Date();
  const startedAtIso = startedAt.toISOString();

  // Identity fields
  const aegis_version = readAegisVersion(aegisRoot);
  const git_sha = readGitSha(aegisRoot);
  const config_fingerprint = buildConfigFingerprint(resolvedConfig);

  // Load the fixture to determine issues and simulate outcomes
  const fixture = loadFixture(aegisRoot, scenario.fixture_path);

  // Build issue statistics
  const issue_count = fixture.issues.length;
  const issue_types: Record<string, number> = {};
  for (const issue of fixture.issues) {
    issue_types[issue.type] = (issue_types[issue.type] ?? 0) + 1;
  }

  // Simulate outcomes from fixture declarations
  const completion_outcomes: Record<string, CompletionOutcome> = {};
  const merge_outcomes: Record<string, MergeOutcome> = {};

  for (const issue of fixture.issues) {
    completion_outcomes[issue.id] = issue.expected_completion;
    merge_outcomes[issue.id] = issue.expected_merge;
  }

  const runtime = resolvedConfig.runtime;
  const model_mapping = { ...resolvedConfig.models };

  const finishedAt = new Date();
  const finishedAtIso = finishedAt.toISOString();
  const elapsed_ms = finishedAt.getTime() - startedAt.getTime();

  const result: EvalRunResult = {
    aegis_version,
    git_sha,
    config_fingerprint,
    runtime,
    model_mapping,
    scenario_id: scenario.id,
    issue_count,
    issue_types,
    completion_outcomes,
    merge_outcomes,
    human_intervention_issue_ids: [...fixture.human_interventions],
    cost_totals: null,
    quota_totals: null,
    timing: {
      started_at: startedAtIso,
      finished_at: finishedAtIso,
      elapsed_ms,
    },
  };

  return result;
}
