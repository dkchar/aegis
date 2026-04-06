/**
 * S10 Lane B — Recovery implementation unit tests.
 *
 * Validates the RecoveryImpl class, agent reconciliation, labor
 * reconciliation, and recovery report generation from SPECv2 §6.3, §6.5.
 */

import { describe, it, expect } from "vitest";

import { RecoveryImpl } from "../../../src/core/recovery-impl.js";
import {
  findInProgressRecords,
  summarizeRecovery,
  canRedispatchAfterRecovery,
} from "../../../src/core/recovery.js";
import type { DispatchState, DispatchRecord } from "../../../src/core/dispatch-state.js";
import { DispatchStage } from "../../../src/core/stage-transition.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRecord(
  issueId: string,
  stage: DispatchStage = DispatchStage.Pending,
  runningAgentCaste: "oracle" | "titan" | "sentinel" | null = null,
): DispatchRecord {
  return {
    issueId,
    stage,
    runningAgent: runningAgentCaste
      ? {
          caste: runningAgentCaste,
          sessionId: `session-${issueId}`,
          startedAt: new Date().toISOString(),
        }
      : null,
    oracleAssessmentRef: null,
    sentinelVerdictRef: null,
    failureCount: 0,
    consecutiveFailures: 0,
    cooldownUntil: null,
    cumulativeSpendUsd: null,
    sessionProvenanceId: "old-session",
    updatedAt: new Date().toISOString(),
  };
}

function makeState(records: DispatchRecord[]): DispatchState {
  const recordMap: Record<string, DispatchRecord> = {};
  for (const r of records) {
    recordMap[r.issueId] = r;
  }
  return { schemaVersion: 1, records: recordMap };
}

// ---------------------------------------------------------------------------
// 1. findInProgressRecords
// ---------------------------------------------------------------------------

