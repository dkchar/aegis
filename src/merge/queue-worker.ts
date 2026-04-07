/**
 * Queue worker skeleton — merge queue processing loop.
 *
 * SPECv2 §12.5 and §12.6:
 *   - FIFO ordering for queue processing
 *   - one active merge worker at a time for correctness
 *   - mechanical checks before human or LLM escalation
 *   - Janus invocation only through deterministic policy gates
 *
 * This file provides the worker skeleton that lanes will implement.
 * The actual merge gate execution and outcome handling are implemented in S14.
 */

import type { MergeQueueState, QueueItem } from "./merge-queue-store.js";
import type { LiveEventPublisher } from "../events/event-bus.js";

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
 * This is the skeleton entry point. S14 will implement the actual merge
 * gate execution, conflict handling, and outcome artifacts.
 *
 * For S13, this skeleton:
 *   - accepts the queue state and config
 *   - marks the next queued item as active
 *   - returns the updated state AND processing result
 *
 * @param state - Current merge queue state.
 * @param config - Worker configuration.
 * @returns Tuple of [updated state, processing result] or null if queue is empty.
 */
export async function processNextQueueItem(
  state: MergeQueueState,
  config: QueueWorkerConfig,
): Promise<{ updatedState: MergeQueueState; result: QueueProcessingResult } | null> {
  // Find the next queued item (FIFO)
  const nextItem = state.items
    .filter((item) => item.status === "queued")
    .sort((a, b) => a.position - b.position)[0];

  if (!nextItem) {
    return null;
  }

  // Mark item as active
  const updatedItem: QueueItem = {
    ...nextItem,
    status: "active",
    attemptCount: nextItem.attemptCount + 1,
    updatedAt: new Date().toISOString(),
  };

  // Create updated state with the modified item
  const updatedState: MergeQueueState = {
    schemaVersion: state.schemaVersion,
    items: state.items.map((item) =>
      item.issueId === nextItem.issueId ? updatedItem : item,
    ),
    processedCount: state.processedCount,
  };

  // Publish event for queue state change
  config.eventPublisher.publish({
    id: crypto.randomUUID(),
    type: "merge.queue_state",
    timestamp: new Date().toISOString(),
    sequence: state.items.length + 1,
    payload: {
      issueId: nextItem.issueId,
      status: "active",
      attemptCount: updatedItem.attemptCount,
      errorDetail: null,
    },
  });

  return {
    updatedState,
    result: {
      issueId: nextItem.issueId,
      success: false, // S14 will implement actual merge logic
      error: "Merge gate execution not yet implemented (S14)",
      newStatus: "active",
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
