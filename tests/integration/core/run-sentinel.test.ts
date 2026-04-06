/**
 * S09A — Sentinel dispatch integration tests.
 *
 * Tests prompt construction, fix-issue creation, and the full run-sentinel.ts
 * dispatch flow with mocked runtime:
 * - pass verdict → complete transition
 * - fail verdict → failed transition + fix issue creation
 * - error → failed with fail-closed behavior
 * - stage precondition (must be in "reviewing" stage)
 * - verdict artifact persistence to .aegis/sentinel/
 */

import { readFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BudgetLimit } from "../../../src/config/schema.js";
import type { DispatchRecord } from "../../../src/core/dispatch-state.js";
import type { SentinelIssueCreator } from "../../../src/core/run-sentinel.js";
import { runSentinel } from "../../../src/core/run-sentinel.js";
import { DispatchStage } from "../../../src/core/stage-transition.js";
import {
  createSentinelPromptContract,
  buildSentinelPrompt,
} from "../../../src/castes/sentinel/sentinel-prompt.js";
import { createFixIssueInputs } from "../../../src/tracker/create-fix-issue.js";
import type {
  AgentEvent,
  AgentHandle,
  AgentRuntime,
  SpawnOptions,
} from "../../../src/runtime/agent-runtime.js";
import type { AegisIssue } from "../../../src/tracker/issue-model.js";

function makeIssue(overrides: Partial<AegisIssue> = {}): AegisIssue {
  return {
    id: "aegis-fjm.1",
    title: "Test issue for Sentinel review",
    description: "An issue that has been merged and needs review.",
    issueClass: "primary",
    status: "open",
    priority: 1,
    blockers: [],
    parentId: null,
    childIds: [],
    labels: ["mvp", "phase1", "s09a"],
    createdAt: "2026-04-03T01:07:43Z",
    updatedAt: "2026-04-06T17:00:00Z",
    ...overrides,
  };
}

function makeRecord(stage: DispatchStage = DispatchStage.Reviewing): DispatchRecord {
  return {
    issueId: "aegis-fjm.1",
    stage,
    runningAgent: {
      caste: "sentinel",
      sessionId: "session-sentinel-1",
      startedAt: "2026-04-06T17:00:00.000Z",
    },
    oracleAssessmentRef: null,
    sentinelVerdictRef: null,
    failureCount: 0,
    consecutiveFailures: 0,
    failureWindowStartMs: null,
    cooldownUntil: null,
    cumulativeSpendUsd: null,
    sessionProvenanceId: "session-aegis-1",
    updatedAt: "2026-04-06T17:00:00.000Z",
  };
}

