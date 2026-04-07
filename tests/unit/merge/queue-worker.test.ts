/**
 * Unit tests for queue worker and persistence edge cases — S13 lane A.
 *
 * Tests:
 *   - Worker skeleton behavior with empty queue
 *   - Queue depth tracking accuracy
 *   - Atomic write pattern validation
 *   - Corrupted file handling
 *   - Multiple restart cycles
 *   - Position consistency after operations
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  loadMergeQueueState,
  saveMergeQueueState,
  emptyMergeQueueState,
  reconcileMergeQueueState,
  type MergeQueueState,
  type QueueItem,
} from "../../../src/merge/merge-queue-store.js";
import {
  getActiveWorkCount,
  processNextQueueItem,
} from "../../../src/merge/queue-worker.js";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    handoffArtifactRef: overrides.handoffArtifactRef ?? null,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Queue Worker and Persistence — Lane A Unit", () => {
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

  describe("getActiveWorkCount", () => {
    it("returns 0 for empty queue", () => {
      const state = emptyMergeQueueState();
      expect(getActiveWorkCount(state)).toBe(0);
    });

    it("counts only queued and active items", () => {
      const state: MergeQueueState = {
        schemaVersion: 1,
        items: [
          makeQueueItem({ issueId: "q1", status: "queued" }),
          makeQueueItem({ issueId: "q2", status: "queued" }),
          makeQueueItem({ issueId: "a1", status: "active" }),
          makeQueueItem({ issueId: "m1", status: "merged" }),
          makeQueueItem({ issueId: "f1", status: "merge_failed" }),
        ],
        processedCount: 0,
      };

      expect(getActiveWorkCount(state)).toBe(3); // q1, q2, a1
    });
  });

  describe("processNextQueueItem", () => {
    function makePublisher() {
      const events: Array<Record<string, unknown>> = [];
      return {
        events,
        publisher: {
          publish: (event: Record<string, unknown>) => events.push(event),
        },
      };
    }

    it("returns null for empty queue", async () => {
      const state = emptyMergeQueueState();
      const { publisher } = makePublisher();
      const result = await processNextQueueItem(state, {
        projectRoot: testDir,
        eventPublisher: publisher as never,
        janusEnabled: false,
        maxRetryAttempts: 3,
      });
      expect(result).toBeNull();
    });

    it("marks queued item as active", async () => {
      const state: MergeQueueState = {
        schemaVersion: 1,
        items: [makeQueueItem({ issueId: "next-1", status: "queued", position: 0 })],
        processedCount: 0,
      };
      const { events, publisher } = makePublisher();
      const output = await processNextQueueItem(state, {
        projectRoot: testDir,
        eventPublisher: publisher as never,
        janusEnabled: false,
        maxRetryAttempts: 3,
      });

      expect(output).not.toBeNull();
      const activeItem = output!.updatedState.items.find((i) => i.issueId === "next-1");
      expect(activeItem!.status).toBe("active");
    });

    it("does NOT increment attemptCount when marking active", async () => {
      const state: MergeQueueState = {
        schemaVersion: 1,
        items: [
          makeQueueItem({
            issueId: "next-1",
            status: "queued",
            position: 0,
            attemptCount: 0,
          }),
        ],
        processedCount: 0,
      };
      const { publisher } = makePublisher();
      const output = await processNextQueueItem(state, {
        projectRoot: testDir,
        eventPublisher: publisher as never,
        janusEnabled: false,
        maxRetryAttempts: 3,
      });

      expect(output).not.toBeNull();
      const activeItem = output!.updatedState.items.find((i) => i.issueId === "next-1");
      expect(activeItem!.attemptCount).toBe(0); // unchanged
    });

    it("publishes a merge.queue_state SSE event", async () => {
      const state: MergeQueueState = {
        schemaVersion: 1,
        items: [makeQueueItem({ issueId: "next-1", status: "queued", position: 0 })],
        processedCount: 0,
      };
      const { events, publisher } = makePublisher();
      await processNextQueueItem(state, {
        projectRoot: testDir,
        eventPublisher: publisher as never,
        janusEnabled: false,
        maxRetryAttempts: 3,
      });

      expect(events.length).toBe(1);
      expect(events[0].type).toBe("merge.queue_state");
      expect((events[0].payload as Record<string, unknown>).status).toBe("active");
    });

    it("returns success: false for S13 skeleton with S14 error message", async () => {
      const state: MergeQueueState = {
        schemaVersion: 1,
        items: [makeQueueItem({ issueId: "next-1", status: "queued", position: 0 })],
        processedCount: 0,
      };
      const { publisher } = makePublisher();
      const output = await processNextQueueItem(state, {
        projectRoot: testDir,
        eventPublisher: publisher as never,
        janusEnabled: false,
        maxRetryAttempts: 3,
      });

      expect(output).not.toBeNull();
      expect(output!.result.success).toBe(false);
      expect(output!.result.error).toContain("S14");
    });
  });

  describe("atomic write pattern with crash recovery", () => {
    it("orphaned tmp file is ignored on load", () => {
      const aegisDir = join(testDir, ".aegis");
      mkdirSync(aegisDir, { recursive: true });

      // Write a valid state
      const state = emptyMergeQueueState();
      saveMergeQueueState(testDir, state);

      // Simulate orphaned tmp from a crashed write
      const tmpPath = join(aegisDir, "merge-queue.json.tmp");
      writeFileSync(tmpPath, "{ orphaned tmp }", "utf-8");

      // Load should still work fine
      const loaded = loadMergeQueueState(testDir);
      expect(loaded.schemaVersion).toBe(1);

      // Clean up
      rmSync(tmpPath, { force: true });
    });
  });

  describe("corrupted file handling", () => {
    it("throws on malformed JSON", () => {
      const aegisDir = join(testDir, ".aegis");
      mkdirSync(aegisDir, { recursive: true });
      writeFileSync(
        join(aegisDir, "merge-queue.json"),
        "{ invalid json }}}",
        "utf-8",
      );

      expect(() => loadMergeQueueState(testDir)).toThrow(/malformed JSON/);
    });

    it("throws on unsupported schema version", () => {
      const aegisDir = join(testDir, ".aegis");
      mkdirSync(aegisDir, { recursive: true });
      writeFileSync(
        join(aegisDir, "merge-queue.json"),
        JSON.stringify({ schemaVersion: 99, items: [] }),
        "utf-8",
      );

      expect(() => loadMergeQueueState(testDir)).toThrow(/unsupported schemaVersion/);
    });

    it("throws on missing items field", () => {
      const aegisDir = join(testDir, ".aegis");
      mkdirSync(aegisDir, { recursive: true });
      writeFileSync(
        join(aegisDir, "merge-queue.json"),
        JSON.stringify({ schemaVersion: 1 }),
        "utf-8",
      );

      expect(() => loadMergeQueueState(testDir)).toThrow(/missing or invalid 'items' field/);
    });
  });

  describe("multiple restart cycles", () => {
    it("preserves queue integrity across multiple restarts", () => {
      let state = emptyMergeQueueState();

      // Add items
      state = {
        ...state,
        items: [
          makeQueueItem({ issueId: "issue-1", position: 0 }),
          makeQueueItem({ issueId: "issue-2", position: 1 }),
        ],
      };

      saveMergeQueueState(testDir, state);

      // Simulate 3 restart cycles
      for (let i = 0; i < 3; i++) {
        const loaded = loadMergeQueueState(testDir);
        const reconciled = reconcileMergeQueueState(loaded, `session-${i}`);

        // Mark one as active to test reconciliation
        if (i === 1) {
          reconciled.items[0] = {
            ...reconciled.items[0],
            status: "active",
          };
          saveMergeQueueState(testDir, reconciled);
        } else {
          saveMergeQueueState(testDir, reconciled);
        }
      }

      // Final load should have both items
      const final = loadMergeQueueState(testDir);
      expect(final.items).toHaveLength(2);
      expect(final.items.map((item) => item.issueId)).toContain("issue-1");
      expect(final.items.map((item) => item.issueId)).toContain("issue-2");
    });

    it("clears all active items on restart regardless of count", () => {
      const state: MergeQueueState = {
        schemaVersion: 1,
        items: [
          makeQueueItem({ issueId: "active-1", status: "active" }),
          makeQueueItem({ issueId: "active-2", status: "active" }),
          makeQueueItem({ issueId: "queued-1", status: "queued" }),
        ],
        processedCount: 0,
      };

      const reconciled = reconcileMergeQueueState(state, "new-session");

      const activeItems = reconciled.items.filter((i) => i.status === "active");
      expect(activeItems).toHaveLength(0);

      const queuedItems = reconciled.items.filter((i) => i.status === "queued");
      expect(queuedItems).toHaveLength(3); // All 3 should be queued now
    });
  });

  describe("position consistency", () => {
    it("maintains correct positions after mixed operations", () => {
      let state = emptyMergeQueueState();

      state = {
        ...state,
        items: [
          makeQueueItem({ issueId: "first", position: 0 }),
          makeQueueItem({ issueId: "second", position: 1 }),
          makeQueueItem({ issueId: "third", position: 2 }),
        ],
      };

      // Positions should be sequential
      expect(state.items[0].position).toBe(0);
      expect(state.items[1].position).toBe(1);
      expect(state.items[2].position).toBe(2);

      saveMergeQueueState(testDir, state);
      const loaded = loadMergeQueueState(testDir);

      // After reload, positions should still be correct
      expect(loaded.items[0].position).toBe(0);
      expect(loaded.items[1].position).toBe(1);
      expect(loaded.items[2].position).toBe(2);
    });
  });

  describe("no mutation guarantees", () => {
    it("reconcileMergeQueueState never mutates input", () => {
      const state: MergeQueueState = {
        schemaVersion: 1,
        items: [
          makeQueueItem({ issueId: "active-1", status: "active" }),
        ],
        processedCount: 0,
      };

      const originalStatus = state.items[0].status;
      reconcileMergeQueueState(state, "new-session");

      expect(state.items[0].status).toBe(originalStatus);
    });
  });
});
