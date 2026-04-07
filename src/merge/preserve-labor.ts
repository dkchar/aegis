/**
 * Labor preservation — S14 implementation.
 *
 * SPECv2 §12.6:
 *   - on hard conflict, create a conflict issue and preserve the labor and artifacts
 *   - on stale-branch or non-conflict failure, preserve the labor for rework
 *   - labor preservation means the worktree and branch remain intact
 */

import { writeFileSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import type { LaborCleanupPlan } from "../labor/cleanup-labor.js";
import { planLaborCleanup } from "../labor/cleanup-labor.js";

// ---------------------------------------------------------------------------
// Preservation model
// ---------------------------------------------------------------------------

/** Request to preserve a labor after a merge outcome. */
export interface LaborPreservationRequest {
  /** The Beads issue ID associated with the labor. */
  issueId: string;

  /** The absolute path to the labor directory. */
  laborPath: string;

  /** The branch name associated with the labor. */
  branchName: string;

  /** The merge outcome that triggered preservation. */
  outcome: "MERGE_FAILED" | "REWORK_REQUEST";

  /** Whether this is a conflict (Tier 2) or non-conflict (Tier 1) failure. */
  isConflict: boolean;

  /** Optional context about why preservation was needed. */
  reason: string;
}

/** Outcome of a labor preservation operation. */
export interface LaborPreservationOutcome {
  /** Whether the labor was successfully preserved. */
  preserved: boolean;

  /** The labor path that was preserved (or null if preservation failed). */
  laborPath: string | null;

  /** The branch name that was preserved (or null if preservation failed). */
  branchName: string | null;

  /** Human-readable description of the preservation result. */
  detail: string;

  /** Cleanup plan that was NOT executed (for reference). */
  skippedCleanupPlan: LaborCleanupPlan | null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Preserve the labor after a merge failure or conflict.
 *
 * This function:
 *   1. Computes what the cleanup plan WOULD have been (for reference)
 *   2. Writes a preservation metadata file in the labor directory
 *   3. Ensures the labor directory and branch remain intact
 *   4. Returns the preservation outcome
 *
 * @param request - Labor preservation request.
 * @returns Preservation outcome.
 */
export async function preserveLabor(
  request: LaborPreservationRequest,
): Promise<LaborPreservationOutcome> {
  try {
    // Compute what the cleanup plan would have been (for reference/logging)
    const wouldHaveBeenCleanup = planLaborCleanup({
      issueId: request.issueId,
      laborPath: request.laborPath,
      branchName: request.branchName,
      outcome: "merged", // This is what would trigger cleanup
    });

    // Write preservation metadata in the labor directory
    const metadataDir = join(request.laborPath, ".aegis-labor");
    mkdirSync(metadataDir, { recursive: true });

    const metadataPath = join(metadataDir, "preservation.json");
    const metadata = {
      issueId: request.issueId,
      outcome: request.outcome,
      isConflict: request.isConflict,
      reason: request.reason,
      preservedAt: new Date().toISOString(),
      branchName: request.branchName,
      laborPath: request.laborPath,
    };

    // Atomic write via tmp→rename
    const tmpPath = metadataPath + ".tmp";
    writeFileSync(tmpPath, JSON.stringify(metadata, null, 2), "utf-8");
    renameSync(tmpPath, metadataPath);

    return {
      preserved: true,
      laborPath: request.laborPath,
      branchName: request.branchName,
      detail: `Labor preserved for issue ${request.issueId} (${request.outcome})`,
      skippedCleanupPlan: wouldHaveBeenCleanup,
    };
  } catch (err) {
    return {
      preserved: false,
      laborPath: null,
      branchName: null,
      detail: `Failed to preserve labor: ${(err as Error).message}`,
      skippedCleanupPlan: null,
    };
  }
}

/**
 * Determine whether labor should be preserved based on merge outcome.
 *
 * @param outcome - The merge outcome string.
 * @returns True if the labor should be preserved.
 */
export function shouldPreserveLabor(outcome: string): boolean {
  // Preserve labor for all non-success outcomes
  return outcome !== "MERGED";
}
