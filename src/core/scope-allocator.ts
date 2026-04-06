/**
 * S15A — Scope Allocator.
 *
 * SPECv2 §9.3.1 (Upstream scope allocator):
 *   - Oracle `files_affected` becomes the provisional FILE_SCOPE for dispatch safety
 *   - Aegis refuses to dispatch two Titans whose scopes overlap beyond the
 *     configured threshold unless the human forces the decision
 *   - scope is surfaced in Olympus and retained in the handoff artifact so
 *     later stages can reason about intended ownership
 *
 * This module owns the overlap detection and suppression decision logic only
 * — no I/O.  It is pure, deterministic, and immutable.
 */

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

/** Describes the file scope of a single issue (typically from an Oracle assessment). */
export interface FileScope {
  /** The Beads issue ID this scope belongs to. */
  issueId: string;
  /** File paths that this issue intends to touch. */
  files: string[];
}

/** An active Titan dispatch with its assigned file scope. */
export interface ActiveTitanScope {
  /** The Beads issue ID being implemented. */
  issueId: string;
  /** File paths already claimed by the running Titan. */
  files: string[];
}

/** A candidate issue waiting to be evaluated for Titan dispatch. */
export interface ScopeCandidate {
  /** The Beads issue ID. */
  issueId: string;
  /** Provisional file scope from Oracle (or explicit seed). */
  fileScope: FileScope;
}

/**
 * A suppression entry explaining why a candidate was blocked from Titan dispatch.
 */
export interface SuppressionEntry {
  /** The suppressed issue ID. */
  issueId: string;
  /** Issue IDs whose scopes overlap with this candidate. */
  blockedBy: string[];
  /** File paths that overlap. */
  overlappingFiles: string[];
  /** Human-readable reason. */
  reason: string;
}

/**
 * The result of a scope allocation decision.
 *
 * - `dispatchable`: candidates that are safe to dispatch in parallel.
 * - `suppressed`: candidates that were blocked with explicit overlap reasons.
 */
export interface ScopeAllocation {
  dispatchable: string[];
  suppressed: SuppressionEntry[];
}

// ---------------------------------------------------------------------------
// Overlap detection
// ---------------------------------------------------------------------------

/**
 * Compute the overlap between two file sets.
 *
 * Returns the set of files that appear in both arrays (exact string match).
 * Normalization of paths (case, separators) is the caller's responsibility.
 */
export function computeOverlap(filesA: string[], filesB: string[]): string[] {
  const setB = new Set(filesB);
  return filesA.filter((f) => setB.has(f));
}

/**
 * Count overlapping files between two scope objects.
 */
export function overlapCount(a: FileScope | ActiveTitanScope, b: FileScope | ActiveTitanScope): number {
  return computeOverlap(a.files, b.files).length;
}

/**
 * Determine whether two scopes exceed the configured overlap threshold.
 *
 * @param overlapCount - Number of shared files.
 * @param threshold - Maximum allowed overlap (0 means any overlap is forbidden).
 * @returns `true` when the overlap is within the allowed threshold.
 */
export function isWithinThreshold(overlapCount: number, threshold: number): boolean {
  return overlapCount <= threshold;
}

// ---------------------------------------------------------------------------
// Allocation decision
// ---------------------------------------------------------------------------

/**
 * Evaluate candidates against active Titan scopes and against each other,
 * returning a dispatch-safe allocation.
 *
 * Algorithm (deterministic, SPECv2 §9.3.1):
 *   1. Any candidate that overlaps with an active Titan beyond threshold
 *      is suppressed.
 *   2. Remaining candidates are evaluated pairwise in declaration order.
 *      If two candidates overlap beyond threshold, the later one is
 *      suppressed.
 *   3. The result is the set of dispatchable issues plus suppression entries.
 *
 * @param candidates - Ready issues with file scopes, in dispatch priority order.
 * @param activeTitans - Currently running Titan assignments.
 * @param threshold - Maximum allowed overlap (0 = any overlap blocks).
 * @param forceDispatch - Issue IDs that a human has explicitly forced through.
 * @returns ScopeAllocation with dispatchable and suppressed lists.
 */
