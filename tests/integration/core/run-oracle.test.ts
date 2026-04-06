import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BudgetLimit } from "../../../src/config/schema.js";
import { buildOraclePrompt } from "../../../src/castes/oracle/oracle-prompt.js";
import type { DispatchRecord } from "../../../src/core/dispatch-state.js";
import {
  runOracle,
  type OracleIssueCreator,
} from "../../../src/core/run-oracle.js";
import { DispatchStage } from "../../../src/core/stage-transition.js";
import type {
  AgentEvent,
  AgentHandle,
  AgentRuntime,
  SpawnOptions,
} from "../../../src/runtime/agent-runtime.js";
import type { AegisIssue } from "../../../src/tracker/issue-model.js";
import { createDerivedIssueInputs } from "../../../src/tracker/create-derived-issues.js";

function makeIssue(overrides: Partial<AegisIssue> = {}): AegisIssue {
  return {
    id: "aegis-fjm.9.3",
    title: "[S08] Parallel lane B",
    description: "Implement scout dispatch, complexity gating, and decomposition issue creation.",
    issueClass: "primary",
    status: "open",
    priority: 1,
    blockers: [],
    parentId: null,
    childIds: [],
    labels: ["mvp", "phase1", "s08"],
    createdAt: "2026-04-03T01:07:43Z",
    updatedAt: "2026-04-05T19:06:42Z",
    ...overrides,
  };
}

function makeRecord(stage: DispatchStage = DispatchStage.Scouting): DispatchRecord {
  return {
    issueId: "aegis-fjm.9.3",
    stage,
    runningAgent: {
      caste: "oracle",
      sessionId: "session-oracle-1",
      startedAt: "2026-04-05T20:10:00.000Z",
    },
    oracleAssessmentRef: null,
    sentinelVerdictRef: null,
    fileScope: null,
    failureCount: 0,
    consecutiveFailures: 0,
    failureWindowStartMs: null,
    cooldownUntil: null,
    cumulativeSpendUsd: null,
    sessionProvenanceId: "session-aegis-1",
    updatedAt: "2026-04-05T20:10:00.000Z",
  };
}

function makeRuntime(rawResponse: string | string[]): AgentRuntime {
  const responses = Array.isArray(rawResponse) ? rawResponse : [rawResponse];

  return {
    async spawn(_opts: SpawnOptions): Promise<AgentHandle> {
      let listener: ((event: AgentEvent) => void) | null = null;

      return {
        async prompt(): Promise<void> {
          for (const [index, response] of responses.entries()) {
            listener?.({
              type: "message",
              timestamp: `2026-04-05T20:10:0${index + 1}.000Z`,
              issueId: "aegis-fjm.9.3",
              caste: "oracle",
              text: response,
            });
          }
          listener?.({
            type: "session_ended",
            timestamp: "2026-04-05T20:10:03.000Z",
            issueId: "aegis-fjm.9.3",
            caste: "oracle",
            reason: "completed",
            stats: {
              input_tokens: 10,
              output_tokens: 20,
              session_turns: 1,
              wall_time_sec: 1,
            },
          });
        },
        async steer(): Promise<void> {},
        async abort(): Promise<void> {},
        subscribe(next): () => void {
          listener = next;
          return () => {
            listener = null;
          };
        },
        getStats() {
          return {
            input_tokens: 10,
            output_tokens: 20,
            session_turns: 1,
            wall_time_sec: 1,
          };
        },
      };
    },
  };
}

function cloneIssue(issue: AegisIssue): AegisIssue {
  return {
    ...issue,
    blockers: [...issue.blockers],
    childIds: [...issue.childIds],
    labels: [...issue.labels],
  };
}

type TrackerOverrides = Partial<OracleIssueCreator> & {
  issues?: AegisIssue[];
};

