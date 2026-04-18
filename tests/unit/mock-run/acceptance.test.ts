import path from "node:path";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_AEGIS_CONFIG } from "../../../src/config/defaults.js";
import { saveDispatchState, type DispatchState } from "../../../src/core/dispatch-state.js";
import { saveMergeQueueState, type MergeQueueState } from "../../../src/merge/merge-state.js";
import { writeRuntimeState } from "../../../src/cli/runtime-state.js";
import { writePhaseLog } from "../../../src/core/phase-log.js";
import {
  runMockAcceptance,
  collectMockAcceptanceSurface,
  assertMockAcceptanceSurface,
  type MockAcceptanceSurface,
} from "../../../src/mock-run/acceptance.js";

const tempRoots: string[] = [];

function createTempRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "aegis-mock-acceptance-"));
  tempRoots.push(root);
  mkdirSync(path.join(root, ".aegis"), { recursive: true });
  writeFileSync(
    path.join(root, ".aegis", "config.json"),
    `${JSON.stringify(DEFAULT_AEGIS_CONFIG, null, 2)}\n`,
    "utf8",
  );
  writeRuntimeState(
    {
      schema_version: 1,
      pid: 4242,
      server_state: "stopped",
      mode: "auto",
      started_at: "2026-04-16T00:00:00.000Z",
      stopped_at: "2026-04-16T00:10:00.000Z",
      last_stop_reason: "manual stop",
    },
    root,
  );
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("runMockAcceptance", () => {
  it("sequences seeded mock-run commands through CLI merge next retries", async () => {
    const sequence: string[] = [];
    const envSnapshots: Array<string | undefined> = [];
    const seedMockRun = vi.fn(async () => {
      sequence.push("seed");
      return {
        repoRoot: "/repo",
        databaseName: "mock-db",
        issueIdByKey: {
          "foundation.contract": "issue-happy",
          "integration.contract": "issue-janus",
        },
        initialReadyKeys: ["foundation.contract"],
        manifestPath: "/repo/.aegis/mock-run-manifest.json",
      };
    });
    const runMockCommand = vi.fn(async (args: string[]) => {
      sequence.push(args.slice(2).join(" "));
      envSnapshots.push(process.env.AEGIS_SCRIPTED_MERGE_PLAN);
    });
    const surfaceCollector = vi.fn(async (): Promise<MockAcceptanceSurface> => ({
      runtimeState: {
        schema_version: 1 as const,
        pid: 4242,
        server_state: "stopped" as const,
        mode: "auto" as const,
        started_at: "2026-04-16T00:00:00.000Z",
        stopped_at: "2026-04-16T00:10:00.000Z",
        last_stop_reason: "manual stop",
      },
      dispatch: {
        happy: {
          stage: "reviewed" as const,
          oracleAssessmentRef: ".aegis/oracle/issue-happy.json",
          titanHandoffRef: ".aegis/titan/issue-happy.json",
          sentinelVerdictRef: ".aegis/sentinel/issue-happy.json",
          janusArtifactRef: null,
        },
        janus: {
          stage: "queued_for_merge" as const,
          oracleAssessmentRef: ".aegis/oracle/issue-janus.json",
          titanHandoffRef: ".aegis/titan/issue-janus.json",
          sentinelVerdictRef: null,
          janusArtifactRef: ".aegis/janus/issue-janus.json",
        },
      },
      mergeQueue: {
        happy: {
          status: "merged" as const,
          attempts: 0,
          janusInvocations: 0,
          lastTier: "T1" as const,
        },
        janus: {
          status: "queued" as const,
          attempts: 3,
          janusInvocations: 1,
          lastTier: "T3" as const,
        },
      },
      trackerIssues: {
        happy: {
          id: "issue-happy",
          title: "Happy",
          status: "closed",
        },
        janus: {
          id: "issue-janus",
          title: "Janus",
          status: "open",
        },
      },
      phaseLogs: [
        {
          phase: "poll",
          issueId: "_all",
          action: "poll_ready_work",
          outcome: "ok",
          detail: "issue-happy,issue-janus",
          timestamp: "2026-04-16T00:00:00.000Z",
        },
        {
          phase: "triage",
          issueId: "issue-happy",
          action: "classify_ready_work",
          outcome: "ok",
          detail: null,
          timestamp: "2026-04-16T00:00:00.500Z",
        },
        {
          phase: "dispatch",
          issueId: "issue-happy",
          action: "launch_oracle",
          outcome: "running",
          detail: null,
          timestamp: "2026-04-16T00:00:01.000Z",
        },
        {
          phase: "monitor",
          issueId: "issue-happy",
          action: "watch_session",
          outcome: "ok",
          detail: null,
          timestamp: "2026-04-16T00:00:02.000Z",
        },
        {
          phase: "reap",
          issueId: "issue-happy",
          action: "finalize_session",
          outcome: "scouted",
          detail: null,
          timestamp: "2026-04-16T00:00:03.000Z",
        },
      ],
      labor: {
        janus: {
          queueLaborPath: ".aegis/labors/labor-issue-janus",
          queueLaborPathExists: true,
          preservedLaborPath: "/repo/.aegis/labors/labor-issue-janus",
          preservedLaborPathExists: true,
          janusArtifactRef: ".aegis/janus/issue-janus.json",
          janusArtifactExists: true,
          recommendedNextAction: "requeue",
        },
        happy: {
          queueLaborPath: ".aegis/labors/labor-issue-happy",
          queueLaborPathExists: true,
          preservedLaborPath: null,
          preservedLaborPathExists: false,
          janusArtifactRef: null,
          janusArtifactExists: false,
          recommendedNextAction: null,
        },
      },
    }));

    await runMockAcceptance({
      cwd: "/workspace",
      seedMockRun,
      runMockCommand,
      collectMockAcceptanceSurface: surfaceCollector,
      now: "2026-04-16T00:00:00.000Z",
    });

    expect(seedMockRun).toHaveBeenCalledWith({
      workspaceRoot: path.resolve("/workspace"),
    });

    expect(sequence).toEqual([
      "seed",
      "start",
      "status",
      "stop",
      "status",
      "scout issue-happy",
      "implement issue-happy",
      "process issue-happy",
      "merge next",
      "scout issue-janus",
      "implement issue-janus",
      "process issue-janus",
      "merge next",
      "merge next",
      "merge next",
    ]);
    expect(envSnapshots).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      JSON.stringify({
        rules: [
          {
            issueId: "issue-janus",
            candidateBranch: "aegis/issue-janus",
            outcomes: [
              { outcome: "conflict", detail: "Deterministic acceptance merge conflict." },
              { outcome: "conflict", detail: "Deterministic acceptance merge conflict." },
              { outcome: "conflict", detail: "Deterministic acceptance merge conflict." },
            ],
          },
        ],
      }),
      JSON.stringify({
        rules: [
          {
            issueId: "issue-janus",
            candidateBranch: "aegis/issue-janus",
            outcomes: [
              { outcome: "conflict", detail: "Deterministic acceptance merge conflict." },
              { outcome: "conflict", detail: "Deterministic acceptance merge conflict." },
              { outcome: "conflict", detail: "Deterministic acceptance merge conflict." },
            ],
          },
        ],
      }),
      JSON.stringify({
        rules: [
          {
            issueId: "issue-janus",
            candidateBranch: "aegis/issue-janus",
            outcomes: [
              { outcome: "conflict", detail: "Deterministic acceptance merge conflict." },
              { outcome: "conflict", detail: "Deterministic acceptance merge conflict." },
              { outcome: "conflict", detail: "Deterministic acceptance merge conflict." },
            ],
          },
        ],
      }),
    ]);
    expect(surfaceCollector).toHaveBeenCalledWith("/repo", {
      happyIssueId: "issue-happy",
      janusIssueId: "issue-janus",
      tracker: expect.any(Object),
    });
  });
});