function makeRuntime(rawResponse: string): AgentRuntime {
  return {
    async spawn(_opts: SpawnOptions): Promise<AgentHandle> {
      let listener: ((event: AgentEvent) => void) | null = null;

      return {
        async prompt(): Promise<void> {
          listener?.({
            type: "message",
            timestamp: "2026-04-06T17:00:01.000Z",
            issueId: "aegis-fjm.1",
            caste: "sentinel",
            text: rawResponse,
          });
          listener?.({
            type: "session_ended",
            timestamp: "2026-04-06T17:00:02.000Z",
            issueId: "aegis-fjm.1",
            caste: "sentinel",
            reason: "completed",
            stats: {
              input_tokens: 100,
              output_tokens: 200,
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
            input_tokens: 100,
            output_tokens: 200,
            session_turns: 1,
            wall_time_sec: 1,
          };
        },
      };
    },
  };
}

function makeFailingRuntime(errorMessage: string): AgentRuntime {
  return {
    async spawn(_opts: SpawnOptions): Promise<AgentHandle> {
      return {
        async prompt(): Promise<void> {
          throw new Error(errorMessage);
        },
        async steer(): Promise<void> {},
        async abort(): Promise<void> {},
        subscribe(): () => void {
          return () => {};
        },
        getStats() {
          return {
            input_tokens: 0,
            output_tokens: 0,
            session_turns: 0,
            wall_time_sec: 0,
          };
        },
      };
    },
  };
}

function makeTracker(overrides: Partial<SentinelIssueCreator> = {}): SentinelIssueCreator {
  return {
    createIssue: vi.fn(async (input) => {
      return makeIssue({
        id: "aegis-fjm.30.1",
        title: input.title,
        description: input.description,
        issueClass: input.issueClass,
        labels: [...input.labels],
        parentId: input.originId,
      });
    }),
    addBlocker: vi.fn(async () => undefined),
    closeIssue: vi.fn(async (id: string) => makeIssue({ id, status: "closed" })),
    ...overrides,
  };
}

describe("Sentinel prompt construction", () => {
  it("builds a prompt with issue context", () => {
    const contract = createSentinelPromptContract({
      issueId: "aegis-fjm.1",
      issueTitle: "Test",
      issueDescription: "Test description",
      targetBranch: "main",
      baseBranch: "develop",
    });

    const prompt = buildSentinelPrompt(contract);

    expect(prompt).toContain("You are Sentinel");
    expect(prompt).toContain("aegis-fjm.1");
    expect(prompt).toContain("Test description");
    expect(prompt).toContain("main");
  });

  it("handles null issue description", () => {
    const contract = createSentinelPromptContract({
      issueId: "aegis-fjm.1",
      issueTitle: "Test",
      issueDescription: null,
      targetBranch: "main",
      baseBranch: "develop",
    });

    const prompt = buildSentinelPrompt(contract);

    expect(prompt).toContain("Description: (none)");
    expect(prompt).toContain("Base branch: develop");
  });

  it("includes read-only tool constraint", () => {
    const contract = createSentinelPromptContract({
      issueId: "aegis-fjm.1",
      issueTitle: "Test",
      issueDescription: null,
      targetBranch: "main",
      baseBranch: "main",
    });

    const prompt = buildSentinelPrompt(contract);

    expect(prompt).toMatch(/read.only/i);
  });
});

describe("Sentinel fix issue creation", () => {
  it("returns empty array for pass verdict", () => {
    const passVerdict = {
      verdict: "pass" as const,
      reviewSummary: "OK",
      issuesFound: [],
      followUpIssueIds: [],
      riskAreas: [],
    };

    const inputs = createFixIssueInputs(makeIssue(), passVerdict);
    expect(inputs).toHaveLength(0);
  });

  it("creates fix issues for fail verdict", () => {
    const failVerdict = {
      verdict: "fail" as const,
      reviewSummary: "Found issues",
      issuesFound: ["Bug 1", "Bug 2"],
      followUpIssueIds: [],
      riskAreas: ["area1"],
    };

    const inputs = createFixIssueInputs(makeIssue(), failVerdict);
    expect(inputs).toHaveLength(2);
    expect(inputs[0].title).toMatch(/^Fix:/);
    expect(inputs[0].issueClass).toBe("fix");
  });
});

describe("runSentinel", () => {
  const budget: BudgetLimit = { turns: 8, tokens: 100_000 };
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(path.join(tmpdir(), "aegis-s09a-sentinel-"));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("rejects a dispatch record not in the reviewing stage", async () => {
    await expect(
      runSentinel({
        issue: makeIssue(),
        record: makeRecord(DispatchStage.Merged),
        runtime: makeRuntime(""),
        tracker: makeTracker(),
        budget,
        projectRoot,
      }),
    ).rejects.toThrow(/reviewing/i);
  });

  it("runs Sentinel, parses a pass verdict, persists the artifact, and transitions to complete", async () => {
    const passVerdict = JSON.stringify({
      verdict: "pass",
      reviewSummary: "All changes follow conventions. No issues found.",
      issuesFound: [],
      followUpIssueIds: [],
      riskAreas: ["Consider adding more edge-case tests"],
    });

    const spawn = vi.fn(makeRuntime(passVerdict).spawn);
    const runtime: AgentRuntime = { spawn };
    const tracker = makeTracker();

    const result = await runSentinel({
      issue: makeIssue(),
      record: makeRecord(),
      runtime,
      tracker,
      budget,
      projectRoot,
    });

    expect(spawn).toHaveBeenCalledWith({
      caste: "sentinel",
      issueId: "aegis-fjm.1",
      workingDirectory: projectRoot,
      toolRestrictions: ["read", "read-only shell", "tracker commands"],
      budget,
    });
    expect(result.verdict).not.toBeNull();
    expect(result.verdict?.verdict).toBe("pass");
    expect(result.updatedRecord.stage).toBe(DispatchStage.Complete);
    expect(result.updatedRecord.runningAgent).toBeNull();
    expect(result.updatedRecord.sentinelVerdictRef).not.toBeNull();
    expect(tracker.createIssue).not.toHaveBeenCalled();
    expect(tracker.addBlocker).not.toHaveBeenCalled();

    // Verify artifact was persisted
    if (result.updatedRecord.sentinelVerdictRef) {
      const persisted = JSON.parse(
        readFileSync(path.join(projectRoot, result.updatedRecord.sentinelVerdictRef), "utf8"),
      );
      expect(persisted.verdict).toBe("pass");
    }
  });

  it("parses a fail verdict, creates fix issues, links them as blockers, and transitions to failed", async () => {
    const failVerdict = JSON.stringify({
      verdict: "fail",
      reviewSummary: "Critical issues found in the merge handling logic.",
      issuesFound: [
        "Missing error handling in dispatch-state reconciliation",
        "No test coverage for concurrent merge attempts",
      ],
      followUpIssueIds: [],
      riskAreas: ["Dispatch state persistence"],
    });

    const createdIssues = [
      makeIssue({
        id: "aegis-fjm.30.1",
        title: "Fix: Missing error handling in dispatch-state reconciliation",
        issueClass: "fix",
        labels: ["sentinel-fix"],
        parentId: "aegis-fjm.1",
      }),
      makeIssue({
        id: "aegis-fjm.30.2",
        title: "Fix: No test coverage for concurrent merge attempts",
        issueClass: "fix",
        labels: ["sentinel-fix"],
        parentId: "aegis-fjm.1",
      }),
    ];

    const tracker = makeTracker({
      createIssue: vi.fn(async (input) => {
        const index = createdIssues.findIndex((ci) => ci.title === input.title);
        return createdIssues[index >= 0 ? index : 0];
      }),
    });

    const result = await runSentinel({
      issue: makeIssue(),
      record: makeRecord(),
      runtime: makeRuntime(failVerdict),
      tracker,
      budget,
      projectRoot,
    });

    expect(result.verdict?.verdict).toBe("fail");
    expect(result.updatedRecord.stage).toBe(DispatchStage.Failed);
    expect(result.createdFixIssues).toHaveLength(2);
    expect(tracker.createIssue).toHaveBeenCalledTimes(2);
    expect(tracker.addBlocker).toHaveBeenCalledTimes(2);
    expect(tracker.addBlocker).toHaveBeenNthCalledWith(1, "aegis-fjm.1", "aegis-fjm.30.1");
    expect(tracker.addBlocker).toHaveBeenNthCalledWith(2, "aegis-fjm.1", "aegis-fjm.30.2");
  });

  it("fails closed when the runtime throws an error", async () => {
    const tracker = makeTracker();

    const result = await runSentinel({
      issue: makeIssue(),
      record: makeRecord(),
      runtime: makeFailingRuntime("Session crashed unexpectedly"),
      tracker,
      budget,
      projectRoot,
    });

    expect(result.updatedRecord.stage).toBe(DispatchStage.Failed);
    expect(result.failureReason).toMatch(/Session crashed/);
    expect(result.updatedRecord.runningAgent).toBeNull();
    expect(tracker.createIssue).not.toHaveBeenCalled();
  });

  it("fails closed when Sentinel returns malformed JSON", async () => {
    const result = await runSentinel({
      issue: makeIssue(),
      record: makeRecord(),
      runtime: makeRuntime("{ not valid json }"),
      tracker: makeTracker(),
      budget,
      projectRoot,
    });

    expect(result.updatedRecord.stage).toBe(DispatchStage.Failed);
    expect(result.failureReason).toMatch(/final message payload/i);
  });

  it("fails closed when Sentinel returns an invalid verdict shape", async () => {
    const result = await runSentinel({
      issue: makeIssue(),
      record: makeRecord(),
      runtime: makeRuntime(JSON.stringify({ verdict: "maybe" })),
      tracker: makeTracker(),
      budget,
      projectRoot,
    });

    expect(result.updatedRecord.stage).toBe(DispatchStage.Failed);
    expect(result.failureReason).toMatch(/final message payload|verdict/i);
  });

  it("uses the default Sentinel budget of 8 turns and 100k tokens when budget matches spec", async () => {
    const passVerdict = JSON.stringify({
      verdict: "pass",
      reviewSummary: "OK",
      issuesFound: [],
      followUpIssueIds: [],
      riskAreas: [],
    });

    const spawn = vi.fn(makeRuntime(passVerdict).spawn);
    const runtime: AgentRuntime = { spawn };

    await runSentinel({
      issue: makeIssue(),
      record: makeRecord(),
      runtime,
      tracker: makeTracker(),
      budget: { turns: 8, tokens: 100_000 },
      projectRoot,
    });

    expect(spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        budget: { turns: 8, tokens: 100_000 },
      }),
    );
  });

  it("includes the Sentinel prompt with issue context in the runtime spawn", async () => {
    const passVerdict = JSON.stringify({
      verdict: "pass",
      reviewSummary: "OK",
      issuesFound: [],
      followUpIssueIds: [],
      riskAreas: [],
    });

    const spawn = vi.fn(makeRuntime(passVerdict).spawn);
    const runtime: AgentRuntime = { spawn };

    const issue = makeIssue({
      id: "aegis-fjm.42",
      title: "Add dispatch state recovery",
      description: "Implement recovery logic.",
    });

    await runSentinel({
      issue,
      record: {
        ...makeRecord(),
        issueId: "aegis-fjm.42",
      },
      runtime,
      tracker: makeTracker(),
      budget,
      projectRoot,
    });

    expect(spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        caste: "sentinel",
        issueId: "aegis-fjm.42",
      }),
    );
  });

  it("fails closed and closes orphaned fix issues when addBlocker throws", async () => {
    const failVerdict = JSON.stringify({
      verdict: "fail",
      reviewSummary: "Found issues",
      issuesFound: ["Bug 1", "Bug 2"],
      followUpIssueIds: [],
      riskAreas: [],
    });

    const createdIssue1 = makeIssue({ id: "fix-1", title: "Fix: Bug 1", issueClass: "fix" });
    const createdIssue2 = makeIssue({ id: "fix-2", title: "Fix: Bug 2", issueClass: "fix" });
    let callCount = 0;

    const tracker = makeTracker({
      createIssue: vi.fn(async () => {
        callCount += 1;
        return callCount === 1 ? createdIssue1 : createdIssue2;
      }),
      addBlocker: vi.fn(async (blockedId: string, blockerId: string) => {
        // Succeed for first issue, fail for second
        if (blockerId === "fix-1") return undefined;
        throw new Error("Blocker link failed");
      }),
    });

    // runSentinel catches materializeFixIssues errors and returns a failed result
    const result = await runSentinel({
      issue: makeIssue(),
      record: makeRecord(),
      runtime: makeRuntime(failVerdict),
      tracker,
      budget,
      projectRoot,
    });

    expect(result.updatedRecord.stage).toBe(DispatchStage.Failed);
    expect(result.failureReason).toMatch(/Blocker link failed/);

    // The second fix issue should be closed since its blocker was never linked
    expect(tracker.closeIssue).toHaveBeenCalledWith(
      "fix-2",
      "Sentinel review for aegis-fjm.1 failed during fix-issue materialization",
    );
  });

  it("fails closed when session ends with non-completed reason", async () => {
    const runtime: AgentRuntime = {
      async spawn(): Promise<AgentHandle> {
        let listener: ((event: AgentEvent) => void) | null = null;
        return {
          async prompt(): Promise<void> {
            // Emit session_ended with a non-completed reason
            listener?.({
              type: "session_ended",
              timestamp: "2026-04-06T17:00:02.000Z",
              issueId: "aegis-fjm.1",
              caste: "sentinel",
              reason: "budget_exceeded",
              stats: { input_tokens: 0, output_tokens: 0, session_turns: 0, wall_time_sec: 0 },
            });
          },
          async steer(): Promise<void> {},
          async abort(): Promise<void> {},
          subscribe(next): () => void {
            listener = next;
            return () => { listener = null; };
          },
          getStats() {
            return { input_tokens: 0, output_tokens: 0, session_turns: 0, wall_time_sec: 0 };
          },
        };
      },
    };

    const result = await runSentinel({
      issue: makeIssue(),
      record: makeRecord(),
      runtime,
      tracker: makeTracker(),
      budget,
      projectRoot,
    });

    expect(result.updatedRecord.stage).toBe(DispatchStage.Failed);
    expect(result.failureReason).toMatch(/budget_exceeded/);
  });

  it("fails closed when Sentinel returns no messages", async () => {
    const runtime: AgentRuntime = {
      async spawn(): Promise<AgentHandle> {
        let listener: ((event: AgentEvent) => void) | null = null;
        return {
          async prompt(): Promise<void> {
            // Emit session_ended without any messages
            listener?.({
              type: "session_ended",
              timestamp: "2026-04-06T17:00:02.000Z",
              issueId: "aegis-fjm.1",
              caste: "sentinel",
              reason: "completed",
              stats: { input_tokens: 0, output_tokens: 0, session_turns: 0, wall_time_sec: 0 },
            });
          },
          async steer(): Promise<void> {},
          async abort(): Promise<void> {},
          subscribe(next): () => void {
            listener = next;
            return () => { listener = null; };
          },
          getStats() {
            return { input_tokens: 0, output_tokens: 0, session_turns: 0, wall_time_sec: 0 };
          },
        };
      },
    };

    const result = await runSentinel({
      issue: makeIssue(),
      record: makeRecord(),
      runtime,
      tracker: makeTracker(),
      budget,
      projectRoot,
    });

    expect(result.updatedRecord.stage).toBe(DispatchStage.Failed);
    expect(result.failureReason).toMatch(/final message payload/);
  });
});
