import type { AegisConfig } from "../config/schema.js";
import { parseCommand } from "../cli/parse-command.js";
import { createLoopPhaseLog } from "../events/dashboard-events.js";
import type { LiveEventPublisher } from "../events/event-bus.js";
import type { AgentRuntime } from "../runtime/agent-runtime.js";
import type { BeadsClient } from "../tracker/beads-client.js";
import { executeProjectDirectCommand } from "./direct-command-runner.js";
import {
  loadDispatchState,
  type DispatchRecord,
} from "./dispatch-state.js";
import { DispatchStage } from "./stage-transition.js";

export interface AutoLoopTickInput {
  enabledAt: string | null;
  projectRoot: string;
  config: AegisConfig;
  tracker: BeadsClient;
  runtime: AgentRuntime;
  eventPublisher: LiveEventPublisher;
}

export interface AutoLoopTickResult {
  readyIssueIds: string[];
  skippedIssueIds: string[];
  processedIssueIds: string[];
  /**
   * True when a fatal condition was detected (e.g., model tool-call failure).
   * The orchestrator should kill the auto-loop when this is true.
   */
  fatalDetected: boolean;
}

function hasLiveAgent(record: DispatchRecord | undefined): boolean {
  return record?.runningAgent !== null && record?.runningAgent !== undefined;
}

function canAutoProcess(record: DispatchRecord | undefined): boolean {
  if (!record) {
    return true;
  }

  return record.stage !== DispatchStage.Complete;
}

export async function runAutoLoopTick(
  input: AutoLoopTickInput,
): Promise<AutoLoopTickResult> {
  if (input.enabledAt === null) {
    input.eventPublisher.publish(createLoopPhaseLog("poll", "auto loop disabled"));
    return {
      readyIssueIds: [],
      skippedIssueIds: [],
      processedIssueIds: [],
      fatalDetected: false,
    };
  }

  const readyIssues = await input.tracker.getReadyQueue();
  const readyIssueIds = readyIssues.map((issue) => issue.id);
  const dispatchState = loadDispatchState(input.projectRoot);
  const activeCount = Object.values(dispatchState.records).filter((record) => hasLiveAgent(record)).length;
  const availableSlots = Math.max(0, input.config.concurrency.max_agents - activeCount);

  const blockedByState = readyIssues.filter((issue) => hasLiveAgent(dispatchState.records[issue.id]));
  const eligibleIssues = readyIssues.filter((issue) => {
    const record = dispatchState.records[issue.id];
    return !hasLiveAgent(record) && canAutoProcess(record);
  });
  const candidates = eligibleIssues.slice(0, availableSlots);
  const skippedIssueIds = [
    ...blockedByState.map((issue) => issue.id),
    ...eligibleIssues.slice(availableSlots).map((issue) => issue.id),
  ];

  input.eventPublisher.publish(
    createLoopPhaseLog(
      "poll",
      `ready=${readyIssues.length} eligible=${eligibleIssues.length} active=${activeCount} slots=${availableSlots}`,
    ),
  );

  const candidateResults = await Promise.all(candidates.map(async (issue) => {
    input.eventPublisher.publish(
      createLoopPhaseLog("dispatch", `process -> ${issue.id}`, issue.id),
    );

    let fatalDetected = false;

    try {
      const result = await executeProjectDirectCommand(parseCommand(`process ${issue.id}`), {
        projectRoot: input.projectRoot,
        config: input.config,
        tracker: input.tracker,
        runtime: input.runtime,
        eventPublisher: input.eventPublisher,
      });

      input.eventPublisher.publish(
        createLoopPhaseLog("reap", `${result.status} ${issue.id}`, issue.id),
      );

      // Check if this result indicates a tool-call failure (model produced no output).
      // The failure reason is embedded in the message from direct-command-runner.
      if (result.message.includes("Oracle did not return a final message payload")) {
        fatalDetected = true;
      }

      return {
        issueId: issue.id,
        handled: result.status === "handled",
        fatalDetected,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      input.eventPublisher.publish(
        createLoopPhaseLog("reap", `failed ${issue.id}: ${message}`, issue.id),
      );

      return {
        issueId: issue.id,
        handled: false,
        fatalDetected: false,
      };
    }
  }));

  const processedIssueIds = candidateResults
    .filter((result) => result.handled)
    .map((result) => result.issueId);
  const dynamicSkippedIssueIds = candidateResults
    .filter((result) => !result.handled)
    .map((result) => result.issueId);
  const anyFatalDetected = candidateResults.some((result) => result.fatalDetected);

  return {
    readyIssueIds,
    skippedIssueIds: [...skippedIssueIds, ...dynamicSkippedIssueIds],
    processedIssueIds,
    fatalDetected: anyFatalDetected,
  };
}