describe("findInProgressRecords", () => {
  it("returns records with non-null runningAgent", () => {
    const state = makeState([
      makeRecord("issue-1", DispatchStage.Scouting, "oracle"),
      makeRecord("issue-2", DispatchStage.Pending),
      makeRecord("issue-3", DispatchStage.Implementing, "titan"),
    ]);

    const inProgress = findInProgressRecords(state);

    expect(inProgress).toHaveLength(2);
    expect(inProgress.map((r) => r.issueId)).toContain("issue-1");
    expect(inProgress.map((r) => r.issueId)).toContain("issue-3");
  });

  it("returns empty array when no records have running agents", () => {
    const state = makeState([
      makeRecord("issue-1", DispatchStage.Pending),
      makeRecord("issue-2", DispatchStage.Complete),
    ]);

    expect(findInProgressRecords(state)).toHaveLength(0);
  });

  it("handles empty state", () => {
    const state = makeState([]);
    expect(findInProgressRecords(state)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 2. RecoveryImpl — agent reconciliation (alive)
// ---------------------------------------------------------------------------

describe("RecoveryImpl — reconcileAgent (alive)", () => {
  it("reports alive status when session is still responding", () => {
    const recovery = new RecoveryImpl({
      sessionAliveCheck: () => true,
      hasArtifactsCheck: () => false,
    });

    const record = makeRecord("issue-1", DispatchStage.Scouting, "oracle");
    const result = recovery.reconcileAgent(record);

    expect(result.status).toBe("alive");
    expect(result.shouldFail).toBe(false);
    expect(result.issueId).toBe("issue-1");
    expect(result.caste).toBe("oracle");
    expect(result.sessionId).toBe("session-issue-1");
  });
});

// ---------------------------------------------------------------------------
// 3. RecoveryImpl — agent reconciliation (dead with artifacts)
// ---------------------------------------------------------------------------

describe("RecoveryImpl — reconcileAgent (dead with artifacts)", () => {
  it("reports dead_with_artifacts when session is dead but artifacts exist", () => {
    const recovery = new RecoveryImpl({
      sessionAliveCheck: () => false,
      hasArtifactsCheck: () => true,
    });

    const record = makeRecord("issue-1", DispatchStage.Implementing, "titan");
    const result = recovery.reconcileAgent(record);

    expect(result.status).toBe("dead_with_artifacts");
    expect(result.shouldFail).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. RecoveryImpl — agent reconciliation (dead no artifacts)
// ---------------------------------------------------------------------------

describe("RecoveryImpl — reconcileAgent (dead no artifacts)", () => {
  it("reports dead_no_artifacts when session is dead and no artifacts", () => {
    const recovery = new RecoveryImpl({
      sessionAliveCheck: () => false,
      hasArtifactsCheck: () => false,
    });

    const record = makeRecord("issue-1", DispatchStage.Scouting, "oracle");
    const result = recovery.reconcileAgent(record);

    expect(result.status).toBe("dead_no_artifacts");
    expect(result.shouldFail).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. RecoveryImpl — agent reconciliation (no running agent)
// ---------------------------------------------------------------------------

describe("RecoveryImpl — reconcileAgent (no running agent)", () => {
  it("reports not_found when runningAgent is null", () => {
    const recovery = new RecoveryImpl();
    const record = makeRecord("issue-1", DispatchStage.Pending);
    const result = recovery.reconcileAgent(record);

    expect(result.status).toBe("not_found");
    expect(result.shouldFail).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. RecoveryImpl — labor reconciliation (intact)
// ---------------------------------------------------------------------------

describe("RecoveryImpl — reconcileLabor (intact)", () => {
  it("reports intact when both worktree and branch exist", () => {
    const recovery = new RecoveryImpl({
      worktreeExistsCheck: () => true,
      branchExistsCheck: () => true,
    });

    const result = recovery.reconcileLabor(
      "issue-1",
      "/path/to/worktree",
      "aegis/issue-1",
    );

    expect(result.status).toBe("intact");
    expect(result.worktreePath).toBe("/path/to/worktree");
    expect(result.branchName).toBe("aegis/issue-1");
  });
});

// ---------------------------------------------------------------------------
// 7. RecoveryImpl — labor reconciliation (worktree_gone)
// ---------------------------------------------------------------------------

describe("RecoveryImpl — reconcileLabor (worktree_gone)", () => {
  it("reports worktree_gone when branch exists but worktree does not", () => {
    const recovery = new RecoveryImpl({
      worktreeExistsCheck: () => false,
      branchExistsCheck: () => true,
    });

    const result = recovery.reconcileLabor(
      "issue-1",
      "/path/to/worktree",
      "aegis/issue-1",
    );

    expect(result.status).toBe("worktree_gone");
  });
});

// ---------------------------------------------------------------------------
// 8. RecoveryImpl — labor reconciliation (branch_gone)
// ---------------------------------------------------------------------------

describe("RecoveryImpl — reconcileLabor (branch_gone)", () => {
  it("reports branch_gone when worktree exists but branch does not", () => {
    const recovery = new RecoveryImpl({
      worktreeExistsCheck: () => true,
      branchExistsCheck: () => false,
    });

    const result = recovery.reconcileLabor(
      "issue-1",
      "/path/to/worktree",
      "aegis/issue-1",
    );

    expect(result.status).toBe("branch_gone");
  });
});

// ---------------------------------------------------------------------------
// 9. RecoveryImpl — labor reconciliation (lost)
// ---------------------------------------------------------------------------

describe("RecoveryImpl — reconcileLabor (lost)", () => {
  it("reports lost when neither worktree nor branch exist", () => {
    const recovery = new RecoveryImpl({
      worktreeExistsCheck: () => false,
      branchExistsCheck: () => false,
    });

    const result = recovery.reconcileLabor(
      "issue-1",
      "/path/to/worktree",
      "aegis/issue-1",
    );

    expect(result.status).toBe("lost");
  });
});

// ---------------------------------------------------------------------------
// 10. RecoveryImpl — full recovery run
// ---------------------------------------------------------------------------

describe("RecoveryImpl — runRecovery", () => {
  it("produces a recovery report with agent and labor reconciliations", () => {
    const state = makeState([
      makeRecord("issue-1", DispatchStage.Scouting, "oracle"),
      makeRecord("issue-2", DispatchStage.Implementing, "titan"),
      makeRecord("issue-3", DispatchStage.Complete),
    ]);

    const recovery = new RecoveryImpl({
      sessionAliveCheck: () => false,
      hasArtifactsCheck: (issueId) => issueId === "issue-1",
      worktreeExistsCheck: () => true,
      branchExistsCheck: () => true,
    });

    const report = recovery.runRecovery(state, "new-session-123");

    expect(report.newSessionId).toBe("new-session-123");
    expect(report.recordsReconciled).toBe(2);
    expect(report.agentReconciliations).toHaveLength(2);
    expect(report.laborReconciliations).toHaveLength(1);
    expect(report.summary).toContain("Reconciled 2 record(s)");
  });

  it("detects data loss when dead_no_artifacts is present", () => {
    const state = makeState([
      makeRecord("issue-1", DispatchStage.Scouting, "oracle"),
    ]);

    const recovery = new RecoveryImpl({
      sessionAliveCheck: () => false,
      hasArtifactsCheck: () => false,
    });

    const report = recovery.runRecovery(state, "new-session");

    expect(report.dataLossDetected).toBe(true);
  });

  it("no data loss when all dead sessions have artifacts", () => {
    const state = makeState([
      makeRecord("issue-1", DispatchStage.Scouting, "oracle"),
    ]);

    const recovery = new RecoveryImpl({
      sessionAliveCheck: () => false,
      hasArtifactsCheck: () => true,
    });

    const report = recovery.runRecovery(state, "new-session");

    expect(report.dataLossDetected).toBe(false);
  });

  it("handles empty state gracefully", () => {
    const state = makeState([]);
    const recovery = new RecoveryImpl();

    const report = recovery.runRecovery(state, "new-session");

    expect(report.recordsReconciled).toBe(0);
    expect(report.agentReconciliations).toHaveLength(0);
    expect(report.laborReconciliations).toHaveLength(0);
    expect(report.dataLossDetected).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 11. summarizeRecovery
// ---------------------------------------------------------------------------

describe("summarizeRecovery", () => {
  it("produces a summary with record count", () => {
    const report = {
      timestamp: new Date().toISOString(),
      newSessionId: "new-session",
      recordsReconciled: 3,
      agentReconciliations: [],
      laborReconciliations: [],
      dataLossDetected: false,
      summary: "",
    };

    const summary = summarizeRecovery(report);
    expect(summary).toContain("Reconciled 3 record(s)");
  });

  it("includes dead agent count", () => {
    const report = {
      timestamp: new Date().toISOString(),
      newSessionId: "new-session",
      recordsReconciled: 2,
      agentReconciliations: [
        {
          issueId: "issue-1",
          caste: "oracle" as const,
          sessionId: "s1",
          status: "dead_with_artifacts" as const,
          shouldFail: true,
          canRedispatch: true,
          summary: "test",
        },
        {
          issueId: "issue-2",
          caste: "titan" as const,
          sessionId: "s2",
          status: "dead_no_artifacts" as const,
          shouldFail: true,
          canRedispatch: true,
          summary: "test",
        },
      ],
      laborReconciliations: [],
      dataLossDetected: false,
      summary: "",
    };

    const summary = summarizeRecovery(report);
    expect(summary).toContain("2 dead agent session(s)");
  });

  it("includes lost labor count", () => {
    const report = {
      timestamp: new Date().toISOString(),
      newSessionId: "new-session",
      recordsReconciled: 1,
      agentReconciliations: [],
      laborReconciliations: [
        {
          issueId: "issue-1",
          worktreePath: "/path/1",
          branchName: "aegis/1",
          status: "lost" as const,
          recommendedAction: "test",
        },
        {
          issueId: "issue-2",
          worktreePath: "/path/2",
          branchName: "aegis/2",
          status: "intact" as const,
          recommendedAction: "test",
        },
      ],
      dataLossDetected: true,
      summary: "",
    };

    const summary = summarizeRecovery(report);
    expect(summary).toContain("1 lost labor(s)");
    expect(summary).toContain("DATA LOSS DETECTED");
  });
});

// ---------------------------------------------------------------------------
// 12. canRedispatchAfterRecovery
// ---------------------------------------------------------------------------

describe("canRedispatchAfterRecovery", () => {
  it("returns false when runningAgent is still set", () => {
    const record = makeRecord("issue-1", DispatchStage.Scouting, "oracle");
    expect(canRedispatchAfterRecovery(record)).toBe(false);
  });

  it("returns true for scouting stage with no running agent", () => {
    const record = makeRecord("issue-1", DispatchStage.Scouting);
    expect(canRedispatchAfterRecovery(record)).toBe(true);
  });

  it("returns true for implementing stage with no running agent", () => {
    const record = makeRecord("issue-1", DispatchStage.Implementing);
    expect(canRedispatchAfterRecovery(record)).toBe(true);
  });

  it("returns true for merging stage with no running agent", () => {
    const record = makeRecord("issue-1", DispatchStage.Merging);
    expect(canRedispatchAfterRecovery(record)).toBe(true);
  });

  it("returns true for reviewing stage with no running agent", () => {
    const record = makeRecord("issue-1", DispatchStage.Reviewing);
    expect(canRedispatchAfterRecovery(record)).toBe(true);
  });

  it("returns true for resolving_integration with no running agent", () => {
    const record = makeRecord("issue-1", DispatchStage.ResolvingIntegration);
    expect(canRedispatchAfterRecovery(record)).toBe(true);
  });

  it("returns false for pending stage (not in-progress)", () => {
    const record = makeRecord("issue-1", DispatchStage.Pending);
    expect(canRedispatchAfterRecovery(record)).toBe(false);
  });

  it("returns false for complete stage", () => {
    const record = makeRecord("issue-1", DispatchStage.Complete);
    expect(canRedispatchAfterRecovery(record)).toBe(false);
  });

  it("returns false for failed stage", () => {
    const record = makeRecord("issue-1", DispatchStage.Failed);
    expect(canRedispatchAfterRecovery(record)).toBe(false);
  });
});
