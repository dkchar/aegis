import path from "node:path";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";

import { initProject } from "../../../src/config/init-project.js";
import { verifyTrackerRepository } from "../../../src/cli/start.js";

const tempRoots: string[] = [];

function createTempRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "aegis-start-"));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("verifyTrackerRepository", () => {
  it("accepts a healthy tracker probe even when the worktree has no local .beads directory", () => {
    const root = createTempRoot();

    expect(() => verifyTrackerRepository(root, () => ({
      status: 0,
      stdout: "[]",
      stderr: "",
    }), () => ({
      ok: true,
      detail: "Beads CLI is available.",
    }))).not.toThrow();
  });

  it("fails clearly when the Beads CLI is unavailable", () => {
    const root = createTempRoot();

    expect(() => verifyTrackerRepository(root, () => ({
      status: 0,
      stdout: "",
      stderr: "",
    }), () => ({
      ok: false,
      detail: "Beads CLI was not found. Install or fix `bd` before starting Aegis.",
    }))).toThrow("Beads CLI was not found");
  });

  it("includes tracker probe details when bd ready fails", () => {
    const root = createTempRoot();

    expect(() => verifyTrackerRepository(root, () => ({
      status: 1,
      stdout: "",
      stderr: "tracker metadata missing",
    }), () => ({
      ok: true,
      detail: "Beads CLI is available.",
    }))).toThrow("tracker metadata missing");
  });
});

describe("startAegis daemon loop", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("runs the shared daemon cycle immediately and on the configured interval", async () => {
    vi.useFakeTimers();
    const root = createTempRoot();
    initProject(root);

    const configPath = path.join(root, ".aegis", "config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8")) as {
      runtime: string;
      thresholds: { poll_interval_seconds: number };
    };

    writeFileSync(
      configPath,
      `${JSON.stringify({
        ...config,
        runtime: "phase_d_shell",
        thresholds: {
          ...config.thresholds,
          poll_interval_seconds: 1,
        },
      }, null, 2)}\n`,
      "utf8",
    );

    const runDaemonCycle = vi.fn(async () => undefined);
    const startModule = await import("../../../src/cli/start.js");
    const result = await startModule.startAegis(root, {}, {
      verifyTracker: () => undefined,
      verifyGitRepo: () => undefined,
      probeBeadsCli: () => ({
        ok: true,
        detail: "Beads CLI is available.",
      }),
      registerSignalHandlers: false,
      runDaemonCycle,
    });

    expect(runDaemonCycle).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_100);
    expect(runDaemonCycle).toHaveBeenCalledTimes(2);

    await result.runtime.stop();
  });

  it("reconciles stale in-progress dispatch state to the current daemon provenance on start", async () => {
    const root = createTempRoot();
    initProject(root);

    const configPath = path.join(root, ".aegis", "config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8")) as {
      runtime: string;
    };
    writeFileSync(
      configPath,
      `${JSON.stringify({
        ...config,
        runtime: "phase_d_shell",
      }, null, 2)}\n`,
      "utf8",
    );

    writeFileSync(
      path.join(root, ".aegis", "dispatch-state.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        records: {
          "ISSUE-1": {
            issueId: "ISSUE-1",
            stage: "scouting",
            runningAgent: {
              caste: "oracle",
              sessionId: "stale-session",
              startedAt: "2026-04-14T11:00:00.000Z",
            },
            oracleAssessmentRef: null,
            sentinelVerdictRef: null,
            fileScope: null,
            failureCount: 0,
            consecutiveFailures: 0,
            failureWindowStartMs: null,
            cooldownUntil: null,
            sessionProvenanceId: "stale-daemon",
            updatedAt: "2026-04-14T11:00:00.000Z",
          },
        },
      }, null, 2)}\n`,
      "utf8",
    );

    const startModule = await import("../../../src/cli/start.js");
    const result = await startModule.startAegis(root, {}, {
      verifyTracker: () => undefined,
      verifyGitRepo: () => undefined,
      probeBeadsCli: () => ({
        ok: true,
        detail: "Beads CLI is available.",
      }),
      registerSignalHandlers: false,
      runDaemonCycle: async () => undefined,
    });

    const recovered = JSON.parse(
      readFileSync(path.join(root, ".aegis", "dispatch-state.json"), "utf8"),
    ) as {
      records: Record<string, { runningAgent: unknown; sessionProvenanceId: string }>;
    };

    expect(recovered.records["ISSUE-1"]?.runningAgent).toBeNull();
    expect(recovered.records["ISSUE-1"]?.sessionProvenanceId).toBe(String(process.pid));

    await result.runtime.stop();
  });
});
