import path from "node:path";

import { describe, expect, it, vi } from "vitest";

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
    failureCount: 0,
    consecutiveFailures: 0,
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

function makeTracker(overrides: Partial<OracleIssueCreator> = {}): OracleIssueCreator {
  let createdCount = 0;

  return {
    createIssue: vi.fn(async (input) => {
      createdCount += 1;
      return makeIssue({
        id: `aegis-fjm.30.${createdCount}`,
        title: input.title,
        description: input.description,
        issueClass: input.issueClass,
      });
    }),
    addBlocker: vi.fn(async () => undefined),
    closeIssue: vi.fn(async (id, reason) =>
      makeIssue({
        id,
        title: reason ?? "Closed derived issue",
        status: "closed",
        issueClass: "sub",
      })),
    ...overrides,
  };
}

describe("buildOraclePrompt", () => {
  it("includes the issue context and the strict OracleAssessment contract", () => {
    const prompt = buildOraclePrompt(makeIssue());

    expect(prompt).toContain("aegis-fjm.9.3");
    expect(prompt).toContain("[S08] Parallel lane B");
    expect(prompt).toContain("files_affected");
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
  const projectRoot = path.resolve("C:/dev/aegis");
  const budget: BudgetLimit = { turns: 4, tokens: 8000 };

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
    expect(result.updatedRecord.oracleAssessmentRef).toBe("oracle/aegis-fjm.9.3.json");
    expect(result.assessment.estimated_complexity).toBe("complex");
    expect(result.complexityDisposition).toBe("needs_human_approval");
    expect(result.requiresComplexityGate).toBe(true);
    expect(result.readyForImplementation).toBe(false);
    expect(result.createdIssues.map((issue) => issue.id)).toEqual([
      "aegis-fjm.30.1",
      "aegis-fjm.30.2",
    ]);
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
  });

  it("rolls back a created decomposition issue when parent blocker linkage fails", async () => {
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
    expect(result.failureReason).toMatch(/dep add failed/i);
    expect(tracker.closeIssue).toHaveBeenCalledWith(
      "aegis-fjm.30.2",
      expect.stringContaining("Failed to block"),
    );
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
});
