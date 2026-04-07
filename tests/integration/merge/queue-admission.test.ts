/**
 * Integration tests for queue admission — S13 contract and lane B.
 *
 * Tests:
 *   - full admission lifecycle: implemented → queued_for_merge
 *   - restart persistence and recovery
 *   - FIFO ordering under multiple admissions
 *   - duplicate admission rejection
 *   - queue visibility for Olympus state
 *   - full admission workflow with dispatch state transition + SSE events
 *   - queue visibility helpers (snapshot, display formatting, depth)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  loadMergeQueueState,
  saveMergeQueueState,
  emptyMergeQueueState,
  reconcileMergeQueueState,
  nextQueuedItem,
  isInQueue,
  type MergeQueueState,
} from "../../../src/merge/merge-queue-store.js";
import {
  admitCandidate,
  dequeueItem,
  type EnqueueCandidateInput,
} from "../../../src/merge/enqueue-candidate.js";
import {
  runAdmissionWorkflow,
  computeQueueDepth,
  computeWaitingDepth,
  type AdmissionWorkflowInput,
} from "../../../src/merge/admission-workflow.js";
import {
  getQueueSnapshot,
  getQueueDepth,
  getWaitingCount,
  getActiveCount,
  isQueueIdle,
  getNextInQueue,
  getQueueStatusSummary,
  formatQueueItemForDisplay,
  relativeTime,
} from "../../../src/merge/queue-visibility.js";
import { createInMemoryLiveEventBus } from "../../../src/events/event-bus.js";
import { transitionStage, DispatchStage } from "../../../src/core/stage-transition.js";
import type { DispatchRecord, DispatchState } from "../../../src/core/dispatch-state.js";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEnqueueInput(overrides: Partial<EnqueueCandidateInput> = {}): EnqueueCandidateInput {
  return {
    issueId: overrides.issueId ?? "issue-1",
    candidateBranch: overrides.candidateBranch ?? "feat/issue-1",
    targetBranch: overrides.targetBranch ?? "main",
    sourceStage: overrides.sourceStage ?? "implemented",
    sessionProvenanceId: overrides.sessionProvenanceId ?? "session-1",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Queue Admission — Integration", () => {
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

  describe("admission lifecycle", () => {
    it("admits a candidate and persists to disk", () => {
      let state = emptyMergeQueueState();

      const input = makeEnqueueInput({
        issueId: "issue-1",
        candidateBranch: "feat/issue-1",
      });

      state = admitCandidate(state, input);
      saveMergeQueueState(testDir, state);

      const loaded = loadMergeQueueState(testDir);
      expect(loaded.items).toHaveLength(1);
      expect(loaded.items[0].issueId).toBe("issue-1");
      expect(loaded.items[0].status).toBe("queued");
    });

    it("transitions implemented issue to queued state", () => {
      const state = emptyMergeQueueState();
      const input = makeEnqueueInput({
        issueId: "impl-issue",
        sourceStage: "implemented",
      });

      const newState = admitCandidate(state, input);

      expect(newState.items[0].status).toBe("queued");
      expect(newState.items[0].sourceStage).toBe("implemented");
    });
  });

  describe("restart persistence and recovery", () => {
    it("survives restart with queue intact", () => {
      let state = emptyMergeQueueState();

      // Admit multiple candidates
      state = admitCandidate(state, makeEnqueueInput({ issueId: "issue-1" }));
      state = admitCandidate(state, makeEnqueueInput({ issueId: "issue-2" }));
      state = admitCandidate(state, makeEnqueueInput({ issueId: "issue-3" }));

      saveMergeQueueState(testDir, state);

      // Simulate restart
      const loaded = loadMergeQueueState(testDir);
      expect(loaded.items).toHaveLength(3);
      expect(loaded.items.map((i) => i.issueId)).toEqual([
        "issue-1",
        "issue-2",
        "issue-3",
      ]);
    });

    it("reconciles active items to queued after restart", () => {
      let state = emptyMergeQueueState();
      state = admitCandidate(state, makeEnqueueInput({ issueId: "issue-1" }));

      // Simulate item was being processed when crash occurred
      state = {
        ...state,
        items: state.items.map((item) => ({
          ...item,
          status: "active" as const,
        })),
      };

      saveMergeQueueState(testDir, state);

      // Restart and reconcile
      const loaded = loadMergeQueueState(testDir);
      const reconciled = reconcileMergeQueueState(loaded, "new-session");

      const item = reconciled.items[0];
      expect(item.status).toBe("queued");
      expect(item.sessionProvenanceId).toBe("new-session");
    });
  });

  describe("FIFO ordering", () => {
    it("maintains FIFO order under multiple admissions", () => {
      let state = emptyMergeQueueState();

      state = admitCandidate(state, makeEnqueueInput({ issueId: "first" }));
      state = admitCandidate(state, makeEnqueueInput({ issueId: "second" }));
      state = admitCandidate(state, makeEnqueueInput({ issueId: "third" }));

      expect(state.items[0].position).toBe(0);
      expect(state.items[1].position).toBe(1);
      expect(state.items[2].position).toBe(2);

      const next = nextQueuedItem(state);
      expect(next?.issueId).toBe("first");
    });

    it("processes items in FIFO order", () => {
      let state = emptyMergeQueueState();

      state = admitCandidate(state, makeEnqueueInput({ issueId: "first" }));
      state = admitCandidate(state, makeEnqueueInput({ issueId: "second" }));

      // Process first item
      const first = nextQueuedItem(state);
      expect(first?.issueId).toBe("first");

      state = dequeueItem(state, "first");

      // Next should be second
      const next = nextQueuedItem(state);
      expect(next?.issueId).toBe("second");
      expect(next?.position).toBe(0); // Renumbered
    });
  });

  describe("duplicate admission rejection", () => {
    it("rejects duplicate admission for same issue", () => {
      let state = emptyMergeQueueState();

      state = admitCandidate(state, makeEnqueueInput({ issueId: "duplicate" }));

      expect(() =>
        admitCandidate(state, makeEnqueueInput({ issueId: "duplicate" })),
      ).toThrow(/already in the merge queue/);
    });

    it("allows admission after item is dequeued", () => {
      let state = emptyMergeQueueState();

      state = admitCandidate(state, makeEnqueueInput({ issueId: "issue-1" }));
      state = dequeueItem(state, "issue-1");

      // Should now allow re-admission (e.g., after rework)
      const newState = admitCandidate(state, makeEnqueueInput({ issueId: "issue-1" }));
      expect(newState.items).toHaveLength(1);
      expect(newState.items[0].issueId).toBe("issue-1");
    });
  });

  describe("queue visibility for Olympus state", () => {
    it("exposes queue depth for monitoring", () => {
      let state = emptyMergeQueueState();

      state = admitCandidate(state, makeEnqueueInput({ issueId: "issue-1" }));
      state = admitCandidate(state, makeEnqueueInput({ issueId: "issue-2" }));

      const queuedCount = state.items.filter((i) => i.status === "queued").length;
      expect(queuedCount).toBe(2);
    });

    it("tracks processed count for analytics", () => {
      let state = emptyMergeQueueState();

      state = admitCandidate(state, makeEnqueueInput({ issueId: "issue-1" }));
      state = admitCandidate(state, makeEnqueueInput({ issueId: "issue-2" }));

      state = dequeueItem(state, "issue-1");
      expect(state.processedCount).toBe(1);

      state = dequeueItem(state, "issue-2");
      expect(state.processedCount).toBe(2);
    });

    it("integrates with event bus for live updates", () => {
      const eventBus = createInMemoryLiveEventBus();
      const events: any[] = [];
      eventBus.subscribe((event) => events.push(event));

      let state = emptyMergeQueueState();
      state = admitCandidate(state, makeEnqueueInput({ issueId: "issue-1" }));

      // Simulate queue state change event
      eventBus.publish({
        id: "evt-1",
        type: "merge.queue_state",
        timestamp: new Date().toISOString(),
        sequence: 1,
        payload: {
          issueId: "issue-1",
          status: "queued",
          attemptCount: 0,
          errorDetail: null,
        },
      });

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("merge.queue_state");
      expect(events[0].payload.issueId).toBe("issue-1");
    });
  });

  describe("isInQueue checks", () => {
    it("correctly identifies queued and active items", () => {
      let state = emptyMergeQueueState();
      state = admitCandidate(state, makeEnqueueInput({ issueId: "queued" }));

      expect(isInQueue(state, "queued")).toBe(true);
      expect(isInQueue(state, "not-present")).toBe(false);
    });

    it("returns false for merged items", () => {
      let state = emptyMergeQueueState();
      state = admitCandidate(state, makeEnqueueInput({ issueId: "merged-item" }));
      state = {
        ...state,
        items: state.items.map((item) =>
          item.issueId === "merged-item"
            ? { ...item, status: "merged" as const }
            : item,
        ),
      };

      expect(isInQueue(state, "merged-item")).toBe(false);
    });
  });

  // =========================================================================
  // Lane B: Full admission workflow with dispatch state + SSE events
  // =========================================================================

  describe("full admission workflow (lane B)", () => {
    function makeDispatchRecord(overrides: Partial<DispatchRecord> = {}): DispatchRecord {
      return {
        issueId: overrides.issueId ?? "issue-1",
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
        sessionProvenanceId: overrides.sessionProvenanceId ?? "session-1",
        updatedAt: overrides.updatedAt ?? new Date().toISOString(),
      };
    }

    function makeDispatchState(records: DispatchRecord[]): DispatchState {
      const map: Record<string, DispatchRecord> = {};
      for (const r of records) {
        map[r.issueId] = r;
      }
      return { schemaVersion: 1, records: map };
    }

    function makeAdmissionInput(
      dispatchRecord: DispatchRecord,
      overrides: Partial<AdmissionWorkflowInput> = {},
    ): AdmissionWorkflowInput {
      return {
        dispatchRecord,
        candidateBranch: overrides.candidateBranch ?? `feat/${dispatchRecord.issueId}`,
        targetBranch: overrides.targetBranch ?? "main",
        ...overrides,
      };
    }

    it("transitions dispatch state from implemented to queued_for_merge", () => {
      const eventBus = createInMemoryLiveEventBus();
      const dispatchState = makeDispatchState([
        makeDispatchRecord({ issueId: "impl-1" }),
      ]);
      const queueState = emptyMergeQueueState();
      const input = makeAdmissionInput(dispatchState.records["impl-1"]);

      const result = runAdmissionWorkflow(dispatchState, queueState, eventBus, input);

      const updatedRecord = result.dispatchState.records["impl-1"];
      expect(updatedRecord.stage).toBe(DispatchStage.QueuedForMerge);
    });

    it("admits candidate to the merge queue", () => {
      const eventBus = createInMemoryLiveEventBus();
      const dispatchState = makeDispatchState([
        makeDispatchRecord({ issueId: "impl-1" }),
      ]);
      const queueState = emptyMergeQueueState();
      const input = makeAdmissionInput(dispatchState.records["impl-1"]);

      const result = runAdmissionWorkflow(dispatchState, queueState, eventBus, input);

      expect(result.queueState.items).toHaveLength(1);
      expect(result.queueState.items[0].issueId).toBe("impl-1");
      expect(result.queueState.items[0].status).toBe("queued");
      expect(result.queueState.items[0].position).toBe(0);
    });

    it("emits a merge.queue_state SSE event on admission", () => {
      const eventBus = createInMemoryLiveEventBus();
      const events: any[] = [];
      eventBus.subscribe((event) => events.push(event));

      const dispatchState = makeDispatchState([
        makeDispatchRecord({ issueId: "impl-1" }),
      ]);
      const queueState = emptyMergeQueueState();
      const input = makeAdmissionInput(dispatchState.records["impl-1"]);

      runAdmissionWorkflow(dispatchState, queueState, eventBus, input);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("merge.queue_state");
      expect(events[0].payload.issueId).toBe("impl-1");
      expect(events[0].payload.status).toBe("queued");
      expect(events[0].payload.attemptCount).toBe(0);
    });

    it("rejects admission for non-implemented stage", () => {
      const eventBus = createInMemoryLiveEventBus();
      const dispatchState = makeDispatchState([
        makeDispatchRecord({ issueId: "impl-1", stage: DispatchStage.Implementing }),
      ]);
      const queueState = emptyMergeQueueState();
      const input = makeAdmissionInput(dispatchState.records["impl-1"]);

      expect(() =>
        runAdmissionWorkflow(dispatchState, queueState, eventBus, input),
      ).toThrow(/not eligible/);
    });

    it("rejects duplicate admission through workflow", () => {
      const eventBus = createInMemoryLiveEventBus();
      const record = makeDispatchRecord({ issueId: "impl-1" });
      const dispatchState = makeDispatchState([record]);
      let queueState = emptyMergeQueueState();

      // First admission via admitCandidate
      queueState = admitCandidate(queueState, {
        issueId: "impl-1",
        candidateBranch: "feat/impl-1",
        targetBranch: "main",
        sourceStage: "implemented",
        sessionProvenanceId: "session-1",
      });

      const input = makeAdmissionInput(dispatchState.records["impl-1"]);

      expect(() =>
        runAdmissionWorkflow(dispatchState, queueState, eventBus, input),
      ).toThrow(/not eligible/);
    });

    it("handles multiple admissions with correct FIFO ordering", () => {
      const eventBus = createInMemoryLiveEventBus();
      const events: any[] = [];
      eventBus.subscribe((event) => events.push(event));

      let dispatchState = makeDispatchState([
        makeDispatchRecord({ issueId: "first" }),
        makeDispatchRecord({ issueId: "second" }),
        makeDispatchRecord({ issueId: "third" }),
      ]);
      let queueState = emptyMergeQueueState();

      // Admit first
      const r1 = runAdmissionWorkflow(
        dispatchState,
        queueState,
        eventBus,
        makeAdmissionInput(dispatchState.records["first"]),
      );
      dispatchState = r1.dispatchState;
      queueState = r1.queueState;

      // Admit second
      const r2 = runAdmissionWorkflow(
        dispatchState,
        queueState,
        eventBus,
        makeAdmissionInput(dispatchState.records["second"]),
      );
      dispatchState = r2.dispatchState;
      queueState = r2.queueState;

      // Admit third
      const r3 = runAdmissionWorkflow(
        dispatchState,
        queueState,
        eventBus,
        makeAdmissionInput(dispatchState.records["third"]),
      );
      dispatchState = r3.dispatchState;
      queueState = r3.queueState;

      expect(queueState.items).toHaveLength(3);
      expect(queueState.items[0].position).toBe(0);
      expect(queueState.items[1].position).toBe(1);
      expect(queueState.items[2].position).toBe(2);

      // All three records should be queued_for_merge
      expect(dispatchState.records["first"].stage).toBe(DispatchStage.QueuedForMerge);
      expect(dispatchState.records["second"].stage).toBe(DispatchStage.QueuedForMerge);
      expect(dispatchState.records["third"].stage).toBe(DispatchStage.QueuedForMerge);

      // Three events emitted
      expect(events).toHaveLength(3);
      expect(events.map((e) => e.payload.issueId)).toEqual(["first", "second", "third"]);
    });

    it("does not mutate input states", () => {
      const eventBus = createInMemoryLiveEventBus();
      const dispatchState = makeDispatchState([
        makeDispatchRecord({ issueId: "impl-1" }),
      ]);
      const queueState = emptyMergeQueueState();
      const input = makeAdmissionInput(dispatchState.records["impl-1"]);

      const originalDispatchStage = dispatchState.records["impl-1"].stage;
      const originalQueueLength = queueState.items.length;

      runAdmissionWorkflow(dispatchState, queueState, eventBus, input);

      // Inputs should be unchanged
      expect(dispatchState.records["impl-1"].stage).toBe(originalDispatchStage);
      expect(queueState.items.length).toBe(originalQueueLength);
    });
  });

  // =========================================================================
  // Lane B: Queue visibility helpers
  // =========================================================================

  describe("queue visibility helpers (lane B)", () => {
    it("computes queue depth correctly", () => {
      let state = emptyMergeQueueState();
      state = admitCandidate(state, makeEnqueueInput({ issueId: "issue-1" }));
      state = admitCandidate(state, makeEnqueueInput({ issueId: "issue-2" }));

      expect(getQueueDepth(state)).toBe(2);
      expect(computeQueueDepth(state)).toBe(2);
    });

    it("computes waiting depth correctly", () => {
      let state = emptyMergeQueueState();
      state = admitCandidate(state, makeEnqueueInput({ issueId: "issue-1" }));
      state = admitCandidate(state, makeEnqueueInput({ issueId: "issue-2" }));

      expect(computeWaitingDepth(state)).toBe(2);

      // Mark one as active
      state = {
        ...state,
        items: state.items.map((item) =>
          item.issueId === "issue-1"
            ? { ...item, status: "active" as const }
            : item,
        ),
      };

      expect(computeWaitingDepth(state)).toBe(1);
    });

    it("generates a full queue snapshot", () => {
      let state = emptyMergeQueueState();
      state = admitCandidate(state, makeEnqueueInput({ issueId: "issue-1" }));
      state = admitCandidate(state, makeEnqueueInput({ issueId: "issue-2" }));

      const snapshot = getQueueSnapshot(state);

      expect(snapshot.totalDepth).toBe(2);
      expect(snapshot.waitingCount).toBe(2);
      expect(snapshot.activeCount).toBe(0);
      expect(snapshot.processedCount).toBe(0);
      expect(snapshot.isIdle).toBe(false);
      expect(snapshot.items).toHaveLength(2);
      expect(snapshot.items[0].issueId).toBe("issue-1");
      expect(snapshot.items[1].issueId).toBe("issue-2");
    });

    it("formats queue items for display with relative time", () => {
      const now = Date.now();
      const enqueuedAt = new Date(now - 120_000).toISOString(); // 2 minutes ago

      const item = {
        issueId: "issue-1",
        candidateBranch: "feat/issue-1",
        targetBranch: "main",
        enqueuedAt,
        position: 0,
        status: "queued" as const,
        attemptCount: 0,
        lastError: null,
        sourceStage: "implemented",
        sessionProvenanceId: "session-1",
        updatedAt: enqueuedAt,
      };

      const display = formatQueueItemForDisplay(item, now);

      expect(display.issueId).toBe("issue-1");
      expect(display.enqueuedAgo).toBe("2m ago");
      expect(display.status).toBe("queued");
      expect(display.position).toBe(0);
    });

    it("computes relative time correctly", () => {
      const now = Date.now();

      expect(relativeTime(new Date(now - 30_000).toISOString(), now)).toBe("30s ago");
      expect(relativeTime(new Date(now - 120_000).toISOString(), now)).toBe("2m ago");
      expect(relativeTime(new Date(now - 7_200_000).toISOString(), now)).toBe("2h ago");
      expect(relativeTime(new Date(now - 172_800_000).toISOString(), now)).toBe("2d ago");
    });

    it("reports queue idle state correctly", () => {
      let state = emptyMergeQueueState();
      expect(isQueueIdle(state)).toBe(true);

      state = admitCandidate(state, makeEnqueueInput({ issueId: "issue-1" }));
      expect(isQueueIdle(state)).toBe(false);
    });

    it("gets the next item in FIFO order for display", () => {
      let state = emptyMergeQueueState();
      state = admitCandidate(state, makeEnqueueInput({ issueId: "first" }));
      state = admitCandidate(state, makeEnqueueInput({ issueId: "second" }));

      const next = getNextInQueue(state);

      expect(next).not.toBeNull();
      expect(next?.issueId).toBe("first");
      expect(next?.position).toBe(0);
    });

    it("returns null for getNextInQueue when queue is empty", () => {
      const state = emptyMergeQueueState();
      expect(getNextInQueue(state)).toBeNull();
    });

    it("generates a status summary string", () => {
      let state = emptyMergeQueueState();
      expect(getQueueStatusSummary(state)).toBe("idle");

      state = admitCandidate(state, makeEnqueueInput({ issueId: "issue-1" }));
      state = admitCandidate(state, makeEnqueueInput({ issueId: "issue-2" }));
      expect(getQueueStatusSummary(state)).toBe("2 queued");

      // Mark one as active
      state = {
        ...state,
        items: state.items.map((item) =>
          item.issueId === "issue-1"
            ? { ...item, status: "active" as const }
            : item,
        ),
      };
      expect(getQueueStatusSummary(state)).toBe("1 queued, 1 active");
    });

    it("counts waiting and active items separately", () => {
      let state = emptyMergeQueueState();
      state = admitCandidate(state, makeEnqueueInput({ issueId: "issue-1" }));
      state = admitCandidate(state, makeEnqueueInput({ issueId: "issue-2" }));

      expect(getWaitingCount(state)).toBe(2);
      expect(getActiveCount(state)).toBe(0);

      state = {
        ...state,
        items: state.items.map((item) =>
          item.issueId === "issue-1"
            ? { ...item, status: "active" as const }
            : item,
        ),
      };

      expect(getWaitingCount(state)).toBe(1);
      expect(getActiveCount(state)).toBe(1);
    });
  });

  // =========================================================================
  // Lane B: Full admission → visibility → event flow
  // =========================================================================

  describe("full admission → visibility → event flow (lane B)", () => {
    function makeDispatchRecord(overrides: Partial<DispatchRecord> = {}): DispatchRecord {
      return {
        issueId: overrides.issueId ?? "impl-1",
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
        sessionProvenanceId: overrides.sessionProvenanceId ?? "session-1",
        updatedAt: overrides.updatedAt ?? new Date().toISOString(),
      };
    }

    function makeDispatchState(records: DispatchRecord[]): DispatchState {
      const map: Record<string, DispatchRecord> = {};
      for (const r of records) {
        map[r.issueId] = r;
      }
      return { schemaVersion: 1, records: map };
    }

    it("complete lifecycle: admit → transition → emit → display", () => {
      const eventBus = createInMemoryLiveEventBus();
      const capturedEvents: any[] = [];
      eventBus.subscribe((event) => capturedEvents.push(event));

      let dispatchState = makeDispatchState([
        makeDispatchRecord({ issueId: "titan-1" }),
      ]);
      let queueState = emptyMergeQueueState();

      // Step 1: Admit candidate
      const result = runAdmissionWorkflow(dispatchState, queueState, eventBus, {
        dispatchRecord: dispatchState.records["titan-1"],
        candidateBranch: "feat/titan-1",
        targetBranch: "main",
      });

      // Step 2: Verify dispatch state transitioned
      expect(result.dispatchState.records["titan-1"].stage).toBe(
        DispatchStage.QueuedForMerge,
      );

      // Step 3: Verify queue has the candidate
      expect(result.queueState.items).toHaveLength(1);
      expect(result.queueState.items[0].issueId).toBe("titan-1");

      // Step 4: Verify SSE event emitted
      expect(capturedEvents).toHaveLength(1);
      expect(capturedEvents[0].type).toBe("merge.queue_state");
      expect(capturedEvents[0].payload.issueId).toBe("titan-1");
      expect(capturedEvents[0].payload.status).toBe("queued");

      // Step 5: Verify visibility through snapshot
      const snapshot = getQueueSnapshot(result.queueState);
      expect(snapshot.totalDepth).toBe(1);
      expect(snapshot.items[0].issueId).toBe("titan-1");
      expect(snapshot.items[0].candidateBranch).toBe("feat/titan-1");
    });

    it("multiple candidates: full queue visibility after sequential admissions", () => {
      const eventBus = createInMemoryLiveEventBus();
      const capturedEvents: any[] = [];
      eventBus.subscribe((event) => capturedEvents.push(event));

      let dispatchState = makeDispatchState([
        makeDispatchRecord({ issueId: "titan-a" }),
        makeDispatchRecord({ issueId: "titan-b" }),
      ]);
      let queueState = emptyMergeQueueState();

      // Admit first candidate
      const r1 = runAdmissionWorkflow(dispatchState, queueState, eventBus, {
        dispatchRecord: dispatchState.records["titan-a"],
        candidateBranch: "feat/titan-a",
        targetBranch: "main",
      });
      dispatchState = r1.dispatchState;
      queueState = r1.queueState;

      // Admit second candidate
      const r2 = runAdmissionWorkflow(dispatchState, queueState, eventBus, {
        dispatchRecord: dispatchState.records["titan-b"],
        candidateBranch: "feat/titan-b",
        targetBranch: "main",
      });
      dispatchState = r2.dispatchState;
      queueState = r2.queueState;

      // Verify full queue state through snapshot
      const snapshot = getQueueSnapshot(queueState);
      expect(snapshot.totalDepth).toBe(2);
      expect(snapshot.waitingCount).toBe(2);
      expect(snapshot.isIdle).toBe(false);
      expect(snapshot.items.map((i) => i.issueId)).toEqual(["titan-a", "titan-b"]);
      expect(snapshot.items[0].position).toBe(0);
      expect(snapshot.items[1].position).toBe(1);

      // Verify all events captured
      expect(capturedEvents).toHaveLength(2);
      expect(capturedEvents[0].payload.issueId).toBe("titan-a");
      expect(capturedEvents[1].payload.issueId).toBe("titan-b");

      // Verify both dispatch records transitioned
      expect(dispatchState.records["titan-a"].stage).toBe(DispatchStage.QueuedForMerge);
      expect(dispatchState.records["titan-b"].stage).toBe(DispatchStage.QueuedForMerge);
    });

    it("queue depth tracking is accurate across operations", () => {
      let state = emptyMergeQueueState();

      expect(getQueueDepth(state)).toBe(0);
      expect(computeQueueDepth(state)).toBe(0);

      state = admitCandidate(state, makeEnqueueInput({ issueId: "issue-1" }));
      expect(getQueueDepth(state)).toBe(1);

      state = admitCandidate(state, makeEnqueueInput({ issueId: "issue-2" }));
      expect(getQueueDepth(state)).toBe(2);

      // Dequeue first item
      state = dequeueItem(state, "issue-1");
      expect(getQueueDepth(state)).toBe(1);
      expect(state.processedCount).toBe(1);
    });

    it("events are replayable for late subscribers", () => {
      const eventBus = createInMemoryLiveEventBus();

      let dispatchState = makeDispatchState([
        makeDispatchRecord({ issueId: "impl-1" }),
      ]);
      let queueState = emptyMergeQueueState();

      // Admit a candidate (event emitted)
      const result = runAdmissionWorkflow(dispatchState, queueState, eventBus, {
        dispatchRecord: dispatchState.records["impl-1"],
        candidateBranch: "feat/impl-1",
        targetBranch: "main",
      });

      // Replay events
      const replayed = eventBus.replay();
      expect(replayed).toHaveLength(1);
      expect(replayed[0].type).toBe("merge.queue_state");
      expect((replayed[0].payload as { issueId: string }).issueId).toBe("impl-1");

      // Snapshot should match event
      const snapshot = getQueueSnapshot(result.queueState);
      expect(snapshot.items[0].issueId).toBe((replayed[0].payload as { issueId: string }).issueId);
    });
  });
});
