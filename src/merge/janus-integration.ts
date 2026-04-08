/**
 * Janus integration — safe requeue and human-decision artifact generation.
 *
 * SPECv2 §10.4, §10.4.1, §12.6, §12.9:
 *   - on Janus success (requeue): update candidate, return item to queue for fresh mechanical pass
 *   - on Janus failure or unsafe ambiguity: create manual-decision artifacts and stop automatic processing
 *   - queue remains owner of sequencing, retries, and final merge admission
 *   - no mutations — all functions return new objects
 *   - atomic writes via tmp→rename for all file persistence
 */

import { writeFileSync, renameSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { JanusResolutionArtifact } from "../castes/janus/janus-parser.js";
import type {
  MergeQueueState,
  QueueItem,
} from "./merge-queue-store.js";
import type { LiveEventPublisher } from "../events/event-bus.js";
import {
  createMergeQueueStateEvent,
  createMergeOutcomeEvent,
} from "../events/merge-events.js";
import { shouldPreserveLabor, preserveLabor } from "./preserve-labor.js";

// ---------------------------------------------------------------------------
// Human decision artifact model
// ---------------------------------------------------------------------------

/** Structured artifact created when Janus detects semantic ambiguity. */
export interface HumanDecisionArtifact {
  /** The originating Beads issue ID. */
  originatingIssueId: string;

  /** The merge queue item ID. */
  queueItemId: string;

  /** Reference to the Janus resolution that triggered this. */
  janusResolutionRef: string;

  /** Summary of the semantic ambiguity encountered. */
  semanticAmbiguitySummary: string;

  /** Options that Janus considered but could not resolve autonomously. */
  optionsConsidered: string[];

  /** The action recommended to a human operator. */
  recommendedHumanAction: string;

  /** ISO-8601 timestamp when the artifact was created. */
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Janus result handling
// ---------------------------------------------------------------------------

/** Result of handling a Janus resolution. */
export interface JanusHandlingResult {
  /** The updated queue state (no mutations to input). */
  updatedState: MergeQueueState;

  /** Whether a human-decision artifact was created. */
  humanDecisionCreated: boolean;

  /** Path to the human-decision artifact, if any. */
  humanDecisionPath: string | null;

  /** The final status of the queue item. */
  finalStatus: QueueItem["status"];
}

/**
 * Handle the result of a Janus resolution.
 *
 * Based on the recommendedNextAction from the parsed Janus artifact:
 *   - "requeue": reset item to queued, reset attempts, preserve labor, return to queue
 *   - "manual_decision": create human-decision artifact, set status to manual_decision_required
 *   - "fail": set status to janus_failed, preserve labor, emit failure events
 *
 * @param artifact - The parsed Janus resolution artifact.
 * @param projectRoot - Absolute path to the project root.
 * @param state - Current merge queue state (never mutated).
 * @param eventPublisher - Event publisher for SSE events.
 * @returns Result containing updated state and metadata.
 */
export async function handleJanusResult(
  artifact: JanusResolutionArtifact,
  projectRoot: string,
  state: MergeQueueState,
  eventPublisher: LiveEventPublisher,
): Promise<JanusHandlingResult> {
  switch (artifact.recommendedNextAction) {
    case "requeue":
      return handleJanusRequeue(artifact, projectRoot, state, eventPublisher);
    case "manual_decision":
      return handleJanusManualDecision(artifact, projectRoot, state, eventPublisher);
    case "fail":
      return handleJanusFailure(artifact, projectRoot, state, eventPublisher);
    default:
      // Should never happen given strict parser validation
      throw new Error(
        `handleJanusResult: unrecognized recommendedNextAction: ${(artifact as { recommendedNextAction: string }).recommendedNextAction}`,
      );
  }
}

/**
 * Handle Janus success with requeue recommendation.
 *
 * Resets the queue item back to queued status with attempt count reset,
 * preserving any labor from the Janus session. The item returns to the
 * queue for a fresh mechanical pass.
 */
function handleJanusRequeue(
  artifact: JanusResolutionArtifact,
  projectRoot: string,
  state: MergeQueueState,
  eventPublisher: LiveEventPublisher,
): JanusHandlingResult {
  const updatedState: MergeQueueState = janusRequeue(
    state,
    artifact.queueItemId,
  );

  // Publish SSE event for the requeue
  const updatedItem = updatedState.items.find(
    (item) => item.issueId === artifact.originatingIssueId,
  );

  if (updatedItem) {
    eventPublisher.publish({
      id: crypto.randomUUID(),
      type: "merge.queue_state",
      timestamp: new Date().toISOString(),
      sequence: state.items.length + 1,
      payload: createMergeQueueStateEvent(
        artifact.originatingIssueId,
        "queued",
        updatedItem.attemptCount,
      ),
    });

    eventPublisher.publish({
      id: crypto.randomUUID(),
      type: "merge.outcome",
      timestamp: new Date().toISOString(),
      sequence: state.items.length + 2,
      payload: createMergeOutcomeEvent(
        artifact.originatingIssueId,
        "JANUS_RESOLVED",
        updatedItem.candidateBranch,
        updatedItem.targetBranch,
        "Janus resolved; item requeued for fresh mechanical pass",
      ),
    });
  }

  return {
    updatedState,
    humanDecisionCreated: false,
    humanDecisionPath: null,
    finalStatus: "queued",
  };
}

/**
 * Handle Janus detecting semantic ambiguity requiring human decision.
 *
 * Creates a human-decision artifact under .aegis/merge-artifacts/ and
 * sets the queue item status to manual_decision_required.
 */
async function handleJanusManualDecision(
  artifact: JanusResolutionArtifact,
  projectRoot: string,
  state: MergeQueueState,
  eventPublisher: LiveEventPublisher,
): Promise<JanusHandlingResult> {
  const humanDecisionArtifact = await createHumanDecisionArtifact(
    artifact,
    projectRoot,
  );

  const updatedItems = state.items.map((item) =>
    item.issueId === artifact.originatingIssueId
      ? {
          ...item,
          status: "manual_decision_required" as const,
          updatedAt: new Date().toISOString(),
        }
      : { ...item },
  );

  const updatedState: MergeQueueState = {
    schemaVersion: state.schemaVersion,
    items: updatedItems,
    processedCount: state.processedCount,
  };

  const updatedItem = updatedItems.find(
    (item) => item.issueId === artifact.originatingIssueId,
  );

  if (updatedItem) {
    eventPublisher.publish({
      id: crypto.randomUUID(),
      type: "merge.queue_state",
      timestamp: new Date().toISOString(),
      sequence: state.items.length + 1,
      payload: createMergeQueueStateEvent(
        artifact.originatingIssueId,
        "manual_decision_required",
        updatedItem.attemptCount,
        "Semantic ambiguity requires human decision",
      ),
    });

    eventPublisher.publish({
      id: crypto.randomUUID(),
      type: "merge.outcome",
      timestamp: new Date().toISOString(),
      sequence: state.items.length + 2,
      payload: createMergeOutcomeEvent(
        artifact.originatingIssueId,
        "MANUAL_DECISION_REQUIRED",
        updatedItem.candidateBranch,
        updatedItem.targetBranch,
        artifact.conflictSummary,
      ),
    });
  }

  return {
    updatedState,
    humanDecisionCreated: true,
    humanDecisionPath: join(
      projectRoot,
      ".aegis",
      "merge-artifacts",
      `human-decision-${artifact.originatingIssueId}.json`,
    ),
    finalStatus: "manual_decision_required",
  };
}

/**
 * Handle Janus failure.
 *
 * Sets the queue item status to janus_failed, preserves labor if applicable,
 * and emits failure events.
 */
async function handleJanusFailure(
  artifact: JanusResolutionArtifact,
  projectRoot: string,
  state: MergeQueueState,
  eventPublisher: LiveEventPublisher,
): Promise<JanusHandlingResult> {
  // Preserve labor from the Janus session
  const laborPath = artifact.preservedLaborPath;
  if (laborPath && shouldPreserveLabor("MERGE_FAILED")) {
    try {
      await preserveLabor({
        issueId: artifact.originatingIssueId,
        laborPath,
        branchName: artifact.queueItemId,
        outcome: "MERGE_FAILED",
        isConflict: false,
        reason: `Janus failure: ${artifact.conflictSummary}`,
      });
    } catch {
      // Labor preservation is best-effort; don't fail the whole operation
    }
  }

  const updatedItems = state.items.map((item) =>
    item.issueId === artifact.originatingIssueId
      ? {
          ...item,
          status: "janus_failed" as const,
          lastError: artifact.conflictSummary,
          updatedAt: new Date().toISOString(),
        }
      : { ...item },
  );

  const updatedState: MergeQueueState = {
    schemaVersion: state.schemaVersion,
    items: updatedItems,
    processedCount: state.processedCount,
  };

  const updatedItem = updatedItems.find(
    (item) => item.issueId === artifact.originatingIssueId,
  );

  if (updatedItem) {
    eventPublisher.publish({
      id: crypto.randomUUID(),
      type: "merge.queue_state",
      timestamp: new Date().toISOString(),
      sequence: state.items.length + 1,
      payload: createMergeQueueStateEvent(
        artifact.originatingIssueId,
        "janus_failed",
        updatedItem.attemptCount,
        artifact.conflictSummary,
      ),
    });

    eventPublisher.publish({
      id: crypto.randomUUID(),
      type: "merge.outcome",
      timestamp: new Date().toISOString(),
      sequence: state.items.length + 2,
      payload: createMergeOutcomeEvent(
        artifact.originatingIssueId,
        "JANUS_FAILED",
        updatedItem.candidateBranch,
        updatedItem.targetBranch,
        artifact.conflictSummary,
      ),
    });
  }

  return {
    updatedState,
    humanDecisionCreated: false,
    humanDecisionPath: null,
    finalStatus: "janus_failed",
  };
}

// ---------------------------------------------------------------------------
// Human decision artifact persistence
// ---------------------------------------------------------------------------

/**
 * Create a human-decision artifact under .aegis/merge-artifacts/.
 *
 * The artifact captures the semantic ambiguity encountered by Janus and
 * provides structured context for a human operator to make the correct
 * merge decision.
 *
 * Uses atomic tmp→rename pattern for safe persistence.
 *
 * @param janusArtifact - The Janus resolution artifact with manual_decision recommendation.
 * @param projectRoot - Absolute path to the project root.
 * @returns The created human-decision artifact.
 */
export async function createHumanDecisionArtifact(
  janusArtifact: JanusResolutionArtifact,
  projectRoot: string,
): Promise<HumanDecisionArtifact> {
  const artifact: HumanDecisionArtifact = {
    originatingIssueId: janusArtifact.originatingIssueId,
    queueItemId: janusArtifact.queueItemId,
    janusResolutionRef: janusArtifact.resolutionStrategy,
    semanticAmbiguitySummary: janusArtifact.conflictSummary,
    optionsConsidered: janusArtifact.residualRisks.length > 0
      ? janusArtifact.residualRisks
      : ["Unable to determine correct resolution without domain context"],
    recommendedHumanAction: buildRecommendedHumanAction(janusArtifact),
    createdAt: new Date().toISOString(),
  };

  // Atomic write via tmp→rename
  const artifactsDir = join(projectRoot, ".aegis", "merge-artifacts");
  mkdirSync(artifactsDir, { recursive: true });

  const safeIssueId = janusArtifact.originatingIssueId.replace(/[^a-zA-Z0-9._-]/g, "_");
  const fileName = `human-decision-${safeIssueId}.json`;
  const finalPath = join(artifactsDir, fileName);
  const tmpPath = finalPath + ".tmp";

  const json = JSON.stringify(artifact, null, 2);
  writeFileSync(tmpPath, json, "utf-8");
  renameSync(tmpPath, finalPath);

  return artifact;
}

/**
 * Build a recommended human action string from the Janus artifact context.
 */
function buildRecommendedHumanAction(
  janusArtifact: JanusResolutionArtifact,
): string {
  const filesContext =
    janusArtifact.filesTouched.length > 0
      ? ` Files involved: ${janusArtifact.filesTouched.join(", ")}.`
      : "";

  const validationsContext =
    janusArtifact.validationsRun.length > 0
      ? ` Janus ran: ${janusArtifact.validationsRun.join(", ")}.`
      : "";

  return (
    `Review the merge conflict: "${janusArtifact.conflictSummary}".` +
    ` Janus strategy: ${janusArtifact.resolutionStrategy}.` +
    filesContext +
    validationsContext +
    " Determine the correct integration approach and resolve manually."
  );
}

/**
 * Load an existing human-decision artifact if present.
 *
 * @param issueId - The originating issue ID.
 * @param projectRoot - Absolute path to the project root.
 * @returns The artifact if it exists, or null.
 */
export function loadHumanDecisionArtifact(
  issueId: string,
  projectRoot: string,
): HumanDecisionArtifact | null {
  const safeIssueId = issueId.replace(/[^a-zA-Z0-9._-]/g, "_");
  const fileName = `human-decision-${safeIssueId}.json`;
  const filePath = join(projectRoot, ".aegis", "merge-artifacts", fileName);

  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    // Basic validation
    const requiredFields = [
      "originatingIssueId",
      "queueItemId",
      "janusResolutionRef",
      "semanticAmbiguitySummary",
      "optionsConsidered",
      "recommendedHumanAction",
      "createdAt",
    ];

    for (const field of requiredFields) {
      if (!(field in parsed)) {
        return null;
      }
    }

    return parsed as unknown as HumanDecisionArtifact;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Safe requeue
// ---------------------------------------------------------------------------

/**
 * Safely requeue a Janus-resolved item back into the merge queue.
 *
 * This function:
 *   - Updates the queue item status to "queued" (from "janus_required" or "janus_resolved")
 *   - Resets attempt count to allow a fresh mechanical pass
 *   - Preserves the labor history and position in the queue
 *   - Returns a new queue state (never mutates the input)
 *
 * @param state - Current merge queue state.
 * @param issueId - The issue ID to requeue.
 * @returns Updated queue state with the item requeued.
 */
export function janusRequeue(
  state: MergeQueueState,
  issueId: string,
): MergeQueueState {
  const updatedItems = state.items.map((item) =>
    item.issueId === issueId
      ? {
          ...item,
          status: "queued" as const,
          attemptCount: 0,
          lastError: null,
          updatedAt: new Date().toISOString(),
        }
      : { ...item },
  );

  return {
    schemaVersion: state.schemaVersion,
    items: updatedItems,
    processedCount: state.processedCount,
  };
}