export function allocateScope(
  candidates: ScopeCandidate[],
  activeTitans: ActiveTitanScope[],
  threshold: number = 0,
  forceDispatch: Set<string> = new Set(),
): ScopeAllocation {
  const dispatchable: string[] = [];
  const suppressed: SuppressionEntry[] = [];

  // Track scopes that have been "claimed" — starts with active Titans.
  const claimedScopes: Array<{ issueId: string; files: string[] }> = activeTitans.map(
    (t) => ({ issueId: t.issueId, files: t.files }),
  );

  for (const candidate of candidates) {
    // Human override: force-dispatched issues skip overlap checks.
    if (forceDispatch.has(candidate.issueId)) {
      dispatchable.push(candidate.issueId);
      claimedScopes.push({
        issueId: candidate.issueId,
        files: candidate.fileScope.files,
      });
      continue;
    }

    const blockers: string[] = [];
    const allOverlappingFiles: string[] = [];

    for (const claimed of claimedScopes) {
      const overlapping = computeOverlap(candidate.fileScope.files, claimed.files);
      if (overlapping.length > threshold) {
        blockers.push(claimed.issueId);
        allOverlappingFiles.push(...overlapping);
      }
    }

    if (blockers.length > 0) {
      const uniqueOverlappingFiles = [...new Set(allOverlappingFiles)];
      suppressed.push({
        issueId: candidate.issueId,
        blockedBy: blockers,
        overlappingFiles: uniqueOverlappingFiles,
        reason: buildSuppressionReason(candidate.issueId, blockers, uniqueOverlappingFiles),
      });
    } else {
      dispatchable.push(candidate.issueId);
      claimedScopes.push({
        issueId: candidate.issueId,
        files: candidate.fileScope.files,
      });
    }
  }

  return { dispatchable, suppressed };
}

/**
 * Build a human-readable suppression reason.
 */
export function buildSuppressionReason(
  candidateId: string,
  blockedBy: string[],
  overlappingFiles: string[],
): string {
  const blockersStr = blockedBy.join(", ");
  const filesStr = overlappingFiles.slice(0, 5).join(", ");
  const ellipsis = overlappingFiles.length > 5 ? `, +${overlappingFiles.length - 5} more` : "";
  return (
    `Issue ${candidateId} suppressed: scope overlaps with active Titan(s) ` +
    `[${blockersStr}] on ${overlappingFiles.length} file(s): ${filesStr}${ellipsis}`
  );
}

/**
 * Check whether a single candidate conflicts with any active Titan.
 *
 * Convenience wrapper for triage when evaluating one issue at a time.
 */
export function checkCandidateConflict(
  candidate: FileScope,
  activeTitans: ActiveTitanScope[],
  threshold: number = 0,
): { hasConflict: boolean; conflictsWith: string[]; overlappingFiles: string[] } {
  const conflictsWith: string[] = [];
  const allOverlapping: string[] = [];

  for (const titan of activeTitans) {
    const overlapping = computeOverlap(candidate.files, titan.files);
    if (overlapping.length > threshold) {
      conflictsWith.push(titan.issueId);
      allOverlapping.push(...overlapping);
    }
  }

  return {
    hasConflict: conflictsWith.length > 0,
    conflictsWith,
    overlappingFiles: [...new Set(allOverlapping)],
  };
}

// ---------------------------------------------------------------------------
// Scope seeding and narrowing (SPECv2 §9.3.1)
// ---------------------------------------------------------------------------

/**
 * Seed explicit file scope for an issue when the user or planner provides
 * an explicit list of files instead of relying on Oracle files_affected.
 *
 * @param issueId - The Beads issue ID.
 * @param files - Explicit file paths to claim.
 * @returns A FileScope with the seeded files.
 */
export function seedFileScope(issueId: string, files: string[]): FileScope {
  return { issueId, files: [...files] };
}

/**
 * Narrow an existing file scope by removing specified files.
 *
 * Use this when a user or planner explicitly excludes certain files from
 * an issue's scope (e.g., "only touch the config, not the tests").
 *
 * @param scope - The current file scope (not mutated).
 * @param excludeFiles - Files to remove from the scope.
 * @returns A new FileScope with excluded files removed.
 */
export function narrowFileScope(scope: FileScope, excludeFiles: string[]): FileScope {
  const excludeSet = new Set(excludeFiles);
  return {
    ...scope,
    files: scope.files.filter((f) => !excludeSet.has(f)),
  };
}
