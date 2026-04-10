import { describe, expect, it } from "vitest";

import {
  formatStartupPreflight,
  runStartupPreflight,
  type StartupPreflightDependencies,
} from "../../../src/cli/startup-preflight.js";

function makeDeps(
  overrides: Partial<StartupPreflightDependencies> = {},
): StartupPreflightDependencies {
  return {
    verifyGitRepo: () => undefined,
    probeBeadsCli: () => ({ ok: true }),
    probeBeadsRepo: () => ({ ok: true }),
    loadConfig: () => ({
      runtime: "pi",
      models: {
        oracle: "pi:default",
        titan: "pi:default",
        sentinel: "pi:default",
        janus: "pi:default",
        metis: "pi:default",
        prometheus: "pi:default",
      },
    }),
    verifyRuntimeAdapter: () => ({ ok: true }),
    verifyRuntimeLocalConfig: () => ({ ok: true }),
    verifyModelRefs: () => ({ ok: true }),
    verifyRuntimeStatePaths: () => ({ ok: true }),
    ...overrides,
  };
}

describe("runStartupPreflight", () => {
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
});
