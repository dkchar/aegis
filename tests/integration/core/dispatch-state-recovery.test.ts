/**
 * S04 integration gate — dispatch-state load/save/recover tests.
 *
 * Covers loadDispatchState, saveDispatchState, and reconcileDispatchState.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  emptyDispatchState,
  loadDispatchState,
  saveDispatchState,
  reconcileDispatchState,
} from "../../../src/core/dispatch-state.js";
import { DispatchStage, transitionStage } from "../../../src/core/stage-transition.js";
import type { DispatchRecord, DispatchState } from "../../../src/core/dispatch-state.js";

// ---------------------------------------------------------------------------
// Helper — minimal DispatchRecord fixture
// ---------------------------------------------------------------------------

function makeRecord(
  issueId: string,
  stage: DispatchStage = DispatchStage.Pending,
  sessionProvenanceId = "session-abc",
): DispatchRecord {
  return {
    issueId,
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
    sessionProvenanceId,
    updatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Temp directory management
// ---------------------------------------------------------------------------

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "aegis-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 1. Empty state initialisation
// ---------------------------------------------------------------------------

describe("emptyDispatchState", () => {
  it("returns a valid DispatchState with no records", () => {
    const state = emptyDispatchState();

    expect(state.schemaVersion).toBe(1);
    expect(state.records).toEqual({});
  });

  it("returns a fresh object on every call", () => {
    const a = emptyDispatchState();
    const b = emptyDispatchState();

    expect(a).not.toBe(b);
    expect(a.records).not.toBe(b.records);
  });
});

// ---------------------------------------------------------------------------
// 2. Load / save round-trip
// ---------------------------------------------------------------------------

describe("load/save round-trip", () => {
  it("saves a DispatchState to disk and reloads it with identical content", () => {
    const record = makeRecord("issue-1", DispatchStage.Scouting);
    const state: DispatchState = {
      schemaVersion: 1,
      records: { "issue-1": record },
    };

    saveDispatchState(tempDir, state);
    const loaded = loadDispatchState(tempDir);

    expect(loaded).toEqual(state);
  });

  it("save is atomic: write-then-rename strategy is used", () => {
    // After a successful save the .tmp file must not exist (rename completed)
    const state = emptyDispatchState();
    saveDispatchState(tempDir, state);

    const tmpPath = join(tempDir, ".aegis", "dispatch-state.json.tmp");
    expect(existsSync(tmpPath)).toBe(false);

    const finalPath = join(tempDir, ".aegis", "dispatch-state.json");
    expect(existsSync(finalPath)).toBe(true);
  });

  it("load returns emptyDispatchState when file does not exist", () => {
    const loaded = loadDispatchState(tempDir);
    expect(loaded).toEqual(emptyDispatchState());
  });

  it("load throws a clear error when the file contains malformed JSON", () => {
    const aegisDir = join(tempDir, ".aegis");
    mkdirSync(aegisDir, { recursive: true });
    writeFileSync(join(aegisDir, "dispatch-state.json"), "{ not valid json !!!");

    expect(() => loadDispatchState(tempDir)).toThrow();
  });

  it("load rejects an unknown schemaVersion", () => {
    const aegisDir = join(tempDir, ".aegis");
    mkdirSync(aegisDir, { recursive: true });
    writeFileSync(
      join(aegisDir, "dispatch-state.json"),
      JSON.stringify({ schemaVersion: 99, records: {} }),
    );

    expect(() => loadDispatchState(tempDir)).toThrow(/schemaVersion/i);
  });

  it("save creates the .aegis directory if it does not exist", () => {
    const state = emptyDispatchState();
    // tempDir has no .aegis subdirectory at this point
    saveDispatchState(tempDir, state);

    const finalPath = join(tempDir, ".aegis", "dispatch-state.json");
    expect(existsSync(finalPath)).toBe(true);
  });

  it("saved file is pretty-printed JSON (2-space indent)", () => {
    const state = emptyDispatchState();
    saveDispatchState(tempDir, state);

    const raw = readFileSync(join(tempDir, ".aegis", "dispatch-state.json"), "utf-8");
    // Pretty-printed JSON has newlines
    expect(raw).toContain("\n");
    // Re-parsing must match
    expect(JSON.parse(raw)).toEqual(state);
  });

  it("round-trips a state with multiple records", () => {
    const state: DispatchState = {
      schemaVersion: 1,
      records: {
        "issue-1": makeRecord("issue-1", DispatchStage.Pending),
        "issue-2": makeRecord("issue-2", DispatchStage.Implementing),
        "issue-3": makeRecord("issue-3", DispatchStage.Complete),
      },
    };

    saveDispatchState(tempDir, state);
    const loaded = loadDispatchState(tempDir);

    expect(loaded).toEqual(state);
    expect(Object.keys(loaded.records)).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// 3. Crash recovery reconciliation
// ---------------------------------------------------------------------------

describe("reconcileDispatchState", () => {
  it("clears runningAgent from in-progress records owned by a dead session", () => {
    const record: DispatchRecord = {
      ...makeRecord("issue-1", DispatchStage.Implementing, "old-session"),
      runningAgent: {
        caste: "titan",
        sessionId: "pi-session-old",
        startedAt: new Date().toISOString(),
      },
    };
    const state: DispatchState = { schemaVersion: 1, records: { "issue-1": record } };

    const reconciled = reconcileDispatchState(state, "new-session");

    expect(reconciled.records["issue-1"].runningAgent).toBeNull();
    expect(reconciled.records["issue-1"].sessionProvenanceId).toBe("new-session");
  });

  it("preserves runningAgent for records owned by the live session", () => {
    const agent = {
      caste: "titan" as const,
      sessionId: "pi-session-live",
      startedAt: new Date().toISOString(),
    };
    const record: DispatchRecord = {
      ...makeRecord("issue-1", DispatchStage.Implementing, "live-session"),
      runningAgent: agent,
    };
    const state: DispatchState = { schemaVersion: 1, records: { "issue-1": record } };

    const reconciled = reconcileDispatchState(state, "live-session");

    expect(reconciled.records["issue-1"].runningAgent).toEqual(agent);
  });

  it("reconciliation preserves stage — it does not reset in-progress stages (SPECv2 §6.3)", () => {
    const record: DispatchRecord = {
      ...makeRecord("issue-1", DispatchStage.Implementing, "old-session"),
      runningAgent: {
        caste: "titan",
        sessionId: "pi-session-old",
        startedAt: new Date().toISOString(),
      },
    };
    const state: DispatchState = { schemaVersion: 1, records: { "issue-1": record } };

    const reconciled = reconcileDispatchState(state, "new-session");

    expect(reconciled.records["issue-1"].stage).toBe(DispatchStage.Implementing);
  });

  it("leaves complete and failed records untouched during reconciliation", () => {
    const completeRecord = makeRecord("issue-complete", DispatchStage.Complete, "old-session");
    const failedRecord = makeRecord("issue-failed", DispatchStage.Failed, "old-session");
    const state: DispatchState = {
      schemaVersion: 1,
      records: {
        "issue-complete": completeRecord,
        "issue-failed": failedRecord,
      },
    };

    const reconciled = reconcileDispatchState(state, "new-session");

    expect(reconciled.records["issue-complete"]).toEqual(completeRecord);
    expect(reconciled.records["issue-failed"]).toEqual(failedRecord);
  });

  it("handles empty state without error", () => {
    const state = emptyDispatchState();
    const reconciled = reconcileDispatchState(state, "any-session");

    expect(reconciled).toEqual(state);
    expect(reconciled).not.toBe(state); // must be a new object
  });

  it("returns a new copy of the state (immutable)", () => {
    const record: DispatchRecord = {
      ...makeRecord("issue-1", DispatchStage.Scouting, "old-session"),
      runningAgent: {
        caste: "oracle",
        sessionId: "pi-session-old",
        startedAt: new Date().toISOString(),
      },
    };
    const state: DispatchState = { schemaVersion: 1, records: { "issue-1": record } };

    const reconciled = reconcileDispatchState(state, "new-session");

    // Original is not mutated
    expect(state.records["issue-1"].runningAgent).not.toBeNull();
    expect(reconciled.records["issue-1"].runningAgent).toBeNull();
    expect(reconciled).not.toBe(state);
  });

  it("reconciles all in-progress stages: scouting, implementing, merging, reviewing, resolving_integration", () => {
    const inProgressStages = [
      DispatchStage.Scouting,
      DispatchStage.Implementing,
      DispatchStage.Merging,
      DispatchStage.Reviewing,
      DispatchStage.ResolvingIntegration,
    ];

    const records: Record<string, DispatchRecord> = {};
    for (const stage of inProgressStages) {
      const id = `issue-${stage}`;
      records[id] = {
        ...makeRecord(id, stage, "old-session"),
        runningAgent: {
          caste: "titan",
          sessionId: "pi-old",
          startedAt: new Date().toISOString(),
        },
      };
    }
    const state: DispatchState = { schemaVersion: 1, records };

    const reconciled = reconcileDispatchState(state, "new-session");

    for (const stage of inProgressStages) {
      const id = `issue-${stage}`;
      expect(reconciled.records[id].runningAgent).toBeNull();
      expect(reconciled.records[id].stage).toBe(stage);
    }
  });

  it("does not alter non-in-progress records (pending, scouted, implemented, queued_for_merge, merged)", () => {
    const stableStages = [
      DispatchStage.Pending,
      DispatchStage.Scouted,
      DispatchStage.Implemented,
      DispatchStage.QueuedForMerge,
      DispatchStage.Merged,
    ];

    const records: Record<string, DispatchRecord> = {};
    for (const stage of stableStages) {
      const id = `issue-${stage}`;
      records[id] = makeRecord(id, stage, "old-session");
    }
    const state: DispatchState = { schemaVersion: 1, records };

    const reconciled = reconcileDispatchState(state, "new-session");

    for (const stage of stableStages) {
      const id = `issue-${stage}`;
      expect(reconciled.records[id]).toEqual(state.records[id]);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Stage transition persistence (integration smoke)
// ---------------------------------------------------------------------------

describe("stage transitions persist correctly", () => {
  it("a pending → scouting transition is recoverable after save/load", () => {
    const record = makeRecord("issue-1", DispatchStage.Pending);
    const scouting = transitionStage(record, DispatchStage.Scouting);
    const state: DispatchState = { schemaVersion: 1, records: { "issue-1": scouting } };

    saveDispatchState(tempDir, state);
    const loaded = loadDispatchState(tempDir);

    expect(loaded.records["issue-1"].stage).toBe(DispatchStage.Scouting);
  });

  it("a full happy-path sequence persists all intermediate stages", () => {
    const happyPath = [
      DispatchStage.Pending,
      DispatchStage.Scouting,
      DispatchStage.Scouted,
      DispatchStage.Implementing,
      DispatchStage.Implemented,
      DispatchStage.QueuedForMerge,
      DispatchStage.Merging,
      DispatchStage.Merged,
      DispatchStage.Reviewing,
      DispatchStage.Complete,
    ];

    let record = makeRecord("issue-1", DispatchStage.Pending);
    for (let i = 1; i < happyPath.length; i++) {
      record = transitionStage(record, happyPath[i]);
      const state: DispatchState = { schemaVersion: 1, records: { "issue-1": record } };
      saveDispatchState(tempDir, state);
      const loaded = loadDispatchState(tempDir);
      expect(loaded.records["issue-1"].stage).toBe(happyPath[i]);
    }

    const finalState = loadDispatchState(tempDir);
    expect(finalState.records["issue-1"].stage).toBe(DispatchStage.Complete);
  });
});

// ---------------------------------------------------------------------------
// 5. Cooldown state persists
// ---------------------------------------------------------------------------

describe("cooldown state persists", () => {
  it("a record with cooldownUntil set survives save/load round-trip", () => {
    const futureTs = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const record: DispatchRecord = {
      ...makeRecord("issue-1", DispatchStage.Failed),
      cooldownUntil: futureTs,
      consecutiveFailures: 3,
    };
    const state: DispatchState = { schemaVersion: 1, records: { "issue-1": record } };

    saveDispatchState(tempDir, state);
    const loaded = loadDispatchState(tempDir);

    expect(loaded.records["issue-1"].cooldownUntil).toBe(futureTs);
    expect(loaded.records["issue-1"].consecutiveFailures).toBe(3);
  });

  it("cooldownUntil is not cleared by reconcile", () => {
    const futureTs = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const record: DispatchRecord = {
      ...makeRecord("issue-1", DispatchStage.Failed, "old-session"),
      cooldownUntil: futureTs,
    };
    const state: DispatchState = { schemaVersion: 1, records: { "issue-1": record } };

    const reconciled = reconcileDispatchState(state, "new-session");

    expect(reconciled.records["issue-1"].cooldownUntil).toBe(futureTs);
  });

  it("a record past its cooldown window preserves the cooldownUntil value (policy enforcement is caller's responsibility)", () => {
    // The dispatch-state module stores the value; the orchestrator decides
    // whether cooldown has expired. This test verifies the stored value is intact.
    const pastTs = new Date(Date.now() - 1000).toISOString();
    const record: DispatchRecord = {
      ...makeRecord("issue-1", DispatchStage.Failed),
      cooldownUntil: pastTs,
    };
    const state: DispatchState = { schemaVersion: 1, records: { "issue-1": record } };

    saveDispatchState(tempDir, state);
    const loaded = loadDispatchState(tempDir);

    expect(loaded.records["issue-1"].cooldownUntil).toBe(pastTs);
  });
});
