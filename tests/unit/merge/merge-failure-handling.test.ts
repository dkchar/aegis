import path from "node:path";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_AEGIS_CONFIG } from "../../../src/config/defaults.js";
import { loadDispatchState, saveDispatchState, type DispatchRecord } from "../../../src/core/dispatch-state.js";
import { autoEnqueueImplementedIssuesForMerge } from "../../../src/merge/auto-enqueue.js";
import { runMergeNext } from "../../../src/merge/merge-next.js";
import { loadMergeQueueState, saveMergeQueueState, type MergeQueueItem } from "../../../src/merge/merge-state.js";
import type { AegisIssue } from "../../../src/tracker/issue-model.js";

const tempRoots: string[] = [];
const ISSUE = "AG-0042";
const NOW = "2026-05-01T10:00:00.000Z";

function createTempRoot(config = DEFAULT_AEGIS_CONFIG) {
  const root = mkdtempSync(path.join(tmpdir(), "aegis-merge-failure-"));
  tempRoots.push(root);
  mkdirSync(path.join(root, ".aegis", "titan"), { recursive: true });
  writeFileSync(path.join(root, ".aegis", "config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
  writeFileSync(
    path.join(root, ".aegis", "titan", `${ISSUE}.json`),
    JSON.stringify({ labor_path: `labors/${ISSUE}`, candidate_branch: `aegis/${ISSUE}`, base_branch: "main" }),
    "utf8",
  );
  return root;
}

function createRecord(): DispatchRecord {
  return {
    issueId: ISSUE,
    stage: "queued_for_merge",
    runningAgent: null,
    oracleAssessmentRef: path.join(".aegis", "oracle", `${ISSUE}.json`),
    titanHandoffRef: path.join(".aegis", "titan", `${ISSUE}.json`),
    sentinelVerdictRef: path.join(".aegis", "sentinel", `${ISSUE}.json`),
    fileScope: null,
    failureCount: 0,
    consecutiveFailures: 0,
    failureWindowStartMs: null,
    cooldownUntil: null,
    sessionProvenanceId: "test",
    updatedAt: "2026-05-01T09:00:00.000Z",
  };
}

function createQueueItem(overrides: Partial<MergeQueueItem> = {}): MergeQueueItem {
  return {
    queueItemId: `queue-${ISSUE}`,
    issueId: ISSUE,
    candidateBranch: `aegis/${ISSUE}`,
    targetBranch: "main",
    laborPath: `labors/${ISSUE}`,
    status: "queued",
    attempts: 0,
    janusInvocations: 0,
    lastTier: null,
    lastError: null,
    enqueuedAt: "2026-05-01T09:00:00.000Z",
    updatedAt: "2026-05-01T09:00:00.000Z",
    ...overrides,
  };
}

function seed(root: string, item: Partial<MergeQueueItem> = {}) {
  saveDispatchState(root, { schemaVersion: 1, records: { [ISSUE]: createRecord() } });
  saveMergeQueueState(root, { schemaVersion: 1, items: [createQueueItem(item)] });
}

const tracker = {
  getIssue: vi.fn(async (): Promise<AegisIssue> => ({
    id: ISSUE,
    title: "Example",
    description: "Desc",
    issueClass: "primary",
    status: "open",
    priority: 1,
    blockers: [],
    parentId: null,
    childIds: [],
    labels: [],
  })),
  closeIssue: vi.fn(async () => undefined),
};

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("merge queue failure handling", () => {
  it("fails closed instead of stranding the item in merging when the executor throws", async () => {
    const root = createTempRoot();
    seed(root);

    const result = await runMergeNext(root, {
      tracker,
      executor: { execute: vi.fn(async () => { throw new Error("git crashed"); }) },
      now: NOW,
    });

    expect(result).toMatchObject({ status: "failed", stage: "failed_operational" });
    expect(result.detail).toContain("git crashed");
    expect(loadMergeQueueState(root).items[0]).toMatchObject({ status: "failed", attempts: 1 });
    expect(loadDispatchState(root).records[ISSUE]).toMatchObject({
      stage: "failed_operational",
      failureCount: 1,
      consecutiveFailures: 1,
    });
    expect(loadDispatchState(root).records[ISSUE]?.cooldownUntil).toBeTruthy();
  });

  it("hands Janus off without running it inside the merge step", async () => {
    const root = createTempRoot();
    seed(root, { attempts: DEFAULT_AEGIS_CONFIG.thresholds.janus_retry_threshold });

    const result = await runMergeNext(root, {
      tracker,
      executor: { execute: vi.fn(async () => ({ outcome: "conflict" as const, detail: "CONFLICT (content)" })) },
      now: NOW,
    });

    expect(result).toMatchObject({ status: "escalated", tier: "T3", stage: "resolving_integration" });
    expect(loadMergeQueueState(root).items[0]).toMatchObject({
      status: "failed",
      janusInvocations: 1,
      lastOutcome: "conflict",
    });
    expect(loadDispatchState(root).records[ISSUE]).toMatchObject({
      stage: "resolving_integration",
      runningAgent: null,
      consecutiveFailures: 0,
    });
  });

  it("counts terminal merge failures toward the retry ceiling", async () => {
    const root = createTempRoot({
      ...DEFAULT_AEGIS_CONFIG,
      janus: { ...DEFAULT_AEGIS_CONFIG.janus, enabled: false },
    });
    seed(root, { attempts: DEFAULT_AEGIS_CONFIG.thresholds.janus_retry_threshold });

    await runMergeNext(root, {
      tracker,
      executor: { execute: vi.fn(async () => ({ outcome: "conflict" as const, detail: "CONFLICT (content)" })) },
      now: NOW,
    });

    expect(loadDispatchState(root).records[ISSUE]).toMatchObject({
      stage: "failed_operational",
      failureCount: 1,
      consecutiveFailures: 1,
    });
  });
});

describe("autoEnqueueImplementedIssuesForMerge", () => {
  it("leaves current queue items untouched", () => {
    const root = createTempRoot();
    seed(root, { updatedAt: "2026-05-01T09:30:00.000Z" });

    const result = autoEnqueueImplementedIssuesForMerge(root, NOW);

    expect(result.enqueuedIssueIds).toEqual([ISSUE]);
    expect(loadMergeQueueState(root).items[0]).toMatchObject({
      status: "queued",
      updatedAt: "2026-05-01T09:30:00.000Z",
    });
  });

  it("requeues a merging item stranded by an interrupted merge", () => {
    const root = createTempRoot();
    seed(root, { status: "merging", attempts: 1, updatedAt: "2026-05-01T09:30:00.000Z" });

    autoEnqueueImplementedIssuesForMerge(root, NOW);

    expect(loadMergeQueueState(root).items[0]).toMatchObject({
      status: "queued",
      attempts: 1,
      updatedAt: NOW,
    });
  });

  it("re-queues a failed item after a new Sentinel pass", () => {
    const root = createTempRoot();
    seed(root, { status: "failed", attempts: 3, lastError: "old conflict" });

    autoEnqueueImplementedIssuesForMerge(root, NOW);

    expect(loadMergeQueueState(root).items[0]).toMatchObject({
      status: "queued",
      attempts: 0,
      lastError: null,
      updatedAt: NOW,
    });
  });
});
