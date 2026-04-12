import path from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { DEFAULT_AEGIS_CONFIG } from "../../../src/config/defaults.js";
import { executeProjectDirectCommand } from "../../../src/core/direct-command-runner.js";
import { loadDispatchState } from "../../../src/core/dispatch-state.js";
import { DispatchStage } from "../../../src/core/stage-transition.js";
import { createScenarioSandbox, createTrackedIssue, InMemoryScenarioTracker } from "../../../src/evals/mvp-scenario-runners/shared.js";
import { loadMergeQueueState } from "../../../src/merge/merge-queue-store.js";
import { parseCommand } from "../../../src/cli/parse-command.js";
import type { AgentEvent, AgentHandle, AgentRuntime, SpawnOptions } from "../../../src/runtime/agent-runtime.js";
import type { AegisLiveEvent } from "../../../src/events/event-bus.js";

const ISSUE_ID = "liveaegis-1n2";

function createPromptDrivenRuntime(): AgentRuntime {
  return {
    async spawn(opts: SpawnOptions): Promise<AgentHandle> {
      let listener: ((event: AgentEvent) => void) | null = null;

      return {
        async prompt(): Promise<void> {
          if (opts.caste === "titan") {
            const implementedFile = path.join(
              opts.workingDirectory,
              "src",
              "scenarios",
              `${opts.issueId}.ts`,
            );
            mkdirSync(path.dirname(implementedFile), { recursive: true });
            writeFileSync(
              implementedFile,
              `export const implemented = "${opts.issueId}";\n`,
              "utf8",
            );
          }

          const response = buildRuntimeResponse(opts);
          listener?.({
            type: "message",
            timestamp: new Date().toISOString(),
            issueId: opts.issueId,
            caste: opts.caste,
            text: response,
          });
          listener?.({
            type: "session_ended",
            timestamp: new Date().toISOString(),
            issueId: opts.issueId,
            caste: opts.caste,
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

function buildRuntimeResponse(opts: SpawnOptions): string {
  switch (opts.caste) {
    case "oracle":
      return JSON.stringify({
        files_affected: [`src/scenarios/${opts.issueId}.ts`],
        estimated_complexity: "moderate",
        decompose: false,
        ready: true,
      });
    case "titan":
      return JSON.stringify({
        outcome: "success",
        summary: `Implemented ${opts.issueId}`,
        files_changed: [`src/scenarios/${opts.issueId}.ts`],
        tests_and_checks_run: ["npm run test"],
        known_risks: [],
        follow_up_work: [],
        learnings_written_to_mnemosyne: [],
      });
    case "sentinel":
      return JSON.stringify({
        verdict: "pass",
        reviewSummary: `Reviewed ${opts.issueId}`,
        issuesFound: [],
        followUpIssueIds: [],
        riskAreas: [],
      });
    default:
      throw new Error(`Unexpected scripted caste: ${opts.caste}`);
  }
}

describe("executeProjectDirectCommand", () => {
  it("scouts a fresh issue and persists the Oracle assessment instead of returning a slice placeholder", async () => {
    const sandbox = createScenarioSandbox();
    try {
      const issue = createTrackedIssue(ISSUE_ID, "Scout direct command issue");
      const tracker = new InMemoryScenarioTracker([issue]);

      const result = await executeProjectDirectCommand(
        parseCommand(`scout ${ISSUE_ID}`),
        {
          projectRoot: sandbox.projectRoot,
          config: DEFAULT_AEGIS_CONFIG,
          tracker,
          runtime: createPromptDrivenRuntime(),
          eventPublisher: sandbox.eventBus,
        },
      );

      expect(result.status).toBe("handled");
      expect(result.message).toContain(ISSUE_ID);
      expect(result.message).not.toContain("requires S08");

      const state = loadDispatchState(sandbox.projectRoot);
      expect(state.records[ISSUE_ID]?.stage).toBe(DispatchStage.Scouted);
      expect(state.records[ISSUE_ID]?.oracleAssessmentRef).toBeTruthy();

      const assessmentPath = path.join(
        sandbox.projectRoot,
        state.records[ISSUE_ID].oracleAssessmentRef!,
      );
      expect(readFileSync(assessmentPath, "utf8")).toContain(`"ready": true`);

      const publishedEvents = sandbox.eventBus.snapshot();
      expect(publishedEvents.some((event) =>
        event.type === "loop.phase_log"
        && event.payload.phase === "dispatch"
        && event.payload.line.includes(`oracle -> ${ISSUE_ID}`)
      )).toBe(true);
      expect(publishedEvents.some((event) =>
        event.type === "agent.session_started"
        && event.payload.caste === "oracle"
        && event.payload.issueId === ISSUE_ID
      )).toBe(true);
      expect(publishedEvents.some((event) =>
        event.type === "agent.session_ended"
        && event.payload.caste === "oracle"
        && event.payload.issueId === ISSUE_ID
        && event.payload.outcome === "completed"
      )).toBe(true);
    } finally {
      sandbox.cleanup();
    }
  });

  it("processes a fresh issue through Oracle, Titan, merge queue, and Sentinel to completion", async () => {
    const sandbox = createScenarioSandbox();
    try {
      const issue = createTrackedIssue(ISSUE_ID, "Process direct command issue");
      const tracker = new InMemoryScenarioTracker([issue]);

      const result = await executeProjectDirectCommand(
        parseCommand(`process ${ISSUE_ID}`),
        {
          projectRoot: sandbox.projectRoot,
          config: DEFAULT_AEGIS_CONFIG,
          tracker,
          runtime: createPromptDrivenRuntime(),
          eventPublisher: sandbox.eventBus,
        },
      );

      expect(result.status).toBe("handled");
      expect(result.message).toContain("completed");
      expect(result.message).not.toContain("Lane B");

      const dispatchState = loadDispatchState(sandbox.projectRoot);
      expect(dispatchState.records[ISSUE_ID]?.stage).toBe(DispatchStage.Complete);

      const queueState = loadMergeQueueState(sandbox.projectRoot);
      expect(queueState.items).toHaveLength(1);
      expect(queueState.items[0].status).toBe("merged");

      const mergedFile = path.join(
        sandbox.projectRoot,
        "src",
        "scenarios",
        `${ISSUE_ID}.ts`,
      );
      expect(readFileSync(mergedFile, "utf8")).toContain(ISSUE_ID);
      expect((await tracker.getIssue(ISSUE_ID)).status).toBe("closed");

      const publishedEvents = sandbox.eventBus.snapshot();
      expect(publishedEvents.some((event) =>
        event.type === "agent.session_started"
        && event.payload.caste === "oracle"
        && event.payload.issueId === ISSUE_ID
      )).toBe(true);
      expect(publishedEvents.some((event) =>
        event.type === "agent.session_started"
        && event.payload.caste === "titan"
        && event.payload.issueId === ISSUE_ID
      )).toBe(true);
      expect(publishedEvents.some((event) =>
        event.type === "agent.session_started"
        && event.payload.caste === "sentinel"
        && event.payload.issueId === ISSUE_ID
      )).toBe(true);
      expect(publishedEvents.some((event) =>
        event.type === "agent.session_ended"
        && event.payload.caste === "sentinel"
        && event.payload.issueId === ISSUE_ID
        && event.payload.outcome === "completed"
      )).toBe(true);
    } finally {
      sandbox.cleanup();
    }
  });
});
