/**
 * Janus dispatch and execution orchestrator.
 *
 * SPECv2 §10.4, §10.5, §12.5:
 *   - Janus resolves merge-boundary escalations that the deterministic queue cannot safely clear
 *   - Default budget: 12 turns, 120k tokens
 *   - Allowed tools: read, write/edit only inside preserved conflict labor or dedicated integration labor, shell, tracker commands
 *   - Success: produces structured integration-resolution artifact, prepares refreshed candidate for requeue OR emits explicit unresolved escalation artifact
 *   - NEVER merges directly outside the queue
 *   - Does NOT replace Titan for ordinary implementation
 *   - Returns control to deterministic queue processing or explicit human decision point
 *
 * Stage transitions (SPECv2 §6.1-§6.3):
 *   - On dispatch: queued_for_merge → resolving_integration
 *   - On success: resolving_integration → queued_for_merge (after Janus prepares refreshed candidate)
 *   - On failure: resolving_integration → failed
 *   - On manual decision needed: resolving_integration → failed with human-decision artifact
 *
 * Pattern modelled after run-oracle.ts, run-titan.ts, and run-sentinel.ts.
 */

import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { DEFAULT_AEGIS_CONFIG } from "../config/defaults.js";
import type { BudgetLimit } from "../config/schema.js";
import {
  buildJanusPrompt,
  createJanusPromptContract,
  type JanusPromptContext,
} from "../castes/janus/janus-prompt.js";
import {
  parseJanusResolutionArtifact,
  type JanusResolutionArtifact,
  type JanusRecommendedNextAction,
  JanusParseError,
} from "../castes/janus/janus-parser.js";
import type { DispatchRecord } from "./dispatch-state.js";
import { DispatchStage, transitionStage } from "./stage-transition.js";
import type {
  AgentEvent,
  AgentRuntime,
} from "../runtime/agent-runtime.js";
import { isWithinBudget } from "../runtime/normalize-stats.js";
import type { NormalizedBudgetStatus } from "../runtime/normalize-stats.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface JanusIssueCreator {
  getIssue(id: string): Promise<{ id: string; title: string; status: string }>;
}

export interface RunJanusInput {
  /** The originating Beads issue ID. */
  issueId: string;

  /** The merge queue item ID. */
  queueItemId: string;

  /** Path to the preserved conflict labor or integration branch workspace. */
  preservedLaborPath: string;

  /** Summary of the conflict or failure that triggered Janus escalation. */
  conflictSummary: string;

  /** List of files involved in the conflict or failure. */
  filesInvolved: string[];

  /** Error output from the previous merge attempt(s). */
  previousMergeErrors: string;

  /** The conflict tier that triggered this escalation (per SPECv2 §12.8). */
  conflictTier: number;

  /** The dispatch record for this issue. */
  record: DispatchRecord;

  /** The runtime adapter for spawning Janus sessions. */
  runtime: AgentRuntime;

  /** Budget limits for the Janus caste. */
  budget: BudgetLimit;

  /** Absolute path to the project root. */
  projectRoot: string;
}

/** Result returned by runJanus after execution completes. */
export interface RunJanusResult {
  /** The prompt that was sent to the Janus agent. */
  prompt: string;

  /** Parsed Janus resolution artifact, or null if parsing failed. */
  resolutionArtifact: JanusResolutionArtifact | null;

  /** Recommended next action from Janus (requeue, manual_decision, or fail). */
  recommendedNextAction: JanusRecommendedNextAction | null;

  /** Updated dispatch record after the Janus session. */
  updatedRecord: DispatchRecord;

