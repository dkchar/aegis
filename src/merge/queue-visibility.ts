/**
 * Queue visibility helpers — Olympus dashboard display support.
 *
 * SPECv2 §12.4 and §12.5:
 *   - queue items carry full context for Olympus display
 *   - FIFO ordering visible to operator
 *   - queue state must be derivable and restart-safe
 *
 * This module provides formatted views of the merge queue for the Olympus
 * dashboard. It does NOT own queue state — it reads from MergeQueueState
 * and transforms it for display.
 */

import type { MergeQueueState, QueueItem, QueueItemStatus } from "./merge-queue-store.js";
import { isTerminalStatus } from "./merge-queue-store.js";

/** A formatted queue item for Olympus display. */
export interface QueueItemDisplay {
  /** The originating Beads issue ID. */
  issueId: string;

  /** The candidate branch name. */
  candidateBranch: string;

  /** The target branch. */
  targetBranch: string;

  /** Current processing status. */
  status: QueueItemStatus;

  /** Queue position (0 = next to merge). */
  position: number;

  /** Number of merge attempts. */
  attemptCount: number;

  /** Last error, if any. */
  lastError: string | null;

  /** ISO-8601 timestamp when this item was enqueued. */
  enqueuedAt: string;

  /** Human-readable relative time since enqueue (e.g. "2m ago"). */
  enqueuedAgo: string;

  /** The dispatch stage this item came from. */
  sourceStage: string;

  /** Session provenance ID for restart safety tracking. */
  sessionProvenanceId: string;
}

/** Full queue snapshot for Olympus display. */
export interface QueueSnapshot {
  /** Total items in the queue (all non-terminal statuses). */
  totalDepth: number;

  /** Items actively waiting (status === "queued"). */
  waitingCount: number;

  /** Items currently being processed (status === "active"). */
  activeCount: number;

  /** Total items processed through the queue (merged or terminal). */
  processedCount: number;

  /** Formatted queue items in FIFO order. */
  items: QueueItemDisplay[];

  /** Whether the queue is currently idle (no active items, no waiting items). */
  isIdle: boolean;

  /** ISO-8601 timestamp when this snapshot was generated. */
  snapshotAt: string;
}

/**
 * Compute human-readable relative time since an ISO timestamp.
 *
 * @param isoTimestamp - ISO-8601 timestamp.
 * @param now - Optional current time (defaults to Date.now()).
 * @returns Human-readable string like "2m ago", "1h ago", "3d ago".
 */
export function relativeTime(isoTimestamp: string, now: number = Date.now()): string {
  const then = Date.parse(isoTimestamp);
  if (Number.isNaN(then)) return "unknown";

  const diffMs = now - then;
  if (diffMs < 0) return "just now";

  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;

  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

/**
 * Format a single queue item for Olympus display.
 *
 * @param item - The raw queue item.
 * @param now - Optional current time for relative time calculation.
 * @returns Formatted display item.
 */
export function formatQueueItemForDisplay(
  item: QueueItem,
  now: number = Date.now(),
): QueueItemDisplay {
  return {
    issueId: item.issueId,
    candidateBranch: item.candidateBranch,
    targetBranch: item.targetBranch,
    status: item.status,
    position: item.position,
    attemptCount: item.attemptCount,
    lastError: item.lastError,
    enqueuedAt: item.enqueuedAt,
    enqueuedAgo: relativeTime(item.enqueuedAt, now),
    sourceStage: item.sourceStage,
    sessionProvenanceId: item.sessionProvenanceId,
  };
}

/**
 * Build a full queue snapshot for Olympus display.
 *
 * This reads the current MergeQueueState and returns a formatted snapshot
 * with computed counts, relative times, and FIFO-ordered items.
 *
 * @param state - Current merge queue state.
 * @param now - Optional current time for relative time calculation.
 * @returns Formatted queue snapshot.
 */
export function getQueueSnapshot(
  state: MergeQueueState,
  now: number = Date.now(),
): QueueSnapshot {
  const nonTerminalItems = state.items.filter(
    (item) => !isTerminalStatus(item.status),
  );

  const waitingItems = state.items.filter((item) => item.status === "queued");
  const activeItems = state.items.filter((item) => item.status === "active");

  const displayItems = nonTerminalItems
    .sort((a, b) => a.position - b.position)
    .map((item) => formatQueueItemForDisplay(item, now));

  return {
    totalDepth: nonTerminalItems.length,
    waitingCount: waitingItems.length,
    activeCount: activeItems.length,
    processedCount: state.processedCount,
    items: displayItems,
    isIdle: nonTerminalItems.length === 0,
    snapshotAt: new Date(now).toISOString(),
  };
}

/**
 * Get the queue depth — number of items in non-terminal statuses.
 *
 * @param state - Current merge queue state.
 * @returns Number of non-terminal items.
 */
export function getQueueDepth(state: MergeQueueState): number {
  return state.items.filter(
    (item) => !isTerminalStatus(item.status),
  ).length;
}

/**
 * Get the number of items currently waiting (queued, not active).
 *
 * @param state - Current merge queue state.
 * @returns Number of waiting items.
 */
export function getWaitingCount(state: MergeQueueState): number {
  return state.items.filter((item) => item.status === "queued").length;
}

/**
 * Get the number of items currently being processed (active).
 *
 * @param state - Current merge queue state.
 * @returns Number of active items.
 */
export function getActiveCount(state: MergeQueueState): number {
  return state.items.filter((item) => item.status === "active").length;
}

/**
 * Check if the queue is idle (no waiting or active items).
 *
 * @param state - Current merge queue state.
 * @returns True if the queue is idle.
 */
export function isQueueIdle(state: MergeQueueState): boolean {
  return getQueueDepth(state) === 0;
}

/**
 * Get the next item in FIFO order for display purposes.
 *
 * @param state - Current merge queue state.
 * @returns The first queued item, or null if none.
 */
export function getNextInQueue(state: MergeQueueState): QueueItemDisplay | null {
  const next = state.items
    .filter((item) => item.status === "queued")
    .sort((a, b) => a.position - b.position)[0];

  return next ? formatQueueItemForDisplay(next) : null;
}

/**
 * Build a status summary string for Olympus display.
 *
 * @param state - Current merge queue state.
 * @returns Human-readable status string like "3 queued, 1 active, 12 processed".
 */
export function getQueueStatusSummary(state: MergeQueueState): string {
  const waiting = getWaitingCount(state);
  const active = getActiveCount(state);
  const processed = state.processedCount;

  const parts: string[] = [];
  if (waiting > 0) parts.push(`${waiting} queued`);
  if (active > 0) parts.push(`${active} active`);
  if (processed > 0) parts.push(`${processed} processed`);

  return parts.length > 0 ? parts.join(", ") : "idle";
}
