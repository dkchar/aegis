/**
 * S09 spawner — unit tests.
 *
 * Validates SPECv2 §9.5:
 *   a) createLaborWorktree plans and executes git worktree add
 *   b) removeLaborWorktree plans and executes cleanup
 *   c) Caste tool restrictions — oracle is read-only (adapter-level contract)
 *   d) resolveWorkingDirectory returns correct paths per caste
 *   e) casteToStage maps correctly
 *   f) spawnForCaste wires labor, runtime, and dispatch record together
 *   g) Git command failures throw
 */

import path from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import type { BudgetLimit } from "../../../src/config/schema.js";
import type { DispatchRecord } from "../../../src/core/dispatch-state.js";
import type { LaborCreationPlan } from "../../../src/labor/create-labor.js";
import type {
  AgentHandle,
  AgentRuntime,
  SpawnOptions,
} from "../../../src/runtime/agent-runtime.js";
import { DEFAULT_AEGIS_CONFIG } from "../../../src/config/defaults.js";
import { DispatchStage } from "../../../src/core/stage-transition.js";
import type { ReadyIssue } from "../../../src/tracker/issue-model.js";

// Import spawner modules — git execution functions will be mocked.
import {
  casteToolRestrictions,
  resolveWorkingDirectory,
  casteToStage,
  createLaborWorktree,
  removeLaborWorktree,
  spawnForCaste,
  type SpawnCaste,
  type SpawnForCasteInput,
} from "../../../src/core/spawner.js";

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

// Mock child_process to avoid actual git calls.
vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(),
}));

// We need to import the mocked module after vi.mock.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import * as cp from "node:child_process";

// Also mock planLaborCreation so we don't depend on real issue-id validation.
vi.mock("../../../src/labor/create-labor.js", () => ({
  planLaborCreation: vi.fn(),
}));

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import * as laborModule from "../../../src/labor/create-labor.js";

vi.mock("../../../src/labor/cleanup-labor.js", () => ({
  planLaborCleanup: vi.fn(),
}));

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import * as cleanupModule from "../../../src/labor/cleanup-labor.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PROJECT_ROOT = path.resolve("C:/dev/aegis");
const ISSUE_ID = "aegis-fjm.10.1";
const BASE_BRANCH = "main";
const LABOR_PATH = path.join(PROJECT_ROOT, ".aegis", "labors", `labor-${ISSUE_ID}`);
const BRANCH_NAME = `aegis/${ISSUE_ID}`;

function makeBudgetLimit(): BudgetLimit {
  return { turns: 100, tokens: 50000 };
}

