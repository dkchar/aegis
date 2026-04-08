/**
 * Merge queue store — persistence and restart-safe access for `.aegis/merge-queue.json`.
 *
 * SPECv2 §4.3 and §12:
 *   - `.aegis/merge-queue.json` is authoritative for queue processing
 *   - subordinate to dispatch state, rebuildable from durable facts
 *   - tracks candidate branches awaiting merge, queue order, status, attempts, failures
 *   - atomic writes via tmp→rename pattern
 *   - restart-safe: queue can be rebuilt from dispatch state + git branches
 */

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Queue item model
// ---------------------------------------------------------------------------

/** Current status of a queue item. */
export type QueueItemStatus =
  | "queued"
  | "active"
  | "merged"
  | "merge_failed"
  | "rework_requested"
  | "janus_required"
  | "janus_resolved"
  | "janus_failed"
  | "manual_decision_required";

/** A single candidate in the merge queue. */
export interface QueueItem {
  /** The originating Beads issue ID (e.g. "aegis-fjm.5"). */
  issueId: string;

  /** The candidate branch name created by Titan's labor. */
  candidateBranch: string;

  /** The target branch for merge (typically "main"). */
  targetBranch: string;

  /** ISO-8601 timestamp when this item was enqueued. */
  enqueuedAt: string;

  /** Queue order position (0 = next to merge). */
  position: number;

  /** Current processing status. */
  status: QueueItemStatus;

  /** Number of merge attempt cycles for this item. */
  attemptCount: number;

  /** Last mechanical error message, if any. */
  lastError: string | null;

  /** The dispatch stage this item came from (typically "implemented"). */
  sourceStage: string;

  /** Opaque session provenance ID from the dispatch record. */
  sessionProvenanceId: string;

  /** ISO-8601 timestamp of last modification. */
  updatedAt: string;

  /** Optional reference to Titan's handoff artifact for this candidate. */
  handoffArtifactRef: string | null;
}

// ---------------------------------------------------------------------------
// Queue state model
// ---------------------------------------------------------------------------

/**
 * The full contents of `.aegis/merge-queue.json`.
 *
 * `items` is an ordered array of QueueItem records.
 * `schemaVersion` allows forward-compatible migrations.
 * `processedCount` tracks total items that have left the queue (merged or failed).
 */
export interface MergeQueueState {
  schemaVersion: 1;
  items: QueueItem[];
  processedCount: number;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function aegisDir(projectRoot: string): string {
  return join(projectRoot, ".aegis");
}

function mergeQueuePath(projectRoot: string): string {
  return join(aegisDir(projectRoot), "merge-queue.json");
}

function mergeQueueTmpPath(projectRoot: string): string {
  return join(aegisDir(projectRoot), "merge-queue.json.tmp");
}

// ---------------------------------------------------------------------------
// Load / save helpers
// ---------------------------------------------------------------------------

/**
 * Load the merge queue state from disk.
 *
 * - Returns `emptyMergeQueueState()` when the file does not exist.
 * - Throws with context when the file exists but is malformed.
 *
 * @param projectRoot - Absolute path to the project root.
 * @returns The persisted MergeQueueState.
 */
export function loadMergeQueueState(projectRoot: string): MergeQueueState {
  const filePath = mergeQueuePath(projectRoot);

  if (!existsSync(filePath)) {
    return emptyMergeQueueState();
  }

  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch (err) {
    throw new Error(
      `loadMergeQueueState: failed to read ${filePath}: ${(err as Error).message}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `loadMergeQueueState: malformed JSON in ${filePath}: ${(err as Error).message}`,
    );
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as Record<string, unknown>)["schemaVersion"] !== 1
  ) {
    throw new Error(
      `loadMergeQueueState: invalid or unsupported schemaVersion in ${filePath}`,
    );
  }

  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj["items"])) {
    throw new Error(
      `loadMergeQueueState: missing or invalid 'items' field in ${filePath}`,
    );
  }

  return parsed as MergeQueueState;
}

/**
 * Atomically persist the merge queue state to disk.
 *
 * Uses write-to-tmp then rename so a mid-write crash cannot corrupt the
 * existing file.
 *
 * @param projectRoot - Absolute path to the project root.
 * @param state - The state to write.
 */
export function saveMergeQueueState(projectRoot: string, state: MergeQueueState): void {
  const dir = aegisDir(projectRoot);
  mkdirSync(dir, { recursive: true });

  const tmpPath = mergeQueueTmpPath(projectRoot);
  const finalPath = mergeQueuePath(projectRoot);

  const json = JSON.stringify(state, null, 2);
  writeFileSync(tmpPath, json, "utf-8");
  renameSync(tmpPath, finalPath);
}

/**
 * Return an empty, valid MergeQueueState for first-run initialisation.
 */
export function emptyMergeQueueState(): MergeQueueState {
  return {
    schemaVersion: 1,
    items: [],
    processedCount: 0,
  };
}

// ---------------------------------------------------------------------------
// Queue operations (pure, no mutation)
// ---------------------------------------------------------------------------

/**
 * Reconcile the merge queue state after a restart.
 *
 * Clears any items that were marked as `active` (since the merge worker died
 * with the process). Active items are reset to `queued` position so they can
 * be reprocessed. The queue order is preserved.
 *
 * @param state - The state loaded from disk.
 * @param liveSessionId - The current process session identifier.
 * @returns A reconciled **copy** of the state (original is never mutated).
 */
export function reconcileMergeQueueState(
  state: MergeQueueState,
  liveSessionId: string,
): MergeQueueState {
  const reconciledItems = state.items.map((item) => {
    if (item.status === "active") {
      return {
        ...item,
        status: "queued" as const,
        sessionProvenanceId: liveSessionId,
        updatedAt: new Date().toISOString(),
      };
    }
    return { ...item };
  });

  return {
    schemaVersion: state.schemaVersion,
    items: reconciledItems,
    processedCount: state.processedCount,
  };
}

/**
 * Get the next item to process from the queue (FIFO).
 *
 * Returns the first item with status `queued`, or null if the queue is empty
 * or has no ready items.
 *
 * @param state - Current queue state.
 * @returns The next QueueItem to process, or null.
 */
export function nextQueuedItem(state: MergeQueueState): QueueItem | null {
  const queued = state.items
    .filter((item) => item.status === "queued")
    .sort((a, b) => a.position - b.position);

  return queued.length > 0 ? queued[0] : null;
}

/**
 * Check if an issue is already in the merge queue.
 *
 * @param state - Current queue state.
 * @param issueId - The issue ID to check.
 * @returns True if the issue is already queued or being processed.
 */
export function isInQueue(state: MergeQueueState, issueId: string): boolean {
  return state.items.some(
    (item) => item.issueId === issueId && !isTerminalStatus(item.status),
  );
}

/**
 * Determine if a queue item status is terminal (no further processing needed).
 */
export function isTerminalStatus(status: QueueItemStatus): boolean {
  return (
    status === "merged" ||
    status === "manual_decision_required" ||
    status === "janus_failed"
  );
}
