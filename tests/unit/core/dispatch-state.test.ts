import { describe, expect, it } from "vitest";

import {
  reconcileDispatchState,
  type DispatchState,
} from "../../../src/core/dispatch-state.js";

function createReviewingState(consecutiveFailures: number): DispatchState {
  return {
    schemaVersion: 1,
    records: {
      "ISSUE-REVIEW": {
        issueId: "ISSUE-REVIEW",
        stage: "reviewing",
        runningAgent: {
          caste: "sentinel",
          sessionId: "sentinel-old",
          startedAt: "2026-04-24T09:55:00.000Z",
        },
        oracleAssessmentRef: ".aegis/oracle/ISSUE-REVIEW.json",
        titanHandoffRef: ".aegis/titan/ISSUE-REVIEW.json",
        titanClarificationRef: null,
        sentinelVerdictRef: null,
        janusArtifactRef: null,
        failureTranscriptRef: null,
        reviewFeedbackRef: ".aegis/sentinel/ISSUE-REVIEW.json",
        fileScope: null,
        failureCount: consecutiveFailures,
        consecutiveFailures,
        failureWindowStartMs: consecutiveFailures > 0 ? 1777049700000 : null,
        cooldownUntil: null,
        sessionProvenanceId: "daemon-old",
        updatedAt: "2026-04-24T09:55:00.000Z",
      },
    },
  };
}

describe("reconcileDispatchState", () => {
  it("keeps first stale Sentinel review retryable with cooldown", () => {
    const reconciled = reconcileDispatchState(
      createReviewingState(0),
      "daemon-new",
      "2026-04-24T10:00:00.000Z",
    );

    expect(reconciled.records["ISSUE-REVIEW"]).toMatchObject({
      stage: "implemented",
      runningAgent: null,
      failureCount: 1,
      consecutiveFailures: 1,
      sessionProvenanceId: "daemon-new",
    });
    expect(reconciled.records["ISSUE-REVIEW"]?.cooldownUntil).toBeTruthy();
  });

  it("escalates repeated stale Sentinel reviews to operational failure", () => {
    const reconciled = reconcileDispatchState(
      createReviewingState(1),
      "daemon-new",
      "2026-04-24T10:00:00.000Z",
    );

    expect(reconciled.records["ISSUE-REVIEW"]).toMatchObject({
      stage: "failed_operational",
      runningAgent: null,
      oracleAssessmentRef: ".aegis/oracle/ISSUE-REVIEW.json",
      reviewFeedbackRef: ".aegis/sentinel/ISSUE-REVIEW.json",
      failureCount: 2,
      consecutiveFailures: 2,
      sessionProvenanceId: "daemon-new",
    });
    expect(reconciled.records["ISSUE-REVIEW"]?.cooldownUntil).toBeTruthy();
  });
});