function makeDispatchRecord(stage: DispatchStage): DispatchRecord {
  return {
    issueId: ISSUE_ID,
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

function makeReadyIssue(): ReadyIssue {
  return {
    id: ISSUE_ID,
    title: "Test issue",
    issueClass: "primary",
    priority: 3,
  };
}

function makeMockHandle(): AgentHandle {
  return {
    prompt: vi.fn(),
    steer: vi.fn(),
    abort: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    getStats: vi.fn(),
  };
}

function makeMockRuntime(): AgentRuntime {
  return {
    spawn: vi.fn().mockResolvedValue(makeMockHandle()),
  };
}

function makeLaborPlan(): LaborCreationPlan {
  return {
    issueId: ISSUE_ID,
    laborPath: LABOR_PATH,
    branchName: BRANCH_NAME,
    baseBranch: BASE_BRANCH,
    createWorktreeCommand: {
      command: "git",
      args: ["worktree", "add", "-b", BRANCH_NAME, LABOR_PATH, BASE_BRANCH],
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("S09 spawner — casteToolRestrictions", () => {
  it("returns empty array for oracle (adapter enforces readOnlyTools)", () => {
    expect(casteToolRestrictions("oracle")).toEqual([]);
  });

  it("returns empty array for titan (adapter enforces codingTools)", () => {
    expect(casteToolRestrictions("titan")).toEqual([]);
  });

  it("returns empty array for sentinel (adapter enforces readOnlyTools)", () => {
    expect(casteToolRestrictions("sentinel")).toEqual([]);
  });
});

describe("S09 spawner — resolveWorkingDirectory", () => {
  const laborPlan = makeLaborPlan();

  it("returns projectRoot for oracle", () => {
    expect(resolveWorkingDirectory("oracle", PROJECT_ROOT, laborPlan)).toBe(PROJECT_ROOT);
  });

  it("returns projectRoot for sentinel", () => {
    expect(resolveWorkingDirectory("sentinel", PROJECT_ROOT, laborPlan)).toBe(PROJECT_ROOT);
  });

  it("returns laborPath for titan", () => {
    expect(resolveWorkingDirectory("titan", PROJECT_ROOT, laborPlan)).toBe(LABOR_PATH);
  });

  it("throws for titan without a labor plan", () => {
    expect(() =>
      resolveWorkingDirectory("titan", PROJECT_ROOT, null),
    ).toThrow("Titan spawn requires a labor plan");
  });
});

describe("S09 spawner — casteToStage", () => {
  it("maps oracle to scouting", () => {
    expect(casteToStage("oracle")).toBe(DispatchStage.Scouting);
  });

  it("maps titan to implementing", () => {
    expect(casteToStage("titan")).toBe(DispatchStage.Implementing);
  });

  it("maps sentinel to reviewing", () => {
    expect(casteToStage("sentinel")).toBe(DispatchStage.Reviewing);
  });
});

describe("S09 spawner — createLaborWorktree", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (laborModule.planLaborCreation as ReturnType<typeof vi.fn>).mockReturnValue(
      makeLaborPlan(),
    );
    (cp.spawnSync as ReturnType<typeof vi.fn>).mockReturnValue({ status: 0 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls planLaborCreation and executes the worktree command", () => {
    const result = createLaborWorktree(ISSUE_ID, PROJECT_ROOT, BASE_BRANCH);

    expect(laborModule.planLaborCreation).toHaveBeenCalledWith({
      issueId: ISSUE_ID,
      projectRoot: PROJECT_ROOT,
      baseBranch: BASE_BRANCH,
    });

    expect(cp.spawnSync).toHaveBeenCalledWith(
      "git",
      ["worktree", "add", "-b", BRANCH_NAME, LABOR_PATH, BASE_BRANCH],
      expect.objectContaining({ cwd: PROJECT_ROOT }),
    );

    expect(result.laborPath).toBe(LABOR_PATH);
    expect(result.branchName).toBe(BRANCH_NAME);
  });

  it("throws when git worktree add fails", () => {
    (cp.spawnSync as ReturnType<typeof vi.fn>).mockReturnValue({
      status: 1,
      error: undefined,
    });

    expect(() => createLaborWorktree(ISSUE_ID, PROJECT_ROOT)).toThrow(
      /exited with status 1/,
    );
  });

  it("throws when git command errors (e.g. not a git repo)", () => {
    (cp.spawnSync as ReturnType<typeof vi.fn>).mockReturnValue({
      status: null,
      error: new Error("not a git repository"),
    });

    expect(() => createLaborWorktree(ISSUE_ID, PROJECT_ROOT)).toThrow(
      /not a git repository/,
    );
  });
});

describe("S09 spawner — removeLaborWorktree", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // planLaborCleanup returns cleanupCommands for "merged" outcome.
    (cleanupModule.planLaborCleanup as ReturnType<typeof vi.fn>).mockReturnValue({
      issueId: "",
      laborPath: LABOR_PATH,
      branchName: BRANCH_NAME,
      outcome: "merged",
      preserveLabor: false,
      removeWorktree: true,
      deleteBranch: true,
      cleanupCommands: [
        { command: "git", args: ["worktree", "remove", LABOR_PATH] },
        { command: "git", args: ["branch", "-d", BRANCH_NAME] },
      ],
    });
    (cp.spawnSync as ReturnType<typeof vi.fn>).mockReturnValue({ status: 0 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("executes worktree remove and branch delete when removeBranch=true", () => {
    removeLaborWorktree(LABOR_PATH, BRANCH_NAME, true);

    expect(cleanupModule.planLaborCleanup).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "merged" }),
    );

    expect(cp.spawnSync).toHaveBeenCalledTimes(2);
    expect(cp.spawnSync).toHaveBeenNthCalledWith(
      1,
      "git",
      ["worktree", "remove", LABOR_PATH],
      expect.any(Object),
    );
    expect(cp.spawnSync).toHaveBeenNthCalledWith(
      2,
      "git",
      ["branch", "-d", BRANCH_NAME],
      expect.any(Object),
    );
  });

  it("skips cleanup when outcome is preserve (manual_recovery)", () => {
    (cleanupModule.planLaborCleanup as ReturnType<typeof vi.fn>).mockReturnValue({
      issueId: "",
      laborPath: LABOR_PATH,
      branchName: BRANCH_NAME,
      outcome: "manual_recovery",
      preserveLabor: true,
      removeWorktree: false,
      deleteBranch: false,
      cleanupCommands: [],
    });

    removeLaborWorktree(LABOR_PATH, BRANCH_NAME, false);

    expect(cp.spawnSync).not.toHaveBeenCalled();
  });

  it("throws when a cleanup command fails", () => {
    (cp.spawnSync as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce({ status: 0 }) // worktree remove succeeds
      .mockReturnValueOnce({ status: 1 }); // branch delete fails

    expect(() => removeLaborWorktree(LABOR_PATH, BRANCH_NAME)).toThrow(
      /exited with status 1/,
    );
  });
});

describe("S09 spawner — spawnForCaste", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (laborModule.planLaborCreation as ReturnType<typeof vi.fn>).mockReturnValue(
      makeLaborPlan(),
    );
    (cp.spawnSync as ReturnType<typeof vi.fn>).mockReturnValue({ status: 0 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a labor worktree for titan and spawns with labor path", async () => {
    const runtime = makeMockRuntime();
    const input: SpawnForCasteInput = {
      issue: makeReadyIssue(),
      caste: "titan",
      runtime,
      budget: makeBudgetLimit(),
      projectRoot: PROJECT_ROOT,
      record: makeDispatchRecord(DispatchStage.Scouted),
    };

    const result = await spawnForCaste(input);

    // Verify worktree was created.
    expect(laborModule.planLaborCreation).toHaveBeenCalled();
    expect(cp.spawnSync).toHaveBeenCalled();

    // Verify runtime.spawn was called with correct options.
    expect(runtime.spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        caste: "titan",
        issueId: ISSUE_ID,
        workingDirectory: LABOR_PATH,
        toolRestrictions: [],
        budget: makeBudgetLimit(),
        model: DEFAULT_AEGIS_CONFIG.models.titan,
      }),
    );

    // Verify result.
    expect(result.laborPath).toBe(LABOR_PATH);
    expect(result.branchName).toBe(BRANCH_NAME);
    expect(result.handle).toBeDefined();
    expect(result.updatedRecord.stage).toBe(DispatchStage.Implementing);
  });

  it("skips worktree creation for oracle and uses projectRoot", async () => {
    const runtime = makeMockRuntime();
    const input: SpawnForCasteInput = {
      issue: makeReadyIssue(),
      caste: "oracle",
      runtime,
      budget: makeBudgetLimit(),
      projectRoot: PROJECT_ROOT,
      record: makeDispatchRecord(DispatchStage.Pending),
    };

    const result = await spawnForCaste(input);

    // Verify no worktree was created.
    expect(laborModule.planLaborCreation).not.toHaveBeenCalled();
    expect(cp.spawnSync).not.toHaveBeenCalled();

    // Verify runtime.spawn was called with projectRoot.
    expect(runtime.spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        caste: "oracle",
        issueId: ISSUE_ID,
        workingDirectory: PROJECT_ROOT,
        toolRestrictions: [],
        model: DEFAULT_AEGIS_CONFIG.models.oracle,
      }),
    );

    expect(result.laborPath).toBe(PROJECT_ROOT);
    expect(result.branchName).toBe("main");
    expect(result.updatedRecord.stage).toBe(DispatchStage.Scouting);
  });

  it("skips worktree creation for sentinel and uses projectRoot", async () => {
    const runtime = makeMockRuntime();
    const input: SpawnForCasteInput = {
      issue: makeReadyIssue(),
      caste: "sentinel",
      runtime,
      budget: makeBudgetLimit(),
      projectRoot: PROJECT_ROOT,
      record: makeDispatchRecord(DispatchStage.Merged),
    };

    const result = await spawnForCaste(input);

    expect(laborModule.planLaborCreation).not.toHaveBeenCalled();

    expect(runtime.spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        caste: "sentinel",
        issueId: ISSUE_ID,
        workingDirectory: PROJECT_ROOT,
        model: DEFAULT_AEGIS_CONFIG.models.sentinel,
      }),
    );

    expect(result.updatedRecord.stage).toBe(DispatchStage.Reviewing);
  });

  it("passes custom toolRestrictions when provided", async () => {
    const runtime = makeMockRuntime();
    const customRestrictions = ["read_file", "grep_search"];
    const input: SpawnForCasteInput = {
      issue: makeReadyIssue(),
      caste: "oracle",
      runtime,
      budget: makeBudgetLimit(),
      projectRoot: PROJECT_ROOT,
      record: makeDispatchRecord(DispatchStage.Pending),
      toolRestrictions: customRestrictions,
    };

    await spawnForCaste(input);

    expect(runtime.spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        toolRestrictions: customRestrictions,
      }),
    );
  });

  it("clears runningAgent on the updated record", async () => {
    const runtime = makeMockRuntime();
    const input: SpawnForCasteInput = {
      issue: makeReadyIssue(),
      caste: "oracle",
      runtime,
      budget: makeBudgetLimit(),
      projectRoot: PROJECT_ROOT,
      record: {
        ...makeDispatchRecord(DispatchStage.Pending),
        runningAgent: {
          caste: "oracle",
          sessionId: "stale-session",
          startedAt: new Date().toISOString(),
        },
      },
    };

    const result = await spawnForCaste(input);

    expect(result.updatedRecord.runningAgent).toBeNull();
  });
});

