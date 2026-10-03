import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import {
  commitDispatchChanges,
  createDispatchRecord,
  loadDispatchState,
  reconcileDispatchState,
  replaceDispatchRecord,
  saveDispatchRecord,
  saveDispatchState,
  releaseStoppedRunningRecords,
  type DispatchRecord,
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

function createImplementingState(): DispatchState {
  return {
    schemaVersion: 1,
    records: {
      "ISSUE-IMPLEMENT": {
        issueId: "ISSUE-IMPLEMENT",
        stage: "implementing",
        runningAgent: {
          caste: "titan",
          sessionId: "titan-old",
          startedAt: "2026-04-24T09:55:00.000Z",
        },
        oracleAssessmentRef: ".aegis/oracle/ISSUE-IMPLEMENT.json",
        titanHandoffRef: null,
        titanClarificationRef: null,
        sentinelVerdictRef: null,
        janusArtifactRef: null,
        failureTranscriptRef: null,
        reviewFeedbackRef: null,
        policyArtifactRef: null,
        blockedByIssueId: null,
        oracleReady: null,
        oracleDecompose: null,
        oracleBlockers: null,
        lastCompletedCaste: null,
        fileScope: { files: ["src/App.tsx"] },
        failureCount: 0,
        consecutiveFailures: 0,
        failureWindowStartMs: null,
        cooldownUntil: null,
        sessionProvenanceId: "daemon-old",
        updatedAt: "2026-04-24T09:55:00.000Z",
      },
    },
  };
}

function createMergeStageState(
  stage: DispatchRecord["stage"],
  runningAgent: DispatchRecord["runningAgent"] = null,
): DispatchState {
  return {
    schemaVersion: 1,
    records: {
      "ISSUE-MERGE": {
        issueId: "ISSUE-MERGE",
        stage,
        runningAgent,
        oracleAssessmentRef: ".aegis/oracle/ISSUE-MERGE.json",
        titanHandoffRef: ".aegis/titan/ISSUE-MERGE.json",
        sentinelVerdictRef: ".aegis/sentinel/ISSUE-MERGE.json",
        fileScope: { files: ["src/App.tsx"] },
        failureCount: 0,
        consecutiveFailures: 0,
        failureWindowStartMs: null,
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

  it("preserves stale Titan file scope for safe retry", () => {
    const reconciled = reconcileDispatchState(
      createImplementingState(),
      "daemon-new",
      "2026-04-24T10:00:00.000Z",
    );

    expect(reconciled.records["ISSUE-IMPLEMENT"]).toMatchObject({
      stage: "failed_operational",
      runningAgent: null,
      fileScope: { files: ["src/App.tsx"] },
      sessionProvenanceId: "daemon-new",
    });
  });

  it("requeues an interrupted mechanical merge instead of redoing Titan work", () => {
    const reconciled = reconcileDispatchState(
      createMergeStageState("merging"),
      "daemon-new",
      "2026-04-24T10:00:00.000Z",
    );

    expect(reconciled.records["ISSUE-MERGE"]).toMatchObject({
      stage: "queued_for_merge",
      failureCount: 0,
      sessionProvenanceId: "daemon-new",
    });
  });

  it("keeps escalated work awaiting its Janus launch", () => {
    const reconciled = reconcileDispatchState(
      createMergeStageState("resolving_integration"),
      "daemon-new",
      "2026-04-24T10:00:00.000Z",
    );

    expect(reconciled.records["ISSUE-MERGE"]).toMatchObject({
      stage: "resolving_integration",
      runningAgent: null,
      failureCount: 0,
      sessionProvenanceId: "daemon-new",
    });
  });

  it("fails a Janus session owned by a dead daemon with retry accounting", () => {
    const reconciled = reconcileDispatchState(
      createMergeStageState("resolving_integration", {
        caste: "janus",
        sessionId: "janus-old",
        startedAt: "2026-04-24T09:55:00.000Z",
      }),
      "daemon-new",
      "2026-04-24T10:00:00.000Z",
    );

    expect(reconciled.records["ISSUE-MERGE"]).toMatchObject({
      stage: "failed_operational",
      runningAgent: null,
      consecutiveFailures: 1,
    });
  });
});

describe("releaseStoppedRunningRecords", () => {
  it("leaves a stopped Janus session awaiting relaunch", () => {
    const released = releaseStoppedRunningRecords(
      createMergeStageState("resolving_integration", {
        caste: "janus",
        sessionId: "janus-live",
        startedAt: "2026-04-24T09:55:00.000Z",
      }),
      "daemon-live",
      "2026-04-24T10:00:00.000Z",
    );

    expect(released.records["ISSUE-MERGE"]).toMatchObject({
      stage: "resolving_integration",
      runningAgent: null,
      failureCount: 0,
    });
  });
});

describe("commitDispatchChanges", () => {
  const tempRoots: string[] = [];
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  function createTempRoot() {
    const root = mkdtempSync(path.join(tmpdir(), "aegis-dispatch-commit-"));
    tempRoots.push(root);
    return root;
  }

  it("writes only changed records over records saved after the base was loaded", () => {
    const root = createTempRoot();
    const timestamp = "2026-10-01T00:00:00.000Z";
    saveDispatchState(root, {
      schemaVersion: 1,
      records: {
        A: createDispatchRecord("A", "daemon", timestamp),
        B: createDispatchRecord("B", "daemon", timestamp),
      },
    });
    const base = loadDispatchState(root);

    // A session settles while the pass is still working from `base`.
    saveDispatchRecord(root, { ...base.records["B"]!, stage: "implemented", updatedAt: "2026-10-01T00:00:05.000Z" });

    const next = replaceDispatchRecord(base, "A", { ...base.records["A"]!, stage: "scouting" });
    const committed = commitDispatchChanges(root, base, next);

    expect(committed.records["A"]?.stage).toBe("scouting");
    expect(committed.records["B"]?.stage).toBe("implemented");
    expect(loadDispatchState(root)).toEqual(committed);
  });

  it("leaves the file untouched when nothing changed", () => {
    const root = createTempRoot();
    const base = {
      schemaVersion: 1 as const,
      records: { A: createDispatchRecord("A", "daemon", "2026-10-01T00:00:00.000Z") },
    };
    saveDispatchState(root, base);
    saveDispatchRecord(root, { ...base.records.A, stage: "scouted" });

    expect(commitDispatchChanges(root, base, base).records["A"]?.stage).toBe("scouted");
  });
});
