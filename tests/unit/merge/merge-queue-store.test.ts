/**
 * Unit tests for merge queue store — S13 contract.
 *
 * Tests:
 *   - queue item shape validation
 *   - load/save atomic writes
 *   - restart-safe reconciliation
 *   - FIFO ordering
 *   - duplicate admission prevention
 *   - terminal status handling
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  loadMergeQueueState,
  saveMergeQueueState,
  emptyMergeQueueState,
  reconcileMergeQueueState,
  nextQueuedItem,
  isInQueue,
  isTerminalStatus,
  type MergeQueueState,
  type QueueItem,
} from "../../../src/merge/merge-queue-store.js";
import { admitCandidate, dequeueItem, isEligibleForEnqueue } from "../../../src/merge/enqueue-candidate.js";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { DispatchRecord } from "../../../src/core/dispatch-state.js";
import { DispatchStage } from "../../../src/core/stage-transition.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTestQueueState(items: QueueItem[] = []): MergeQueueState {
  return {
    schemaVersion: 1,
    items,
    processedCount: 0,
  };
}

function makeQueueItem(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    issueId: overrides.issueId ?? "test-issue-1",
    candidateBranch: overrides.candidateBranch ?? "feat/test-1",
    targetBranch: overrides.targetBranch ?? "main",
    enqueuedAt: overrides.enqueuedAt ?? new Date().toISOString(),
    position: overrides.position ?? 0,
    status: overrides.status ?? "queued",
    attemptCount: overrides.attemptCount ?? 0,
    lastError: overrides.lastError ?? null,
    sourceStage: overrides.sourceStage ?? "implemented",
    sessionProvenanceId: overrides.sessionProvenanceId ?? "test-session",
    updatedAt: overrides.updatedAt ?? new Date().toISOString(),
  };
}

function makeDispatchRecord(overrides: Partial<DispatchRecord> = {}): DispatchRecord {
  return {
    issueId: overrides.issueId ?? "test-issue-1",
    stage: overrides.stage ?? DispatchStage.Implemented,
    runningAgent: overrides.runningAgent ?? null,
    oracleAssessmentRef: overrides.oracleAssessmentRef ?? null,
    sentinelVerdictRef: overrides.sentinelVerdictRef ?? null,
    fileScope: overrides.fileScope ?? null,
    failureCount: overrides.failureCount ?? 0,
    consecutiveFailures: overrides.consecutiveFailures ?? 0,
    failureWindowStartMs: overrides.failureWindowStartMs ?? null,
    cooldownUntil: overrides.cooldownUntil ?? null,
    cumulativeSpendUsd: overrides.cumulativeSpendUsd ?? null,
    sessionProvenanceId: overrides.sessionProvenanceId ?? "test-session",
    updatedAt: overrides.updatedAt ?? new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Merge Queue Store — Unit", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(process.cwd(), ".aegis-test-" + randomUUID());
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("emptyMergeQueueState", () => {
    it("returns a valid empty state", () => {
      const state = emptyMergeQueueState();
      expect(state.schemaVersion).toBe(1);
      expect(state.items).toEqual([]);
      expect(state.processedCount).toBe(0);
    });
  });

  describe("saveMergeQueueState / loadMergeQueueState", () => {
    it("persists and reloads state atomically", () => {
      const state = makeTestQueueState([
        makeQueueItem({ issueId: "issue-1", position: 0 }),
        makeQueueItem({ issueId: "issue-2", position: 1 }),
      ]);

      saveMergeQueueState(testDir, state);
      const loaded = loadMergeQueueState(testDir);

      expect(loaded.schemaVersion).toBe(1);
      expect(loaded.items).toHaveLength(2);
      expect(loaded.items[0].issueId).toBe("issue-1");
      expect(loaded.items[1].issueId).toBe("issue-2");
    });

    it("returns empty state when file does not exist", () => {
      const loaded = loadMergeQueueState(testDir);
      expect(loaded.schemaVersion).toBe(1);
      expect(loaded.items).toEqual([]);
    });
  });

  describe("reconcileMergeQueueState", () => {
    it("clears active items to queued on restart", () => {
      const state = makeTestQueueState([
        makeQueueItem({ issueId: "active-1", status: "active" }),
        makeQueueItem({ issueId: "queued-1", status: "queued" }),
        makeQueueItem({ issueId: "merged-1", status: "merged" }),
      ]);

      const reconciled = reconcileMergeQueueState(state, "new-session");

      const activeItem = reconciled.items.find((i) => i.issueId === "active-1");
      expect(activeItem?.status).toBe("queued");
      expect(activeItem?.sessionProvenanceId).toBe("new-session");

      const queuedItem = reconciled.items.find((i) => i.issueId === "queued-1");
      expect(queuedItem?.status).toBe("queued");

      const mergedItem = reconciled.items.find((i) => i.issueId === "merged-1");
      expect(mergedItem?.status).toBe("merged");
    });

    it("does not mutate the original state", () => {
      const state = makeTestQueueState([
        makeQueueItem({ issueId: "active-1", status: "active" }),
      ]);

      reconcileMergeQueueState(state, "new-session");

      expect(state.items[0].status).toBe("active");
    });
  });

  describe("nextQueuedItem", () => {
    it("returns the first queued item by position", () => {
      const state = makeTestQueueState([
        makeQueueItem({ issueId: "second", position: 1 }),
        makeQueueItem({ issueId: "first", position: 0 }),
        makeQueueItem({ issueId: "active", status: "active", position: 2 }),
      ]);

      const next = nextQueuedItem(state);
      expect(next?.issueId).toBe("first");
    });

    it("returns null when no queued items exist", () => {
      const state = makeTestQueueState([
        makeQueueItem({ issueId: "active", status: "active" }),
        makeQueueItem({ issueId: "merged", status: "merged" }),
      ]);

      expect(nextQueuedItem(state)).toBeNull();
    });
  });

  describe("isInQueue", () => {
    it("returns true for non-terminal items", () => {
      const state = makeTestQueueState([
        makeQueueItem({ issueId: "queued-1", status: "queued" }),
        makeQueueItem({ issueId: "active-1", status: "active" }),
      ]);

      expect(isInQueue(state, "queued-1")).toBe(true);
      expect(isInQueue(state, "active-1")).toBe(true);
      expect(isInQueue(state, "not-in-queue")).toBe(false);
    });

    it("returns false for terminal items", () => {
      const state = makeTestQueueState([
        makeQueueItem({ issueId: "merged-1", status: "merged" }),
      ]);

      expect(isInQueue(state, "merged-1")).toBe(false);
    });
  });

  describe("isTerminalStatus", () => {
    it("identifies terminal statuses", () => {
      expect(isTerminalStatus("merged")).toBe(true);
      expect(isTerminalStatus("manual_decision_required")).toBe(true);
      expect(isTerminalStatus("queued")).toBe(false);
      expect(isTerminalStatus("active")).toBe(false);
      expect(isTerminalStatus("merge_failed")).toBe(false);
    });
  });

  describe("admitCandidate", () => {
    it("adds a candidate at the end of the queue", () => {
      const state = makeTestQueueState([
        makeQueueItem({ issueId: "existing", position: 0 }),
      ]);

      const newState = admitCandidate(state, {
        issueId: "new-issue",
        candidateBranch: "feat/new-branch",
        targetBranch: "main",
        sourceStage: "implemented",
        sessionProvenanceId: "session-1",
      });

      expect(newState.items).toHaveLength(2);
      const newItem = newState.items.find((i) => i.issueId === "new-issue");
      expect(newItem).toBeDefined();
      expect(newItem?.position).toBe(1);
      expect(newItem?.status).toBe("queued");
      expect(newItem?.attemptCount).toBe(0);
    });

    it("throws if candidate is already in queue", () => {
      const state = makeTestQueueState([
        makeQueueItem({ issueId: "existing", status: "queued" }),
      ]);

      expect(() =>
        admitCandidate(state, {
          issueId: "existing",
          candidateBranch: "feat/new-branch",
          targetBranch: "main",
          sourceStage: "implemented",
          sessionProvenanceId: "session-1",
        }),
      ).toThrow(/already in the merge queue/);
    });

    it("does not mutate the original state", () => {
      const state = makeTestQueueState([]);

      admitCandidate(state, {
        issueId: "new-issue",
        candidateBranch: "feat/new-branch",
        targetBranch: "main",
        sourceStage: "implemented",
        sessionProvenanceId: "session-1",
      });

      expect(state.items).toHaveLength(0);
    });
  });

  describe("dequeueItem", () => {
    it("removes item and renumbers positions", () => {
      const state = makeTestQueueState([
        makeQueueItem({ issueId: "first", position: 0 }),
        makeQueueItem({ issueId: "second", position: 1 }),
        makeQueueItem({ issueId: "third", position: 2 }),
      ]);

      const newState = dequeueItem(state, "second");

      expect(newState.items).toHaveLength(2);
      expect(newState.items[0].issueId).toBe("first");
      expect(newState.items[0].position).toBe(0);
      expect(newState.items[1].issueId).toBe("third");
      expect(newState.items[1].position).toBe(1);
      expect(newState.processedCount).toBe(1);
    });

    it("does not mutate the original state", () => {
      const state = makeTestQueueState([
        makeQueueItem({ issueId: "first", position: 0 }),
      ]);

      dequeueItem(state, "first");

      expect(state.items).toHaveLength(1);
    });
  });

  describe("isEligibleForEnqueue", () => {
    it("returns true for implemented stage and not in queue", () => {
      const record = makeDispatchRecord({ stage: DispatchStage.Implemented });
      expect(isEligibleForEnqueue(record, false)).toBe(true);
    });

    it("returns false for non-implemented stage", () => {
      const record = makeDispatchRecord({ stage: DispatchStage.Implementing });
      expect(isEligibleForEnqueue(record, false)).toBe(false);
    });

    it("returns false if already in queue", () => {
      const record = makeDispatchRecord({ stage: DispatchStage.Implemented });
      expect(isEligibleForEnqueue(record, true)).toBe(false);
    });

    it("returns false for empty issue ID", () => {
      const record = makeDispatchRecord({ issueId: "", stage: DispatchStage.Implemented });
      expect(isEligibleForEnqueue(record, false)).toBe(false);
    });
  });
});