describe("S09 spawner — oracle is read-only (adapter-level contract)", () => {
  it("spawns oracle with empty toolRestrictions (adapter applies readOnlyTools)", async () => {
    const runtime = makeMockRuntime();
    const input: SpawnForCasteInput = {
      issue: makeReadyIssue(),
      caste: "oracle",
      runtime,
      budget: makeBudgetLimit(),
      projectRoot: PROJECT_ROOT,
      record: makeDispatchRecord(DispatchStage.Pending),
    };

    await spawnForCaste(input);

    const spawnCall = (runtime.spawn as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as SpawnOptions;

    // The spawner passes empty toolRestrictions; the Pi adapter maps
    // caste="oracle" to readOnlyTools per SPECv2 §8.4.
    expect(spawnCall.caste).toBe("oracle");
    expect(spawnCall.toolRestrictions).toEqual([]);
    expect(spawnCall.model).toBe(DEFAULT_AEGIS_CONFIG.models.oracle);
    // Oracle works on the project root, not a labor worktree.
    expect(spawnCall.workingDirectory).toBe(PROJECT_ROOT);
  });

  it("spawns titan with empty toolRestrictions (adapter applies codingTools)", async () => {
    const runtime = makeMockRuntime();
    const input: SpawnForCasteInput = {
      issue: makeReadyIssue(),
      caste: "titan",
      runtime,
      budget: makeBudgetLimit(),
      projectRoot: PROJECT_ROOT,
      record: makeDispatchRecord(DispatchStage.Scouted),
    };

    await spawnForCaste(input);

    const spawnCall = (runtime.spawn as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as SpawnOptions;

    expect(spawnCall.caste).toBe("titan");
    expect(spawnCall.toolRestrictions).toEqual([]);
    expect(spawnCall.model).toBe(DEFAULT_AEGIS_CONFIG.models.titan);
    // Titan works in the labor worktree.
    expect(spawnCall.workingDirectory).toBe(LABOR_PATH);
  });

  it("spawns sentinel with empty toolRestrictions (adapter applies readOnlyTools)", async () => {
    const runtime = makeMockRuntime();
    const input: SpawnForCasteInput = {
      issue: makeReadyIssue(),
      caste: "sentinel",
      runtime,
      budget: makeBudgetLimit(),
      projectRoot: PROJECT_ROOT,
      record: makeDispatchRecord(DispatchStage.Merged),
    };

    await spawnForCaste(input);

    const spawnCall = (runtime.spawn as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as SpawnOptions;

    expect(spawnCall.caste).toBe("sentinel");
    expect(spawnCall.toolRestrictions).toEqual([]);
    expect(spawnCall.model).toBe(DEFAULT_AEGIS_CONFIG.models.sentinel);
    // Sentinel reviews merged code at project root.
    expect(spawnCall.workingDirectory).toBe(PROJECT_ROOT);
  });
});

describe("S09 spawner — dispatch record transition on invalid from-stage", () => {
  it("falls back to direct stage set when transitionStage throws", async () => {
    // Complete is a terminal stage; transitioning to scouting should fail
    // in transitionStage but the spawner should still set the stage.
    const runtime = makeMockRuntime();
    const input: SpawnForCasteInput = {
      issue: makeReadyIssue(),
      caste: "oracle",
      runtime,
      budget: makeBudgetLimit(),
      projectRoot: PROJECT_ROOT,
      record: makeDispatchRecord(DispatchStage.Complete),
    };

    const result = await spawnForCaste(input);

    expect(result.updatedRecord.stage).toBe(DispatchStage.Scouting);
    expect(result.updatedRecord.runningAgent).toBeNull();
  });
});
