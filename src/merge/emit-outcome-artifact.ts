/**
 * Outcome artifact emission — S14 implementation.
 *
 * SPECv2 §12.6 and §12.9:
 *   - on success, emit success outcome and advance dispatch state to `merged`
 *   - on stale-branch or non-conflict failure, emit failure outcome and create rework
 *   - on hard conflict, create conflict issue and preserve labor
 *   - outcomes: MERGE_READY, MERGED, MERGE_FAILED, REWORK_REQUEST, etc.
 */

import { writeFileSync, renameSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { MergeOutcomeEventPayload } from "../events/merge-events.js";
import type { ConflictTier } from "./apply-merge.js";

// ---------------------------------------------------------------------------
// Outcome artifact model
// ---------------------------------------------------------------------------

/** A durable merge outcome artifact. */
export interface MergeOutcomeArtifact {
  /** The originating Beads issue ID. */
  issueId: string;

  /** The semantic merge outcome (SPECv2 §12.9). */
  outcome: MergeOutcomeEventPayload["outcome"];

  /** The candidate branch name. */
  candidateBranch: string;

  /** The target branch name. */
  targetBranch: string;

  /** The conflict tier classification. */
  conflictTier: ConflictTier;

  /** Human-readable detail about the outcome. */
  detail: string;

  /** ISO-8601 timestamp when the artifact was created. */
  createdAt: string;

  /** Optional reference to associated follow-up issue (rework, conflict, etc.). */
  followUpIssueId: string | null;

  /** Whether the associated labor was preserved. */
  laborPreserved: boolean;

  /** Optional error message for failed outcomes. */
  error?: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Emit a merge outcome artifact.
 *
 * This function:
 *   1. Constructs a MergeOutcomeArtifact from the merge result
 *   2. Persists it atomically under .aegis/labors/ as a JSON file
 *   3. Returns the artifact for downstream use (dispatch state, follow-up issues)
 *
 * Note: SSE event emission is the caller's responsibility via the live event
 * publisher. This function handles only file persistence.
 *
 * @param issueId - The originating Beads issue ID.
 * @param outcome - The semantic merge outcome.
 * @param candidateBranch - The candidate branch name.
 * @param targetBranch - The target branch name.
 * @param conflictTier - The conflict tier classification.
 * @param detail - Human-readable detail.
 * @param laborPreserved - Whether the labor was preserved.
 * @param projectRoot - Project root for artifact persistence.
 * @param error - Optional error message for failed outcomes.
 * @returns The emitted outcome artifact.
 */
export async function emitOutcomeArtifact(
  issueId: string,
  outcome: MergeOutcomeEventPayload["outcome"],
  candidateBranch: string,
  targetBranch: string,
  conflictTier: ConflictTier,
  detail: string,
  laborPreserved: boolean,
  projectRoot: string,
  error?: string,
): Promise<MergeOutcomeArtifact> {
  const artifact: MergeOutcomeArtifact = {
    issueId,
    outcome,
    candidateBranch,
    targetBranch,
    conflictTier,
    detail,
    createdAt: new Date().toISOString(),
    followUpIssueId: null,
    laborPreserved,
    error,
  };

  // Persist atomically via tmp→rename
  const laborsDir = join(projectRoot, ".aegis", "labors");
  mkdirSync(laborsDir, { recursive: true });

  const safeIssueId = issueId.replace(/[^a-zA-Z0-9._-]/g, "_");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `merge-outcome-${safeIssueId}-${timestamp}.json`;
  const finalPath = join(laborsDir, fileName);
  const tmpPath = finalPath + ".tmp";

  const json = serializeOutcomeArtifact(artifact);
  writeFileSync(tmpPath, json, "utf-8");
  renameSync(tmpPath, finalPath);

  return artifact;
}

/**
 * Serialize a merge outcome artifact to a JSON string for persistence.
 *
 * @param artifact - The artifact to serialize.
 * @returns JSON string representation.
 */
export function serializeOutcomeArtifact(artifact: MergeOutcomeArtifact): string {
  return JSON.stringify(artifact, null, 2);
}

/**
 * Parse a merge outcome artifact from a JSON string.
 *
 * @param json - JSON string to parse.
 * @returns The parsed artifact.
 * @throws Error if the JSON is malformed or missing required fields.
 */
export function parseOutcomeArtifact(json: string): MergeOutcomeArtifact {
  const parsed = JSON.parse(json) as Record<string, unknown>;

  const requiredFields = [
    "issueId",
    "outcome",
    "candidateBranch",
    "targetBranch",
    "conflictTier",
    "detail",
    "createdAt",
    "laborPreserved",
  ];

  for (const field of requiredFields) {
    if (!(field in parsed)) {
      throw new Error(
        `parseOutcomeArtifact: missing required field '${field}'`,
      );
    }
  }

  return parsed as unknown as MergeOutcomeArtifact;
}
