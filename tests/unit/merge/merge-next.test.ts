import path from "node:path";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_AEGIS_CONFIG } from "../../../src/config/defaults.js";
import { saveDispatchState, type DispatchRecord, type DispatchState } from "../../../src/core/dispatch-state.js";
import { runMergeNext } from "../../../src/merge/merge-next.js";
import { saveMergeQueueState, type MergeQueueItem } from "../../../src/merge/merge-state.js";
import { ScriptedCasteRuntime } from "../../../src/runtime/scripted-caste-runtime.js";
import type { AegisIssue } from "../../../src/tracker/issue-model.js";

const tempRoots: string[] = [];

function createTempRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "aegis-merge-next-"));
  tempRoots.push(root);
  mkdirSync(path.join(root, ".aegis"), { recursive: true });
  writeFileSync(
    path.join(root, ".aegis", "config.json"),
    `${JSON.stringify(DEFAULT_AEGIS_CONFIG, null, 2)}\n`,
    "utf8",
  );
  return root;
}

function createIssue(issueId: string): AegisIssue {
  return {
    id: issueId,
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

function createRecord(issueId: string, stage: string): DispatchRecord {
  return {
    issueId,
    stage,
    runningAgent: null,
    oracleAssessmentRef: null,
    titanHandoffRef: path.join(".aegis", "titan", `${issueId}.json`),
    titanClarificationRef: null,
    sentinelVerdictRef: null,
    janusArtifactRef: null,
    failureTranscriptRef: null,
    fileScope: null,
    failureCount: 0,
    consecutiveFailures: 0,
    failureWindowStartMs: null,
    cooldownUntil: null,
    sessionProvenanceId: "test",
    updatedAt: "2026-04-14T12:00:00.000Z",
  };
}

function createQueueItem(issueId: string, attempts = 0): MergeQueueItem {
  return {
    queueItemId: `queue-${issueId}`,
    issueId,
    candidateBranch: `aegis/${issueId}`,
    targetBranch: "main",
    laborPath: `labors/${issueId}`,
    status: "queued",
    attempts,
    janusInvocations: 0,
    lastTier: null,
    lastError: null,
    enqueuedAt: "2026-04-14T12:00:00.000Z",
    updatedAt: "2026-04-14T12:00:00.000Z",
  };
}

function writeState(root: string, issueId: string, attempts = 0) {
  const dispatchState: DispatchState = {
    schemaVersion: 1,
    records: {
      [issueId]: createRecord(issueId, "queued_for_merge"),
    },
  };

  saveDispatchState(root, dispatchState);
  saveMergeQueueState(root, {
    schemaVersion: 1,
    items: [createQueueItem(issueId, attempts)],
  });
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("runMergeNext", () => {
  it("merges queued work, runs Sentinel post-merge, and advances the issue to reviewed", async () => {
    const root = createTempRoot();
    writeState(root, "aegis-123");

    const result = await runMergeNext(root, {
      tracker: {
        getIssue: vi.fn(async () => createIssue("aegis-123")),
      },
      runtime: new ScriptedCasteRuntime({
        sentinel: () => ({
          output: JSON.stringify({
            verdict: "pass",
            reviewSummary: "merged cleanly",
            issuesFound: [],
            followUpIssueIds: [],
            riskAreas: [],
          }),
        }),
      }),
      executor: {
        execute: vi.fn(async () => ({
          outcome: "merged" as const,
          detail: "Merged cleanly.",
        })),
      },
      now: "2026-04-14T12:30:00.000Z",
    });

    expect(result).toMatchObject({
      action: "merge_next",
      issueId: "aegis-123",
      queueItemId: "queue-aegis-123",
      tier: "T1",
      stage: "reviewed",
      status: "merged",
    });
  });

  it("requeues T2 work without invoking Janus", async () => {
    const root = createTempRoot();
    writeState(root, "aegis-456");

    const runtime = new ScriptedCasteRuntime();
    const result = await runMergeNext(root, {
      tracker: {
        getIssue: vi.fn(async () => createIssue("aegis-456")),
      },
      runtime,
      executor: {
        execute: vi.fn(async () => ({
          outcome: "stale_branch" as const,
          detail: "Branch needs refresh.",
        })),
      },
      now: "2026-04-14T12:30:00.000Z",
    });

    expect(result).toMatchObject({
      action: "merge_next",
      issueId: "aegis-456",
      queueItemId: "queue-aegis-456",
      tier: "T2",
      stage: "queued_for_merge",
      status: "requeued",
    });

    expect(JSON.parse(
      readFileSync(path.join(root, ".aegis", "dispatch-state.json"), "utf8"),
    ).records["aegis-456"].stage).toBe("queued_for_merge");
  });

  it("dispatches Janus on T3 and requeues when Janus recommends requeue", async () => {
    const root = createTempRoot();
    writeState(root, "aegis-789", 2);

    const result = await runMergeNext(root, {
      tracker: {
        getIssue: vi.fn(async () => createIssue("aegis-789")),
      },
      runtime: new ScriptedCasteRuntime({
        janus: () => ({
          output: JSON.stringify({
            originatingIssueId: "aegis-789",
            queueItemId: "queue-aegis-789",
            preservedLaborPath: "labors/aegis-789",
            conflictSummary: "Needs integration retry",
            resolutionStrategy: "Refresh merge candidate",
            filesTouched: [],
            validationsRun: [],
            residualRisks: [],
            recommendedNextAction: "requeue",
          }),
        }),
      }),
      executor: {
        execute: vi.fn(async () => ({
          outcome: "conflict" as const,
          detail: "Merge conflict.",
        })),
      },
      now: "2026-04-14T12:30:00.000Z",
    });

    expect(result).toMatchObject({
      action: "merge_next",
      issueId: "aegis-789",
      queueItemId: "queue-aegis-789",
      tier: "T3",
      stage: "queued_for_merge",
      status: "janus_requeued",
    });

    expect(JSON.parse(
      readFileSync(path.join(root, ".aegis", "dispatch-state.json"), "utf8"),
    ).records["aegis-789"].stage).toBe("queued_for_merge");
    expect(JSON.parse(
      readFileSync(path.join(root, ".aegis", "merge-queue.json"), "utf8"),
    ).items[0].janusInvocations).toBe(1);
  });

  it("selects scripted merge outcomes by issue, branch, and queue attempt", async () => {
    const root = createTempRoot();
    writeState(root, "aegis-321");

    const previousPlan = process.env.AEGIS_SCRIPTED_MERGE_PLAN;
    process.env.AEGIS_SCRIPTED_MERGE_PLAN = JSON.stringify({
      rules: [
        {
          issueId: "aegis-321",
          candidateBranch: "aegis/aegis-321",
          outcomes: [
            { outcome: "stale_branch", detail: "attempt-0" },
            { outcome: "stale_branch", detail: "attempt-1" },
            { outcome: "conflict", detail: "attempt-2" },
          ],
        },
      ],
    });

    try {
      const first = await runMergeNext(root, {
        tracker: {
          getIssue: vi.fn(async () => createIssue("aegis-321")),
        },
      });

      expect(first).toMatchObject({
        issueId: "aegis-321",
        queueItemId: "queue-aegis-321",
        tier: "T2",
        stage: "queued_for_merge",
        status: "requeued",
        detail: "attempt-0",
      });

      const second = await runMergeNext(root, {
        tracker: {
          getIssue: vi.fn(async () => createIssue("aegis-321")),
        },
      });

      expect(second).toMatchObject({
        issueId: "aegis-321",
        queueItemId: "queue-aegis-321",
        tier: "T2",
        stage: "queued_for_merge",
        status: "requeued",
        detail: "attempt-1",
      });

      const third = await runMergeNext(root, {
        tracker: {
          getIssue: vi.fn(async () => createIssue("aegis-321")),
        },
      });

      expect(third).toMatchObject({
        issueId: "aegis-321",
        queueItemId: "queue-aegis-321",
        tier: "T3",
        stage: "queued_for_merge",
        status: "janus_requeued",
        detail: "attempt-2",
      });
      expect(JSON.parse(
        readFileSync(path.join(root, ".aegis", "merge-queue.json"), "utf8"),
      ).items[0]).toMatchObject({
        attempts: 3,
        janusInvocations: 1,
        lastTier: "T3",
        status: "queued",
      });
    } finally {
      if (previousPlan === undefined) {
        delete process.env.AEGIS_SCRIPTED_MERGE_PLAN;
      } else {
        process.env.AEGIS_SCRIPTED_MERGE_PLAN = previousPlan;
      }
    }
  });
});
