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

import type { EvalRunResult, EvalScenario, CompletionOutcome, MergeOutcome } from "./result-schema.js";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface RunScenarioOptions {
  /** The scenario definition to run. */
  scenario: EvalScenario;
  /**
   * Absolute path to the project root (repository) the scenario should run
   * against.  Lane A will clone or set up the fixture repo here.
   */
  projectRoot: string;
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
   * scenario.  Defaults to 30 minutes (1_800_000 ms).
   */
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Fixture format
// ---------------------------------------------------------------------------

interface FixtureIssue {
  id: string;
  type: string;
  expected_completion: CompletionOutcome;
  expected_merge: MergeOutcome;
}

interface Fixture {
  issues: FixtureIssue[];
  human_interventions: string[];
  config_overrides: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function readAegisVersion(projectRoot: string): string {
  const pkgPath = path.join(projectRoot, "package.json");
  const raw = readFileSync(pkgPath, "utf8");
  const pkg = JSON.parse(raw) as { version?: unknown };
  if (typeof pkg.version !== "string" || pkg.version.length === 0) {
    throw new Error(`Cannot read aegis_version from ${pkgPath}`);
  }
  return pkg.version;
}

function readGitSha(projectRoot: string): string {
  try {
    const sha = execSync("git rev-parse HEAD", {
      cwd: projectRoot,
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

function buildConfigFingerprint(projectRoot: string): string {
  // We fingerprint the resolved config JSON.  If no config file is present
  // (common in test environments), we fingerprint an empty object so the
  // runner still produces a deterministic string.
  let configJson: string;
  try {
    const configPath = path.join(projectRoot, ".aegis", "config.json");
    configJson = readFileSync(configPath, "utf8");
  } catch {
    configJson = "{}";
  }

  return crypto.createHash("sha256").update(configJson).digest("hex");
}

function loadFixture(projectRoot: string, fixturePath: string): Fixture {
  const base = path.resolve(projectRoot, "evals", "fixtures");
  const fullPath = path.resolve(base, fixturePath);
  if (!fullPath.startsWith(base + path.sep) && fullPath !== base) {
    throw new Error(`fixture_path "${fixturePath}" escapes the fixtures directory`);
  }
  const raw = readFileSync(fullPath, "utf8");
  return JSON.parse(raw) as Fixture;
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
  const { scenario, projectRoot } = options;

  const startedAt = new Date();
  const startedAtIso = startedAt.toISOString();

  // Identity fields
  const aegis_version = readAegisVersion(projectRoot);
  const git_sha = readGitSha(projectRoot);
  const config_fingerprint = buildConfigFingerprint(projectRoot);

  // Load the fixture to determine issues and simulate outcomes
  const fixture = loadFixture(projectRoot, scenario.fixture_path);

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

  // Determine runtime / model mapping from the project config (best-effort)
  let runtime = "pi";
  let model_mapping: Record<string, string> = {
    oracle: "pi:default",
    titan: "pi:default",
    sentinel: "pi:default",
    janus: "pi:default",
  };

  try {
    const configPath = path.join(projectRoot, ".aegis", "config.json");
    const rawConfig = readFileSync(configPath, "utf8");
    const cfg = JSON.parse(rawConfig) as {
      runtime?: unknown;
      models?: Record<string, unknown>;
    };
    if (typeof cfg.runtime === "string") {
      runtime = cfg.runtime;
    }
    if (cfg.models != null && typeof cfg.models === "object") {
      const mapped: Record<string, string> = {};
      for (const [role, model] of Object.entries(cfg.models)) {
        if (typeof model === "string") {
          mapped[role] = model;
        }
      }
      if (Object.keys(mapped).length > 0) {
        model_mapping = mapped;
      }
    }
  } catch {
    // No config present — use defaults
  }

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
