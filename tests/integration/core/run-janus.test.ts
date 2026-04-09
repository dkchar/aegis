import path from "node:path";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import {
  runJanus,
  type RunJanusInput,
  type RunJanusResult,
  type JanusIssueCreator,
} from "../../../src/core/run-janus.js";
import { DispatchStage } from "../../../src/core/stage-transition.js";
import type { DispatchRecord } from "../../../src/core/dispatch-state.js";
import type {
  AgentEvent,
  AgentHandle,
  AgentRuntime,
  SpawnOptions,
} from "../../../src/runtime/agent-runtime.js";
import type { BudgetLimit } from "../../../src/config/schema.js";
import { DEFAULT_AEGIS_CONFIG } from "../../../src/config/defaults.js";

const DEFAULT_PROJECT_ROOT = path.resolve("C:/dev/aegis");

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeRecord(stage: DispatchStage = DispatchStage.ResolvingIntegration): DispatchRecord {
  return {
    issueId: "aegis-fjm.19",
    stage,
    runningAgent: {
      caste: "janus",
      sessionId: "session-janus-1",
      startedAt: "2026-04-07T20:00:00.000Z",
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
    updatedAt: "2026-04-07T20:00:00.000Z",
  };
}

function makeBudget(overrides: Partial<BudgetLimit> = {}): BudgetLimit {
  return {
    turns: 12,
    tokens: 120_000,
    ...overrides,
  };
}

function makeJanusInput(overrides: Partial<RunJanusInput> = {}): RunJanusInput {
  return {
    issueId: "aegis-fjm.19",
    queueItemId: "queue-item-1",
    preservedLaborPath: path.join(DEFAULT_PROJECT_ROOT, ".aegis", "labors", "labor-conflict"),
    conflictSummary: "Merge conflict in src/core/run-titan.ts",
    filesInvolved: ["src/core/run-titan.ts", "src/core/dispatch-state.ts"],
    previousMergeErrors: "CONFLICT (content): Merge conflict in src/core/run-titan.ts",
    conflictTier: 3,
    record: makeRecord(),
    runtime: makeJanusRuntime(validJanusOutput("requeue")),
    budget: makeBudget(),
    projectRoot: DEFAULT_PROJECT_ROOT,
    ...overrides,
  };
}

function makeIssueCreator(): JanusIssueCreator {
  return {
    getIssue: vi.fn(async (id: string) => ({
      id,
      title: "Test issue",
      status: "open",
    })),
  };
}

// ---------------------------------------------------------------------------
// Runtime helpers
// ---------------------------------------------------------------------------

function validJanusOutput(action: "requeue" | "manual_decision" | "fail"): string {
  return JSON.stringify({
    originatingIssueId: "aegis-fjm.19",
    queueItemId: "queue-item-1",
    preservedLaborPath: ".aegis/labors/labor-conflict",
    conflictSummary: "Resolved merge conflict by accepting both changes",
    resolutionStrategy: "manual merge with conflict resolution",
    filesTouched: ["src/core/run-titan.ts"],
    validationsRun: ["npm run build", "npm run test"],
    residualRisks: ["Minor refactoring may affect edge cases"],
    recommendedNextAction: action,
  });
}

function makeJanusRuntime(rawResponse: string | string[], options: { crash?: boolean; endReason?: "completed" | "aborted" | "error" | "budget_exceeded" } = {}): AgentRuntime {
  const responses = Array.isArray(rawResponse) ? rawResponse : [rawResponse];
  const { crash = false, endReason = "completed" } = options;

  return {
    async spawn(_opts: SpawnOptions): Promise<AgentHandle> {
      let listener: ((event: AgentEvent) => void) | null = null;

      return {
        async prompt(): Promise<void> {
          if (crash) {
            listener?.({
              type: "error",
              timestamp: "2026-04-07T20:00:01.000Z",
              issueId: "aegis-fjm.19",
              caste: "janus",
              message: "Runtime crashed unexpectedly",
              fatal: true,
            });
            return;
          }

          for (const [index, response] of responses.entries()) {
            listener?.({
              type: "message",
              timestamp: `2026-04-07T20:00:0${index + 1}.000Z`,
              issueId: "aegis-fjm.19",
              caste: "janus",
              text: response,
            });
          }
          listener?.({
            type: "session_ended",
            timestamp: "2026-04-07T20:00:02.000Z",
            issueId: "aegis-fjm.19",
            caste: "janus",
            reason: endReason,
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

function makeCrashingRuntime(): AgentRuntime {
  return makeJanusRuntime("", { crash: true });
}

function makeIncompleteRuntime(): AgentRuntime {
  return makeJanusRuntime("", { endReason: "aborted" });
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "run-janus-test-"));
});

afterEach(() => {
  if (existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("runJanus - success path (requeue)", () => {
  it("transitions resolving_integration → queued_for_merge on requeue", async () => {
    const input = makeJanusInput({
      runtime: makeJanusRuntime(validJanusOutput("requeue")),
      projectRoot: tempDir,
    });
    const result = await runJanus(input);

    expect(result.updatedRecord.stage).toBe(DispatchStage.QueuedForMerge);
    expect(result.updatedRecord.runningAgent).toBeNull();
    expect(result.failureReason).toBeNull();
    expect(result.recommendedNextAction).toBe("requeue");
    expect(result.resolutionArtifact).not.toBeNull();
    expect(result.resolutionArtifact!.recommendedNextAction).toBe("requeue");
  });

  it("propagates the configured Janus model into runtime.spawn", async () => {
    const spawn = vi.fn(makeJanusRuntime(validJanusOutput("requeue")).spawn);
    const runtime: AgentRuntime = { spawn };
    const input = makeJanusInput({
      runtime,
      projectRoot: tempDir,
    });

    await runJanus(input);

    expect(spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        caste: "janus",
        model: DEFAULT_AEGIS_CONFIG.models.janus,
      }),
    );
  });

  it("persists the Janus resolution artifact to disk", async () => {
    const input = makeJanusInput({
      runtime: makeJanusRuntime(validJanusOutput("requeue")),
      projectRoot: tempDir,
    });
    const result = await runJanus(input);

    const artifactPath = path.join(tempDir, ".aegis", "janus", "aegis-fjm.19.json");
    expect(existsSync(artifactPath)).toBe(true);
    const persisted = JSON.parse(readFileSync(artifactPath, "utf-8"));
    expect(persisted.recommendedNextAction).toBe("requeue");
    expect(persisted.originatingIssueId).toBe("aegis-fjm.19");
  });

  it("constructs the correct Janus prompt", async () => {
    const input = makeJanusInput({
      runtime: makeJanusRuntime(validJanusOutput("requeue")),
      projectRoot: tempDir,
    });
    const result = await runJanus(input);

    expect(result.prompt).toContain("Janus");
    expect(result.prompt).toContain("aegis-fjm.19");
    expect(result.prompt).toContain("queue-item-1");
    expect(result.prompt).toContain("Conflict tier: 3");
    expect(result.prompt).toContain("conflict");
  });
});

describe("runJanus - manual_decision path", () => {
  it("transitions resolving_integration → failed on manual_decision", async () => {
    const input = makeJanusInput({
      runtime: makeJanusRuntime(validJanusOutput("manual_decision")),
      projectRoot: tempDir,
    });
    const result = await runJanus(input);

    expect(result.updatedRecord.stage).toBe(DispatchStage.Failed);
    expect(result.updatedRecord.runningAgent).toBeNull();
    expect(result.failureReason).toContain("manual human decision");
    expect(result.recommendedNextAction).toBe("manual_decision");
    expect(result.resolutionArtifact).not.toBeNull();
  });

  it("persists the artifact even on manual_decision", async () => {
    const input = makeJanusInput({
      runtime: makeJanusRuntime(validJanusOutput("manual_decision")),
      projectRoot: tempDir,
    });
    const result = await runJanus(input);

    const artifactPath = path.join(tempDir, ".aegis", "janus", "aegis-fjm.19.json");
    expect(existsSync(artifactPath)).toBe(true);
  });
});

describe("runJanus - fail path", () => {
  it("transitions resolving_integration → failed on fail recommendation", async () => {
    const input = makeJanusInput({
      runtime: makeJanusRuntime(validJanusOutput("fail")),
      projectRoot: tempDir,
    });
    const result = await runJanus(input);

    expect(result.updatedRecord.stage).toBe(DispatchStage.Failed);
    expect(result.updatedRecord.runningAgent).toBeNull();
    expect(result.failureReason).toContain("recommended fail");
    expect(result.recommendedNextAction).toBe("fail");
    expect(result.resolutionArtifact).not.toBeNull();
  });
});

describe("runJanus - runtime crash handling", () => {
  it("transitions to failed when runtime crashes", async () => {
    const input = makeJanusInput({
      runtime: makeCrashingRuntime(),
      projectRoot: tempDir,
    });
    const result = await runJanus(input);

    expect(result.updatedRecord.stage).toBe(DispatchStage.Failed);
    expect(result.updatedRecord.runningAgent).toBeNull();
    expect(result.failureReason).toContain("crashed");
    expect(result.resolutionArtifact).toBeNull();
    expect(result.recommendedNextAction).toBeNull();
  });

  it("transitions to failed when session ends with non-completed reason", async () => {
    const input = makeJanusInput({
      runtime: makeIncompleteRuntime(),
      projectRoot: tempDir,
    });
    const result = await runJanus(input);

    expect(result.updatedRecord.stage).toBe(DispatchStage.Failed);
    expect(result.failureReason).toContain("aborted");
  });
});

describe("runJanus - malformed output handling", () => {
  it("transitions to failed when Janus output is not valid JSON", async () => {
    const input = makeJanusInput({
      runtime: makeJanusRuntime("This is not JSON at all"),
      projectRoot: tempDir,
    });
    const result = await runJanus(input);

    expect(result.updatedRecord.stage).toBe(DispatchStage.Failed);
    expect(result.updatedRecord.runningAgent).toBeNull();
    expect(result.failureReason).toContain("JSON");
    expect(result.resolutionArtifact).toBeNull();
  });

  it("transitions to failed when Janus output is missing required fields", async () => {
    const malformedOutput = JSON.stringify({
      originatingIssueId: "aegis-fjm.19",
      // Missing all other required fields
    });
    const input = makeJanusInput({
      runtime: makeJanusRuntime(malformedOutput),
      projectRoot: tempDir,
    });
    const result = await runJanus(input);

    expect(result.updatedRecord.stage).toBe(DispatchStage.Failed);
    expect(result.failureReason).toContain("missing");
  });

  it("transitions to failed when recommendedNextAction is invalid", async () => {
    const malformedOutput = JSON.stringify({
      originatingIssueId: "aegis-fjm.19",
      queueItemId: "queue-item-1",
      preservedLaborPath: ".aegis/labors/labor-conflict",
      conflictSummary: "test",
      resolutionStrategy: "test",
      filesTouched: [],
      validationsRun: [],
      residualRisks: [],
      recommendedNextAction: "invalid_action",
    });
    const input = makeJanusInput({
      runtime: makeJanusRuntime(malformedOutput),
      projectRoot: tempDir,
    });
    const result = await runJanus(input);

    expect(result.updatedRecord.stage).toBe(DispatchStage.Failed);
    expect(result.failureReason).toContain("recommendedNextAction");
  });
});

describe("runJanus - budget kill handling", () => {
  it("transitions to failed when budget is exceeded", async () => {
    // Create a runtime that sends messages with stats that exceed budget
    const budgetExceededRuntime: AgentRuntime = {
      async spawn(_opts: SpawnOptions): Promise<AgentHandle> {
        let listener: ((event: AgentEvent) => void) | null = null;
        let messageCount = 0;

        return {
          async prompt(): Promise<void> {
            // Simulate multiple messages that would exceed budget
            for (let i = 0; i < 15; i++) {
              messageCount++;
              listener?.({
                type: "message",
                timestamp: `2026-04-07T20:00:0${i}.000Z`,
                issueId: "aegis-fjm.19",
                caste: "janus",
                text: `Message ${i}`,
              });
            }
            listener?.({
              type: "session_ended",
              timestamp: "2026-04-07T20:00:16.000Z",
              issueId: "aegis-fjm.19",
              caste: "janus",
              reason: "completed",
              stats: {
                input_tokens: 1000,
                output_tokens: 2000,
                session_turns: 15,
                wall_time_sec: 16,
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
              input_tokens: 1000 * messageCount,
              output_tokens: 2000 * messageCount,
              session_turns: messageCount,
              wall_time_sec: messageCount,
            };
          },
        };
      },
    };

    // Use a very small budget to trigger exceeding
    const input = makeJanusInput({
      runtime: budgetExceededRuntime,
      budget: { turns: 2, tokens: 100 },
      projectRoot: tempDir,
    });
    const result = await runJanus(input);

    expect(result.updatedRecord.stage).toBe(DispatchStage.Failed);
    expect(result.updatedRecord.runningAgent).toBeNull();
    expect(result.failureReason).toContain("budget");
  });
});

describe("runJanus - stage guard", () => {
  it("throws if record is not in resolving_integration stage", async () => {
    const input = makeJanusInput({
      record: makeRecord(DispatchStage.QueuedForMerge),
    });

    await expect(runJanus(input)).rejects.toThrow("resolving_integration");
  });

  it("throws if record is in implementing stage", async () => {
    const input = makeJanusInput({
      record: makeRecord(DispatchStage.Implementing),
    });

    await expect(runJanus(input)).rejects.toThrow("resolving_integration");
  });
});

describe("runJanus - prompt construction", () => {
  it("includes conflict context in prompt", async () => {
    const input = makeJanusInput({
      runtime: makeJanusRuntime(validJanusOutput("requeue")),
      conflictSummary: "Complex merge conflict with semantic ambiguity",
      filesInvolved: ["src/a.ts", "src/b.ts", "src/c.ts"],
      previousMergeErrors: "CONFLICT: semantic ambiguity detected",
      projectRoot: tempDir,
    });
    const result = await runJanus(input);

    expect(result.prompt).toContain("Complex merge conflict with semantic ambiguity");
    expect(result.prompt).toContain("src/a.ts");
    expect(result.prompt).toContain("src/b.ts");
    expect(result.prompt).toContain("semantic ambiguity");
  });
});
