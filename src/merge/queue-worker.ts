/**
 * Queue worker — merge queue processing with S14/S15B implementation.
 *
 * SPECv2 §12.5 and §12.6:
 *   - FIFO ordering for queue processing
 *   - one active merge worker at a time for correctness
 *   - mechanical checks before human or LLM escalation
 *   - Janus invocation only through deterministic policy gates
 *
 * S14 implements the actual merge gate execution, conflict handling,
 * and outcome artifacts.
 *
 * S15B integrates Janus escalation flow:
 *   - detect janus_required items and handle Janus dispatch
 *   - handle post-Janus outcomes (requeue, manual_decision, fail)
 *   - integrate with tiered-conflict-policy for escalation eligibility
 */

import type { MergeQueueState, QueueItem } from "./merge-queue-store.js";
import { nextQueuedItem } from "./merge-queue-store.js";
import type { LiveEventPublisher } from "../events/event-bus.js";
import { runGates, defaultGateConfig } from "./run-gates.js";
import { attemptMerge } from "./apply-merge.js";
import { emitOutcomeArtifact } from "./emit-outcome-artifact.js";
import { preserveLabor, shouldPreserveLabor } from "./preserve-labor.js";
import { resolveLaborPath, buildLaborBranchName } from "../labor/create-labor.js";
import {
  createMergeOutcomeEvent,
  createMergeQueueStateEvent,
} from "../events/merge-events.js";
import {
  handleJanusResult,
  janusRequeue,
} from "./janus-integration.js";
import {
  classifyConflictTier as classifyPolicyConflictTier,
  defaultJanusInvocationPolicy,
  type JanusInvocationPolicy,
} from "./tiered-conflict-policy.js";
import type { AgentRuntime } from "../runtime/agent-runtime.js";
import { loadDispatchState } from "../core/dispatch-state.js";
import { runJanus } from "../core/run-janus.js";
import { DEFAULT_AEGIS_CONFIG } from "../config/defaults.js";

/** Configuration for the queue worker. */
export interface QueueWorkerConfig {
  /** Project root for file operations. */
  projectRoot: string;

  /** Event publisher for queue state changes. */
  eventPublisher: LiveEventPublisher;

  /** Whether Janus escalation is enabled. */
  janusEnabled: boolean;

  /** Maximum merge retry attempts before Janus escalation. */
  maxRetryAttempts: number;

  /** Target branch for merges (typically "main"). */
  targetBranch: string;

  /** Optional Janus invocation policy override. */
  janusInvocationPolicy?: JanusInvocationPolicy;

  /** Runtime adapter for spawning Janus sessions. */
  runtime?: AgentRuntime;
}

/** Result of a queue processing cycle. */
export interface QueueProcessingResult {
  /** The issue ID that was processed. */
  issueId: string;

  /** Whether processing succeeded. */
  success: boolean;

  /** Optional error message if processing failed. */
  error?: string;

  /** The new queue item status after processing. */
  newStatus: QueueItem["status"];
}

/**
 * Process the next item in the merge queue.
 *
 * S14/S15B implementation:
 *   1. Checks for janus_required items first and handles Janus dispatch flow
 *   2. For normal items: marks as active, increments attempt count
 *   3. Runs verification gates
 *   4. Attempts merge if gates pass
 *   5. Handles outcomes: clean merge, rework, conflict, Janus escalation
 *   6. Emits outcome artifacts and SSE events
 *   7. Preserves labor on non-success outcomes
 *
 * @param state - Current merge queue state.
 * @param config - Worker configuration.
 * @returns Tuple of [updated state, processing result] or null if queue is empty.
 */
