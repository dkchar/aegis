/**
 * Janus outcome artifact persistence.
 *
 * SPECv2 §10.4, §12.6, §12.9:
 *   - Janus produces a structured integration-resolution artifact
 *   - Janus either prepares a refreshed candidate for requeue or emits an explicit unresolved escalation artifact
 *   - Atomic writes via tmp→rename for all file persistence
 *
 * Follows the same atomic tmp→rename pattern as emit-outcome-artifact.ts.
 */

import { writeFileSync, renameSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { JanusResolutionArtifact } from "../castes/janus/janus-parser.js";

// ---------------------------------------------------------------------------
// Janus outcome artifact model
// ---------------------------------------------------------------------------

/** A durable Janus resolution outcome artifact. */
export interface JanusOutcomeArtifact {
  /** The originating Beads issue ID. */
  originatingIssueId: string;

  /** The merge queue item ID. */
  queueItemId: string;

  /** Path to the preserved conflict labor or integration branch. */
  preservedLaborPath: string;

  /** Summary of the conflict or failure that was addressed. */
  conflictSummary: string;

  /** The resolution strategy chosen and applied. */
  resolutionStrategy: string;

  /** Files modified during resolution. */
  filesTouched: string[];

  /** Checks run after resolution (tests, lint, build, etc.). */
  validationsRun: string[];

  /** Remaining risks or concerns after resolution. */
  residualRisks: string[];

  /** Recommended next action for the queue or human. */
  recommendedNextAction: "requeue" | "manual_decision" | "fail";

  /** ISO-8601 timestamp when the artifact was created. */
  createdAt: string;

  /** Optional reference to the Janus session that produced this. */
  janusSessionRef: string | null;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function artifactsDir(projectRoot: string): string {
  return join(projectRoot, ".aegis", "merge-artifacts");
}

function janusOutcomePath(projectRoot: string, issueId: string): string {
  const safeIssueId = issueId.replace(/[^a-zA-Z0-9._-]/g, "_");
  return join(artifactsDir(projectRoot), `janus-outcome-${safeIssueId}.json`);
}

function janusOutcomeTmpPath(projectRoot: string, issueId: string): string {
  return janusOutcomePath(projectRoot, issueId) + ".tmp";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Emit a Janus outcome artifact atomically.
 *
 * Persists the Janus resolution result under .aegis/merge-artifacts/ using
 * the tmp→rename pattern for crash-safe writes.
 *
 * @param artifact - The parsed Janus resolution artifact.
 * @param projectRoot - Absolute path to the project root.
 * @param janusSessionRef - Optional reference to the Janus session.
 * @returns The emitted Janus outcome artifact.
 */
export async function emitJanusOutcomeArtifact(
  artifact: JanusResolutionArtifact,
  projectRoot: string,
  janusSessionRef: string | null = null,
): Promise<JanusOutcomeArtifact> {
  const outcome: JanusOutcomeArtifact = {
    originatingIssueId: artifact.originatingIssueId,
    queueItemId: artifact.queueItemId,
    preservedLaborPath: artifact.preservedLaborPath,
    conflictSummary: artifact.conflictSummary,
    resolutionStrategy: artifact.resolutionStrategy,
    filesTouched: artifact.filesTouched.slice(),
    validationsRun: artifact.validationsRun.slice(),
    residualRisks: artifact.residualRisks.slice(),
    recommendedNextAction: artifact.recommendedNextAction,
    createdAt: new Date().toISOString(),
    janusSessionRef,
  };

  // Atomic write via tmp→rename
  const dir = artifactsDir(projectRoot);
  mkdirSync(dir, { recursive: true });

  const finalPath = janusOutcomePath(projectRoot, artifact.originatingIssueId);
  const tmpPath = janusOutcomeTmpPath(projectRoot, artifact.originatingIssueId);

  const json = JSON.stringify(outcome, null, 2);
  writeFileSync(tmpPath, json, "utf-8");
  renameSync(tmpPath, finalPath);

  return outcome;
}

/**
 * Load an existing Janus outcome artifact if present.
 *
 * @param issueId - The originating issue ID.
 * @param projectRoot - Absolute path to the project root.
 * @returns The artifact if it exists, or null.
 */
export function loadJanusOutcomeArtifact(
  issueId: string,
  projectRoot: string,
): JanusOutcomeArtifact | null {
  const filePath = janusOutcomePath(projectRoot, issueId);

  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    // Basic validation of required fields
    const requiredFields = [
      "originatingIssueId",
      "queueItemId",
      "preservedLaborPath",
      "conflictSummary",
      "resolutionStrategy",
      "filesTouched",
      "validationsRun",
      "residualRisks",
      "recommendedNextAction",
      "createdAt",
    ];

    for (const field of requiredFields) {
      if (!(field in parsed)) {
        return null;
      }
    }

    return parsed as unknown as JanusOutcomeArtifact;
  } catch {
    return null;
  }
}

/**
 * Serialize a Janus outcome artifact to a JSON string.
 *
 * @param artifact - The artifact to serialize.
 * @returns JSON string representation.
 */
export function serializeJanusOutcomeArtifact(artifact: JanusOutcomeArtifact): string {
  return JSON.stringify(artifact, null, 2);
}

/**
 * Parse a Janus outcome artifact from a JSON string.
 *
 * @param json - JSON string to parse.
 * @returns The parsed artifact.
 * @throws Error if the JSON is malformed or missing required fields.
 */
export function parseJanusOutcomeArtifact(json: string): JanusOutcomeArtifact {
  const parsed = JSON.parse(json) as Record<string, unknown>;

  const requiredFields = [
    "originatingIssueId",
    "queueItemId",
    "preservedLaborPath",
    "conflictSummary",
    "resolutionStrategy",
    "filesTouched",
    "validationsRun",
    "residualRisks",
    "recommendedNextAction",
    "createdAt",
  ];

  for (const field of requiredFields) {
    if (!(field in parsed)) {
      throw new Error(
        `parseJanusOutcomeArtifact: missing required field '${field}'`,
      );
    }
  }

  return parsed as unknown as JanusOutcomeArtifact;
}