  /** Error message if the session failed, null on success. */
  failureReason: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build the Janus prompt contract from the escalation context. */
function buildJanusPromptContext(input: RunJanusInput): JanusPromptContext {
  return {
    originatingIssueId: input.issueId,
    queueItemId: input.queueItemId,
    preservedLaborPath: input.preservedLaborPath,
    conflictSummary: input.conflictSummary,
    filesInvolved: input.filesInvolved,
    previousMergeErrors: input.previousMergeErrors,
    conflictTier: input.conflictTier as 1 | 2 | 3,
  };
}

/** Reference path for persisting the Janus resolution artifact. */
function buildJanusArtifactRef(issueId: string): string {
  return join(".aegis", "janus", `${issueId}.json`);
}

/**
 * Atomically persist the Janus resolution artifact to disk.
 *
 * Uses write-to-tmp then rename so a mid-write crash cannot corrupt the
 * existing file.
 *
 * @param projectRoot - Absolute path to the project root.
 * @param issueId - The originating issue ID.
 * @param artifact - The parsed JanusResolutionArtifact.
 * @returns The relative path reference to the persisted artifact.
 */
function persistJanusArtifact(
  projectRoot: string,
  issueId: string,
  artifact: JanusResolutionArtifact,
): string {
  const artifactRef = buildJanusArtifactRef(issueId);
  const artifactDirectory = join(projectRoot, ".aegis", "janus");
  const absolutePath = join(projectRoot, artifactRef);
  const temporaryPath = `${absolutePath}.tmp`;
  mkdirSync(artifactDirectory, { recursive: true });
  writeFileSync(temporaryPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, absolutePath);
  return artifactRef;
}

/**
 * Collect messages from a Janus runtime session.
 *
 * Follows the same pattern as collectOracleResponse, collectTitanResponse,
 * and collectSentinelResponse: subscribes to runtime events, collects
 * messages, and fails closed on runtime crashes or session timeouts.
 *
 * Budget enforcement is applied via the runtime's spawn options. Additional
 * monitoring uses isWithinBudget() on event boundaries.
 *
 * @param runtime - The agent runtime adapter.
 * @param issueId - The originating Beads issue ID.
 * @param workingDirectory - The labor path where Janus operates.
 * @param budget - The budget limits for Janus.
 * @param prompt - The constructed Janus prompt.
 * @returns The final message payload from the Janus agent.
 */
async function collectJanusResponse(
  runtime: AgentRuntime,
  issueId: string,
  workingDirectory: string,
  budget: BudgetLimit,
  prompt: string,
): Promise<string> {
  const handle = await runtime.spawn({
    caste: "janus",
    issueId,
    workingDirectory,
    toolRestrictions: [
      "read",
      "write/edit inside labor",
      "shell",
      "tracker commands",
    ],
    budget,
  });

  const messages: string[] = [];
  let budgetExceeded = false;

  const sessionPromise = new Promise<void>((resolve, reject) => {
    const unsubscribe = handle.subscribe((event: AgentEvent) => {
      if (event.type === "message") {
        messages.push(event.text);

        // Budget enforcement on event boundaries
        const stats = handle.getStats();
        const normalizedStatus: NormalizedBudgetStatus = {
          session_turns: stats.session_turns ?? 0,
          total_tokens: (stats.input_tokens ?? 0) + (stats.output_tokens ?? 0),
          wall_time_sec: stats.wall_time_sec ?? 0,
          metering: "stats_only",
          auth_mode: "unknown",
          confidence: "proxy",
          budget_warning: false,
        };

        if (!isWithinBudget(normalizedStatus, budget)) {
          budgetExceeded = true;
          unsubscribe();
          reject(new Error("Janus session exceeded budget"));
          return;
        }
        return;
      }
      if (event.type === "error" && event.fatal) {
        unsubscribe();
        reject(new Error(event.message));
        return;
      }
      if (event.type === "session_ended") {
        unsubscribe();
        if (event.reason !== "completed") {
          reject(new Error(`Janus session ended with reason=${event.reason}`));
          return;
        }
        resolve();
      }
    });

    void handle.prompt(prompt).catch((error: unknown) => {
      unsubscribe();
      reject(error);
    });
  });

  // Fail closed if the runtime crashes without emitting session_ended.
  const timeoutMs = 10 * 60 * 1000; // 10 minutes — generous upper bound
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`Janus session timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });

  try {
    await Promise.race([sessionPromise, timeoutPromise]);
  } catch (error) {
    // Attempt to abort the runtime session to free resources, then re-throw.
    try {
      await handle.abort();
    } catch {
      // Best-effort cleanup; the original error is more important.
    }
    if (budgetExceeded) {
      throw new Error(`Janus budget exceeded: ${(error as Error).message}`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId!);
  }

  return findFinalJanusPayloadMessage(messages);
}

/**
 * Find the last valid Janus payload message from the collected messages.
 *
 * Scans from the end of the messages array for the first JSON object that
 * looks like a Janus resolution artifact. Falls back to the last non-empty
 * message if no valid artifact is found (the parser will then reject it).
 *
 * @param messages - Collected messages from the Janus session.
 * @returns The final message payload string.
 */
function findFinalJanusPayloadMessage(messages: readonly string[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const candidate = messages[index].trim();
    if (candidate === "") {
      continue;
    }
    // Try to parse as JSON to find a valid artifact
    try {
      const parsed = JSON.parse(candidate);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "originatingIssueId" in parsed &&
        "queueItemId" in parsed &&
        "recommendedNextAction" in parsed
      ) {
        return messages[index];
      }
    } catch {
      // Not valid JSON, continue scanning
    }
  }

  // Fallback: return the last non-empty message (parser will reject if malformed)
  const fallback = messages.at(-1);
  if (!fallback) {
    throw new Error("Janus did not return a final message payload");
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Execute a Janus escalation session for a merge-boundary conflict.
 *
 * Per SPECv2 §10.4 and §10.5:
 *   - Janus is invoked only when the queue policy or a human command triggers it
 *   - Janus does NOT replace Titan for ordinary implementation
 *   - Janus returns control to deterministic queue processing or explicit human decision
 *
 * Stage transitions:
 *   - On dispatch: queued_for_merge → resolving_integration (caller must do this before calling)
 *   - On success: resolving_integration → queued_for_merge (after Janus prepares refreshed candidate)
 *   - On failure: resolving_integration → failed
 *   - On manual decision needed: resolving_integration → failed
 *
 * @param input - The Janus execution input with all required context.
 * @returns A RunJanusResult with the resolution artifact and updated record.
 */
export async function runJanus(input: RunJanusInput): Promise<RunJanusResult> {
  if (input.record.stage !== DispatchStage.ResolvingIntegration) {
    throw new Error(
      `runJanus requires a dispatch record in stage=${DispatchStage.ResolvingIntegration}`,
    );
  }

  const janusBudget = input.budget ?? DEFAULT_AEGIS_CONFIG.budgets.janus;
  const promptContext = buildJanusPromptContext(input);
  const promptContract = createJanusPromptContract(promptContext);
  const prompt = buildJanusPrompt(promptContract);
  let resolutionArtifact: JanusResolutionArtifact | null = null;
  let artifactRef: string | null = null;

  try {
    const raw = await collectJanusResponse(
      input.runtime,
      input.issueId,
      input.preservedLaborPath,
      janusBudget,
      prompt,
    );

    // Parse the Janus output through the strict parser
    resolutionArtifact = parseJanusResolutionArtifact(raw);
    artifactRef = persistJanusArtifact(
      input.projectRoot,
      input.issueId,
      resolutionArtifact,
    );

    const recommendedAction = resolutionArtifact.recommendedNextAction;

    // On success: requeue if Janus says requeue, otherwise fail for manual decision
    if (recommendedAction === "requeue") {
      return {
        prompt,
        resolutionArtifact,
        recommendedNextAction: recommendedAction,
        updatedRecord: {
          ...transitionStage(input.record, DispatchStage.QueuedForMerge),
          runningAgent: null,
        },
        failureReason: null,
      };
    }

    // manual_decision or fail → transition to failed
    return {
      prompt,
      resolutionArtifact,
      recommendedNextAction: recommendedAction,
      updatedRecord: {
        ...transitionStage(input.record, DispatchStage.Failed),
        runningAgent: null,
      },
      failureReason:
        recommendedAction === "manual_decision"
          ? "Janus determined that manual human decision is required due to semantic ambiguity or policy conflict"
          : `Janus recommended fail: ${resolutionArtifact.conflictSummary}`,
    };
  } catch (error) {
    // Fail closed: runtime crashes, malformed output, and budget kills all
    // land the record in the failed stage.
    return {
      prompt,
      resolutionArtifact,
      recommendedNextAction: null,
      updatedRecord: {
        ...transitionStage(input.record, DispatchStage.Failed),
        runningAgent: null,
      },
      failureReason: (error as Error).message,
    };
  }
}
