/**
 * Canonical stage sequence and transition rules.
 *
 * SPECv2 §6.1–§6.3: transitions are explicit, one-way for a given attempt,
 * and must never depend on informal text parsing.
 *
 * This module contains pure logic only — no I/O.
 */

import type { DispatchRecord } from "./dispatch-state.js";

// ---------------------------------------------------------------------------
// Canonical stage enum
// ---------------------------------------------------------------------------

/**
 * All valid stages in the Aegis dispatch pipeline (SPECv2 §6.1–§6.2).
 */
export enum DispatchStage {
  Pending = "pending",
  Scouting = "scouting",
  Scouted = "scouted",
  Implementing = "implementing",
  Implemented = "implemented",
  QueuedForMerge = "queued_for_merge",
  Merging = "merging",
  ResolvingIntegration = "resolving_integration",
  Merged = "merged",
  Reviewing = "reviewing",
  Complete = "complete",
  Failed = "failed",
}

/**
 * Ordered list of happy-path stages (excludes `failed`).
 *
 * Used by callers that need to reason about stage ordering without encoding
 * the canonical sequence themselves.
 */
export const STAGE_ORDER: readonly DispatchStage[] = [
  DispatchStage.Pending,
  DispatchStage.Scouting,
  DispatchStage.Scouted,
  DispatchStage.Implementing,
  DispatchStage.Implemented,
  DispatchStage.QueuedForMerge,
  DispatchStage.Merging,
  DispatchStage.ResolvingIntegration,
  DispatchStage.Merged,
  DispatchStage.Reviewing,
  DispatchStage.Complete,
];

// ---------------------------------------------------------------------------
// Transition adjacency table
// ---------------------------------------------------------------------------

/**
 * Explicit, exhaustive set of valid `from → to` transitions.
 *
 * Rules encoded here (SPECv2 §6.1–§6.3):
 *
 * Happy-path forward transitions:
 *   pending → scouting → scouted → implementing → implemented →
 *   queued_for_merge → merging → merged → reviewing → complete
 *
 * Janus activation:
 *   merging → resolving_integration → merged
 *
 * Failure: reachable from any in-progress stage (scouting … reviewing)
 *
 * Retry after cooldown: failed → pending
 *
 * Stages NOT in this table as `from` are terminal for the current attempt.
 */
function buildTransitionTable(): Map<DispatchStage, Set<DispatchStage>> {
  const t = new Map<DispatchStage, Set<DispatchStage>>();
  const add = (from: DispatchStage, ...to: DispatchStage[]) => {
    t.set(from, new Set(to));
  };

  // Happy-path forward transitions
  add(DispatchStage.Pending, DispatchStage.Scouting);
  add(DispatchStage.Scouting, DispatchStage.Scouted, DispatchStage.Failed);
  add(DispatchStage.Scouted, DispatchStage.Implementing, DispatchStage.Failed);
  add(DispatchStage.Implementing, DispatchStage.Implemented, DispatchStage.Failed);
  add(DispatchStage.Implemented, DispatchStage.QueuedForMerge, DispatchStage.Failed);
  add(DispatchStage.QueuedForMerge, DispatchStage.Merging, DispatchStage.Failed);
  // Merging can skip straight to merged (clean path) or activate Janus
  add(
    DispatchStage.Merging,
    DispatchStage.ResolvingIntegration,
    DispatchStage.Merged,
    DispatchStage.Failed,
  );
  add(DispatchStage.ResolvingIntegration, DispatchStage.Merged, DispatchStage.QueuedForMerge, DispatchStage.Failed);
  add(DispatchStage.Merged, DispatchStage.Reviewing, DispatchStage.Failed);
  add(DispatchStage.Reviewing, DispatchStage.Complete, DispatchStage.Failed);
  // complete: no outgoing transitions — terminal success
  // failed: only retry path is back to pending
  add(DispatchStage.Failed, DispatchStage.Pending);

  return t;
}

const VALID_TRANSITIONS: ReadonlyMap<DispatchStage, ReadonlySet<DispatchStage>> =
  buildTransitionTable();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Return `true` if transitioning from `from` to `to` is permitted.
 *
 * Does not throw; use `transitionStage` when you want an error on invalid input.
 */
export function validateTransition(from: DispatchStage, to: DispatchStage): boolean {
  const allowed = VALID_TRANSITIONS.get(from);
  if (!allowed) return false;
  return allowed.has(to);
}

/**
 * Apply a stage transition to a DispatchRecord.
 *
 * Returns a **new** record with the updated `stage` and `updatedAt`; the
 * original record is never mutated.
 *
 * @throws {Error} If the transition is not permitted by the adjacency table.
 */
export function transitionStage(
  record: DispatchRecord,
  to: DispatchStage,
): DispatchRecord {
  if (!validateTransition(record.stage, to)) {
    throw new Error(
      `Invalid stage transition: ${record.stage} → ${to} is not a permitted transition`,
    );
  }

  return {
    ...record,
    stage: to,
    updatedAt: new Date().toISOString(),
  };
}
