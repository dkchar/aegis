import { describe, expect, it } from "vitest";

import { reconcileDispatchRecordAfterQueueStatus } from "../../../src/core/direct-command-runner.js";
import type { DispatchRecord } from "../../../src/core/dispatch-state.js";
import { DispatchStage } from "../../../src/core/stage-transition.js";

function makeRecord(stage: DispatchStage): DispatchRecord {
  return {
    issueId: "aegis-test.42",
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
    sessionProvenanceId: "session-1",
    updatedAt: "2026-04-09T00:00:00.000Z",
  };
}

describe("reconcileDispatchRecordAfterQueueStatus", () => {
  it("keeps a Janus-bound issue in merging instead of collapsing it to failed", () => {
    const record = reconcileDispatchRecordAfterQueueStatus(
      makeRecord(DispatchStage.Merging),
      "janus_required",
    );

    expect(record.stage).toBe(DispatchStage.Merging);
  });

  it("requeues Janus-resolved work back to queued_for_merge", () => {
    const record = reconcileDispatchRecordAfterQueueStatus(
      makeRecord(DispatchStage.ResolvingIntegration),
      "queued",
    );

    expect(record.stage).toBe(DispatchStage.QueuedForMerge);
  });

  it("moves merge failures into the failed dispatch stage", () => {
    const record = reconcileDispatchRecordAfterQueueStatus(
      makeRecord(DispatchStage.Merging),
      "merge_failed",
    );

    expect(record.stage).toBe(DispatchStage.Failed);
  });

  it("advances a successful merge to merged", () => {
    const record = reconcileDispatchRecordAfterQueueStatus(
      makeRecord(DispatchStage.QueuedForMerge),
      "merged",
    );

    expect(record.stage).toBe(DispatchStage.Merged);
  });
});
