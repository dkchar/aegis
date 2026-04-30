import path from "node:path";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { getAegisStatus } from "../../../src/cli/status.js";
import type { TrackerClient } from "../../../src/tracker/tracker.js";

const tempRoots: string[] = [];

function createTempRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "aegis-status-"));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("getAegisStatus", () => {
  it("reports queue depth even when the daemon is currently stopped", async () => {
    const root = createTempRoot();
    mkdirSync(path.join(root, ".aegis"), { recursive: true });
    writeFileSync(
      path.join(root, ".aegis", "dispatch-state.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        records: {},
      }, null, 2)}\n`,
      "utf8",
    );

    const tracker: TrackerClient = {
      async listReadyIssues() {
        return [
          { id: "ISSUE-1", title: "First" },
          { id: "ISSUE-2", title: "Second" },
        ];
      },
    };

    const status = await getAegisStatus(root, { tracker });

    expect(status).toEqual({
      server_state: "stopped",
      mode: "auto",
      active_agents: 0,
      queue_depth: 2,
      uptime_ms: 0,
      terminal_operational_failures: [],
    });
  });

  it("reports zero active agents when runtime state is stopped even if stale running records exist", async () => {
    const root = createTempRoot();
    mkdirSync(path.join(root, ".aegis"), { recursive: true });
    writeFileSync(
      path.join(root, ".aegis", "dispatch-state.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        records: {
          "issue-1": {
            issueId: "issue-1",
            stage: "scouting",
            runningAgent: {
              caste: "oracle",
              sessionId: "session-1",
              startedAt: "2026-04-21T00:00:00.000Z",
            },
            oracleAssessmentRef: null,
            titanHandoffRef: null,
            titanClarificationRef: null,
            sentinelVerdictRef: null,
            janusArtifactRef: null,
            failureTranscriptRef: null,
            fileScope: null,
            failureCount: 0,
            consecutiveFailures: 0,
            failureWindowStartMs: null,
            cooldownUntil: null,
            sessionProvenanceId: "1234",
            updatedAt: "2026-04-21T00:00:00.000Z",
          },
        },
      }, null, 2)}\n`,
      "utf8",
    );
    writeFileSync(
      path.join(root, ".aegis", "runtime-state.json"),
      `${JSON.stringify({
        schema_version: 1,
        pid: process.pid,
        server_state: "stopped",
        mode: "auto",
        started_at: "2026-04-21T00:00:00.000Z",
        stopped_at: "2026-04-21T00:01:00.000Z",
        last_stop_reason: "manual",
      }, null, 2)}\n`,
      "utf8",
    );

    const status = await getAegisStatus(root, {
      tracker: {
        async listReadyIssues() {
          return [];
        },
      },
    });

    expect(status).toEqual({
      server_state: "stopped",
      mode: "auto",
      active_agents: 0,
      queue_depth: 0,
      uptime_ms: 0,
      terminal_operational_failures: [],
    });
  });

  it("recovers stale running runtime and dispatch state when daemon pid is gone", async () => {
    const root = createTempRoot();
    mkdirSync(path.join(root, ".aegis"), { recursive: true });
    writeFileSync(
      path.join(root, ".aegis", "dispatch-state.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        records: {
          "issue-stale": {
            issueId: "issue-stale",
            stage: "implementing",
            runningAgent: {
              caste: "titan",
              sessionId: "session-stale",
              startedAt: "2026-04-21T00:00:00.000Z",
            },
            oracleAssessmentRef: ".aegis/oracle/issue-stale.json",
            titanHandoffRef: null,
            titanClarificationRef: null,
            sentinelVerdictRef: null,
            janusArtifactRef: null,
            failureTranscriptRef: null,
            fileScope: { files: ["src/App.tsx"] },
            failureCount: 0,
            consecutiveFailures: 0,
            failureWindowStartMs: null,
            cooldownUntil: null,
            sessionProvenanceId: "424242",
            updatedAt: "2026-04-21T00:00:00.000Z",
          },
        },
      }, null, 2)}\n`,
      "utf8",
    );
    writeFileSync(
      path.join(root, ".aegis", "runtime-state.json"),
      `${JSON.stringify({
        schema_version: 1,
        pid: 424242,
        server_state: "running",
        mode: "auto",
        started_at: "2026-04-21T00:00:00.000Z",
      }, null, 2)}\n`,
      "utf8",
    );

    const status = await getAegisStatus(root, {
      tracker: {
        async listReadyIssues() {
          return [];
        },
      },
      isProcessRunning: () => false,
      recoveryProvenanceId: "status-recovery",
      now: "2026-04-21T00:05:00.000Z",
    });

    expect(status.server_state).toBe("stopped");

    const runtimeState = JSON.parse(
      readFileSync(path.join(root, ".aegis", "runtime-state.json"), "utf8"),
    ) as { server_state: string; last_stop_reason?: string };
    expect(runtimeState).toMatchObject({
      server_state: "stopped",
      last_stop_reason: "stale_pid",
    });

    const dispatchState = JSON.parse(
      readFileSync(path.join(root, ".aegis", "dispatch-state.json"), "utf8"),
    ) as {
      records: Record<string, {
        stage: string;
        runningAgent: unknown;
        failureCount: number;
        fileScope: unknown;
      }>;
    };
    expect(dispatchState.records["issue-stale"]).toMatchObject({
      stage: "failed_operational",
      runningAgent: null,
      failureCount: 1,
      fileScope: { files: ["src/App.tsx"] },
    });
  });

  it("counts pre-merge reviewing records without Sentinel verdict as active while daemon is live", async () => {
    const root = createTempRoot();
    mkdirSync(path.join(root, ".aegis"), { recursive: true });
    writeFileSync(
      path.join(root, ".aegis", "dispatch-state.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        records: {
          "issue-review": {
            issueId: "issue-review",
            stage: "reviewing",
            runningAgent: null,
            oracleAssessmentRef: ".aegis/oracle/issue-review.json",
            titanHandoffRef: ".aegis/titan/issue-review.json",
            titanClarificationRef: null,
            sentinelVerdictRef: null,
            janusArtifactRef: null,
            failureTranscriptRef: null,
            fileScope: null,
            failureCount: 0,
            consecutiveFailures: 0,
            failureWindowStartMs: null,
            cooldownUntil: null,
            sessionProvenanceId: String(process.pid),
            updatedAt: "2026-04-21T00:00:00.000Z",
          },
        },
      }, null, 2)}\n`,
      "utf8",
    );
    writeFileSync(
      path.join(root, ".aegis", "runtime-state.json"),
      `${JSON.stringify({
        schema_version: 1,
        pid: process.pid,
        server_state: "running",
        mode: "auto",
        started_at: "2026-04-21T00:00:00.000Z",
      }, null, 2)}\n`,
      "utf8",
    );

    const status = await getAegisStatus(root, {
      tracker: {
        async listReadyIssues() {
          return [];
        },
      },
    });

    expect(status.active_agents).toBe(1);
  });

  it("reports terminal operational failures separately from raw queue depth", async () => {
    const root = createTempRoot();
    mkdirSync(path.join(root, ".aegis"), { recursive: true });
    writeFileSync(
      path.join(root, ".aegis", "dispatch-state.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        records: {
          "issue-cap": {
            issueId: "issue-cap",
            stage: "failed_operational",
            runningAgent: null,
            oracleAssessmentRef: null,
            titanHandoffRef: null,
            titanClarificationRef: null,
            sentinelVerdictRef: null,
            janusArtifactRef: null,
            failureTranscriptRef: ".aegis/transcripts/issue-cap--oracle.json",
            operationalFailureKind: "provider_usage_limit",
            fileScope: null,
            failureCount: 1,
            consecutiveFailures: 3,
            failureWindowStartMs: 1777566201128,
            cooldownUntil: "2026-04-30T16:23:51.128Z",
            sessionProvenanceId: "daemon-1",
            updatedAt: "2026-04-30T16:23:21.128Z",
          },
        },
      }, null, 2)}\n`,
      "utf8",
    );

    const status = await getAegisStatus(root, {
      tracker: {
        async listReadyIssues() {
          return [{ id: "issue-cap", title: "Release gate" }];
        },
      },
    });

    expect(status.queue_depth).toBe(1);
    expect(status.terminal_operational_failures).toEqual([
      {
        issue_id: "issue-cap",
        operational_failure_kind: "provider_usage_limit",
        failure_count: 1,
        consecutive_failures: 3,
        failure_transcript_ref: ".aegis/transcripts/issue-cap--oracle.json",
      },
    ]);
  });
});
