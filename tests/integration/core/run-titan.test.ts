import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  TITAN_PROMPT_RULES,
  TITAN_PROMPT_SECTIONS,
  buildTitanPrompt,
  createTitanPromptContract,
} from "../../../src/castes/titan/titan-prompt.js";
import {
  runTitan,
  TITAN_RUN_LIFECYCLE_RULES,
  createTitanRunContract,
} from "../../../src/core/run-titan.js";
import { DispatchStage } from "../../../src/core/stage-transition.js";
import type { DispatchRecord } from "../../../src/core/dispatch-state.js";
import type { AegisIssue } from "../../../src/tracker/issue-model.js";
import type { AgentEvent, AgentHandle, AgentRuntime, SpawnOptions } from "../../../src/runtime/agent-runtime.js";
import type { BudgetLimit } from "../../../src/config/schema.js";

function makeIssue(overrides: Partial<AegisIssue> = {}): AegisIssue {
  return {
    id: "aegis-fjm.10.3",
    title: "[S09] Parallel lane B",
    description: "Implement Titan prompt execution and clarification flow.",
    issueClass: "primary",
    status: "open",
    priority: 1,
    blockers: [],
    parentId: null,
    childIds: [],
    labels: ["mvp", "phase1", "s09"],
    createdAt: "2026-04-03T01:07:48Z",
    updatedAt: "2026-04-05T19:19:25Z",
    ...overrides,
  };
}

