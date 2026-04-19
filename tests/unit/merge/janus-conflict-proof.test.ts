import path from "node:path";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_AEGIS_CONFIG } from "../../../src/config/defaults.js";
import { runMergeNext } from "../../../src/merge/merge-next.js";
import { saveDispatchState, type DispatchState } from "../../../src/core/dispatch-state.js";
import { saveMergeQueueState, type MergeQueueState } from "../../../src/merge/merge-state.js";
import { ScriptedCasteRuntime } from "../../../src/runtime/scripted-caste-runtime.js";
import type { AegisIssue } from "../../../src/tracker/issue-model.js";

const tempRoots: string[] = [];

function createTempRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "aegis-janus-proof-"));
  tempRoots.push(root);
  mkdirSync(path.join(root, ".aegis"), { recursive: true });
  return root;
}

function createIssue(issueId: string): AegisIssue {
  return {
    id: issueId,
    title: "Integration conflict proof",
    description: "Deterministic T3 Janus escalation proof",
    issueClass: "primary",
    status: "open",
    priority: 1,
    blockers: [],
    parentId: null,
    childIds: [],
    labels: ["phase-k", "janus"],
  };
}

function seedState(root: string, issueId: string) {
  saveDispatchState(root, {
    schemaVersion: 1,
    records: {
      [issueId]: {
        issueId,
        stage: "queued_for_merge",
        runningAgent: null,
        oracleAssessmentRef: path.join(".aegis", "oracle", `${issueId}.json`),
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
        updatedAt: "2026-04-19T15:00:00.000Z",
      },
    },
  } satisfies DispatchState);

  saveMergeQueueState(root, {
    schemaVersion: 1,
    items: [
      {
        queueItemId: `queue-${issueId}`,
        issueId,
        candidateBranch: `aegis/${issueId}`,
        targetBranch: "main",
        laborPath: `.aegis/labors/labor-${issueId}`,
        status: "queued",
        attempts: 0,
        janusInvocations: 0,
        lastTier: null,
        lastError: null,
        enqueuedAt: "2026-04-19T15:00:00.000Z",
        updatedAt: "2026-04-19T15:00:00.000Z",
      },
    ],
  } satisfies MergeQueueState);
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("Phase K Janus conflict proof seam", () => {
  it("reaches deterministic T3 escalation, records Janus invocations, then fail-closes with manual decision context", async () => {
    const root = createTempRoot();
    const issueId = "aegis-k-janus";
    seedState(root, issueId);

    writeFileSync(
      path.join(root, ".aegis", "config.json"),
      `${JSON.stringify({
        ...DEFAULT_AEGIS_CONFIG,
        janus: {
          ...DEFAULT_AEGIS_CONFIG.janus,
          max_invocations_per_issue: 2,
        },
      }, null, 2)}\n`,
      "utf8",
    );

    let janusRuns = 0;
    const runtime = new ScriptedCasteRuntime({
      janus: () => {
        janusRuns += 1;
        return {
          output: JSON.stringify({
            originatingIssueId: issueId,
            queueItemId: `queue-${issueId}`,
            preservedLaborPath: `.aegis/labors/labor-${issueId}`,
            conflictSummary: janusRuns === 1
              ? "rebasing required before retry"
              : "conflict still ambiguous after retry",
            resolutionStrategy: janusRuns === 1
              ? "retry with refreshed merge candidate"
              : "escalate to manual decision",
            filesTouched: ["src/todo.ts"],
            validationsRun: ["npm run test -- tests/unit/todo.test.ts"],
            residualRisks: janusRuns === 1 ? [] : ["manual merge policy decision pending"],
            recommendedNextAction: janusRuns === 1 ? "requeue" : "manual_decision",
          }),
        };
      },
    });

    const tracker = {
      getIssue: vi.fn(async () => createIssue(issueId)),
    };
    const executor = {
      execute: vi.fn(async () => ({
        outcome: "conflict" as const,
        detail: "Deterministic merge conflict in src/todo.ts.",
      })),
    };

    const first = await runMergeNext(root, { tracker, runtime, executor });
    const second = await runMergeNext(root, { tracker, runtime, executor });
    const third = await runMergeNext(root, { tracker, runtime, executor });
    const fourth = await runMergeNext(root, { tracker, runtime, executor });

    expect(first).toMatchObject({
      tier: "T2",
      status: "requeued",
      stage: "queued_for_merge",
    });
    expect(second).toMatchObject({
      tier: "T2",
      status: "requeued",
      stage: "queued_for_merge",
    });
    expect(third).toMatchObject({
      tier: "T3",
      status: "janus_requeued",
      stage: "queued_for_merge",
    });
    expect(fourth).toMatchObject({
      tier: "T3",
      status: "failed",
      stage: "failed",
    });

    const queueItem = JSON.parse(
      readFileSync(path.join(root, ".aegis", "merge-queue.json"), "utf8"),
    ).items[0] as {
      status: string;
      attempts: number;
      janusInvocations: number;
      lastTier: string;
      lastError: string | null;
    };

    expect(queueItem).toMatchObject({
      status: "failed",
      attempts: 4,
      janusInvocations: 2,
      lastTier: "T3",
    });
    expect(queueItem.lastError).toContain("Deterministic merge conflict in src/todo.ts.");
    expect(queueItem.lastError).toContain("manual_decision");
    expect(janusRuns).toBe(2);
  });
});

