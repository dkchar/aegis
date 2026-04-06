/**
 * S10 Lane B — Monitor + Reaper integration tests.
 *
 * Validates the full reaper flow with failure accounting, cooldown
 * persistence, and recovery reconciliation.
 * SPECv2 §9.7, §6.4, §6.5
 *
 * Automated gate for S10:
 *   npm run test -- tests/unit/core/cooldown-policy.test.ts tests/integration/core/monitor-reaper.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ReaperImpl, applyFailureAccounting, updateRecordFromReaper } from "../../../src/core/reaper-impl.js";
import { RecoveryImpl } from "../../../src/core/recovery-impl.js";
import {
  recordFailure,
  shouldTriggerCooldown,
  computeCooldownUntil,
  canRedispatch,
  resetFailures,
  COOLDOWN_SUPPRESSION_MS,
} from "../../../src/core/cooldown-policy.js";
import {
  findInProgressRecords,
  summarizeRecovery,
  canRedispatchAfterRecovery,
} from "../../../src/core/recovery.js";
import {
  loadDispatchState,
  saveDispatchState,
  reconcileDispatchState,
  emptyDispatchState,
} from "../../../src/core/dispatch-state.js";
import { DispatchStage } from "../../../src/core/stage-transition.js";
import type { DispatchRecord, DispatchState } from "../../../src/core/dispatch-state.js";
import type { AgentEvent } from "../../../src/runtime/agent-events.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "aegis-s10-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

const NOW = Date.now();

function makeRecord(
  issueId: string,
  stage: DispatchStage = DispatchStage.Scouting,
  caste: "oracle" | "titan" | "sentinel" | null = null,
): DispatchRecord {
  return {
    issueId,
    stage,
    runningAgent: caste
      ? {
          caste,
          sessionId: `session-${issueId}`,
          startedAt: new Date().toISOString(),
        }
      : null,
    oracleAssessmentRef: null,
    sentinelVerdictRef: null,
    failureCount: 0,
    consecutiveFailures: 0,
    failureWindowStartMs: null,
    cooldownUntil: null,
    cumulativeSpendUsd: null,
    sessionProvenanceId: "test-session",
    updatedAt: new Date().toISOString(),
  };
}

function makeEvents(messages: string[] = [], toolUses: string[] = []): AgentEvent[] {
  const events: AgentEvent[] = [];
  for (const text of messages) {
    events.push({
      type: "message" as const,
      timestamp: new Date().toISOString(),
      issueId: "test-issue",
      caste: "oracle" as const,
      text,
    });
  }
  for (const tool of toolUses) {
    events.push({
      type: "tool_use" as const,
      timestamp: new Date().toISOString(),
      issueId: "test-issue",
      caste: "oracle" as const,
      tool,
    });
  }
  return events;
}

// ---------------------------------------------------------------------------
// 1. Full reaper flow — Oracle happy path
// ---------------------------------------------------------------------------

describe("Reaper full flow — Oracle happy path", () => {
  it("reaps Oracle success, resets failures, persists state", () => {
    const reaper = new ReaperImpl();
    const assessment = JSON.stringify({
      files_affected: ["src/core/foo.ts"],
      estimated_complexity: "moderate",
      decompose: false,
      ready: true,
    });
    const events = makeEvents([assessment]);
    const record = makeRecord("issue-1", DispatchStage.Scouting, "oracle");

    // Simulate a previous failure that was reset
    record.consecutiveFailures = 2;
    record.failureCount = 2;

    const result = reaper.reap("issue-1", "oracle", "completed", events, record);
    const updated = updateRecordFromReaper(record, result, NOW);

    expect(result.outcome).toBe("success");
    expect(result.nextStage).toBe(DispatchStage.Scouted);
    expect(updated.stage).toBe(DispatchStage.Scouted);
    expect(updated.runningAgent).toBeNull();
    expect(updated.consecutiveFailures).toBe(0);
    expect(updated.cooldownUntil).toBeNull();
    expect(updated.failureCount).toBe(2); // cumulative preserved
  });
});

// ---------------------------------------------------------------------------
// 2. Full reaper flow — Titan failure with cooldown
// ---------------------------------------------------------------------------

describe("Reaper full flow — Titan failure with cooldown", () => {
  it("three Titan failures trigger cooldown, persisted to dispatch state", () => {
    const reaper = new ReaperImpl();
    let record = makeRecord("issue-1", DispatchStage.Implementing, "titan");
    const events = makeEvents([]); // No handoff — artifact failure

    // Failure 1
    let result = reaper.reap("issue-1", "titan", "error", events, record);
    record = updateRecordFromReaper(record, result, NOW);
    expect(record.consecutiveFailures).toBe(1);
    expect(record.cooldownUntil).toBeNull();

    // Reset to implementing for retry
    record = { ...record, stage: DispatchStage.Implementing };

    // Failure 2
    result = reaper.reap("issue-1", "titan", "error", events, record);
    record = updateRecordFromReaper(record, result, NOW + 60_000);
    expect(record.consecutiveFailures).toBe(2);
    expect(record.cooldownUntil).toBeNull();

    // Reset for retry
    record = { ...record, stage: DispatchStage.Implementing };

    // Failure 3 — triggers cooldown
    result = reaper.reap("issue-1", "titan", "error", events, record);
    record = updateRecordFromReaper(record, result, NOW + 120_000);
    expect(record.consecutiveFailures).toBe(3);
    expect(record.cooldownUntil).not.toBeNull();
    expect(record.failureCount).toBe(3);

    // Persist and reload
    const state: DispatchState = {
      schemaVersion: 1,
      records: { "issue-1": record },
    };
    saveDispatchState(tempDir, state);
    const loaded = loadDispatchState(tempDir);

    expect(loaded.records["issue-1"].cooldownUntil).toBe(record.cooldownUntil);
    expect(loaded.records["issue-1"].consecutiveFailures).toBe(3);

    // Cannot re-dispatch during cooldown
    expect(
      canRedispatch(
        loaded.records["issue-1"].consecutiveFailures,
        loaded.records["issue-1"].cooldownUntil,
        false,
        NOW + 120_000,
      ),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Cooldown expiry and re-dispatch
// ---------------------------------------------------------------------------

describe("Cooldown expiry and re-dispatch", () => {
  it("allows re-dispatch after cooldown expires and failures are reset", () => {
    const reaper = new ReaperImpl();
    let record = makeRecord("issue-1", DispatchStage.Implementing, "titan");

    // Simulate 3 failures
    for (let i = 0; i < 3; i++) {
      const result = reaper.reap(
        "issue-1",
        "titan",
        "error",
        makeEvents([]),
        { ...record, stage: DispatchStage.Implementing },
      );
      record = updateRecordFromReaper(record, result, NOW + i * 60_000);
    }

    expect(record.cooldownUntil).not.toBeNull();

    // After cooldown expires + failures reset
    const afterCooldown = NOW + 3 * 60_000 + COOLDOWN_SUPPRESSION_MS + 1_000;
    const [resetFailuresCount] = resetFailures();

    expect(canRedispatch(resetFailuresCount, null, false, afterCooldown)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Manual restart override
// ---------------------------------------------------------------------------

describe("Manual restart override", () => {
  it("overrides cooldown and allows re-dispatch", () => {
    const reaper = new ReaperImpl();
    let record = makeRecord("issue-1", DispatchStage.Implementing, "titan");

    // 3 failures
    for (let i = 0; i < 3; i++) {
      const result = reaper.reap(
        "issue-1",
        "titan",
        "error",
        makeEvents([]),
        { ...record, stage: DispatchStage.Implementing },
      );
      record = updateRecordFromReaper(record, result, NOW + i * 60_000);
    }

    expect(record.cooldownUntil).not.toBeNull();

    // Manual restart overrides cooldown
    expect(
      canRedispatch(record.consecutiveFailures, record.cooldownUntil, true, NOW),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. Restart recovery reconciliation
// ---------------------------------------------------------------------------

describe("Restart recovery reconciliation", () => {
  it("reconciles dead agents and persists updated state", () => {
    // Set up state with in-progress records
    const state: DispatchState = {
      schemaVersion: 1,
      records: {
        "issue-1": makeRecord("issue-1", DispatchStage.Scouting, "oracle"),
        "issue-2": makeRecord("issue-2", DispatchStage.Implementing, "titan"),
      },
    };
    saveDispatchState(tempDir, state);

    // Load and reconcile
    const loaded = loadDispatchState(tempDir);
    const reconciled = reconcileDispatchState(loaded, "new-session");

    // Both should have runningAgent cleared
    expect(reconciled.records["issue-1"].runningAgent).toBeNull();
    expect(reconciled.records["issue-2"].runningAgent).toBeNull();
    expect(reconciled.records["issue-1"].stage).toBe(DispatchStage.Scouting);
    expect(reconciled.records["issue-2"].stage).toBe(DispatchStage.Implementing);

    // Persist reconciled state
    saveDispatchState(tempDir, reconciled);
    const reloaded = loadDispatchState(tempDir);

    expect(reloaded.records["issue-1"].runningAgent).toBeNull();
    expect(reloaded.records["issue-2"].runningAgent).toBeNull();
  });

  it("recovery report identifies dead agents and can-redispatch status", () => {
    const state: DispatchState = {
      schemaVersion: 1,
      records: {
        "issue-1": makeRecord("issue-1", DispatchStage.Scouting, "oracle"),
      },
    };

    const recovery = new RecoveryImpl({
      sessionAliveCheck: () => false,
      hasArtifactsCheck: () => true,
    });

    const report = recovery.runRecovery(state, "new-session");

    expect(report.agentReconciliations).toHaveLength(1);
    const agent = report.agentReconciliations[0];
    expect(agent.status).toBe("dead_with_artifacts");
    expect(agent.shouldFail).toBe(true);
    // canRedispatch is based on the current record which still has runningAgent,
    // so it returns false until the runningAgent is cleared by reconcileDispatchState
    expect(agent.canRedispatch).toBe(false);

    // After reconcileDispatchState clears runningAgent, canRedispatchAfterRecovery returns true
    const reconciled = reconcileDispatchState(state, "new-session");
    expect(canRedispatchAfterRecovery(reconciled.records["issue-1"])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. Labor preservation on Titan failure
// ---------------------------------------------------------------------------

describe("Labor preservation on Titan failure", () => {
  it("reaper instructs labor preservation on Titan failure", () => {
    const reaper = new ReaperImpl();
    const record = makeRecord("issue-1", DispatchStage.Implementing, "titan");

    const result = reaper.reap("issue-1", "titan", "error", [], record);

    expect(result.laborCleanup).not.toBeNull();
    expect(result.laborCleanup!.removeWorktree).toBe(false);
    expect(result.laborCleanup!.deleteBranch).toBe(false);
    expect(result.laborCleanup!.reason).toBe("titan_failure_preserve_for_diagnostics");
  });

  it("reaper instructs labor preservation on Titan success (for merge queue)", () => {
    const reaper = new ReaperImpl();
    const handoff = JSON.stringify({
      issueId: "issue-1",
      laborPath: ".aegis/labors/labor-issue-1",
      candidateBranch: "aegis/issue-1",
      baseBranch: "main",
      filesChanged: ["src/foo.ts"],
      testsAndChecksRun: [],
      knownRisks: [],
      followUpWork: [],
      learningsWrittenToMnemosyne: [],
    });
    const events = makeEvents([handoff], ["write_file"]);
    const record = makeRecord("issue-1", DispatchStage.Implementing, "titan");

    const result = reaper.reap("issue-1", "titan", "completed", events, record);

    expect(result.outcome).toBe("success");
    expect(result.artifacts.passed).toBe(true);
    expect(result.laborCleanup!.removeWorktree).toBe(false);
    expect(result.laborCleanup!.deleteBranch).toBe(false);
    expect(result.laborCleanup!.reason).toBe("titan_success_preserve_for_merge_queue");
  });
});

// ---------------------------------------------------------------------------
// 7. Oracle and Sentinel have no labor cleanup
// ---------------------------------------------------------------------------

describe("No labor cleanup for Oracle and Sentinel", () => {
  it("Oracle reap returns null labor cleanup", () => {
    const reaper = new ReaperImpl();
    const assessment = JSON.stringify({
      files_affected: ["src/foo.ts"],
      estimated_complexity: "trivial",
      decompose: false,
      ready: true,
    });
    const result = reaper.reap(
      "issue-1",
      "oracle",
      "completed",
      makeEvents([assessment]),
      makeRecord("issue-1", DispatchStage.Scouting, "oracle"),
    );

    expect(result.laborCleanup).toBeNull();
  });

  it("Sentinel reap returns null labor cleanup", () => {
    const reaper = new ReaperImpl();
    const verdict = JSON.stringify({
      verdict: "pass",
      reviewSummary: "OK",
      issuesFound: false,
      followUpIssueIds: [],
      riskAreas: [],
    });
    const result = reaper.reap(
      "issue-1",
      "sentinel",
      "completed",
      makeEvents([verdict]),
      makeRecord("issue-1", DispatchStage.Reviewing, "sentinel"),
    );

    expect(result.laborCleanup).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 8. Monitor events are collected during reaping
// ---------------------------------------------------------------------------

describe("Monitor events during reaping", () => {
  const reaper = new ReaperImpl();

  it("collects monitor events for budget_exceeded", () => {
    const record = makeRecord("issue-1", DispatchStage.Scouting, "oracle");
    const result = reaper.reap("issue-1", "oracle", "budget_exceeded", [], record);

    expect(result.monitorEvents.length).toBe(1);
    expect(result.monitorEvents[0].type).toBe("session_aborted_by_monitor");
    expect(result.monitorEvents[0].issueId).toBe("issue-1");
  });

  it("collects monitor events for stuck_killed", () => {
    const record = makeRecord("issue-1", DispatchStage.Implementing, "titan");
    const result = reaper.reap("issue-1", "titan", "stuck_killed", [], record);

    expect(result.monitorEvents.length).toBe(1);
    expect(result.monitorEvents[0].type).toBe("session_aborted_by_monitor");
  });

  it("collects monitor events for crash", () => {
    const record = makeRecord("issue-1", DispatchStage.Scouting, "oracle");
    const result = reaper.reap("issue-1", "oracle", "error", [], record);

    expect(result.monitorEvents.length).toBe(1);
    expect(result.monitorEvents[0].type).toBe("session_aborted_by_monitor");
  });

  it("no monitor events for successful completion", () => {
    const assessment = JSON.stringify({
      files_affected: ["src/foo.ts"],
      estimated_complexity: "moderate",
      decompose: false,
      ready: true,
    });
    const record = makeRecord("issue-1", DispatchStage.Scouting, "oracle");
    const result = reaper.reap("issue-1", "oracle", "completed", makeEvents([assessment]), record);

    expect(result.monitorEvents).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 9. Failure accounting — cumulative vs consecutive
// ---------------------------------------------------------------------------

describe("Failure accounting — cumulative vs consecutive", () => {
  it("cumulative failureCount is never reset on success", () => {
    const record: DispatchRecord = {
      ...makeRecord("issue-1", DispatchStage.Failed),
      failureCount: 10,
      consecutiveFailures: 3,
      cooldownUntil: new Date(Date.now() + 1000).toISOString(),
    };

    const updated = applyFailureAccounting(record, false, true, NOW);

    expect(updated.failureCount).toBe(10); // NOT reset
    expect(updated.consecutiveFailures).toBe(0);
    expect(updated.cooldownUntil).toBeNull();
  });

  it("cumulative failureCount increments on each failure", () => {
    const record = makeRecord("issue-1", DispatchStage.Failed);

    const updated1 = applyFailureAccounting(record, true, false, NOW);
    expect(updated1.failureCount).toBe(1);

    const updated2 = applyFailureAccounting(updated1, true, false, NOW + 60_000);
    expect(updated2.failureCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 10. Integration: full cycle — scout, implement, review with failures
// ---------------------------------------------------------------------------

describe("Full cycle with intermediate failures", () => {
  it("Oracle fails twice, succeeds on third attempt, pipeline continues", () => {
    const reaper = new ReaperImpl();
    let record = makeRecord("issue-1", DispatchStage.Scouting, "oracle");

    // Attempt 1: crash
    let result = reaper.reap("issue-1", "oracle", "error", [], record);
    record = updateRecordFromReaper(record, result, NOW);
    expect(record.stage).toBe(DispatchStage.Failed);
    expect(record.consecutiveFailures).toBe(1);

    // Retry: reset to pending then scouting
    record = { ...record, stage: DispatchStage.Pending };
    // (In real flow, triage would move pending → scouting)
    record = { ...record, stage: DispatchStage.Scouting };

    // Attempt 2: artifact failure (no valid assessment)
    result = reaper.reap("issue-1", "oracle", "completed", makeEvents(["garbage"]), record);
    record = updateRecordFromReaper(record, result, NOW + 60_000);
    expect(record.stage).toBe(DispatchStage.Failed);
    expect(record.consecutiveFailures).toBe(2);

    // Retry
    record = { ...record, stage: DispatchStage.Scouting };

    // Attempt 3: success
    const assessment = JSON.stringify({
      files_affected: ["src/foo.ts"],
      estimated_complexity: "moderate",
      decompose: false,
      ready: true,
    });
    result = reaper.reap("issue-1", "oracle", "completed", makeEvents([assessment]), record);
    record = updateRecordFromReaper(record, result, NOW + 120_000);
    expect(record.stage).toBe(DispatchStage.Scouted);
    expect(record.consecutiveFailures).toBe(0);
    expect(record.failureCount).toBe(2); // Cumulative from 2 failures
  });
});
