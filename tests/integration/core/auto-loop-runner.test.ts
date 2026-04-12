import { describe, expect, it } from "vitest";

import { DEFAULT_AEGIS_CONFIG } from "../../../src/config/defaults.js";
import { loadDispatchState } from "../../../src/core/dispatch-state.js";
import { DispatchStage } from "../../../src/core/stage-transition.js";
import {
  createScenarioSandbox,
  createTrackedIssue,
  createScriptedRuntime,
  InMemoryScenarioTracker,
} from "../../../src/evals/mvp-scenario-runners/shared.js";
import { runAutoLoopTick } from "../../../src/core/auto-loop-runner.js";

const ISSUE_ID = "auto-loop-issue";

describe("runAutoLoopTick", () => {
  it("processes ready backlog work and emits loop activity", async () => {
    const sandbox = createScenarioSandbox();

    try {
      const tracker = new InMemoryScenarioTracker([
        createTrackedIssue(ISSUE_ID, "Auto loop issue", {
          updatedAt: "2026-04-12T10:00:10.000Z",
        }),
      ]);
      const runtime = createScriptedRuntime({
        oracle: {
          messages: [JSON.stringify({
            files_affected: [`src/scenarios/${ISSUE_ID}.ts`],
            estimated_complexity: "moderate",
            decompose: false,
            ready: true,
          })],
        },
        titan: {
          messages: [JSON.stringify({
            outcome: "success",
            summary: `Implemented ${ISSUE_ID}`,
            files_changed: [`src/scenarios/${ISSUE_ID}.ts`],
            tests_and_checks_run: ["npm run test"],
            known_risks: [],
            follow_up_work: [],
            learnings_written_to_mnemosyne: [],
          })],
        },
        sentinel: {
          messages: [JSON.stringify({
            verdict: "pass",
            reviewSummary: `Reviewed ${ISSUE_ID}`,
            issuesFound: [],
            followUpIssueIds: [],
            riskAreas: [],
          })],
        },
      });

      const result = await runAutoLoopTick({
        enabledAt: "2026-04-12T10:00:00.000Z",
        projectRoot: sandbox.projectRoot,
        config: DEFAULT_AEGIS_CONFIG,
        tracker,
        runtime,
        eventPublisher: sandbox.eventBus,
      });

      expect(result.processedIssueIds).toEqual([ISSUE_ID]);
      expect(result.skippedIssueIds).toEqual([]);
      expect(loadDispatchState(sandbox.projectRoot).records[ISSUE_ID]?.stage).toBe(
        DispatchStage.Complete,
      );

      const publishedEvents = sandbox.eventBus.snapshot();
      expect(publishedEvents.some((event) =>
        event.type === "loop.phase_log"
        && event.payload.phase === "poll"
        && event.payload.line.includes("ready=1 eligible=1")
      )).toBe(true);
      expect(publishedEvents.some((event) =>
        event.type === "loop.phase_log"
        && event.payload.phase === "dispatch"
        && event.payload.line.includes(`process -> ${ISSUE_ID}`)
      )).toBe(true);
      expect(publishedEvents.some((event) =>
        event.type === "loop.phase_log"
        && event.payload.phase === "reap"
        && event.payload.line.includes(ISSUE_ID)
      )).toBe(true);
    } finally {
      sandbox.cleanup();
    }
  });

  it("dispatches multiple ready issues up to available capacity", async () => {
    const sandbox = createScenarioSandbox();

    try {
      const tracker = new InMemoryScenarioTracker([
        createTrackedIssue("auto-loop-issue-1", "First ready issue", {
          updatedAt: "2026-04-12T09:59:59.000Z",
        }),
        createTrackedIssue("auto-loop-issue-2", "Second ready issue", {
          updatedAt: "2026-04-12T10:00:05.000Z",
        }),
      ]);
      const runtime = createScriptedRuntime({
        "oracle:auto-loop-issue-1": {
          messages: [JSON.stringify({
            files_affected: ["src/scenarios/auto-loop-issue-1.ts"],
            estimated_complexity: "moderate",
            decompose: false,
            ready: true,
          })],
        },
        "titan:auto-loop-issue-1": {
          messages: [JSON.stringify({
            outcome: "success",
            summary: "Implemented auto-loop-issue-1",
            files_changed: ["src/scenarios/auto-loop-issue-1.ts"],
            tests_and_checks_run: ["npm run test"],
            known_risks: [],
            follow_up_work: [],
            learnings_written_to_mnemosyne: [],
          })],
        },
        "sentinel:auto-loop-issue-1": {
          messages: [JSON.stringify({
            verdict: "pass",
            reviewSummary: "Reviewed auto-loop-issue-1",
            issuesFound: [],
            followUpIssueIds: [],
            riskAreas: [],
          })],
        },
        "oracle:auto-loop-issue-2": {
          messages: [JSON.stringify({
            files_affected: ["src/scenarios/auto-loop-issue-2.ts"],
            estimated_complexity: "moderate",
            decompose: false,
            ready: true,
          })],
        },
        "titan:auto-loop-issue-2": {
          messages: [JSON.stringify({
            outcome: "success",
            summary: "Implemented auto-loop-issue-2",
            files_changed: ["src/scenarios/auto-loop-issue-2.ts"],
            tests_and_checks_run: ["npm run test"],
            known_risks: [],
            follow_up_work: [],
            learnings_written_to_mnemosyne: [],
          })],
        },
        "sentinel:auto-loop-issue-2": {
          messages: [JSON.stringify({
            verdict: "pass",
            reviewSummary: "Reviewed auto-loop-issue-2",
            issuesFound: [],
            followUpIssueIds: [],
            riskAreas: [],
          })],
        },
      });

      const result = await runAutoLoopTick({
        enabledAt: "2026-04-12T10:00:00.000Z",
        projectRoot: sandbox.projectRoot,
        config: {
          ...DEFAULT_AEGIS_CONFIG,
          concurrency: {
            ...DEFAULT_AEGIS_CONFIG.concurrency,
            max_agents: 2,
          },
        },
        tracker,
        runtime,
        eventPublisher: sandbox.eventBus,
      });

      expect(result.processedIssueIds).toEqual([
        "auto-loop-issue-1",
        "auto-loop-issue-2",
      ]);
      expect(result.skippedIssueIds).toEqual([]);
      expect(loadDispatchState(sandbox.projectRoot).records["auto-loop-issue-1"]?.stage).toBe(
        DispatchStage.Complete,
      );
      expect(loadDispatchState(sandbox.projectRoot).records["auto-loop-issue-2"]?.stage).toBe(
        DispatchStage.Complete,
      );

      const publishedEvents = sandbox.eventBus.snapshot();
      expect(publishedEvents.some((event) =>
        event.type === "loop.phase_log"
        && event.payload.phase === "dispatch"
        && event.payload.line.includes("process -> auto-loop-issue-1")
      )).toBe(true);
      expect(publishedEvents.some((event) =>
        event.type === "loop.phase_log"
        && event.payload.phase === "dispatch"
        && event.payload.line.includes("process -> auto-loop-issue-2")
      )).toBe(true);
    } finally {
      sandbox.cleanup();
    }
  });
});
