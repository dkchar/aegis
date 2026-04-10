import { describe, expect, it } from "vitest";

import type { AegisConfig } from "../../../src/config/schema.js";

import {
  formatStartupPreflight,
  runStartupPreflight,
  type StartupPreflightDependencies,
} from "../../../src/cli/startup-preflight.js";

function makeConfig(): AegisConfig {
  return {
    runtime: "pi",
    auth: {
      provider: "pi",
      mode: "api_key",
      plan: null,
    },
    models: {
      oracle: "pi:default",
      titan: "pi:default",
      sentinel: "pi:default",
      janus: "pi:default",
      metis: "pi:default",
      prometheus: "pi:default",
    },
    concurrency: {
      max_agents: 4,
      max_oracles: 1,
      max_titans: 1,
      max_sentinels: 1,
      max_janus: 1,
    },
    budgets: {
      oracle: { turns: 10, tokens: 1_000 },
      titan: { turns: 10, tokens: 1_000 },
      sentinel: { turns: 10, tokens: 1_000 },
      janus: { turns: 10, tokens: 1_000 },
    },
    thresholds: {
      poll_interval_seconds: 30,
      stuck_warning_seconds: 300,
      stuck_kill_seconds: 600,
      allow_complex_auto_dispatch: false,
      scope_overlap_threshold: 0.5,
      janus_retry_threshold: 1,
    },
    economics: {
      metering_fallback: "stats_only",
      per_issue_cost_warning_usd: null,
      daily_cost_warning_usd: null,
      daily_hard_stop_usd: null,
      quota_warning_floor_pct: null,
      quota_hard_stop_floor_pct: null,
      credit_warning_floor: null,
      credit_hard_stop_floor: null,
      allow_exact_cost_estimation: false,
    },
    janus: {
      enabled: true,
      max_invocations_per_issue: 1,
    },
    mnemosyne: {
      max_records: 100,
      prompt_token_budget: 1_000,
    },
    labor: {
      base_path: ".aegis/labors",
    },
    olympus: {
      port: 3847,
      open_browser: true,
    },
    evals: {
      enabled: false,
      results_path: ".aegis/evals",
      benchmark_suite: "core-suite",
      minimum_pass_rate: 0.8,
      max_human_interventions_per_10_issues: 1,
    },
  };
}

function makeDeps(
  overrides: Partial<StartupPreflightDependencies> = {},
): StartupPreflightDependencies {
  return {
    verifyGitRepo: () => undefined,
    probeBeadsCli: () => ({ ok: true }),
    probeBeadsRepo: () => ({ ok: true }),
    loadConfig: () => makeConfig(),
    verifyRuntimeAdapter: () => ({ ok: true }),
    verifyRuntimeLocalConfig: () => ({ ok: true }),
    verifyModelRefs: () => ({ ok: true }),
    verifyRuntimeStatePaths: () => ({ ok: true }),
    ...overrides,
  };
}