function makeTracker(overrides: TrackerOverrides = {}): OracleIssueCreator {
  const { issues = [], ...methodOverrides } = overrides;
  const issueStore = new Map<string, AegisIssue>();
  const seededIssues = issues.some((issue) => issue.id === "aegis-fjm.9.3")
    ? issues
    : [makeIssue(), ...issues];
  let createdCount = seededIssues.reduce((highestSuffix, issue) => {
    const match = /^aegis-fjm\.30\.(\d+)$/.exec(issue.id);
    if (!match) {
      return highestSuffix;
    }
    return Math.max(highestSuffix, Number(match[1]));
  }, 0);

  for (const issue of seededIssues) {
    issueStore.set(issue.id, cloneIssue(issue));
  }

  const getTrackedIssue = (id: string): AegisIssue => {
    const issue = issueStore.get(id);
    if (!issue) {
      throw new Error(`Issue not found: ${id}`);
    }
    return issue;
  };

  const getIssue = vi.fn(async (id: string) => cloneIssue(getTrackedIssue(id)));
  const getReadyQueue = vi.fn(async () =>
    Array.from(issueStore.values())
      .filter((issue) => issue.status !== "closed" && issue.blockers.length === 0)
      .map((issue) => ({
        id: issue.id,
        title: issue.title,
        issueClass: issue.issueClass,
        priority: issue.priority,
      })));
  const createIssue = vi.fn(async (input) => {
    createdCount += 1;
    const createdIssue = makeIssue({
      id: `aegis-fjm.30.${createdCount}`,
      title: input.title,
      description: input.description,
      issueClass: input.issueClass,
      parentId: input.originId,
      childIds: [],
      blockers: [],
      labels: [...input.labels],
    });
    issueStore.set(createdIssue.id, cloneIssue(createdIssue));
    if (input.originId) {
      const parentIssue = getTrackedIssue(input.originId);
      parentIssue.childIds = [...parentIssue.childIds, createdIssue.id];
    }
    return cloneIssue(createdIssue);
  });
  const linkIssue = vi.fn(async (parentId: string, childId: string) => {
    const parentIssue = getTrackedIssue(parentId);
    const childIssue = getTrackedIssue(childId);
    if (!parentIssue.childIds.includes(childId)) {
      parentIssue.childIds = [...parentIssue.childIds, childId];
    }
    issueStore.set(childId, cloneIssue({
      ...childIssue,
      parentId,
    }));
  });
  const unlinkIssue = vi.fn(async (parentId: string, childId: string) => {
    const parentIssue = getTrackedIssue(parentId);
    const childIssue = getTrackedIssue(childId);
    parentIssue.childIds = parentIssue.childIds.filter((existingId) => existingId !== childId);
    issueStore.set(childId, cloneIssue({
      ...childIssue,
      parentId: null,
    }));
  });
  const addBlocker = vi.fn(async (blockedId: string, blockerId: string) => {
    const blockedIssue = getTrackedIssue(blockedId);
    if (!blockedIssue.blockers.includes(blockerId)) {
      blockedIssue.blockers = [...blockedIssue.blockers, blockerId];
    }
  });
  const removeBlocker = vi.fn(async (blockedId: string, blockerId: string) => {
    const blockedIssue = getTrackedIssue(blockedId);
    blockedIssue.blockers = blockedIssue.blockers.filter((existingId) => existingId !== blockerId);
  });
  const closeIssue = vi.fn(async (id: string, reason?: string) => {
    const closedIssue = makeIssue({
      ...getTrackedIssue(id),
      title: reason ?? "Closed derived issue",
      status: "closed",
    });
    issueStore.set(id, cloneIssue(closedIssue));
    for (const issue of issueStore.values()) {
      if (issue.blockers.includes(id)) {
        issue.blockers = issue.blockers.filter((blockerId) => blockerId !== id);
      }
    }
    return cloneIssue(closedIssue);
  });

  return {
    getIssue: methodOverrides.getIssue ?? getIssue,
    getReadyQueue: methodOverrides.getReadyQueue ?? getReadyQueue,
    createIssue: methodOverrides.createIssue ?? createIssue,
    linkIssue: methodOverrides.linkIssue ?? linkIssue,
    unlinkIssue: methodOverrides.unlinkIssue ?? unlinkIssue,
    addBlocker: methodOverrides.addBlocker ?? addBlocker,
    removeBlocker: methodOverrides.removeBlocker ?? removeBlocker,
    closeIssue: methodOverrides.closeIssue ?? closeIssue,
  };
}

describe("buildOraclePrompt", () => {
  it("includes the issue context and the strict OracleAssessment contract", () => {
    const prompt = buildOraclePrompt(makeIssue());

    expect(prompt).toContain("aegis-fjm.9.3");
    expect(prompt).toContain("[S08] Parallel lane B");
    expect(prompt).toContain("files_affected");
    expect(prompt).toContain("tracker reads");
    expect(prompt).toContain("estimated_complexity");
    expect(prompt).toContain("decompose");
    expect(prompt).toContain("ready");
    expect(prompt.toLowerCase()).toContain("no file modifications");
    expect(prompt.toLowerCase()).toContain("return only json");
  });
});

