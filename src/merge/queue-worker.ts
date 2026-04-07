/**
 * Queue worker — merge queue processing with S14 implementation.
 *
 * SPECv2 §12.5 and §12.6:
 *   - FIFO ordering for queue processing
 *   - one active merge worker at a time for correctness
 *   - mechanical checks before human or LLM escalation
 *   - Janus invocation only through deterministic policy gates
 *
 * S14 implements the actual merge gate execution, conflict handling,
 * and outcome artifacts.
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

/** Configuration for the queue worker. */
export interface QueueWorkerConfig {
  /** Project root for file operations. */
  projectRoot: string;

  /** Event publisher for queue state changes. */
  eventPublisher: LiveEventPublisher;

  /** Whether Janus escalation is enabled. */
  janusEnabled: boolean;

  /** Maximum merge retry attempts before escalation. */
  maxRetryAttempts: number;

  /** Target branch for merges (typically "main"). */
  targetBranch: string;
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
 * S14 implementation:
 *   1. Marks the next queued item as active
 *   2. Increments attempt count
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
  // Find the next queued item (FIFO) using canonical store function
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

    // Step 7: Determine final queue item status
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
        // Check if Janus escalation is needed
        if (
          mergeResult.conflictTier === 3 &&
          config.janusEnabled &&
          updatedItem.attemptCount >= config.maxRetryAttempts
        ) {
          finalStatus = "janus_required";
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