export async function processNextQueueItem(
  state: MergeQueueState,
  config: QueueWorkerConfig,
): Promise<{ updatedState: MergeQueueState; result: QueueProcessingResult } | null> {
  // Check for janus_required items first (S15B: Janus dispatch flow)
  const janusItem = state.items.find((item) => item.status === "janus_required");
  if (janusItem) {
    return processJanusItem(state, janusItem, config);
  }

  // Normal queue processing
  const nextItem = nextQueuedItem(state);

  if (!nextItem) {
    return null;
  }

  // Mark item as active and increment attempt count
  const updatedItem: QueueItem = {
    ...nextItem,
    status: "active",
    attemptCount: nextItem.attemptCount + 1,
    updatedAt: new Date().toISOString(),
  };

  const updatedState: MergeQueueState = {
    schemaVersion: state.schemaVersion,
    items: state.items.map((item) =>
      item.issueId === nextItem.issueId ? updatedItem : item,
    ),
    processedCount: state.processedCount,
  };

  // Publish SSE event for activation
  config.eventPublisher.publish({
    id: crypto.randomUUID(),
    type: "merge.queue_state",
    timestamp: new Date().toISOString(),
    sequence: state.items.length + 1,
    payload: createMergeQueueStateEvent(
      nextItem.issueId,
      "active",
      updatedItem.attemptCount,
    ),
  });

  try {
    // Step 1: Resolve labor path for this issue
    const laborPath = resolveLaborPath(config.projectRoot, nextItem.issueId);
    const branchName = buildLaborBranchName(nextItem.issueId);

    // Step 2: Run verification gates
    const gateConfig = defaultGateConfig(config.projectRoot, laborPath);
    const gateResult = await runGates(gateConfig);

    if (!gateResult.allFatalPassed) {
      // Gate failure — emit outcome, preserve labor, update queue
      const gateErrors = gateResult.results
        .filter((r) => !r.passed)
        .map((r) => `${r.name}: ${r.error ?? r.stderr}`)
        .join("; ");

      const artifact = await emitOutcomeArtifact(
        nextItem.issueId,
        "MERGE_FAILED",
        nextItem.candidateBranch,
        nextItem.targetBranch,
        1, // Tier 1: gate failure is reworkable
        `Gate failures: ${gateErrors}`,
        true,
        config.projectRoot,
        gateErrors,
      );

      config.eventPublisher.publish({
        id: crypto.randomUUID(),
        type: "merge.outcome",
        timestamp: new Date().toISOString(),
        sequence: state.items.length + 2,
        payload: createMergeOutcomeEvent(
          nextItem.issueId,
          "MERGE_FAILED",
          nextItem.candidateBranch,
          nextItem.targetBranch,
          gateErrors,
        ),
      });

      // Update queue item status
      const finalState: MergeQueueState = {
        schemaVersion: updatedState.schemaVersion,
        items: updatedState.items.map((item) =>
          item.issueId === nextItem.issueId
            ? {
                ...item,
                status: "merge_failed",
                lastError: gateErrors,
                updatedAt: new Date().toISOString(),
              }
            : item,
        ),
        processedCount: updatedState.processedCount,
      };

      return {
        updatedState: finalState,
        result: {
          issueId: nextItem.issueId,
          success: false,
          error: gateErrors,
          newStatus: "merge_failed",
        },
      };
    }

    // Step 3: Gates passed — attempt merge
    const mergeResult = await attemptMerge({
      candidateBranch: nextItem.candidateBranch,
      targetBranch: nextItem.targetBranch,
      projectRoot: config.projectRoot,
      laborPath,
      issueId: nextItem.issueId,
      attemptCount: updatedItem.attemptCount,
      maxRetryBeforeJanus: config.maxRetryAttempts,
    });

    // Step 4: Preserve labor on non-success outcomes
    if (!mergeResult.success && shouldPreserveLabor(mergeResult.outcome)) {
      await preserveLabor({
        issueId: nextItem.issueId,
        laborPath,
        branchName,
        outcome: mergeResult.outcome as "MERGE_FAILED" | "REWORK_REQUEST",
        isConflict: mergeResult.conflictTier === 2,
        reason: mergeResult.detail,
      });
    }

    // Step 5: Emit outcome artifact
    const artifact = await emitOutcomeArtifact(
      nextItem.issueId,
      mergeResult.outcome,
      nextItem.candidateBranch,
      nextItem.targetBranch,
      mergeResult.conflictTier,
      mergeResult.detail,
      mergeResult.laborPreserved,
      config.projectRoot,
      mergeResult.error,
    );

    // Step 6: Emit SSE outcome event
    config.eventPublisher.publish({
      id: crypto.randomUUID(),
      type: "merge.outcome",
      timestamp: new Date().toISOString(),
      sequence: state.items.length + 2,
      payload: createMergeOutcomeEvent(
        nextItem.issueId,
        mergeResult.outcome,
        nextItem.candidateBranch,
        nextItem.targetBranch,
        mergeResult.detail,
      ),
    });

    // Step 7: Determine final queue item status with Janus escalation check
    let finalStatus: QueueItem["status"];
    let success = false;

    switch (mergeResult.outcome) {
      case "MERGED":
        finalStatus = "merged";
        success = true;
        break;
      case "REWORK_REQUEST":
        finalStatus = "rework_requested";
        success = false;
        break;
      case "MERGE_FAILED":
        // Check tiered conflict policy for Janus escalation eligibility (S15B)
        const policy = config.janusInvocationPolicy ?? defaultJanusInvocationPolicy();
        const mergeDetail = mergeResult.detail ?? "";
        // Count actual conflict markers for accurate tier classification
        const conflictFileCount = (mergeDetail.match(/CONFLICT\s*\(/g) ?? []).length
          || (mergeDetail.match(/<<<<<<<\s/g) ?? []).length;
        const classification = classifyPolicyConflictTier(
          mergeDetail,
          1, // exit code non-zero since we're in MERGE_FAILED
          conflictFileCount,
          updatedItem.attemptCount,
          policy,
        );

        // If Tier 3 and Janus enabled and eligible, escalate to Janus
        if (
          classification.tier === 3 &&
          classification.janusEligible &&
          config.janusEnabled
        ) {
          finalStatus = "janus_required";
          config.eventPublisher.publish({
            id: crypto.randomUUID(),
            type: "merge.janus_escalation",
            timestamp: new Date().toISOString(),
            sequence: state.items.length + 3,
            payload: {
              issueId: nextItem.issueId,
              reason: "retry_threshold_reached",
              attemptCount: updatedItem.attemptCount,
              janusEnabled: true,
            },
          });
        } else {
          finalStatus = "merge_failed";
        }
        success = false;
        break;
      default:
        finalStatus = "merge_failed";
        success = false;
    }

    const finalState: MergeQueueState = {
      schemaVersion: updatedState.schemaVersion,
      items: updatedState.items.map((item) =>
        item.issueId === nextItem.issueId
          ? {
              ...item,
              status: finalStatus,
              lastError: mergeResult.error ?? null,
              updatedAt: new Date().toISOString(),
            }
          : item,
      ),
      processedCount: success
        ? updatedState.processedCount + 1
        : updatedState.processedCount,
    };

    return {
      updatedState: finalState,
      result: {
        issueId: nextItem.issueId,
        success,
        error: mergeResult.error,
        newStatus: finalStatus,
      },
    };
  } catch (err) {
    // Crash during merge — mark as merge_failed
    const errorMessage = (err as Error).message;

    const finalState: MergeQueueState = {
      schemaVersion: updatedState.schemaVersion,
      items: updatedState.items.map((item) =>
        item.issueId === nextItem.issueId
          ? {
              ...item,
              status: "merge_failed",
              lastError: errorMessage,
              updatedAt: new Date().toISOString(),
            }
          : item,
      ),
      processedCount: updatedState.processedCount,
    };

    return {
      updatedState: finalState,
      result: {
        issueId: nextItem.issueId,
        success: false,
        error: errorMessage,
        newStatus: "merge_failed",
      },
    };
  }
}

/**
 * Process an item that requires Janus escalation.
 *
 * S15B implementation:
 *   1. Transition dispatch state to resolving_integration
 *   2. Invoke runJanus() to dispatch the Janus session
 *   3. Handle the Janus result (requeue, manual_decision, or fail)
 *   4. Update queue state accordingly
 *
 * Per SPECv2 §12.6 steps 7-9:
 *   - transition dispatch state to resolving_integration and dispatch Janus
 *   - on Janus success, update the candidate artifact and return to queue
 *   - on Janus failure or unsafe ambiguity, create manual-decision artifacts
 *
 * @param state - Current merge queue state.
 * @param item - The queue item requiring Janus.
 * @param config - Worker configuration.
 * @returns Updated state and processing result.
 */
async function processJanusItem(
  state: MergeQueueState,
  item: QueueItem,
  config: QueueWorkerConfig,
): Promise<{ updatedState: MergeQueueState; result: QueueProcessingResult }> {
  // Publish Janus escalation event (queue state change, independent of runtime availability)
  config.eventPublisher.publish({
    id: crypto.randomUUID(),
    type: "merge.janus_escalation",
    timestamp: new Date().toISOString(),
    sequence: state.items.length + 1,
    payload: {
      issueId: item.issueId,
      reason: "retry_threshold_reached",
      attemptCount: item.attemptCount,
      janusEnabled: config.janusEnabled,
    },
  });

  // Check we have the required dependencies for Janus dispatch
  if (!config.runtime) {
    return {
      updatedState: state,
      result: {
        issueId: item.issueId,
        success: false,
        error: "Janus dispatch requires a runtime adapter",
        newStatus: "janus_required",
      },
    };
  }

  // Load dispatch state to find the record for this issue
  const dispatchState = loadDispatchState(config.projectRoot);
  const record = Object.values(dispatchState.records).find(
    (r) => r.issueId === item.issueId,
  ) ?? null;

  if (!record) {
    // No dispatch record available — create a manual decision artifact
    // and stop automatic processing
    const updatedState: MergeQueueState = {
      schemaVersion: state.schemaVersion,
      items: state.items.map((queueItem) =>
        queueItem.issueId === item.issueId
          ? {
              ...queueItem,
              status: "manual_decision_required" as const,
              lastError: "No dispatch record found for Janus escalation",
              updatedAt: new Date().toISOString(),
            }
          : { ...queueItem },
      ),
      processedCount: state.processedCount + 1,
    };

    return {
      updatedState,
      result: {
        issueId: item.issueId,
        success: false,
        error: "No dispatch record found for Janus escalation",
        newStatus: "manual_decision_required",
      },
    };
  }

  // Build the labor path for Janus
  const laborPath = resolveLaborPath(config.projectRoot, item.issueId);

  // Invoke runJanus (Lane A) to actually dispatch the Janus session
  const janusBudget = DEFAULT_AEGIS_CONFIG.budgets.janus;

  let janusResult: Awaited<ReturnType<typeof runJanus>>;
  try {
    janusResult = await runJanus({
      issueId: item.issueId,
      queueItemId: item.issueId,
      preservedLaborPath: laborPath,
      conflictSummary: item.lastError ?? "Merge integration escalation",
      filesInvolved: [],
      previousMergeErrors: item.lastError ?? "",
      conflictTier: 3,
      record,
      runtime: config.runtime,
      budget: janusBudget,
      projectRoot: config.projectRoot,
    });
  } catch (err) {
    // Janus dispatch crashed — create manual decision artifact
    const errorMessage = (err as Error).message;
    const updatedState: MergeQueueState = {
      schemaVersion: state.schemaVersion,
      items: state.items.map((queueItem) =>
        queueItem.issueId === item.issueId
          ? {
              ...queueItem,
              status: "janus_failed" as const,
              lastError: `Janus dispatch crash: ${errorMessage}`,
              updatedAt: new Date().toISOString(),
            }
          : { ...queueItem },
      ),
      processedCount: state.processedCount,
    };

    return {
      updatedState,
      result: {
        issueId: item.issueId,
        success: false,
        error: `Janus dispatch crash: ${errorMessage}`,
        newStatus: "janus_failed",
      },
    };
  }

  // Handle the Janus result through the integration module (Lane B)
  const janusOutcome = await handleJanusResult(
    janusResult.resolutionArtifact!,
    config.projectRoot,
    state,
    config.eventPublisher,
  );

  // Apply the Janus outcome to the queue state
  if (janusOutcome.finalStatus === "queued") {
    // Safe requeue: item returns to queue for fresh mechanical pass
    const requeued = janusRequeue(state, item.issueId);
    return {
      updatedState: requeued,
      result: {
        issueId: item.issueId,
        success: true,
        newStatus: "queued",
      },
    };
  }

  const newStatus = janusOutcome.finalStatus;
  const success = newStatus !== "janus_failed" && newStatus !== "manual_decision_required";

  const updatedState: MergeQueueState = {
    schemaVersion: state.schemaVersion,
    items: state.items.map((queueItem) =>
      queueItem.issueId === item.issueId
        ? {
            ...queueItem,
            status: newStatus,
            lastError: janusResult.failureReason ?? "Janus resolution failed",
            updatedAt: new Date().toISOString(),
          }
        : { ...queueItem },
    ),
    processedCount: state.processedCount + 1,
  };

  return {
    updatedState,
    result: {
      issueId: item.issueId,
      success,
      error: janusResult.failureReason ?? undefined,
      newStatus,
    },
  };
}

/**
 * Get the count of items actively being processed.
 *
 * This is narrower than getQueueDepth from queue-visibility.ts, which counts
 * all non-terminal items. This function only counts queued + active items
 * (i.e., items the worker would actually touch).
 *
 * @param state - Current merge queue state.
 * @returns Number of items in queued or active status.
 */
export function getActiveWorkCount(state: MergeQueueState): number {
  return state.items.filter(
    (item) =>
      item.status === "queued" || item.status === "active",
  ).length;
}