describe("runStartupPreflight", () => {
  it("returns ready when every startup preflight check passes", () => {
    const report = runStartupPreflight("C:/repo", makeDeps());

    expect(report).toEqual({
      overall: "ready",
      repoRoot: "C:/repo",
      checks: [
        { id: "git_repo", label: "git repo", status: "pass", detail: "Inside a git worktree." },
        { id: "beads_cli", label: "beads cli", status: "pass", detail: "Beads CLI is available." },
        { id: "beads_repo", label: "beads repo", status: "pass", detail: "Beads tracker is initialized." },
        { id: "aegis_config", label: "aegis config", status: "pass", detail: "Config loaded." },
        { id: "runtime_adapter", label: "runtime adapter", status: "pass", detail: "Runtime adapter is supported." },
        { id: "runtime_local_config", label: "runtime local config", status: "pass", detail: "Runtime local config is valid." },
        { id: "model_refs", label: "model refs", status: "pass", detail: "Configured model refs are valid." },
        { id: "runtime_state_paths", label: "runtime state paths", status: "pass", detail: "Runtime state paths are available." },
      ],
    });
  });

  it("returns blocked when the Beads repository is missing", () => {
    const report = runStartupPreflight("C:/repo", makeDeps({
      probeBeadsRepo: () => ({
        ok: false,
        detail: "Beads tracker is not initialized.",
        fix: "run `bd init` or `bd onboard` in this repository",
      }),
    }));

    expect(report.overall).toBe("blocked");
    expect(report.checks.map((check) => [check.id, check.status])).toEqual([
      ["git_repo", "pass"],
      ["beads_cli", "pass"],
      ["beads_repo", "fail"],
      ["aegis_config", "skipped"],
      ["runtime_adapter", "skipped"],
      ["runtime_local_config", "skipped"],
      ["model_refs", "skipped"],
      ["runtime_state_paths", "skipped"],
    ]);
    expect(formatStartupPreflight(report)).toContain(
      "fix: run `bd init` or `bd onboard` in this repository",
    );
  });

  it("converts thrown probe errors into a failed check and skips downstream work", () => {
    const report = runStartupPreflight("C:/repo", makeDeps({
      probeBeadsCli: () => {
        throw new Error("bd executable missing");
      },
    }));

    expect(report.overall).toBe("blocked");
    expect(report.checks.map((check) => [check.id, check.status, check.detail])).toEqual([
      ["git_repo", "pass", "Inside a git worktree."],
      ["beads_cli", "fail", "bd executable missing"],
      ["beads_repo", "skipped", "Skipped because an earlier preflight check failed."],
      ["aegis_config", "skipped", "Skipped because an earlier preflight check failed."],
      ["runtime_adapter", "skipped", "Skipped because an earlier preflight check failed."],
      ["runtime_local_config", "skipped", "Skipped because an earlier preflight check failed."],
      ["model_refs", "skipped", "Skipped because an earlier preflight check failed."],
      ["runtime_state_paths", "skipped", "Skipped because an earlier preflight check failed."],
    ]);
  });

  it("fails the aegis_config check when loading config throws", () => {
    const report = runStartupPreflight("C:/repo", makeDeps({
      loadConfig: () => {
        throw new Error("Config file is missing.");
      },
    }));

    expect(report.overall).toBe("blocked");
    expect(report.checks.map((check) => [check.id, check.status, check.detail])).toEqual([
      ["git_repo", "pass", "Inside a git worktree."],
      ["beads_cli", "pass", "Beads CLI is available."],
      ["beads_repo", "pass", "Beads tracker is initialized."],
      ["aegis_config", "fail", "Config file is missing."],
      ["runtime_adapter", "skipped", "Skipped because an earlier preflight check failed."],
      ["runtime_local_config", "skipped", "Skipped because an earlier preflight check failed."],
      ["model_refs", "skipped", "Skipped because an earlier preflight check failed."],
      ["runtime_state_paths", "skipped", "Skipped because an earlier preflight check failed."],
    ]);
  });

  it("stops at a runtime_state_paths failure without appending skipped checks", () => {
    const report = runStartupPreflight("C:/repo", makeDeps({
      verifyRuntimeStatePaths: () => ({
        ok: false,
        detail: "Runtime state path is not writable.",
        fix: "fix repository permissions",
      }),
    }));

    expect(report.overall).toBe("blocked");
    expect(report.checks).toHaveLength(8);
    expect(report.checks.map((check) => [check.id, check.status])).toEqual([
      ["git_repo", "pass"],
      ["beads_cli", "pass"],
      ["beads_repo", "pass"],
      ["aegis_config", "pass"],
      ["runtime_adapter", "pass"],
      ["runtime_local_config", "pass"],
      ["model_refs", "pass"],
      ["runtime_state_paths", "fail"],
    ]);
    expect(report.checks.filter((check) => check.status === "skipped")).toHaveLength(0);
  });
});