function makeRecord(stage: DispatchStage = DispatchStage.Implementing): DispatchRecord {
  return {
    issueId: "aegis-fjm.10.3",
    stage,
    runningAgent: {
      caste: "titan",
      sessionId: "session-titan-1",
      startedAt: "2026-04-05T19:55:00.000Z",
    },
    oracleAssessmentRef: "oracle/aegis-fjm.10.3.json",
    sentinelVerdictRef: null,
    failureCount: 0,
    consecutiveFailures: 0,
    cooldownUntil: null,
    cumulativeSpendUsd: null,
    sessionProvenanceId: "session-aegis-1",
    updatedAt: "2026-04-05T19:55:00.000Z",
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
            timestamp: "2026-04-05T19:55:01.000Z",
            issueId: "aegis-fjm.10.3",
            caste: "titan",
            text: rawResponse,
          });
          listener?.({
            type: "session_ended",
            timestamp: "2026-04-05T19:55:02.000Z",
            issueId: "aegis-fjm.10.3",
            caste: "titan",
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

describe("S09 Titan contract seed", () => {
  it("pins the Titan prompt sections and rules around labor isolation and clarification", () => {
    const projectRoot = path.resolve("C:/dev/aegis");
    const laborPath = path.join(projectRoot, ".aegis", "labors", "labor-aegis-fjm.10.1");

    expect(
      createTitanPromptContract({
        issueId: "aegis-fjm.10.1",
        issueTitle: "[S09] Contract seed",
        issueDescription: "Seed the Titan contract surface.",
        laborPath,
        branchName: "aegis/aegis-fjm.10.1",
        baseBranch: "main",
      }),
    ).toEqual({
      issueId: "aegis-fjm.10.1",
      issueTitle: "[S09] Contract seed",
      issueDescription: "Seed the Titan contract surface.",
      laborPath,
      branchName: "aegis/aegis-fjm.10.1",
      baseBranch: "main",
      sections: TITAN_PROMPT_SECTIONS,
      rules: TITAN_PROMPT_RULES,
    });

    expect(TITAN_PROMPT_SECTIONS).toEqual([
      "issue_context",
      "labor_boundary",
      "handoff_requirements",
      "clarification_rule",
    ]);
    expect(TITAN_PROMPT_RULES).toEqual([
      "write only inside the labor",
      "produce a structured handoff artifact",
      "create a clarification issue instead of guessing",
      "preserve the labor on failure or ambiguity",
    ]);
  });

  it("renders the Titan execution prompt with issue context, labor boundary, and structured JSON response rules", () => {
    const prompt = buildTitanPrompt(
      createTitanPromptContract({
        issueId: "aegis-fjm.10.3",
        issueTitle: "[S09] Parallel lane B",
        issueDescription: "Implement Titan prompt execution and clarification flow.",
        laborPath: path.join("C:/dev/aegis", ".aegis", "labors", "labor-aegis-fjm.10.3"),
        branchName: "aegis/aegis-fjm.10.3",
        baseBranch: "main",
      }),
    );

    expect(prompt).toContain("Issue ID: aegis-fjm.10.3");
    expect(prompt).toContain("Labor path:");
    expect(prompt).toContain("aegis/aegis-fjm.10.3");
    expect(prompt).toContain('"outcome": "success" | "clarification" | "failure"');
    expect(prompt).toContain('"blocking_question"?: string');
    expect(prompt.toLowerCase()).toContain("return only json");
  });

  it("defines the Titan run contract with handoff and clarification artifact shapes", () => {
    const contract = createTitanRunContract({
      issueId: "aegis-fjm.10.1",
      issueTitle: "[S09] Contract seed",
      issueDescription: "Seed the Titan contract surface.",
      laborPath: path.join("C:/dev/aegis", ".aegis", "labors", "labor-aegis-fjm.10.1"),
      branchName: "aegis/aegis-fjm.10.1",
      baseBranch: "main",
    });

    expect(contract.lifecycleRules).toEqual(TITAN_RUN_LIFECYCLE_RULES);
    expect(contract.handoffArtifact).toEqual({
      issueId: "aegis-fjm.10.1",
      laborPath: path.join("C:/dev/aegis", ".aegis", "labors", "labor-aegis-fjm.10.1"),
      candidateBranch: "aegis/aegis-fjm.10.1",
      baseBranch: "main",
      filesChanged: [],
      testsAndChecksRun: [],
      knownRisks: [],
      followUpWork: [],
      learningsWrittenToMnemosyne: [],
    });
    expect(contract.clarificationArtifact).toEqual({
      originalIssueId: "aegis-fjm.10.1",
      issueTitle: "[S09] Contract seed",
      laborPath: path.join("C:/dev/aegis", ".aegis", "labors", "labor-aegis-fjm.10.1"),
      candidateBranch: "aegis/aegis-fjm.10.1",
      baseBranch: "main",
      blockingQuestion: "",
      handoffNote: "",
      preserveLabor: true,
      linkedClarificationIssueId: null,
    });
  });

  it("keeps Titan lifecycle rules explicit for success, clarification, and failure outcomes", () => {
    expect(TITAN_RUN_LIFECYCLE_RULES).toEqual({
      success: {
        outcome: "success",
        retainLabor: true,
        emitHandoffArtifact: true,
        emitClarificationArtifact: false,
      },
      clarification: {
        outcome: "clarification",
        retainLabor: true,
        emitHandoffArtifact: true,
        emitClarificationArtifact: true,
      },
      failure: {
        outcome: "failure",
        retainLabor: true,
        emitHandoffArtifact: true,
        emitClarificationArtifact: false,
      },
    });
  });

  it("runs Titan in the labor, maps a successful response to implemented, and emits a handoff artifact", async () => {
    const spawn = vi.fn(makeRuntime(JSON.stringify({
      outcome: "success",
      summary: "Implemented Titan execution.",
      files_changed: ["src/core/run-titan.ts"],
      tests_and_checks_run: ["npm run test -- tests/integration/core/run-titan.test.ts"],
      known_risks: ["merge queue not wired yet"],
      follow_up_work: [],
      learnings_written_to_mnemosyne: [],
    })).spawn);
    const runtime: AgentRuntime = { spawn };
    const tracker = { createIssue: vi.fn() };
    const budget: BudgetLimit = { turns: 4, tokens: 8000 };

    const result = await runTitan({
      issue: makeIssue(),
      record: makeRecord(),
      labor: {
        issueId: "aegis-fjm.10.3",
        laborPath: path.join("C:/dev/aegis", ".aegis", "labors", "labor-aegis-fjm.10.3"),
        branchName: "aegis/aegis-fjm.10.3",
        baseBranch: "main",
        createWorktreeCommand: {
          command: "git",
          args: [
            "worktree",
            "add",
            "-b",
            "aegis/aegis-fjm.10.3",
            path.join("C:/dev/aegis", ".aegis", "labors", "labor-aegis-fjm.10.3"),
            "main",
          ],
        },
      },
      runtime,
      tracker,
      budget,
    });

    expect(spawn).toHaveBeenCalledWith({
      caste: "titan",
      issueId: "aegis-fjm.10.3",
      workingDirectory: path.join("C:/dev/aegis", ".aegis", "labors", "labor-aegis-fjm.10.3"),
      toolRestrictions: [],
      budget,
    });
    expect(result.outcome).toBe("success");
    expect(result.updatedRecord.stage).toBe(DispatchStage.Implemented);
    expect(result.updatedRecord.runningAgent).toBeNull();
    expect(result.handoffArtifact.filesChanged).toEqual(["src/core/run-titan.ts"]);
    expect(result.handoffArtifact.testsAndChecksRun).toEqual([
      "npm run test -- tests/integration/core/run-titan.test.ts",
    ]);
    expect(result.clarificationArtifact).toBeNull();
    expect(tracker.createIssue).not.toHaveBeenCalled();
    expect(result.prompt).toContain("return only JSON");
  });

  it("creates a clarification issue and maps the Titan attempt to failed when the response is ambiguous", async () => {
    const tracker = {
      createIssue: vi.fn(async () => ({
        ...makeIssue({
          id: "aegis-fjm.30",
          title: "Clarify Titan handoff requirements",
          issueClass: "clarification",
        }),
      })),
    };

    const result = await runTitan({
      issue: makeIssue(),
      record: makeRecord(),
      labor: {
        issueId: "aegis-fjm.10.3",
        laborPath: path.join("C:/dev/aegis", ".aegis", "labors", "labor-aegis-fjm.10.3"),
        branchName: "aegis/aegis-fjm.10.3",
        baseBranch: "main",
        createWorktreeCommand: {
          command: "git",
          args: [
            "worktree",
            "add",
            "-b",
            "aegis/aegis-fjm.10.3",
            path.join("C:/dev/aegis", ".aegis", "labors", "labor-aegis-fjm.10.3"),
            "main",
          ],
        },
      },
      runtime: makeRuntime(JSON.stringify({
        outcome: "clarification",
        summary: "Need explicit acceptance criteria before proceeding.",
        files_changed: [],
        tests_and_checks_run: [],
        known_risks: ["implementation would guess missing requirements"],
        follow_up_work: ["answer the blocking question"],
        learnings_written_to_mnemosyne: [],
        blocking_question: "Should Titan emit one handoff artifact per issue or per merge candidate?",
        handoff_note: "Preserved labor for follow-up after clarification.",
      })),
      tracker,
      budget: { turns: 4, tokens: 8000 },
    });

    expect(result.outcome).toBe("clarification");
    expect(result.updatedRecord.stage).toBe(DispatchStage.Failed);
    expect(result.clarificationArtifact).toEqual({
      originalIssueId: "aegis-fjm.10.3",
      issueTitle: "[S09] Parallel lane B",
      laborPath: path.join("C:/dev/aegis", ".aegis", "labors", "labor-aegis-fjm.10.3"),
      candidateBranch: "aegis/aegis-fjm.10.3",
      baseBranch: "main",
      blockingQuestion: "Should Titan emit one handoff artifact per issue or per merge candidate?",
      handoffNote: "Preserved labor for follow-up after clarification.",
      preserveLabor: true,
      linkedClarificationIssueId: "aegis-fjm.30",
    });
    expect(tracker.createIssue).toHaveBeenCalledWith({
      title: "Clarification needed for [S09] Parallel lane B",
      description: expect.stringContaining("Should Titan emit one handoff artifact per issue or per merge candidate?"),
      issueClass: "clarification",
      priority: 1,
      originId: "aegis-fjm.10.3",
      labels: ["clarification", "titan"],
    });
  });

  it("maps malformed Titan output to a failed dispatch transition", async () => {
    const result = await runTitan({
      issue: makeIssue(),
      record: makeRecord(),
      labor: {
        issueId: "aegis-fjm.10.3",
        laborPath: path.join("C:/dev/aegis", ".aegis", "labors", "labor-aegis-fjm.10.3"),
        branchName: "aegis/aegis-fjm.10.3",
        baseBranch: "main",
        createWorktreeCommand: {
          command: "git",
          args: [
            "worktree",
            "add",
            "-b",
            "aegis/aegis-fjm.10.3",
            path.join("C:/dev/aegis", ".aegis", "labors", "labor-aegis-fjm.10.3"),
            "main",
          ],
        },
      },
      runtime: makeRuntime("{ nope }"),
      tracker: { createIssue: vi.fn() },
      budget: { turns: 4, tokens: 8000 },
    });

    expect(result.outcome).toBe("failure");
    expect(result.updatedRecord.stage).toBe(DispatchStage.Failed);
    expect(result.failureReason).toMatch(/Titan output/i);
  });
});
