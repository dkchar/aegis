/**
 * S15A — Overlap visibility for Olympus.
 *
 * SPECv2 §9.3.1 requires that scope-overlap decisions are surfaced clearly
 * to the operator so the human can see why work was deferred and optionally
 * force a dispatch.
 *
 * This module produces UI-ready visibility artifacts from a ScopeAllocation.
 * It is pure, deterministic, and immutable.
 */

import type { ScopeAllocation, SuppressionEntry, FileScope } from "./scope-allocator.js";

// ---------------------------------------------------------------------------
// Visibility shapes for Olympus
// ---------------------------------------------------------------------------

/**
 * A summary card for the Olympus scope-overlap panel.
 *
 * Designed for direct serialization via SSE to the dashboard.
 */
export interface ScopeVisibilitySummary {
  /** Number of issues safe to dispatch. */
  dispatchableCount: number;
  /** Number of issues suppressed due to overlap. */
  suppressedCount: number;
  /** Whether any overlap was detected. */
  hasOverlap: boolean;
  /** Dispatchable issue IDs in priority order. */
  dispatchable: string[];
  /** Suppression entries with overlap details. */
  suppressions: SuppressionEntry[];
}

/**
 * Per-issue visibility context that can be attached to a ready issue card
 * in Olympus, explaining its scope status.
 */
export interface IssueScopeVisibility {
  /** The issue ID. */
  issueId: string;
  /** File scope declared for this issue. */
  fileScope: FileScope;
  /** Whether this issue is currently safe to dispatch. */
  isDispatchable: boolean;
  /** If suppressed, the suppression entry (null otherwise). */
  suppression: SuppressionEntry | null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a summary card for Olympus from a ScopeAllocation.
 */
export function buildScopeVisibilitySummary(
  allocation: ScopeAllocation,
): ScopeVisibilitySummary {
  return {
    dispatchableCount: allocation.dispatchable.length,
    suppressedCount: allocation.suppressed.length,
    hasOverlap: allocation.suppressed.length > 0,
    dispatchable: [...allocation.dispatchable],
    suppressions: allocation.suppressed.map((s) => ({ ...s })),
  };
}

/**
 * Build per-issue visibility cards for Olympus.
 *
 * Given a map of issueId -> FileScope and the allocation result, produces
 * one visibility entry per issue so the dashboard can render each card with
 * its scope status (dispatchable or suppressed + why).
 */
export function buildIssueScopeVisibility(
  fileScopes: Map<string, FileScope>,
  allocation: ScopeAllocation,
): IssueScopeVisibility[] {
  const suppressedMap = new Map<string, SuppressionEntry>();
  for (const entry of allocation.suppressed) {
    suppressedMap.set(entry.issueId, entry);
  }

  const results: IssueScopeVisibility[] = [];
  for (const [issueId, fileScope] of fileScopes) {
    results.push({
      issueId,
      fileScope: { ...fileScope, files: [...fileScope.files] },
      isDispatchable: allocation.dispatchable.includes(issueId),
      suppression: suppressedMap.get(issueId) ?? null,
    });
  }

  return results;
}

/**
 * Format a suppression entry as a human-readable status line for Olympus
 * tooltips, log output, or CLI status.
 */
export function formatSuppressionEntry(entry: SuppressionEntry): string {
  return entry.reason;
}

/**
 * Format the full allocation decision as a status summary string.
 */
export function formatAllocationSummary(allocation: ScopeAllocation): string {
  if (allocation.suppressed.length === 0) {
    if (allocation.dispatchable.length === 0) {
      return "No candidates to dispatch.";
    }
    return `All ${allocation.dispatchable.length} candidate(s) are dispatchable; no overlap detected.`;
  }

  const lines: string[] = [
    `${allocation.dispatchable.length} dispatchable, ${allocation.suppressed.length} suppressed due to scope overlap:`,
  ];
  for (const entry of allocation.suppressed) {
    lines.push(`  - ${entry.reason}`);
  }
  return lines.join("\n");
}
