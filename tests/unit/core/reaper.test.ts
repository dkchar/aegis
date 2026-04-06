/**
 * S10 Lane B — Reaper implementation unit tests.
 *
 * Validates the ReaperImpl class, failure accounting, record updates,
 * and Lethe pruning decisions from SPECv2 §9.7.
 */

import { describe, it, expect } from "vitest";

import { ReaperImpl, applyFailureAccounting, updateRecordFromReaper, shouldRunLethePruning } from "../../../src/core/reaper-impl.js";
import type { ReaperResult } from "../../../src/core/reaper.js";
import { DispatchStage } from "../../../src/core/stage-transition.js";
import type { DispatchRecord } from "../../../src/core/dispatch-state.js";
import type { AgentEvent } from "../../../src/runtime/agent-events.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW = Date.now();

function makeRecord(
  issueId: string,
  stage: DispatchStage = DispatchStage.Scouting,
): DispatchRecord {
  return {
    issueId,
    stage,
    runningAgent: {
      caste: "oracle",
      sessionId: "session-1",
      startedAt: new Date().toISOString(),
    },
    oracleAssessmentRef: null,
    sentinelVerdictRef: null,
    failureCount: 0,
    consecutiveFailures: 0,
    cooldownUntil: null,
    cumulativeSpendUsd: null,
    sessionProvenanceId: "test-session",
    updatedAt: new Date().toISOString(),
  };
}

function oracleAssessmentJson(): string {
  return JSON.stringify({
    files_affected: ["src/core/foo.ts"],
    estimated_complexity: "moderate",
    decompose: false,
    ready: true,
  });
}

function titanHandoffJson(): string {
  return JSON.stringify({
    issueId: "aegis-fjm.10",
    laborPath: ".aegis/labors/labor-aegis-fjm.10",
    candidateBranch: "aegis/aegis-fjm.10",
    baseBranch: "main",
    filesChanged: ["src/core/foo.ts"],
    testsAndChecksRun: ["npm run test"],
    knownRisks: [],
    followUpWork: [],
    learningsWrittenToMnemosyne: [],
  });
}

function sentinelVerdictJson(verdict: "pass" | "fail" = "pass"): string {
  return JSON.stringify({
    verdict,
    reviewSummary: "Review complete",
    issuesFound: false,
    followUpIssueIds: [],
    riskAreas: [],
  });
}

function makeEvents(messages: string[], toolUses: string[] = []): AgentEvent[] {
  const events: AgentEvent[] = [];
  for (const text of messages) {
    events.push({
      type: "message",
      timestamp: new Date().toISOString(),
      issueId: "test-issue",
      caste: "oracle",
      text,
    });
  }
  for (const tool of toolUses) {
    events.push({
      type: "tool_use",
      timestamp: new Date().toISOString(),
      issueId: "test-issue",
      caste: "oracle",
      tool,
    });
  }
  return events;
}

// ---------------------------------------------------------------------------
// 1. ReaperImpl — Oracle reap success
// ---------------------------------------------------------------------------