describe("createDerivedIssueInputs", () => {
  it("maps assessment sub_issues to Beads issue creation inputs that link back to the origin issue", () => {
    const assessment = {
      files_affected: ["src/core/run-oracle.ts"],
      estimated_complexity: "complex" as const,
      decompose: true,
      sub_issues: ["Split prompt construction", "Add strict parser"],
      blockers: ["src/core/run-oracle.ts"],
      ready: false,
    };

    const result = createDerivedIssueInputs(makeIssue(), assessment);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(
      expect.objectContaining({
        title: "Split prompt construction",
        description: expect.stringContaining("aegis-fjm.9.3"),
        issueClass: "sub",
        originId: "aegis-fjm.9.3",
        priority: 1,
        labels: [],
      }),
    );
    expect(result[1].originId).toBe("aegis-fjm.9.3");
  });

  it("returns no derived issues when decompose is false", () => {
    const assessment = {
      files_affected: ["src/core/run-oracle.ts"],
      estimated_complexity: "moderate" as const,
      decompose: false,
      ready: true,
    };

    expect(createDerivedIssueInputs(makeIssue(), assessment)).toEqual([]);
  });

  it("fails closed when decompose=true arrives without usable sub_issues", () => {
    expect(() =>
      createDerivedIssueInputs(makeIssue(), {
        files_affected: ["src/core/run-oracle.ts"],
        estimated_complexity: "complex",
        decompose: true,
        ready: false,
      }),
    ).toThrow(/sub_issues/i);
  });
});

