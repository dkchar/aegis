import path from "node:path";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";

import { initProject } from "../../../src/config/init-project.js";
import {
  StartupPreflightBlockedError,
} from "../../../src/cli/startup-preflight.js";
import { verifyTrackerRepository } from "../../../src/cli/start.js";
import { readRuntimeState } from "../../../src/cli/runtime-state.js";

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
        runtime: "scripted",
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

  it("keeps daemon merge pass active across Janus requeue and fail-closed outcomes", async () => {
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
        runtime: "scripted",
        thresholds: {
          ...config.thresholds,
          poll_interval_seconds: 1,
        },
      }, null, 2)}\n`,
      "utf8",
    );

    const runDaemonCycle = vi.fn(async () => undefined);
    const runMergeCommand = vi.fn()
      .mockResolvedValueOnce({
        action: "merge_next",
        status: "janus_requeued",
        issueId: "aegis-janus-1",
        queueItemId: "queue-aegis-janus-1",
        tier: "T3",
        stage: "queued_for_merge",
      })
      .mockResolvedValueOnce({
        action: "merge_next",
        status: "failed",
        issueId: "aegis-janus-1",
        queueItemId: "queue-aegis-janus-1",
        tier: "T3",
        stage: "failed",
      });

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
      runMergeCommand,
    });

    expect(runDaemonCycle).toHaveBeenCalledTimes(1);
    expect(runMergeCommand).toHaveBeenCalledTimes(1);
    expect(runMergeCommand).toHaveBeenNthCalledWith(1, root, "next");

    await vi.advanceTimersByTimeAsync(1_100);
    expect(runDaemonCycle).toHaveBeenCalledTimes(2);
    expect(runMergeCommand).toHaveBeenCalledTimes(2);
    expect(runMergeCommand).toHaveBeenNthCalledWith(2, root, "next");

    const runtimeState = readRuntimeState(root);
    expect(runtimeState?.server_state).toBe("running");

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
        runtime: "scripted",
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
      records: Record<string, {
        stage: string;
        runningAgent: unknown;
        sessionProvenanceId: string;
      }>;
    };

    expect(recovered.records["ISSUE-1"]?.stage).toBe("failed_operational");
    expect(recovered.records["ISSUE-1"]?.runningAgent).toBeNull();
    expect(recovered.records["ISSUE-1"]?.sessionProvenanceId).toBe(String(process.pid));

    await result.runtime.stop();
  });

  it("reconciles stale reviewing state back to implemented cooldown instead of restarting Oracle", async () => {
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
        runtime: "scripted",
      }, null, 2)}\n`,
      "utf8",
    );

    writeFileSync(
      path.join(root, ".aegis", "dispatch-state.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        records: {
          "ISSUE-REVIEW": {
            issueId: "ISSUE-REVIEW",
            stage: "reviewing",
            runningAgent: {
              caste: "sentinel",
              sessionId: "stale-sentinel",
              startedAt: "2026-04-14T11:00:00.000Z",
            },
            oracleAssessmentRef: ".aegis/oracle/ISSUE-REVIEW.json",
            titanHandoffRef: ".aegis/titan/ISSUE-REVIEW.json",
            titanClarificationRef: null,
            sentinelVerdictRef: null,
            janusArtifactRef: null,
            failureTranscriptRef: null,
            fileScope: { files: ["src/App.tsx"] },
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
      records: Record<string, {
        stage: string;
        runningAgent: unknown;
        cooldownUntil: string | null;
        sessionProvenanceId: string;
      }>;
    };

    expect(recovered.records["ISSUE-REVIEW"]?.stage).toBe("implemented");
    expect(recovered.records["ISSUE-REVIEW"]?.runningAgent).toBeNull();
    expect(recovered.records["ISSUE-REVIEW"]?.cooldownUntil).toBeTruthy();
    expect(recovered.records["ISSUE-REVIEW"]?.sessionProvenanceId).toBe(String(process.pid));

    await result.runtime.stop();
  });

  it("serializes daemon-routed phase commands with an in-flight daemon cycle", async () => {
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
        runtime: "scripted",
        thresholds: {
          ...config.thresholds,
          poll_interval_seconds: 1,
        },
      }, null, 2)}\n`,
      "utf8",
    );

    let releaseCycle: (() => void) | undefined;
    let cycleCount = 0;
    const runDaemonCycle = vi.fn(() => {
      cycleCount += 1;
      if (cycleCount === 1) {
        return Promise.resolve();
      }

      return new Promise<void>((resolve) => {
        releaseCycle = () => {
          resolve();
        };
      });
    });

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

    await vi.advanceTimersByTimeAsync(1_100);
    expect(runDaemonCycle).toHaveBeenCalledTimes(2);

    const commandDirectory = path.join(root, ".aegis", "runtime-commands");
    mkdirSync(commandDirectory, { recursive: true });
    writeFileSync(
      path.join(commandDirectory, "request-1.request.json"),
      `${JSON.stringify({
        request_id: "request-1",
        phase: "monitor",
        target_pid: process.pid,
        requested_at: "2026-04-14T12:00:00.000Z",
      }, null, 2)}\n`,
      "utf8",
    );

    await vi.advanceTimersByTimeAsync(500);
    expect(
      existsSync(path.join(commandDirectory, "request-1.response.json")),
    ).toBe(false);

    releaseCycle?.();
    await vi.advanceTimersByTimeAsync(200);

    expect(
      existsSync(path.join(commandDirectory, "request-1.response.json")),
    ).toBe(true);

    await result.runtime.stop();
  });

  it("serializes daemon-routed caste commands with an in-flight daemon cycle", async () => {
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
        runtime: "scripted",
        thresholds: {
          ...config.thresholds,
          poll_interval_seconds: 1,
        },
      }, null, 2)}\n`,
      "utf8",
    );

    let releaseCycle: (() => void) | undefined;
    let cycleCount = 0;
    const runDaemonCycle = vi.fn(() => {
      cycleCount += 1;
      if (cycleCount === 1) {
        return Promise.resolve();
      }

      return new Promise<void>((resolve) => {
        releaseCycle = () => {
          resolve();
        };
      });
    });
    const runCasteCommand = vi.fn(async () => ({
      action: "scout",
      issueId: "aegis-123",
      stage: "scouted",
    }));

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
      runCasteCommand,
    });

    await vi.advanceTimersByTimeAsync(1_100);
    expect(runDaemonCycle).toHaveBeenCalledTimes(2);

    const commandDirectory = path.join(root, ".aegis", "runtime-commands");
    mkdirSync(commandDirectory, { recursive: true });
    writeFileSync(
      path.join(commandDirectory, "request-2.request.json"),
      `${JSON.stringify({
        request_id: "request-2",
        command_kind: "caste",
        action: "scout",
        issue_id: "aegis-123",
        target_pid: process.pid,
        requested_at: "2026-04-14T12:00:00.000Z",
      }, null, 2)}\n`,
      "utf8",
    );

    await vi.advanceTimersByTimeAsync(500);
    expect(
      existsSync(path.join(commandDirectory, "request-2.response.json")),
    ).toBe(false);

    releaseCycle?.();
    await vi.advanceTimersByTimeAsync(200);

    expect(runCasteCommand).toHaveBeenCalledWith(root, "scout", "aegis-123");
    expect(
      existsSync(path.join(commandDirectory, "request-2.response.json")),
    ).toBe(true);

    await result.runtime.stop();
  });

  it("blocks startup when configured pi model validation fails", async () => {
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
        runtime: "pi",
      }, null, 2)}\n`,
      "utf8",
    );
    mkdirSync(path.join(root, ".pi"), { recursive: true });
    writeFileSync(path.join(root, ".pi", "settings.json"), "{}\n", "utf8");

    const startModule = await import("../../../src/cli/start.js");

    await expect(startModule.startAegis(root, {}, {
      verifyTracker: () => undefined,
      verifyGitRepo: () => undefined,
      probeBeadsCli: () => ({
        ok: true,
        detail: "Beads CLI is available.",
      }),
      registerSignalHandlers: false,
      verifyModelRefs: () => ({
        ok: false,
        detail:
          'Configured provider "openai-codex" for "titan" is not authenticated. Authenticated providers: anthropic',
        fix: "authenticate the configured provider or update the configured model ref",
      }),
    })).rejects.toMatchObject({
      name: StartupPreflightBlockedError.name,
      report: {
        overall: "blocked",
        checks: expect.arrayContaining([
          expect.objectContaining({
            id: "model_refs",
            status: "fail",
            detail: expect.stringContaining("Authenticated providers: anthropic"),
          }),
        ]),
      },
    });
  });
});