describe("collectMockAcceptanceSurface", () => {
  it("collects tracker status, phase logs, and labor evidence for the proof surface", async () => {
    const root = createTempRoot();

    saveDispatchState(root, {
      schemaVersion: 1,
      records: {
        "issue-happy": {
          issueId: "issue-happy",
          stage: "reviewed",
          runningAgent: null,
          oracleAssessmentRef: ".aegis/oracle/issue-happy.json",
          titanHandoffRef: ".aegis/titan/issue-happy.json",
          titanClarificationRef: null,
          sentinelVerdictRef: ".aegis/sentinel/issue-happy.json",
          janusArtifactRef: null,
          failureTranscriptRef: null,
          fileScope: null,
          failureCount: 0,
          consecutiveFailures: 0,
          failureWindowStartMs: null,
          cooldownUntil: null,
          sessionProvenanceId: "test",
          updatedAt: "2026-04-16T00:00:00.000Z",
        },
        "issue-janus": {
          issueId: "issue-janus",
          stage: "queued_for_merge",
          runningAgent: null,
          oracleAssessmentRef: ".aegis/oracle/issue-janus.json",
          titanHandoffRef: ".aegis/titan/issue-janus.json",
          titanClarificationRef: null,
          sentinelVerdictRef: null,
          janusArtifactRef: ".aegis/janus/issue-janus.json",
          failureTranscriptRef: null,
          fileScope: null,
          failureCount: 0,
          consecutiveFailures: 0,
          failureWindowStartMs: null,
          cooldownUntil: null,
          sessionProvenanceId: "test",
          updatedAt: "2026-04-16T00:00:00.000Z",
        },
      },
    } satisfies DispatchState);

    saveMergeQueueState(root, {
      schemaVersion: 1,
      items: [
        {
          queueItemId: "queue-issue-happy",
          issueId: "issue-happy",
          candidateBranch: "aegis/issue-happy",
          targetBranch: "main",
          laborPath: ".aegis/labors/labor-issue-happy",
          status: "merged",
          attempts: 0,
          janusInvocations: 0,
          lastTier: "T1",
          lastError: null,
          enqueuedAt: "2026-04-16T00:00:00.000Z",
          updatedAt: "2026-04-16T00:00:00.000Z",
        },
        {
          queueItemId: "queue-issue-janus",
          issueId: "issue-janus",
          candidateBranch: "aegis/issue-janus",
          targetBranch: "main",
          laborPath: ".aegis/labors/labor-issue-janus",
          status: "queued",
          attempts: 3,
          janusInvocations: 1,
          lastTier: "T3",
          lastError: null,
          enqueuedAt: "2026-04-16T00:00:00.000Z",
          updatedAt: "2026-04-16T00:00:00.000Z",
        },
      ],
    } satisfies MergeQueueState);

    mkdirSync(path.join(root, ".aegis", "labors", "labor-issue-happy"), { recursive: true });
    mkdirSync(path.join(root, ".aegis", "labors", "labor-issue-janus"), { recursive: true });
    mkdirSync(path.join(root, ".aegis", "janus"), { recursive: true });
    writeFileSync(
      path.join(root, ".aegis", "janus", "issue-janus.json"),
      `${JSON.stringify({
        originatingIssueId: "issue-janus",
        queueItemId: "queue-issue-janus",
        preservedLaborPath: path.join(root, ".aegis", "labors", "labor-issue-janus"),
        conflictSummary: "Needs integration retry",
        resolutionStrategy: "Refresh merge candidate",
        filesTouched: [],
        validationsRun: [],
        residualRisks: [],
        recommendedNextAction: "requeue",
      }, null, 2)}\n`,
      "utf8",
    );

    writePhaseLog(root, {
      timestamp: "2026-04-16T00:00:00.000Z",
      phase: "poll",
      issueId: "_all",
      action: "poll_ready_work",
      outcome: "ok",
      detail: "issue-happy,issue-janus",
    });
    writePhaseLog(root, {
      timestamp: "2026-04-16T00:00:30.000Z",
      phase: "triage",
      issueId: "issue-happy",
      action: "classify_ready_work",
      outcome: "ok",
    });
    writePhaseLog(root, {
      timestamp: "2026-04-16T00:00:45.000Z",
      phase: "dispatch",
      issueId: "issue-happy",
      action: "launch_oracle",
      outcome: "running",
    });
    writePhaseLog(root, {
      timestamp: "2026-04-16T00:00:50.000Z",
      phase: "dispatch",
      issueId: "issue-janus",
      action: "launch_janus",
      outcome: "running",
    });
    writePhaseLog(root, {
      timestamp: "2026-04-16T00:01:00.000Z",
      phase: "monitor",
      issueId: "issue-happy",
      action: "watch_session",
      outcome: "ok",
    });
    writePhaseLog(root, {
      timestamp: "2026-04-16T00:02:00.000Z",
      phase: "reap",
      issueId: "issue-happy",
      action: "finalize_session",
      outcome: "scouted",
    });

    const surface = await collectMockAcceptanceSurface(root, {
      happyIssueId: "issue-happy",
      janusIssueId: "issue-janus",
      tracker: {
        getIssue: vi.fn(async (issueId: string) => ({
          id: issueId,
          title: issueId === "issue-happy" ? "Happy" : "Janus",
          description: null,
          issueClass: "primary" as const,
          status: issueId === "issue-happy" ? ("closed" as const) : ("blocked" as const),
          priority: 1,
          blockers: [],
          parentId: null,
          childIds: [],
          labels: [],
        })),
      },
    });

    expect(surface.runtimeState.server_state).toBe("stopped");
    expect(surface.dispatch.happy.stage).toBe("reviewed");
    expect(surface.dispatch.happy.oracleAssessmentRef).toBe(".aegis/oracle/issue-happy.json");
    expect(surface.dispatch.janus.stage).toBe("queued_for_merge");
    expect(surface.dispatch.janus.janusArtifactRef).toBe(".aegis/janus/issue-janus.json");
    expect(surface.mergeQueue.happy.status).toBe("merged");
    expect(surface.mergeQueue.janus.status).toBe("queued");
    expect(surface.mergeQueue.janus.janusInvocations).toBe(1);
    expect(surface.trackerIssues.happy.status).toBe("closed");
    expect(surface.trackerIssues.janus.status).toBe("blocked");
    expect(surface.phaseLogs.some((entry) => entry.phase === "poll")).toBe(true);
    expect(surface.phaseLogs.some((entry) => entry.phase === "triage")).toBe(true);
    expect(surface.phaseLogs.some((entry) => entry.phase === "dispatch" && entry.issueId === "issue-happy")).toBe(true);
    expect(surface.phaseLogs.some((entry) => entry.phase === "monitor")).toBe(true);
    expect(surface.phaseLogs.some((entry) => entry.phase === "reap")).toBe(true);
    expect(surface.phaseLogs.some((entry) => entry.phase === "dispatch" && entry.issueId === "issue-janus")).toBe(true);
    expect(surface.labor.janus.queueLaborPathExists).toBe(true);
    expect(surface.labor.janus.janusArtifactExists).toBe(true);
    expect(surface.labor.janus.preservedLaborPathExists).toBe(true);
    expect(surface.labor.janus.recommendedNextAction).toBe("requeue");
  });

  it("accepts the Janus fail-closed proof path when the queue item is failed", () => {
    const surface: MockAcceptanceSurface = {
      runtimeState: {
        schema_version: 1,
        pid: 4242,
        server_state: "stopped",
        mode: "auto",
        started_at: "2026-04-16T00:00:00.000Z",
        stopped_at: "2026-04-16T00:10:00.000Z",
        last_stop_reason: "manual stop",
      },
      dispatch: {
        happy: {
          stage: "reviewed",
          oracleAssessmentRef: ".aegis/oracle/issue-happy.json",
          titanHandoffRef: ".aegis/titan/issue-happy.json",
          sentinelVerdictRef: ".aegis/sentinel/issue-happy.json",
          janusArtifactRef: null,
        },
        janus: {
          stage: "failed",
          oracleAssessmentRef: ".aegis/oracle/issue-janus.json",
          titanHandoffRef: ".aegis/titan/issue-janus.json",
          sentinelVerdictRef: null,
          janusArtifactRef: ".aegis/janus/issue-janus.json",
        },
      },
      mergeQueue: {
        happy: {
          status: "merged",
          attempts: 0,
          janusInvocations: 0,
          lastTier: "T1",
        },
        janus: {
          status: "failed",
          attempts: 3,
          janusInvocations: 1,
          lastTier: "T3",
        },
      },
      trackerIssues: {
        happy: {
          id: "issue-happy",
          title: "Happy",
          status: "closed",
        },
        janus: {
          id: "issue-janus",
          title: "Janus",
          status: "blocked",
        },
      },
      phaseLogs: [
        {
          phase: "poll",
          issueId: "_all",
          action: "poll_ready_work",
          outcome: "ok",
          detail: "issue-happy,issue-janus",
          timestamp: "2026-04-16T00:00:00.000Z",
        },
        {
          phase: "triage",
          issueId: "issue-janus",
          action: "classify_ready_work",
          outcome: "ok",
          detail: null,
          timestamp: "2026-04-16T00:00:00.500Z",
        },
        {
          phase: "dispatch",
          issueId: "issue-janus",
          action: "launch_janus",
          outcome: "running",
          detail: null,
          timestamp: "2026-04-16T00:00:01.000Z",
        },
        {
          phase: "monitor",
          issueId: "issue-janus",
          action: "watch_session",
          outcome: "ok",
          detail: null,
          timestamp: "2026-04-16T00:00:02.000Z",
        },
        {
          phase: "reap",
          issueId: "issue-janus",
          action: "finalize_session",
          outcome: "failed",
          detail: null,
          timestamp: "2026-04-16T00:00:03.000Z",
        },
      ],
      labor: {
        happy: {
          queueLaborPath: ".aegis/labors/labor-issue-happy",
          queueLaborPathExists: true,
          preservedLaborPath: null,
          preservedLaborPathExists: false,
          janusArtifactRef: null,
          janusArtifactExists: false,
          recommendedNextAction: null,
        },
        janus: {
          queueLaborPath: ".aegis/labors/labor-issue-janus",
          queueLaborPathExists: true,
          preservedLaborPath: "/repo/.aegis/labors/labor-issue-janus",
          preservedLaborPathExists: true,
          janusArtifactRef: ".aegis/janus/issue-janus.json",
          janusArtifactExists: true,
          recommendedNextAction: "manual_decision",
        },
      },
    };

    expect(() => assertMockAcceptanceSurface(surface)).not.toThrow();
  });
});
