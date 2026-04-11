import { describe, expect, it } from "vitest";

import type { AegisConfig } from "../../../src/config/schema.js";
import { DEFAULT_AEGIS_CONFIG } from "../../../src/config/defaults.js";

import {
  formatStartupPreflight,
  runStartupPreflight,
  type StartupPreflightDependencies,
} from "../../../src/cli/startup-preflight.js";

function makeConfig(): AegisConfig {
  return {
    ...DEFAULT_AEGIS_CONFIG,
    runtime: "pi",
    models: {
      ...DEFAULT_AEGIS_CONFIG.models,
      titan: "pi:default",
      sentinel: "pi:default",
      janus: "pi:default",
      metis: "pi:default",
      prometheus: "pi:default",
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

  it("uses a failure fallback detail when a failing probe does not provide one", () => {
    const report = runStartupPreflight("C:/repo", makeDeps({
      probeBeadsCli: () => ({ ok: false }),
    }));

    expect(report.overall).toBe("blocked");
    expect(report.checks[1]).toMatchObject({
      id: "beads_cli",
      status: "fail",
    });
    expect(report.checks[1]?.detail).not.toBe("Beads CLI is available.");
    expect(formatStartupPreflight(report)).not.toContain("Beads CLI is available.");
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