describe("runOracle", () => {
  const budget: BudgetLimit = { turns: 4, tokens: 8000 };
  const assessmentRef = path.join(".aegis", "oracle", "aegis-fjm.9.3.json");
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(path.join(tmpdir(), "aegis-s08-"));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("runs Oracle in the project root, creates decomposition issues, blocks the parent, and transitions to scouted", async () => {
    const spawn = vi.fn(makeRuntime(JSON.stringify({
      files_affected: ["src/core/run-oracle.ts", "src/tracker/create-derived-issues.ts"],
      estimated_complexity: "complex",
      decompose: true,
      sub_issues: ["Split prompt", "Add linker"],
      blockers: ["src/tracker/create-derived-issues.ts"],
      ready: false,
    })).spawn);
    const runtime: AgentRuntime = { spawn };
    const tracker = makeTracker();

    const result = await runOracle({
      issue: makeIssue(),
      record: makeRecord(),
      runtime,
      tracker,
      budget,
      projectRoot,
      operatingMode: "conversational",
      allowComplexAutoDispatch: false,
    });

    expect(spawn).toHaveBeenCalledWith({
      caste: "oracle",
      issueId: "aegis-fjm.9.3",
      workingDirectory: projectRoot,
      toolRestrictions: [],
      budget,
    });
    expect(result.updatedRecord.stage).toBe(DispatchStage.Scouted);
    expect(result.updatedRecord.runningAgent).toBeNull();
    expect(result.updatedRecord.oracleAssessmentRef).toBe(assessmentRef);
    expect(result.assessment).not.toBeNull();
    expect(result.updatedRecord.oracleAssessmentRef).not.toBeNull();
    if (!result.assessment) {
      throw new Error("Expected Oracle assessment to be present");
    }
    if (!result.updatedRecord.oracleAssessmentRef) {
      throw new Error("Expected Oracle assessment ref to be present");
    }
    expect(
      JSON.parse(
        readFileSync(path.join(projectRoot, result.updatedRecord.oracleAssessmentRef), "utf8"),
      ),
    ).toEqual(result.assessment);
    expect(result.assessment.estimated_complexity).toBe("complex");
    expect(result.complexityDisposition).toBe("needs_human_approval");
    expect(result.requiresComplexityGate).toBe(true);
    expect(result.readyForImplementation).toBe(false);
    expect(result.createdIssues.map((issue) => issue.id)).toEqual([
      "aegis-fjm.30.1",
      "aegis-fjm.30.2",
    ]);
    expect(result.rolledBackIssues).toEqual([]);
    expect(tracker.createIssue).toHaveBeenNthCalledWith(1, {
      title: "Split prompt",
      description: expect.stringContaining("aegis-fjm.9.3"),
      issueClass: "sub",
      priority: 1,
      originId: "aegis-fjm.9.3",
      labels: [],
    });
    expect(tracker.createIssue).toHaveBeenNthCalledWith(2, {
      title: "Add linker",
      description: expect.stringContaining("aegis-fjm.9.3"),
      issueClass: "sub",
      priority: 1,
      originId: "aegis-fjm.9.3",
      labels: [],
    });
    expect(tracker.addBlocker).toHaveBeenNthCalledWith(1, "aegis-fjm.9.3", "aegis-fjm.30.1");
    expect(tracker.addBlocker).toHaveBeenNthCalledWith(2, "aegis-fjm.9.3", "aegis-fjm.30.2");
  });

  it("keeps moderate ready work dispatchable after scouting", async () => {
    const result = await runOracle({
      issue: makeIssue(),
      record: makeRecord(),
      runtime: makeRuntime(JSON.stringify({
        files_affected: ["src/core/run-oracle.ts"],
        estimated_complexity: "moderate",
        decompose: false,
        ready: true,
      })),
      tracker: makeTracker(),
      budget,
      projectRoot,
      operatingMode: "conversational",
      allowComplexAutoDispatch: false,
    });

    expect(result.complexityDisposition).toBe("allow");
    expect(result.requiresComplexityGate).toBe(false);
    expect(result.readyForImplementation).toBe(true);
    expect(result.createdIssues).toEqual([]);
  });

  it("does not depend on a second parent refresh after materialization succeeds", async () => {
    const tracker = makeTracker();
    const baseGetIssue = tracker.getIssue;
    let parentReadCount = 0;
    tracker.getIssue = vi.fn(async (id: string) => {
      if (id === "aegis-fjm.9.3") {
        parentReadCount += 1;
        if (parentReadCount > 2) {
          throw new Error("late readiness refresh failed");
        }
      }
      return baseGetIssue(id);
    });

    const result = await runOracle({
      issue: makeIssue(),
      record: makeRecord(),
      runtime: makeRuntime(JSON.stringify({
        files_affected: ["src/core/run-oracle.ts"],
        estimated_complexity: "moderate",
        decompose: false,
        ready: true,
      })),
      tracker,
      budget,
      projectRoot,
      operatingMode: "conversational",
      allowComplexAutoDispatch: false,
    });

    expect(result.updatedRecord.stage).toBe(DispatchStage.Scouted);
    expect(result.failureReason).toBeNull();
    expect(parentReadCount).toBe(2);
  });

  it("fails closed if the parent is no longer open after Oracle finishes", async () => {
    const tracker = makeTracker();
    const baseGetIssue = tracker.getIssue;
    let parentReadCount = 0;
    tracker.getIssue = vi.fn(async (id: string) => {
      const issue = await baseGetIssue(id);
      if (id !== "aegis-fjm.9.3") {
        return issue;
      }
      parentReadCount += 1;
      if (parentReadCount < 2) {
        return issue;
      }
      return {
        ...issue,
        status: "closed" as const,
      };
    });

    const result = await runOracle({
      issue: makeIssue(),
      record: makeRecord(),
      runtime: makeRuntime(JSON.stringify({
        files_affected: ["src/core/run-oracle.ts"],
        estimated_complexity: "moderate",
        decompose: true,
        sub_issues: ["Split prompt"],
        ready: false,
      })),
      tracker,
      budget,
      projectRoot,
      operatingMode: "conversational",
      allowComplexAutoDispatch: false,
    });

    expect(result.updatedRecord.stage).toBe(DispatchStage.Failed);
    expect(result.failureReason).toMatch(/no longer open/i);
    expect(tracker.createIssue).not.toHaveBeenCalled();
  });

  it("fails closed when Oracle reports blockers even if it also marks the issue ready", async () => {
    const result = await runOracle({
      issue: makeIssue(),
      record: makeRecord(),
      runtime: makeRuntime(JSON.stringify({
        files_affected: ["src/core/run-oracle.ts"],
        estimated_complexity: "moderate",
        decompose: false,
        blockers: ["src/core/run-oracle.ts"],
        ready: true,
      })),
      tracker: makeTracker(),
      budget,
      projectRoot,
      operatingMode: "conversational",
      allowComplexAutoDispatch: false,
    });

    expect(result.updatedRecord.stage).toBe(DispatchStage.Scouted);
    expect(result.readyForImplementation).toBe(false);
  });

  it("ignores stale child lookup failures when the assessment does not decompose", async () => {
    const tracker = makeTracker({
      issues: [
        makeIssue({
          childIds: ["stale-child"],
        }),
      ],
    });
    const baseGetIssue = tracker.getIssue;
    tracker.getIssue = vi.fn(async (id: string) => {
      if (id === "stale-child") {
        throw new Error("stale child lookup failed");
      }
      return baseGetIssue(id);
    });

    const result = await runOracle({
      issue: makeIssue(),
      record: makeRecord(),
      runtime: makeRuntime(JSON.stringify({
        files_affected: ["src/core/run-oracle.ts"],
        estimated_complexity: "moderate",
        decompose: false,
        ready: true,
      })),
      tracker,
      budget,
      projectRoot,
      operatingMode: "conversational",
      allowComplexAutoDispatch: false,
    });

    expect(result.updatedRecord.stage).toBe(DispatchStage.Scouted);
    expect(result.failureReason).toBeNull();
    expect(result.readyForImplementation).toBe(true);
  });

  it("skips auto dispatch for complex work unless the config explicitly allows it", async () => {
    const result = await runOracle({
      issue: makeIssue(),
      record: makeRecord(),
      runtime: makeRuntime(JSON.stringify({
        files_affected: ["src/core/run-oracle.ts"],
        estimated_complexity: "complex",
        decompose: false,
        ready: true,
      })),
      tracker: makeTracker(),
      budget,
      projectRoot,
      operatingMode: "auto",
      allowComplexAutoDispatch: false,
    });

    expect(result.complexityDisposition).toBe("skip_auto_dispatch");
    expect(result.requiresComplexityGate).toBe(true);
    expect(result.readyForImplementation).toBe(false);
  });

  it("maps malformed Oracle output to a failed dispatch transition", async () => {
    const result = await runOracle({
      issue: makeIssue(),
      record: makeRecord(),
      runtime: makeRuntime("{ nope }"),
      tracker: makeTracker(),
      budget,
      projectRoot,
      operatingMode: "conversational",
      allowComplexAutoDispatch: false,
    });

    expect(result.updatedRecord.stage).toBe(DispatchStage.Failed);
    expect(result.failureReason).toMatch(/JSON/i);
    expect(result.createdIssues).toEqual([]);
    expect(result.rolledBackIssues).toEqual([]);
  });

  it("rolls back all created decomposition issues when parent blocker linkage fails", async () => {
    const tracker = makeTracker({
      addBlocker: vi.fn(async (_blockedId, blockerId) => {
        if (blockerId === "aegis-fjm.30.2") {
          throw new Error("dep add failed");
        }
      }),
    });

    const result = await runOracle({
      issue: makeIssue(),
      record: makeRecord(),
      runtime: makeRuntime(JSON.stringify({
        files_affected: ["src/core/run-oracle.ts", "src/tracker/create-derived-issues.ts"],
        estimated_complexity: "moderate",
        decompose: true,
        sub_issues: ["Split prompt", "Add linker"],
        ready: false,
      })),
      tracker,
      budget,
      projectRoot,
      operatingMode: "conversational",
      allowComplexAutoDispatch: false,
    });

    expect(result.updatedRecord.stage).toBe(DispatchStage.Failed);
    expect(result.updatedRecord.oracleAssessmentRef).toBe(assessmentRef);
    expect(result.failureReason).toMatch(/dep add failed/i);
    expect(result.assessment).not.toBeNull();
    expect(result.updatedRecord.oracleAssessmentRef).not.toBeNull();
    expect(result.createdIssues).toEqual([]);
    expect(result.rolledBackIssues.map((issue) => issue.id)).toEqual([
      "aegis-fjm.30.1",
      "aegis-fjm.30.2",
    ]);
    if (!result.updatedRecord.oracleAssessmentRef) {
      throw new Error("Expected Oracle assessment ref to be present");
    }
    expect(
      JSON.parse(
        readFileSync(path.join(projectRoot, result.updatedRecord.oracleAssessmentRef), "utf8"),
      ),
    ).toEqual(result.assessment);
    expect(tracker.closeIssue).toHaveBeenCalledWith(
      "aegis-fjm.30.1",
      expect.stringContaining("Failed to materialize"),
    );
    expect(tracker.closeIssue).toHaveBeenCalledWith(
      "aegis-fjm.30.2",
      expect.stringContaining("Failed to materialize"),
    );
  });

  it("ignores stale Oracle assessment artifacts and re-scouts from the current runtime output", async () => {
    mkdirSync(path.join(projectRoot, ".aegis", "oracle"), { recursive: true });
    writeFileSync(
      path.join(projectRoot, assessmentRef),
      `${JSON.stringify({
        files_affected: ["src/tracker/create-derived-issues.ts"],
        estimated_complexity: "complex",
        decompose: true,
        sub_issues: ["Stale derived issue"],
        ready: false,
      }, null, 2)}\n`,
      "utf8",
    );
    const tracker = makeTracker();
    const spawn = vi.fn(makeRuntime(JSON.stringify({
      files_affected: ["src/core/run-oracle.ts"],
      estimated_complexity: "moderate",
      decompose: false,
      ready: true,
    })).spawn);
    const runtime: AgentRuntime = { spawn };

    const result = await runOracle({
      issue: makeIssue(),
      record: makeRecord(),
      runtime,
      tracker,
      budget,
      projectRoot,
      operatingMode: "conversational",
      allowComplexAutoDispatch: false,
    });

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(tracker.createIssue).not.toHaveBeenCalled();
    expect(result.updatedRecord.stage).toBe(DispatchStage.Scouted);
    expect(result.updatedRecord.oracleAssessmentRef).toBe(assessmentRef);
    expect(result.assessment?.estimated_complexity).toBe("moderate");
    expect(result.createdIssues).toEqual([]);
    expect(result.readyForImplementation).toBe(true);
    expect(result.rolledBackIssues).toEqual([]);
  });

  it("reports only successfully closed derived issues as rolled back when cleanup partially fails", async () => {
    const tracker = makeTracker({
      addBlocker: vi.fn(async (_blockedId, blockerId) => {
        if (blockerId === "aegis-fjm.30.2") {
          throw new Error("dep add failed");
        }
      }),
      closeIssue: vi.fn(async (id, reason) => {
        if (id === "aegis-fjm.30.2") {
          throw new Error("close failed");
        }
        return makeIssue({
          id,
          title: reason ?? "Closed derived issue",
          status: "closed",
          issueClass: "sub",
          parentId: "aegis-fjm.9.3",
          labels: [],
        });
      }),
    });

    const result = await runOracle({
      issue: makeIssue(),
      record: makeRecord(),
      runtime: makeRuntime(JSON.stringify({
        files_affected: ["src/core/run-oracle.ts", "src/tracker/create-derived-issues.ts"],
        estimated_complexity: "moderate",
        decompose: true,
        sub_issues: ["Split prompt", "Add linker"],
        ready: false,
      })),
      tracker,
      budget,
      projectRoot,
      operatingMode: "conversational",
      allowComplexAutoDispatch: false,
    });

    expect(result.updatedRecord.stage).toBe(DispatchStage.Failed);
    expect(result.failureReason).toMatch(/dep add failed/i);
    expect(result.failureReason).toMatch(/close failed/i);
    expect(result.createdIssues.map((issue) => issue.id)).toEqual(["aegis-fjm.30.2"]);
    expect(result.rolledBackIssues.map((issue) => issue.id)).toEqual(["aegis-fjm.30.1"]);
  });

  it("reuses existing derived children on retry instead of creating duplicates", async () => {
    const tracker = makeTracker({
      issues: [
        makeIssue({
          blockers: ["aegis-fjm.30.1"],
          childIds: ["aegis-fjm.30.1", "aegis-fjm.30.2"],
        }),
        makeIssue({
          id: "aegis-fjm.30.1",
          title: "Split prompt",
          description: "Derived from Oracle assessment for aegis-fjm.9.3.",
          issueClass: "sub",
          parentId: "aegis-fjm.9.3",
          labels: [],
        }),
        makeIssue({
          id: "aegis-fjm.30.2",
          title: "Add linker",
          description: "Derived from Oracle assessment for aegis-fjm.9.3.",
          issueClass: "sub",
          parentId: "aegis-fjm.9.3",
          labels: [],
        }),
      ],
    });

    const result = await runOracle({
      issue: makeIssue(),
      record: makeRecord(),
      runtime: makeRuntime(JSON.stringify({
        files_affected: ["src/core/run-oracle.ts", "src/tracker/create-derived-issues.ts"],
        estimated_complexity: "complex",
        decompose: true,
        sub_issues: ["Split prompt", "Add linker"],
        blockers: ["src/tracker/create-derived-issues.ts"],
        ready: false,
      })),
      tracker,
      budget,
      projectRoot,
      operatingMode: "conversational",
      allowComplexAutoDispatch: false,
    });

    expect(tracker.createIssue).not.toHaveBeenCalled();
    expect(tracker.addBlocker).toHaveBeenCalledTimes(1);
    expect(tracker.addBlocker).toHaveBeenCalledWith("aegis-fjm.9.3", "aegis-fjm.30.2");
    expect(result.createdIssues.map((issue) => issue.id)).toEqual([
      "aegis-fjm.30.1",
      "aegis-fjm.30.2",
    ]);
  });

  it("recovers orphaned ready derived issues by linking them back to the parent", async () => {
    const tracker = makeTracker({
      issues: [
        makeIssue({
          id: "aegis-fjm.30.1",
          title: "Split prompt",
          description: "Derived from Oracle assessment for aegis-fjm.9.3.",
          issueClass: "sub",
          parentId: null,
          labels: [],
        }),
      ],
    });

    const result = await runOracle({
      issue: makeIssue(),
      record: makeRecord(),
      runtime: makeRuntime(JSON.stringify({
        files_affected: ["src/core/run-oracle.ts"],
        estimated_complexity: "moderate",
        decompose: true,
        sub_issues: ["Split prompt"],
        ready: false,
      })),
      tracker,
      budget,
      projectRoot,
      operatingMode: "conversational",
      allowComplexAutoDispatch: false,
    });

    expect(tracker.createIssue).not.toHaveBeenCalled();
    expect(tracker.linkIssue).toHaveBeenCalledWith("aegis-fjm.9.3", "aegis-fjm.30.1");
    expect(tracker.addBlocker).toHaveBeenCalledWith("aegis-fjm.9.3", "aegis-fjm.30.1");
    expect(result.updatedRecord.stage).toBe(DispatchStage.Scouted);
    expect(result.createdIssues.map((issue) => issue.id)).toEqual(["aegis-fjm.30.1"]);
    expect((await tracker.getIssue("aegis-fjm.30.1")).parentId).toBe("aegis-fjm.9.3");
  });

  it("fails closed when a transient child lookup blocks decomposition recovery", async () => {
    const tracker = makeTracker({
      issues: [
        makeIssue({
          childIds: ["aegis-fjm.30.1"],
        }),
        makeIssue({
          id: "aegis-fjm.30.1",
          title: "Split prompt",
          description: "Derived from Oracle assessment for aegis-fjm.9.3.",
          issueClass: "sub",
          parentId: "aegis-fjm.9.3",
          labels: [],
        }),
      ],
    });
    const baseGetIssue = tracker.getIssue;
    tracker.getIssue = vi.fn(async (id: string) => {
      if (id === "aegis-fjm.30.1") {
        throw new Error("tracker unavailable");
      }
      return baseGetIssue(id);
    });

    const result = await runOracle({
      issue: makeIssue(),
      record: makeRecord(),
      runtime: makeRuntime(JSON.stringify({
        files_affected: ["src/core/run-oracle.ts"],
        estimated_complexity: "moderate",
        decompose: true,
        sub_issues: ["Split prompt"],
        ready: false,
      })),
      tracker,
      budget,
      projectRoot,
      operatingMode: "conversational",
      allowComplexAutoDispatch: false,
    });

    expect(result.updatedRecord.stage).toBe(DispatchStage.Failed);
    expect(result.failureReason).toMatch(/tracker unavailable/i);
    expect(tracker.createIssue).not.toHaveBeenCalled();
  });

  it("removes blockers added to reused children when a later retry step fails", async () => {
    const tracker = makeTracker({
      issues: [
        makeIssue({
          childIds: ["aegis-fjm.30.1"],
        }),
        makeIssue({
          id: "aegis-fjm.30.1",
          title: "Split prompt",
          description: "Derived from Oracle assessment for aegis-fjm.9.3.",
          issueClass: "sub",
          parentId: "aegis-fjm.9.3",
          labels: [],
        }),
      ],
    });
    const baseAddBlocker = tracker.addBlocker;
    tracker.addBlocker = vi.fn(async (blockedId: string, blockerId: string) => {
      if (blockerId === "aegis-fjm.30.2") {
        throw new Error("dep add failed");
      }
      await baseAddBlocker(blockedId, blockerId);
    });

    const result = await runOracle({
      issue: makeIssue(),
      record: makeRecord(),
      runtime: makeRuntime(JSON.stringify({
        files_affected: ["src/core/run-oracle.ts", "src/tracker/create-derived-issues.ts"],
        estimated_complexity: "complex",
        decompose: true,
        sub_issues: ["Split prompt", "Add linker"],
        ready: false,
      })),
      tracker,
      budget,
      projectRoot,
      operatingMode: "conversational",
      allowComplexAutoDispatch: false,
    });

    expect(result.updatedRecord.stage).toBe(DispatchStage.Failed);
    expect(tracker.removeBlocker).toHaveBeenCalledWith("aegis-fjm.9.3", "aegis-fjm.30.1");
    expect((await tracker.getIssue("aegis-fjm.9.3")).blockers).toEqual([]);
    expect(result.rolledBackIssues.map((issue) => issue.id)).toEqual(["aegis-fjm.30.2"]);
  });

  it("restores recovered orphans instead of closing them when a later retry step fails", async () => {
    const tracker = makeTracker({
      issues: [
        makeIssue({
          id: "aegis-fjm.30.1",
          title: "Split prompt",
          description: "Derived from Oracle assessment for aegis-fjm.9.3.",
          issueClass: "sub",
          parentId: null,
          labels: [],
        }),
      ],
    });
    const baseAddBlocker = tracker.addBlocker;
    tracker.addBlocker = vi.fn(async (blockedId: string, blockerId: string) => {
      await baseAddBlocker(blockedId, blockerId);
      if (blockerId === "aegis-fjm.30.1") {
        throw new Error("dep add failed");
      }
    });

    const result = await runOracle({
      issue: makeIssue(),
      record: makeRecord(),
      runtime: makeRuntime(JSON.stringify({
        files_affected: ["src/core/run-oracle.ts"],
        estimated_complexity: "moderate",
        decompose: true,
        sub_issues: ["Split prompt"],
        ready: false,
      })),
      tracker,
      budget,
      projectRoot,
      operatingMode: "conversational",
      allowComplexAutoDispatch: false,
    });

    expect(result.updatedRecord.stage).toBe(DispatchStage.Failed);
    expect(tracker.unlinkIssue).toHaveBeenCalledWith("aegis-fjm.9.3", "aegis-fjm.30.1");
    expect(tracker.closeIssue).not.toHaveBeenCalledWith(
      "aegis-fjm.30.1",
      expect.anything(),
    );
    expect(result.createdIssues).toEqual([]);
    expect((await tracker.getIssue("aegis-fjm.30.1")).parentId).toBeNull();
    expect((await tracker.getIssue("aegis-fjm.9.3")).blockers).toEqual([]);
  });

  it("tracks orphaned derived issues when createIssue reports a failed rollback", async () => {
    const orphanedIssue = makeIssue({
      id: "aegis-fjm.30.1",
      title: "Split prompt",
      description: "Derived from Oracle assessment for aegis-fjm.9.3.",
      issueClass: "sub",
      parentId: "aegis-fjm.9.3",
      labels: [],
    });
    const tracker = makeTracker({
      createIssue: vi.fn(async () => {
        const error = new Error("link failed; rollback failed") as Error & {
          createdIssue?: AegisIssue;
        };
        error.createdIssue = orphanedIssue;
        throw error;
      }),
      closeIssue: vi.fn(async (id, reason) =>
        makeIssue({
          id,
          title: reason ?? "Closed derived issue",
          status: "closed",
          issueClass: "sub",
          parentId: "aegis-fjm.9.3",
          labels: [],
        })),
    });

    const result = await runOracle({
      issue: makeIssue(),
      record: makeRecord(),
      runtime: makeRuntime(JSON.stringify({
        files_affected: ["src/core/run-oracle.ts"],
        estimated_complexity: "moderate",
        decompose: true,
        sub_issues: ["Split prompt"],
        ready: false,
      })),
      tracker,
      budget,
      projectRoot,
      operatingMode: "conversational",
      allowComplexAutoDispatch: false,
    });

    expect(result.updatedRecord.stage).toBe(DispatchStage.Failed);
    expect(result.createdIssues).toEqual([]);
    expect(result.rolledBackIssues.map((issue) => issue.id)).toEqual(["aegis-fjm.30.1"]);
    expect(tracker.closeIssue).toHaveBeenCalledWith(
      "aegis-fjm.30.1",
      expect.stringContaining("Failed to materialize"),
    );
  });

  it("fails closed when Oracle emits a malformed final message after an earlier valid assessment", async () => {
    const result = await runOracle({
      issue: makeIssue(),
      record: makeRecord(),
      runtime: makeRuntime([
        JSON.stringify({
          files_affected: ["src/core/run-oracle.ts"],
          estimated_complexity: "moderate",
          decompose: false,
          ready: true,
        }),
        "sorry, one more thing",
      ]),
      tracker: makeTracker(),
      budget,
      projectRoot,
      operatingMode: "conversational",
      allowComplexAutoDispatch: false,
    });

    expect(result.updatedRecord.stage).toBe(DispatchStage.Failed);
    expect(result.failureReason).toMatch(/JSON/i);
    expect(result.assessment).toBeNull();
    expect(result.createdIssues).toEqual([]);
    expect(result.rolledBackIssues).toEqual([]);
  });

  it("rejects non-scouting dispatch records", async () => {
    await expect(
      runOracle({
        issue: makeIssue(),
        record: makeRecord(DispatchStage.Pending),
        runtime: makeRuntime(JSON.stringify({
          files_affected: ["src/core/run-oracle.ts"],
          estimated_complexity: "moderate",
          decompose: false,
          ready: true,
        })),
        tracker: makeTracker(),
        budget,
        projectRoot,
        operatingMode: "conversational",
        allowComplexAutoDispatch: false,
      }),
    ).rejects.toThrow(/scouting/i);
  });

  it("allows complex work when auto mode explicitly permits it", async () => {
    const result = await runOracle({
      issue: makeIssue(),
      record: makeRecord(),
      runtime: makeRuntime(JSON.stringify({
        files_affected: ["src/core/run-oracle.ts"],
        estimated_complexity: "complex",
        decompose: false,
        ready: true,
      })),
      tracker: makeTracker(),
      budget,
      projectRoot,
      operatingMode: "auto",
      allowComplexAutoDispatch: true,
    });

    expect(result.complexityDisposition).toBe("allow");
    expect(result.requiresComplexityGate).toBe(false);
    expect(result.readyForImplementation).toBe(true);
  });

  it("reports readyForImplementation false when assessment ready is false with no blockers", async () => {
    const result = await runOracle({
      issue: makeIssue(),
      record: makeRecord(),
      runtime: makeRuntime(JSON.stringify({
        files_affected: ["src/core/run-oracle.ts"],
        estimated_complexity: "moderate",
        decompose: false,
        ready: false,
      })),
      tracker: makeTracker(),
      budget,
      projectRoot,
      operatingMode: "conversational",
      allowComplexAutoDispatch: false,
    });

    expect(result.updatedRecord.stage).toBe(DispatchStage.Scouted);
    expect(result.complexityDisposition).toBe("allow");
    expect(result.requiresComplexityGate).toBe(false);
    expect(result.readyForImplementation).toBe(false);
    expect(result.failureReason).toBeNull();
  });
});
