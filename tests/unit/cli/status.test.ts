import path from "node:path";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
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
});
