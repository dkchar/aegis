/**
 * S04 contract seed — stage-transition unit tests.
 *
 * Validates the canonical dispatch stage model from SPECv2 §6.1–§6.3:
 *   a) All named stages exist in the DispatchStage enum
 *   b) Valid transitions succeed and return an updated DispatchRecord
 *   c) Invalid transitions return false / throw
 *   d) `failed` is reachable from every in-progress stage
 *   e) Terminal stages (`complete`, `failed`) cannot transition further
 *      (except `failed` → `pending` for retry after cooldown)
 *   f) transitionStage mutates a copy, not the original
 */

import { describe, it, expect } from "vitest";

import {
  DispatchStage,
  STAGE_ORDER,
  validateTransition,
  transitionStage,
} from "../../../src/core/stage-transition.js";
import type { DispatchRecord } from "../../../src/core/dispatch-state.js";

// ---------------------------------------------------------------------------
// Helper — minimal DispatchRecord fixture
// ---------------------------------------------------------------------------

function makeRecord(stage: DispatchStage): DispatchRecord {
  return {
    issueId: "test-issue-1",
    stage,
    runningAgent: null,
    oracleAssessmentRef: null,
    sentinelVerdictRef: null,
    fileScope: null,
    failureCount: 0,
    consecutiveFailures: 0,
    failureWindowStartMs: null,
    cooldownUntil: null,
    cumulativeSpendUsd: null,
    sessionProvenanceId: "test-session",
    updatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// 1. Enum completeness
// ---------------------------------------------------------------------------

describe("DispatchStage enum", () => {
  it("contains all 12 canonical stages from SPECv2 §6.1", () => {
    const expected: DispatchStage[] = [
      DispatchStage.Pending,
      DispatchStage.Scouting,
      DispatchStage.Scouted,
      DispatchStage.Implementing,
      DispatchStage.Implemented,
      DispatchStage.QueuedForMerge,
      DispatchStage.Merging,
      DispatchStage.ResolvingIntegration,
      DispatchStage.Merged,
      DispatchStage.Reviewing,
      DispatchStage.Complete,
      DispatchStage.Failed,
    ];

    for (const stage of expected) {
      expect(Object.values(DispatchStage)).toContain(stage);
    }

    expect(Object.values(DispatchStage)).toHaveLength(expected.length);
  });

  it("STAGE_ORDER lists the happy-path stages in canonical order", () => {
    expect(STAGE_ORDER).toEqual([
      DispatchStage.Pending,
      DispatchStage.Scouting,
      DispatchStage.Scouted,
      DispatchStage.Implementing,
      DispatchStage.Implemented,
      DispatchStage.QueuedForMerge,
      DispatchStage.Merging,
      DispatchStage.ResolvingIntegration,
      DispatchStage.Merged,
      DispatchStage.Reviewing,
      DispatchStage.Complete,
    ]);
  });
});

// ---------------------------------------------------------------------------
// 2. validateTransition — valid transitions
// ---------------------------------------------------------------------------

describe("validateTransition — valid transitions", () => {
  it("allows pending → scouting", () => {
    expect(validateTransition(DispatchStage.Pending, DispatchStage.Scouting)).toBe(true);
  });

  it("allows scouting → scouted", () => {
    expect(validateTransition(DispatchStage.Scouting, DispatchStage.Scouted)).toBe(true);
  });

  it("allows scouted → implementing", () => {
    expect(validateTransition(DispatchStage.Scouted, DispatchStage.Implementing)).toBe(true);
  });

  it("allows implementing → implemented", () => {
    expect(validateTransition(DispatchStage.Implementing, DispatchStage.Implemented)).toBe(true);
  });

  it("allows implemented → queued_for_merge", () => {
    expect(validateTransition(DispatchStage.Implemented, DispatchStage.QueuedForMerge)).toBe(true);
  });

  it("allows queued_for_merge → merging", () => {
    expect(validateTransition(DispatchStage.QueuedForMerge, DispatchStage.Merging)).toBe(true);
  });

  it("allows merging → resolving_integration (Janus activation)", () => {
    expect(validateTransition(DispatchStage.Merging, DispatchStage.ResolvingIntegration)).toBe(true);
  });

  it("allows merging → merged (clean merge path)", () => {
    expect(validateTransition(DispatchStage.Merging, DispatchStage.Merged)).toBe(true);
  });

  it("allows resolving_integration → merged", () => {
    expect(validateTransition(DispatchStage.ResolvingIntegration, DispatchStage.Merged)).toBe(true);
  });

  it("allows merged → reviewing", () => {
    expect(validateTransition(DispatchStage.Merged, DispatchStage.Reviewing)).toBe(true);
  });

  it("allows reviewing → complete", () => {
    expect(validateTransition(DispatchStage.Reviewing, DispatchStage.Complete)).toBe(true);
  });

  it("allows failed → pending (retry after cooldown)", () => {
    expect(validateTransition(DispatchStage.Failed, DispatchStage.Pending)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. validateTransition — invalid transitions
// ---------------------------------------------------------------------------

describe("validateTransition — invalid transitions", () => {
  it("rejects backwards transitions (scouted → pending)", () => {
    expect(validateTransition(DispatchStage.Scouted, DispatchStage.Pending)).toBe(false);
  });

  it("rejects skipping stages (pending → implementing)", () => {
    expect(validateTransition(DispatchStage.Pending, DispatchStage.Implementing)).toBe(false);
  });

  it("rejects complete → any forward stage", () => {
    for (const stage of Object.values(DispatchStage)) {
      if (stage !== DispatchStage.Complete) {
        expect(validateTransition(DispatchStage.Complete, stage)).toBe(false);
      }
    }
  });

  it("rejects failed → any stage except pending", () => {
    for (const stage of Object.values(DispatchStage)) {
      if (stage !== DispatchStage.Pending && stage !== DispatchStage.Failed) {
        expect(validateTransition(DispatchStage.Failed, stage)).toBe(false);
      }
    }
  });

  it("rejects self-transition for non-terminal stages", () => {
    // A stage should not transition to itself (no-op transitions are not allowed)
    expect(validateTransition(DispatchStage.Pending, DispatchStage.Pending)).toBe(false);
    expect(validateTransition(DispatchStage.Scouting, DispatchStage.Scouting)).toBe(false);
    expect(validateTransition(DispatchStage.Implementing, DispatchStage.Implementing)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. failed is reachable from every in-progress stage
// ---------------------------------------------------------------------------

describe("failed reachability", () => {
  const inProgressStages: DispatchStage[] = [
    DispatchStage.Scouting,
    DispatchStage.Scouted,
    DispatchStage.Implementing,
    DispatchStage.Implemented,
    DispatchStage.QueuedForMerge,
    DispatchStage.Merging,
    DispatchStage.ResolvingIntegration,
    DispatchStage.Merged,
    DispatchStage.Reviewing,
  ];

  for (const stage of inProgressStages) {
    it(`allows ${stage} → failed`, () => {
      expect(validateTransition(stage, DispatchStage.Failed)).toBe(true);
    });
  }

  it("does not allow pending → failed (never dispatched yet)", () => {
    // pending has not started work; failure is not applicable until dispatch begins
    expect(validateTransition(DispatchStage.Pending, DispatchStage.Failed)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. transitionStage — success path
// ---------------------------------------------------------------------------

describe("transitionStage — success path", () => {
  it("returns a new record with the updated stage", () => {
    const original = makeRecord(DispatchStage.Pending);
    const updated = transitionStage(original, DispatchStage.Scouting);

    expect(updated.stage).toBe(DispatchStage.Scouting);
    expect(updated.issueId).toBe(original.issueId);
  });

  it("does not mutate the original record", () => {
    const original = makeRecord(DispatchStage.Pending);
    transitionStage(original, DispatchStage.Scouting);

    expect(original.stage).toBe(DispatchStage.Pending);
  });

  it("updates updatedAt on transition", () => {
    const before = new Date().toISOString();
    const original = makeRecord(DispatchStage.Pending);
    const updated = transitionStage(original, DispatchStage.Scouting);

    expect(updated.updatedAt >= before).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. transitionStage — error path
// ---------------------------------------------------------------------------

describe("transitionStage — error path", () => {
  it("throws on an invalid transition", () => {
    const record = makeRecord(DispatchStage.Pending);

    expect(() => transitionStage(record, DispatchStage.Implementing)).toThrow();
  });

  it("throws on a backwards transition", () => {
    const record = makeRecord(DispatchStage.Scouted);

    expect(() => transitionStage(record, DispatchStage.Pending)).toThrow();
  });

  it("error message includes from and to stage names", () => {
    const record = makeRecord(DispatchStage.Complete);

    expect(() =>
      transitionStage(record, DispatchStage.Pending),
    ).toThrow(/complete.*pending/i);
  });
});