describe("ReaperImpl — Oracle success", () => {
  const reaper = new ReaperImpl();

  it("reaps a completed Oracle session as success with valid assessment", () => {
    const events = makeEvents([oracleAssessmentJson()]);
    const record = makeRecord("issue-1", DispatchStage.Scouting);

    const result = reaper.reap("issue-1", "oracle", "completed", events, record);

    expect(result.outcome).toBe("success");
    expect(result.nextStage).toBe(DispatchStage.Scouted);
    expect(result.artifacts.passed).toBe(true);
    expect(result.incrementFailure).toBe(false);
    expect(result.resetFailures).toBe(true);
    expect(result.laborCleanup).toBeNull();
    expect(result.mergeCandidate).toBeNull();
  });

  it("reaps an Oracle with missing assessment as artifact_failure", () => {
    const events = makeEvents(["some random text"]);
    const record = makeRecord("issue-1", DispatchStage.Scouting);

    const result = reaper.reap("issue-1", "oracle", "completed", events, record);

    expect(result.artifacts.passed).toBe(false);
    expect(result.nextStage).toBe(DispatchStage.Failed);
    expect(result.incrementFailure).toBe(true);
  });

  it("detects Oracle write violations", () => {
    const events = makeEvents([oracleAssessmentJson()], ["write_file"]);
    const record = makeRecord("issue-1", DispatchStage.Scouting);

    const result = reaper.reap("issue-1", "oracle", "completed", events, record);

    // Assessment is valid but write violations make artifact check fail
    const writeCheck = result.artifacts.checks.find((c) => c.name === "no_write_violations");
    expect(writeCheck).toBeDefined();
    expect(writeCheck!.passed).toBe(false);
    expect(result.artifacts.passed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. ReaperImpl — Titan reap
// ---------------------------------------------------------------------------

describe("ReaperImpl — Titan", () => {
  const reaper = new ReaperImpl();

  it("reaps a successful Titan with handoff artifact", () => {
    const events = makeEvents([titanHandoffJson()], ["write_file", "edit"]);
    const record = makeRecord("issue-1", DispatchStage.Implementing);
    record.runningAgent = { ...record.runningAgent!, caste: "titan" };

    const result = reaper.reap("issue-1", "titan", "completed", events, record);

    expect(result.outcome).toBe("success");
    expect(result.nextStage).toBe(DispatchStage.Implemented);
    expect(result.artifacts.passed).toBe(true);
    expect(result.laborCleanup).not.toBeNull();
    expect(result.laborCleanup!.removeWorktree).toBe(false);
    expect(result.laborCleanup!.deleteBranch).toBe(false);
    expect(result.laborCleanup!.reason).toBe("titan_success_preserve_for_merge_queue");
  });

  it("produces a merge candidate instruction on Titan success", () => {
    const events = makeEvents([titanHandoffJson()], ["write_file"]);
    const record = makeRecord("issue-1", DispatchStage.Implementing);
    record.runningAgent = { ...record.runningAgent!, caste: "titan" };

    const result = reaper.reap("issue-1", "titan", "completed", events, record);

    expect(result.mergeCandidate).not.toBeNull();
    expect(result.mergeCandidate!.issueId).toBe("issue-1");
    expect(result.mergeCandidate!.candidateBranch).toBe("aegis/aegis-fjm.10");
    expect(result.mergeCandidate!.targetBranch).toBe("main");
  });

  it("reaps a Titan with no file changes as artifact_failure", () => {
    const events = makeEvents([titanHandoffJson()], []);
    const record = makeRecord("issue-1", DispatchStage.Implementing);
    record.runningAgent = { ...record.runningAgent!, caste: "titan" };

    const result = reaper.reap("issue-1", "titan", "completed", events, record);

    expect(result.artifacts.passed).toBe(false);
    expect(result.nextStage).toBe(DispatchStage.Failed);
  });
});

// ---------------------------------------------------------------------------
// 3. ReaperImpl — Sentinel reap
// ---------------------------------------------------------------------------

describe("ReaperImpl — Sentinel", () => {
  const reaper = new ReaperImpl();

  it("reaps a Sentinel pass as success (valid verdict artifact)", () => {
    const events = makeEvents([sentinelVerdictJson("pass")]);
    const record = makeRecord("issue-1", DispatchStage.Reviewing);
    record.runningAgent = { ...record.runningAgent!, caste: "sentinel" };

    const result = reaper.reap("issue-1", "sentinel", "completed", events, record);

    // The reaper verifies that a verdict artifact exists but doesn't parse
    // the verdict value itself. computeNextStage returns Failed for sentinel
    // without the verdict param — the caller (runSentinel) handles that.
    expect(result.outcome).toBe("success");
    expect(result.artifacts.passed).toBe(true);
    expect(result.laborCleanup).toBeNull();
  });

  it("reaps a Sentinel fail as success (verdict valid) → failed stage", () => {
    // The verdict itself is valid — the session succeeded at its job.
    // But the verdict is "fail" so the next stage is failed.
    const events = makeEvents([sentinelVerdictJson("fail")]);
    const record = makeRecord("issue-1", DispatchStage.Reviewing);
    record.runningAgent = { ...record.runningAgent!, caste: "sentinel" };

    const result = reaper.reap("issue-1", "sentinel", "completed", events, record);

    // Reaper extracts the sentinel verdict and passes it to computeNextStage.
    // A "fail" verdict produces outcome="success" (sentinel did its job) but
    // nextStage=Failed because the underlying PR was rejected.
    expect(result.outcome).toBe("success");
    expect(result.artifacts.passed).toBe(true);
    expect(result.nextStage).toBe(DispatchStage.Failed);
    expect(result.incrementFailure).toBe(true);
  });

  it("reaps a crashed Sentinel as crash → failed", () => {
    const events = makeEvents([]);
    const record = makeRecord("issue-1", DispatchStage.Reviewing);
    record.runningAgent = { ...record.runningAgent!, caste: "sentinel" };

    const result = reaper.reap("issue-1", "sentinel", "error", events, record);

    expect(result.outcome).toBe("crash");
    expect(result.nextStage).toBe(DispatchStage.Failed);
    expect(result.incrementFailure).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. ReaperImpl — monitor termination and crash
// ---------------------------------------------------------------------------

describe("ReaperImpl — monitor termination and crash", () => {
  const reaper = new ReaperImpl();

  it("reaps a budget_exceeded session as monitor_termination", () => {
    const record = makeRecord("issue-1", DispatchStage.Scouting);
    const result = reaper.reap("issue-1", "oracle", "budget_exceeded", [], record);

    expect(result.outcome).toBe("monitor_termination");
    expect(result.nextStage).toBe(DispatchStage.Failed);
    expect(result.incrementFailure).toBe(true);
  });

  it("reaps a stuck_killed session as monitor_termination", () => {
    const record = makeRecord("issue-1", DispatchStage.Implementing);
    record.runningAgent = { ...record.runningAgent!, caste: "titan" };
    const result = reaper.reap("issue-1", "titan", "stuck_killed", [], record);

    expect(result.outcome).toBe("monitor_termination");
    expect(result.nextStage).toBe(DispatchStage.Failed);
  });

  it("reaps an error session as crash", () => {
    const record = makeRecord("issue-1", DispatchStage.Scouting);
    const result = reaper.reap("issue-1", "oracle", "error", [], record);

    expect(result.outcome).toBe("crash");
    expect(result.nextStage).toBe(DispatchStage.Failed);
  });

  it("emits monitor events for monitor_termination", () => {
    const record = makeRecord("issue-1", DispatchStage.Scouting);
    const result = reaper.reap("issue-1", "oracle", "budget_exceeded", [], record);

    expect(result.monitorEvents.length).toBeGreaterThan(0);
    expect(result.monitorEvents[0].type).toBe("session_aborted_by_monitor");
    expect(result.monitorEvents[0].issueId).toBe("issue-1");
  });

  it("emits monitor events for crash", () => {
    const record = makeRecord("issue-1", DispatchStage.Scouting);
    const result = reaper.reap("issue-1", "oracle", "error", [], record);

    expect(result.monitorEvents.length).toBeGreaterThan(0);
    expect(result.monitorEvents[0].type).toBe("session_aborted_by_monitor");
  });
});

// ---------------------------------------------------------------------------
// 5. Failure accounting
// ---------------------------------------------------------------------------

describe("applyFailureAccounting", () => {
  it("resets consecutiveFailures and cooldown on success", () => {
    const record: DispatchRecord = {
      ...makeRecord("issue-1", DispatchStage.Failed),
      failureCount: 5,
      consecutiveFailures: 3,
      cooldownUntil: new Date(Date.now() + 1000).toISOString(),
    };

    const updated = applyFailureAccounting(record, false, true, NOW);

    expect(updated.consecutiveFailures).toBe(0);
    expect(updated.cooldownUntil).toBeNull();
    expect(updated.failureCount).toBe(5); // cumulative NOT reset
  });

  it("increments failureCount and consecutiveFailures on failure", () => {
    const record = makeRecord("issue-1", DispatchStage.Failed);

    const updated = applyFailureAccounting(record, true, false, NOW);

    expect(updated.failureCount).toBe(1);
    expect(updated.consecutiveFailures).toBe(1);
  });

  it("triggers cooldown after 3 consecutive failures", () => {
    const record: DispatchRecord = {
      ...makeRecord("issue-1", DispatchStage.Failed),
      consecutiveFailures: 2,
      failureCount: 2,
    };

    const updated = applyFailureAccounting(record, true, false, NOW);

    expect(updated.consecutiveFailures).toBe(3);
    expect(updated.failureCount).toBe(3);
    expect(updated.cooldownUntil).not.toBeNull();
    expect(new Date(updated.cooldownUntil!).getTime()).toBeGreaterThan(NOW);
  });

  it("does not trigger cooldown for 2 failures", () => {
    const record = makeRecord("issue-1", DispatchStage.Failed);

    const updated1 = applyFailureAccounting(record, true, false, NOW);
    const updated2 = applyFailureAccounting(updated1, true, false, NOW);

    expect(updated2.consecutiveFailures).toBe(2);
    expect(updated2.cooldownUntil).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6. updateRecordFromReaper
// ---------------------------------------------------------------------------

describe("updateRecordFromReaper", () => {
  it("applies stage transition and clears runningAgent", () => {
    const record = makeRecord("issue-1", DispatchStage.Scouting);
    const result: ReaperResult = {
      issueId: "issue-1",
      outcome: "success",
      endReason: "completed",
      nextStage: DispatchStage.Scouted,
      artifacts: { issueId: "issue-1", caste: "oracle", passed: true, checks: [] },
      incrementFailure: false,
      resetFailures: true,
      laborCleanup: null,
      mergeCandidate: null,
      monitorEvents: [],
    };

    const updated = updateRecordFromReaper(record, result, NOW);

    expect(updated.stage).toBe(DispatchStage.Scouted);
    expect(updated.runningAgent).toBeNull();
    expect(updated.consecutiveFailures).toBe(0);
  });

  it("applies failure accounting on failed outcome", () => {
    const record = makeRecord("issue-1", DispatchStage.Scouting);
    const result: ReaperResult = {
      issueId: "issue-1",
      outcome: "crash",
      endReason: "error",
      nextStage: DispatchStage.Failed,
      artifacts: { issueId: "issue-1", caste: "oracle", passed: false, checks: [] },
      incrementFailure: true,
      resetFailures: false,
      laborCleanup: null,
      mergeCandidate: null,
      monitorEvents: [],
    };

    const updated = updateRecordFromReaper(record, result, NOW);

    expect(updated.stage).toBe(DispatchStage.Failed);
    expect(updated.runningAgent).toBeNull();
    expect(updated.failureCount).toBe(1);
    expect(updated.consecutiveFailures).toBe(1);
  });

  it("does not mutate the original record", () => {
    const record = makeRecord("issue-1", DispatchStage.Scouting);
    const originalStage = record.stage;
    const originalAgent = record.runningAgent;
    const result: ReaperResult = {
      issueId: "issue-1",
      outcome: "success",
      endReason: "completed",
      nextStage: DispatchStage.Scouted,
      artifacts: { issueId: "issue-1", caste: "oracle", passed: true, checks: [] },
      incrementFailure: false,
      resetFailures: true,
      laborCleanup: null,
      mergeCandidate: null,
      monitorEvents: [],
    };

    updateRecordFromReaper(record, result, NOW);

    expect(record.stage).toBe(originalStage);
    expect(record.runningAgent).toBe(originalAgent);
  });
});

// ---------------------------------------------------------------------------
// 7. Lethe pruning decisions
// ---------------------------------------------------------------------------

describe("shouldRunLethePruning", () => {
  it("returns true for success when pruning is enabled", () => {
    expect(shouldRunLethePruning("success", true)).toBe(true);
  });

  it("returns false for success when pruning is disabled", () => {
    expect(shouldRunLethePruning("success", false)).toBe(false);
  });

  it("returns false for artifact_failure", () => {
    expect(shouldRunLethePruning("artifact_failure", true)).toBe(false);
  });

  it("returns false for monitor_termination", () => {
    expect(shouldRunLethePruning("monitor_termination", true)).toBe(false);
  });

  it("returns false for crash", () => {
    expect(shouldRunLethePruning("crash", true)).toBe(false);
  });

  it("defaults pruneOnSuccess to true", () => {
    expect(shouldRunLethePruning("success")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8. Unknown caste handling
// ---------------------------------------------------------------------------

describe("ReaperImpl — unknown caste", () => {
  const reaper = new ReaperImpl();

  it("reaps an unknown caste as artifact_failure", () => {
    const record = makeRecord("issue-1", DispatchStage.Pending);
    const result = reaper.reap("issue-1", "janus", "completed", [], record);

    expect(result.artifacts.passed).toBe(false);
    expect(result.nextStage).toBe(DispatchStage.Failed);
  });
});
