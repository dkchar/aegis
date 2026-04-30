import path from "node:path";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";

import { initProject } from "../../../src/config/init-project.js";
import { loadDispatchState, saveDispatchState } from "../../../src/core/dispatch-state.js";
import { loadMergeQueueState } from "../../../src/merge/merge-state.js";

const tempRoots: string[] = [];

function createTempRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "aegis-loop-runner-"));
  tempRoots.push(root);
  return root;
}

async function sleep(milliseconds: number) {
  await new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();

  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("runDaemonCycle", () => {
  it("reaps a completed Oracle session into scouted with an artifact ref", async () => {
    const root = createTempRoot();
    initProject(root);
    writeFileSync(
      path.join(root, ".aegis", "config.json"),
      `${JSON.stringify({
        runtime: "scripted",
        models: {
          oracle: "openai-codex:gpt-5.4-mini",
          titan: "openai-codex:gpt-5.4-mini",
          sentinel: "openai-codex:gpt-5.4-mini",
          janus: "openai-codex:gpt-5.4-mini",
        },
        thinking: {
          oracle: "medium",
          titan: "medium",
          sentinel: "medium",
          janus: "medium",
        },
        concurrency: {
          max_agents: 1,
          max_oracles: 1,
          max_titans: 1,
          max_sentinels: 1,
          max_janus: 1,
        },
        thresholds: {
          poll_interval_seconds: 5,
          stuck_warning_seconds: 240,
          stuck_kill_seconds: 600,
          allow_complex_auto_dispatch: false,
          scope_overlap_threshold: 0,
          janus_retry_threshold: 2,
        },
        janus: {
          enabled: true,
          max_invocations_per_issue: 1,
        },
        labor: {
          base_path: ".aegis/labors",
        },
        git: {
          base_branch: "main",
        },
      }, null, 2)}\n`,
      "utf8",
    );

    vi.doMock("../../../src/tracker/beads-tracker.js", () => ({
      BeadsTrackerClient: class {
        async listReadyIssues() {
          return [{ id: "ISSUE-1", title: "Example" }];
        }

        async getIssue() {
          return {
            id: "ISSUE-1",
            title: "Example",
            description: "Desc",
            issueClass: "primary",
            status: "open",
            priority: 1,
            blockers: [],
            parentId: null,
            childIds: [],
            labels: [],
          };
        }
      },
    }));

    const { runDaemonCycle } = await import("../../../src/core/loop-runner.js");

    await runDaemonCycle(root);
    await sleep(50);
    await runDaemonCycle(root);

    const state = JSON.parse(
      readFileSync(path.join(root, ".aegis", "dispatch-state.json"), "utf8"),
    ) as {
      records: Record<string, {
        stage: string;
        oracleAssessmentRef: string | null;
        runningAgent: { caste: string } | null;
      }>;
    };

    expect(["scouted", "implementing"]).toContain(state.records["ISSUE-1"]?.stage);
    expect(state.records["ISSUE-1"]?.runningAgent?.caste ?? null).not.toBe("oracle");
    expect(state.records["ISSUE-1"]?.oracleAssessmentRef).toBeTruthy();
  });

  it("waits for pre-merge Sentinel before enqueueing reviewed work", async () => {
    const root = createTempRoot();
    initProject(root);
    mkdirSync(path.join(root, ".aegis", "titan"), { recursive: true });
    writeFileSync(
      path.join(root, ".aegis", "titan", "ISSUE-REVIEW.json"),
      `${JSON.stringify({
        labor_path: ".aegis/labors/ISSUE-REVIEW",
        candidate_branch: "aegis/ISSUE-REVIEW",
        base_branch: "main",
      }, null, 2)}\n`,
      "utf8",
    );
    saveDispatchState(root, {
      schemaVersion: 1,
      records: {
        "ISSUE-REVIEW": {
          issueId: "ISSUE-REVIEW",
          stage: "implemented",
          runningAgent: null,
          oracleAssessmentRef: ".aegis/oracle/ISSUE-REVIEW.json",
          titanHandoffRef: ".aegis/titan/ISSUE-REVIEW.json",
          titanClarificationRef: null,
          sentinelVerdictRef: null,
          janusArtifactRef: null,
          failureTranscriptRef: null,
          fileScope: null,
          failureCount: 0,
          consecutiveFailures: 0,
          failureWindowStartMs: null,
          cooldownUntil: null,
          sessionProvenanceId: "daemon",
          updatedAt: "2026-04-26T20:00:00.000Z",
        },
      },
    });

    vi.doMock("../../../src/tracker/beads-tracker.js", () => ({
      BeadsTrackerClient: class {
        async listReadyIssues() {
          return [];
        }
      },
    }));

    const { runDaemonCycle } = await import("../../../src/core/loop-runner.js");

    await runDaemonCycle(root, {
      runtime: {
        async launch() {
          throw new Error("unexpected launch");
        },
        async readSession() {
          return null;
        },
        async terminate() {
          return null;
        },
      },
      launchPreMergeReview: async ({ issueId, timestamp }) => {
        await sleep(25);
        const state = loadDispatchState(root);
        const record = state.records[issueId];
        if (!record) {
          throw new Error(`missing dispatch record ${issueId}`);
        }
        saveDispatchState(root, {
          schemaVersion: state.schemaVersion,
          records: {
            ...state.records,
            [issueId]: {
              ...record,
              stage: "queued_for_merge",
              sentinelVerdictRef: `.aegis/sentinel/${issueId}.json`,
              reviewFeedbackRef: `.aegis/sentinel/${issueId}.json`,
              updatedAt: timestamp,
            },
          },
        });
      },
    });

    const dispatchState = loadDispatchState(root);
    const mergeQueue = loadMergeQueueState(root);

    expect(dispatchState.records["ISSUE-REVIEW"]).toMatchObject({
      stage: "queued_for_merge",
      sentinelVerdictRef: ".aegis/sentinel/ISSUE-REVIEW.json",
    });
    expect(mergeQueue.items).toMatchObject([
      {
        issueId: "ISSUE-REVIEW",
        candidateBranch: "aegis/ISSUE-REVIEW",
        targetBranch: "main",
        status: "queued",
      },
    ]);
  });

  it("launches pre-merge Sentinel as a durable runtime session", async () => {
    const root = createTempRoot();
    initProject(root);
    mkdirSync(path.join(root, ".aegis", "titan"), { recursive: true });
    writeFileSync(
      path.join(root, ".aegis", "titan", "ISSUE-REVIEW.json"),
      `${JSON.stringify({
        labor_path: ".aegis/labors/ISSUE-REVIEW",
        candidate_branch: "aegis/ISSUE-REVIEW",
        base_branch: "main",
      }, null, 2)}\n`,
      "utf8",
    );
    saveDispatchState(root, {
      schemaVersion: 1,
      records: {
        "ISSUE-REVIEW": {
          issueId: "ISSUE-REVIEW",
          stage: "implemented",
          runningAgent: null,
          oracleAssessmentRef: ".aegis/oracle/ISSUE-REVIEW.json",
          titanHandoffRef: ".aegis/titan/ISSUE-REVIEW.json",
          titanClarificationRef: null,
          sentinelVerdictRef: null,
          janusArtifactRef: null,
          failureTranscriptRef: null,
          fileScope: null,
          failureCount: 0,
          consecutiveFailures: 0,
          failureWindowStartMs: null,
          cooldownUntil: null,
          sessionProvenanceId: "daemon-old",
          updatedAt: "2026-04-26T20:00:00.000Z",
        },
      },
    });

    vi.doMock("../../../src/tracker/beads-tracker.js", () => ({
      BeadsTrackerClient: class {
        async listReadyIssues() {
          return [];
        }
      },
    }));

    const launch = vi.fn(async (input: any) => ({
      sessionId: `session-${input.caste}`,
      startedAt: "2026-04-26T20:01:00.000Z",
    }));
    const { runDaemonCycle } = await import("../../../src/core/loop-runner.js");

    await runDaemonCycle(root, {
      runtime: {
        launch,
        async readSession() {
          return null;
        },
        async terminate() {
          return null;
        },
      },
      sessionProvenanceId: "daemon-new",
    });

    expect(launch).toHaveBeenCalledWith(expect.objectContaining({
      root,
      issueId: "ISSUE-REVIEW",
      caste: "sentinel",
      stage: "reviewing",
    }));
    expect(loadDispatchState(root).records["ISSUE-REVIEW"]).toMatchObject({
      stage: "reviewing",
      runningAgent: {
        caste: "sentinel",
        sessionId: "session-sentinel",
      },
      sessionProvenanceId: "daemon-new",
    });
    expect(loadMergeQueueState(root).items).toEqual([]);
  });

  it("keeps implemented work in cooldown when pre-merge review crashes", async () => {
    const root = createTempRoot();
    initProject(root);
    mkdirSync(path.join(root, ".aegis", "titan"), { recursive: true });
    writeFileSync(
      path.join(root, ".aegis", "titan", "ISSUE-REVIEW.json"),
      `${JSON.stringify({
        labor_path: ".aegis/labors/ISSUE-REVIEW",
        candidate_branch: "aegis/ISSUE-REVIEW",
        base_branch: "main",
      }, null, 2)}\n`,
      "utf8",
    );
    saveDispatchState(root, {
      schemaVersion: 1,
      records: {
        "ISSUE-REVIEW": {
          issueId: "ISSUE-REVIEW",
          stage: "implemented",
          runningAgent: null,
          oracleAssessmentRef: ".aegis/oracle/ISSUE-REVIEW.json",
          titanHandoffRef: ".aegis/titan/ISSUE-REVIEW.json",
          titanClarificationRef: null,
          sentinelVerdictRef: null,
          janusArtifactRef: null,
          failureTranscriptRef: null,
          fileScope: null,
          failureCount: 0,
          consecutiveFailures: 0,
          failureWindowStartMs: null,
          cooldownUntil: null,
          sessionProvenanceId: "daemon",
          updatedAt: "2026-04-26T20:00:00.000Z",
        },
      },
    });

    vi.doMock("../../../src/tracker/beads-tracker.js", () => ({
      BeadsTrackerClient: class {
        async listReadyIssues() {
          return [{ id: "ISSUE-REVIEW", title: "Review me" }];
        }
      },
    }));

    const { runDaemonCycle } = await import("../../../src/core/loop-runner.js");
    const launchPreMergeReview = vi.fn(async () => {
      throw new Error("Sentinel verdict field 'contractChecks' must be an array of strings.");
    });
    const runtime = {
      async launch() {
        throw new Error("unexpected dispatch launch");
      },
      async readSession() {
        return null;
      },
      async terminate() {
        return null;
      },
    };

    await runDaemonCycle(root, { runtime, launchPreMergeReview });
    await runDaemonCycle(root, { runtime, launchPreMergeReview });

    const state = loadDispatchState(root);
    expect(state.records["ISSUE-REVIEW"]).toMatchObject({
      stage: "implemented",
      runningAgent: null,
      failureCount: 1,
      consecutiveFailures: 1,
    });
    expect(state.records["ISSUE-REVIEW"]?.cooldownUntil).toBeTruthy();
    expect(launchPreMergeReview).toHaveBeenCalledTimes(1);
    expect(loadMergeQueueState(root).items).toEqual([]);
  });

  it("recovers a stranded reviewing record from durable Sentinel verdict", async () => {
    const root = createTempRoot();
    initProject(root);
    mkdirSync(path.join(root, ".aegis", "titan"), { recursive: true });
    mkdirSync(path.join(root, ".aegis", "sentinel"), { recursive: true });
    writeFileSync(
      path.join(root, ".aegis", "titan", "ISSUE-REVIEW.json"),
      `${JSON.stringify({
        labor_path: ".aegis/labors/ISSUE-REVIEW",
        candidate_branch: "aegis/ISSUE-REVIEW",
        base_branch: "main",
      }, null, 2)}\n`,
      "utf8",
    );
    writeFileSync(
      path.join(root, ".aegis", "sentinel", "ISSUE-REVIEW.json"),
      `${JSON.stringify({
        verdict: "fail_blocking",
        reviewSummary: "needs rework",
        blockingFindings: [{
          finding_kind: "regression",
          summary: "format drift remains",
          required_files: ["docs/setup-gate.md"],
          owner_issue: "ISSUE-REVIEW",
          route: "rework_owner",
        }],
        advisories: [],
        touchedFiles: ["docs/setup-gate.md"],
        contractChecks: ["format check"],
        session: { sessionId: "sentinel-1" },
      }, null, 2)}\n`,
      "utf8",
    );
    saveDispatchState(root, {
      schemaVersion: 1,
      records: {
        "ISSUE-REVIEW": {
          issueId: "ISSUE-REVIEW",
          stage: "reviewing",
          runningAgent: null,
          oracleAssessmentRef: ".aegis/oracle/ISSUE-REVIEW.json",
          titanHandoffRef: ".aegis/titan/ISSUE-REVIEW.json",
          titanClarificationRef: null,
          sentinelVerdictRef: ".aegis/sentinel/ISSUE-REVIEW.json",
          janusArtifactRef: null,
          failureTranscriptRef: null,
          reviewFeedbackRef: null,
          fileScope: null,
          failureCount: 0,
          consecutiveFailures: 0,
          failureWindowStartMs: null,
          cooldownUntil: null,
          sessionProvenanceId: "daemon",
          updatedAt: "2026-04-26T20:00:00.000Z",
        },
      },
    });

    vi.doMock("../../../src/tracker/beads-tracker.js", () => ({
      BeadsTrackerClient: class {
        async listReadyIssues() {
          return [];
        }
      },
    }));

    const { runDaemonCycle } = await import("../../../src/core/loop-runner.js");
    const launchPreMergeReview = vi.fn(async () => {
      throw new Error("should not rerun Sentinel when verdict artifact exists");
    });

    await runDaemonCycle(root, {
      runtime: {
        async launch() {
          throw new Error("unexpected dispatch launch");
        },
        async readSession() {
          return null;
        },
        async terminate() {
          return null;
        },
      },
      launchPreMergeReview,
    });

    expect(loadDispatchState(root).records["ISSUE-REVIEW"]).toMatchObject({
      stage: "rework_required",
      sentinelVerdictRef: ".aegis/sentinel/ISSUE-REVIEW.json",
      reviewFeedbackRef: ".aegis/sentinel/ISSUE-REVIEW.json",
    });
    expect(launchPreMergeReview).not.toHaveBeenCalled();
    expect(loadMergeQueueState(root).items).toEqual([]);
  });

  it("returns resolved router-created blockers to fresh Oracle scout instead of stale review", async () => {
    const root = createTempRoot();
    initProject(root);
    mkdirSync(path.join(root, ".aegis", "policy"), { recursive: true });
    mkdirSync(path.join(root, ".aegis", "titan"), { recursive: true });
    mkdirSync(path.join(root, ".aegis", "sentinel"), { recursive: true });
    writeFileSync(
      path.join(root, ".aegis", "policy", "ISSUE-PARENT--accepted.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        outcome: "accepted",
        originIssueId: "ISSUE-PARENT",
        originCaste: "router",
        proposalType: "create_out_of_scope_blocker",
        fingerprint: "contract-mismatch",
        summary: "contract blocker",
        childIssueId: "ISSUE-BLOCKER",
        parentStage: "blocked_on_child",
        createdAt: "2026-04-29T12:00:00.000Z",
      }, null, 2)}\n`,
      "utf8",
    );
    writeFileSync(
      path.join(root, ".aegis", "titan", "ISSUE-PARENT.json"),
      `${JSON.stringify({
        labor_path: ".aegis/labors/ISSUE-PARENT",
        candidate_branch: "aegis/ISSUE-PARENT",
        base_branch: "main",
      }, null, 2)}\n`,
      "utf8",
    );
    writeFileSync(
      path.join(root, ".aegis", "sentinel", "ISSUE-PARENT.json"),
      `${JSON.stringify({
        verdict: "fail_blocking",
        reviewSummary: "needs contract blocker",
        blockingFindings: [{
          finding_kind: "out_of_scope_blocker",
          summary: "contract mismatch",
          required_files: ["docs/setup-contract.md"],
          owner_issue: "ISSUE-PARENT",
          route: "create_blocker",
        }],
        advisories: [],
        touchedFiles: ["src/App.tsx"],
        contractChecks: ["contract mismatch found"],
      }, null, 2)}\n`,
      "utf8",
    );
    saveDispatchState(root, {
      schemaVersion: 1,
      records: {
        "ISSUE-PARENT": {
          issueId: "ISSUE-PARENT",
          stage: "blocked_on_child",
          runningAgent: null,
          blockedByIssueId: "ISSUE-BLOCKER",
          policyArtifactRef: ".aegis/policy/ISSUE-PARENT--accepted.json",
          oracleAssessmentRef: ".aegis/oracle/ISSUE-PARENT.json",
          titanHandoffRef: ".aegis/titan/ISSUE-PARENT.json",
          titanClarificationRef: null,
          sentinelVerdictRef: ".aegis/sentinel/ISSUE-PARENT.json",
          reviewFeedbackRef: ".aegis/sentinel/ISSUE-PARENT.json",
          janusArtifactRef: null,
          failureTranscriptRef: null,
          fileScope: { files: ["src/App.tsx"] },
          failureCount: 0,
          consecutiveFailures: 0,
          failureWindowStartMs: null,
          cooldownUntil: null,
          sessionProvenanceId: "daemon-old",
          updatedAt: "2026-04-29T12:00:00.000Z",
        } as any,
      },
    });

    vi.doMock("../../../src/tracker/beads-tracker.js", () => ({
      BeadsTrackerClient: class {
        async listReadyIssues() {
          return [{ id: "ISSUE-PARENT", title: "Parent ready after blocker" }];
        }
      },
    }));

    const launch = vi.fn(async (input: any) => ({
      sessionId: `session-${input.caste}`,
      startedAt: "2026-04-29T12:01:00.000Z",
    }));
    const { runDaemonCycle } = await import("../../../src/core/loop-runner.js");

    await runDaemonCycle(root, {
      runtime: {
        launch,
        async readSession() {
          return null;
        },
        async terminate() {
          return null;
        },
      },
      sessionProvenanceId: "daemon-new",
    });

    expect(launch).toHaveBeenCalledTimes(1);
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({
      issueId: "ISSUE-PARENT",
      caste: "oracle",
      stage: "scouting",
    }));
    expect(loadDispatchState(root).records["ISSUE-PARENT"]).toMatchObject({
      stage: "scouting",
      blockedByIssueId: null,
      oracleAssessmentRef: null,
      reviewFeedbackRef: null,
      titanHandoffRef: null,
      sentinelVerdictRef: null,
      fileScope: null,
      runningAgent: {
        caste: "oracle",
        sessionId: "session-oracle",
      },
    });
  });

  it("recovers failed parents when a Titan-created policy blocker has closed", async () => {
    const root = createTempRoot();
    initProject(root);
    mkdirSync(path.join(root, ".aegis", "policy"), { recursive: true });
    writeFileSync(
      path.join(root, ".aegis", "policy", "ISSUE-PARENT--accepted.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        outcome: "accepted",
        originIssueId: "ISSUE-PARENT",
        originCaste: "titan",
        proposalType: "create_out_of_scope_blocker",
        fingerprint: "test-wiring",
        summary: "wire tests",
        childIssueId: "ISSUE-BLOCKER",
        parentStage: "blocked_on_child",
        createdAt: "2026-04-29T12:00:00.000Z",
      }, null, 2)}\n`,
      "utf8",
    );
    saveDispatchState(root, {
      schemaVersion: 1,
      records: {
        "ISSUE-PARENT": {
          issueId: "ISSUE-PARENT",
          stage: "failed_operational",
          runningAgent: null,
          blockedByIssueId: "ISSUE-BLOCKER",
          policyArtifactRef: ".aegis/policy/ISSUE-PARENT--accepted.json",
          oracleAssessmentRef: ".aegis/oracle/ISSUE-PARENT.json",
          titanHandoffRef: null,
          titanClarificationRef: ".aegis/titan/ISSUE-PARENT.json",
          sentinelVerdictRef: null,
          reviewFeedbackRef: ".aegis/sentinel/ISSUE-PARENT.json",
          janusArtifactRef: null,
          failureTranscriptRef: ".aegis/transcripts/ISSUE-PARENT--titan.json",
          fileScope: { files: ["docs/core-gate.md"] },
          failureCount: 3,
          consecutiveFailures: 3,
          failureWindowStartMs: 1777562269020,
          cooldownUntil: "2026-04-29T12:00:30.000Z",
          sessionProvenanceId: "daemon-old",
          updatedAt: "2026-04-29T12:00:00.000Z",
        } as any,
      },
    });

    vi.doMock("../../../src/tracker/beads-tracker.js", () => ({
      BeadsTrackerClient: class {
        async listReadyIssues() {
          return [{ id: "ISSUE-PARENT", title: "Parent ready after Titan blocker" }];
        }
      },
    }));

    const launch = vi.fn(async (input: any) => ({
      sessionId: `session-${input.caste}`,
      startedAt: "2026-04-29T12:01:00.000Z",
    }));
    const { runDaemonCycle } = await import("../../../src/core/loop-runner.js");

    await runDaemonCycle(root, {
      runtime: {
        launch,
        async readSession() {
          return null;
        },
        async terminate() {
          return null;
        },
      },
      sessionProvenanceId: "daemon-new",
    });

    expect(launch).toHaveBeenCalledWith(expect.objectContaining({
      issueId: "ISSUE-PARENT",
      caste: "oracle",
      stage: "scouting",
    }));
    expect(loadDispatchState(root).records["ISSUE-PARENT"]).toMatchObject({
      stage: "scouting",
      blockedByIssueId: null,
      policyArtifactRef: null,
      oracleAssessmentRef: null,
      reviewFeedbackRef: null,
      titanClarificationRef: null,
      fileScope: null,
      failureCount: 3,
      consecutiveFailures: 3,
    });
  });
});
