/**
 * S15A — Deterministic triage with scope-aware dispatch gating.
 *
 * SPECv2 §9.3 (triage): decides the next stage for each issue by inspecting
 * dispatch state, Oracle readiness, queue capacity, and scope-overlap constraints.
 *
 * This module is pure — no I/O.  It receives the current dispatch state,
 * Oracle assessments, and ready issues, then returns deterministic dispatch
 * decisions that the orchestrator can act on.
 *
 * Scope allocation gate (SPECv2 §9.3.1):
 *   - When Oracle returns files_affected, triage checks overlap with active Titans
 *   - If overlap exceeds the configured threshold, the candidate is suppressed
 *   - Suppressed candidates remain scouted (not dispatched to Titan)
 *   - The suppression is surfaced to the operator via the overlap-visibility layer
 */

import type { DispatchState, DispatchRecord } from "./dispatch-state.js";
import { activeTitanScopes } from "./dispatch-state.js";
import { DispatchStage } from "./stage-transition.js";
import type { OracleAssessment } from "../castes/oracle/oracle-parser.js";
import type { ReadyIssue } from "../tracker/issue-model.js";
import {
  allocateScope,
  checkCandidateConflict,
  type ScopeCandidate,
  type ActiveTitanScope,
  type FileScope,
  type ScopeAllocation,
} from "./scope-allocator.js";

// ---------------------------------------------------------------------------
// Triage inputs and outputs
// ---------------------------------------------------------------------------

/**
 * An issue that has completed scouting and is ready for Titan dispatch.
 */
export interface ScoutedIssue {
  issueId: string;
  /** The Oracle assessment for this issue. */
  assessment: OracleAssessment;
  /** The dispatch record (must be in `scouted` stage). */
  record: DispatchRecord;
}

/**
 * Result of a single-issue triage decision.
 */
export interface TriageDecision {
  issueId: string;
  /** Whether this issue is safe to dispatch to Titan. */
  canDispatch: boolean;
  /** If suppressed, why. */
  suppressionReason?: string;
  /** The file scope that was evaluated. */
  fileScope: FileScope;
}

/**
 * The full triage result for a batch of ready scouted issues.
 */
export interface BatchTriageResult {
  /** Issues safe to dispatch to Titan. */
  dispatchable: ScoutedIssue[];
  /** Issues suppressed due to scope overlap. */
  suppressed: TriageDecision[];
  /** The underlying scope allocation result. */
  scopeAllocation: ScopeAllocation;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Triage a batch of scouted issues against the current dispatch state.
 *
 * Uses scope allocation to determine which issues can be dispatched to Titan
 * without overlapping with in-flight Titan work.
 *
 * @param scoutedIssues - Issues in `scouted` stage, ready for Titan.
 * @param state - Current dispatch state (source of active Titan scopes).
 * @param threshold - Maximum allowed file overlap (0 = any overlap blocks).
 * @param forceDispatch - Issue IDs a human has explicitly forced through.
 * @returns BatchTriageResult with dispatchable and suppressed lists.
 */
export function triageScouted(
  scoutedIssues: ScoutedIssue[],
  state: DispatchState,
  threshold: number = 0,
  forceDispatch: Set<string> = new Set(),
): BatchTriageResult {
  const activeTitans = activeTitanScopes(state);

  // Build scope candidates from scouted issues, using Oracle files_affected.
  const candidates: ScopeCandidate[] = scoutedIssues.map((s) => ({
    issueId: s.issueId,
    fileScope: {
      issueId: s.issueId,
      files: [...s.assessment.files_affected],
    },
  }));

  const allocation = allocateScope(candidates, activeTitans, threshold, forceDispatch);

  // Map back to scouted issues.
  const dispatchableMap = new Set(allocation.dispatchable);
  const suppressedMap = new Map<string, TriageDecision["suppressionReason"]>();
  for (const entry of allocation.suppressed) {
    suppressedMap.set(entry.issueId, entry.reason);
  }

  const dispatchable: ScoutedIssue[] = [];
  const suppressed: TriageDecision[] = [];

  for (const scouted of scoutedIssues) {
    const fileScope: FileScope = {
      issueId: scouted.issueId,
      files: [...scouted.assessment.files_affected],
    };

    if (dispatchableMap.has(scouted.issueId)) {
      dispatchable.push(scouted);
    } else {
      suppressed.push({
        issueId: scouted.issueId,
        canDispatch: false,
        suppressionReason: suppressedMap.get(scouted.issueId),
        fileScope,
      });
    }
  }

  return { dispatchable, suppressed, scopeAllocation: allocation };
}

/**
 * Convenience: check a single issue for scope conflict with active Titans.
 *
 * Use this at the point of Titan dispatch to double-check that no other
 * Titan has claimed overlapping files since triage ran.
 *
 * @param fileScope - The candidate's file scope (from Oracle files_affected).
 * @param state - Current dispatch state.
 * @param threshold - Maximum allowed overlap.
 * @returns Object with hasConflict flag and details.
 */
export function checkDispatchConflict(
  fileScope: FileScope,
  state: DispatchState,
  threshold: number = 0,
): { hasConflict: boolean; conflictsWith: string[]; overlappingFiles: string[] } {
  const activeTitans = activeTitanScopes(state);
  return checkCandidateConflict(fileScope, activeTitans, threshold);
}

/**
 * Attach file scope to a dispatch record when dispatching Titan.
 *
 * Returns a new record with the fileScope populated.
 */
export function attachFileScope(
  record: DispatchRecord,
  fileScope: FileScope,
): DispatchRecord {
  return {
    ...record,
    fileScope: {
      issueId: fileScope.issueId,
      files: [...fileScope.files],
    },
  };
}

/**
 * Clear file scope from a dispatch record when Titan completes or fails.
 *
 * Returns a new record with fileScope set to null.
 */
export function clearFileScope(record: DispatchRecord): DispatchRecord {
  return {
    ...record,
    fileScope: null,
  };
}
