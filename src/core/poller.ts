/**
 * S9.2 — Work poller.
 *
 * SPECv2 §9.2: queries Beads for ready work, classifies each issue against
 * the current dispatch state, and runs triage for scouted issues that have
 * Oracle assessments available.
 *
 * This module is pure — no I/O.  The caller supplies the ready queue,
 * dispatch state, and Oracle assessments; the poller returns a classified
 * PollResult.
 *
 * Five-planes discipline (SPECv2 §2):
 *   - Beads supplies task definitions (ready queue)
 *   - DispatchState supplies orchestration stage truth
 *   - The poller never mutates either input
 *   - The poller never infers stage from Beads comments or text
 */

import type { BeadsClient } from "../tracker/beads-client.js";
import type { ReadyIssue } from "../tracker/issue-model.js";
import type { DispatchState, DispatchRecord } from "./dispatch-state.js";
import { DispatchStage } from "./stage-transition.js";
import { triageScouted, type ScoutedIssue } from "./triage.js";
import type { OracleAssessment } from "../castes/oracle/oracle-parser.js";

// ---------------------------------------------------------------------------
// PollResult
// ---------------------------------------------------------------------------

export interface PollResult {
  /** Scouted issues cleared by triage — safe to dispatch to Titan. */
  dispatchable: ScoutedIssue[];
  /** Issue IDs suppressed by triage (scope overlap or other constraints). */
  suppressed: string[];
  /** Issue IDs that need Oracle assessment before they can advance. */
  needsOracle: string[];
  /** Issue IDs currently being worked on by an agent. */
  inProgress: string[];
}

// ---------------------------------------------------------------------------
// Stage classification helpers
// ---------------------------------------------------------------------------

/** Stages where an agent is actively executing work. */
const ACTIVE_STAGES: ReadonlySet<DispatchStage> = new Set<DispatchStage>([
  DispatchStage.Scouting,
  DispatchStage.Implementing,
  DispatchStage.Merging,
  DispatchStage.Reviewing,
  DispatchStage.ResolvingIntegration,
]);

/** Stages where work has reached a terminal or waiting point for this poll cycle. */
const WAITING_STAGES: ReadonlySet<DispatchStage> = new Set<DispatchStage>([
  DispatchStage.QueuedForMerge,
  DispatchStage.Implemented,
  DispatchStage.Merged,
]);

function isInProgress(stage: DispatchStage): boolean {
  return ACTIVE_STAGES.has(stage) || WAITING_STAGES.has(stage);
}

function isScouted(stage: DispatchStage): boolean {
  return stage === DispatchStage.Scouted;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Poll for ready work and classify issues by their dispatch state.
 *
 * Algorithm:
 *   1. Fetch the ready queue from Beads.
 *   2. For each ready issue, look up its dispatch record.
 *   3. Classify:
 *      - No record or `pending` stage → needsOracle
 *      - `scouted` stage with Oracle assessment available → run triage
 *      - `scouted` stage without assessment → needsOracle
 *      - Active or waiting stage → inProgress
 *   4. For scouted issues, run triageScouted to split into
 *      dispatchable vs suppressed.
 *
 * @param client - Beads tracker client (used to fetch the ready queue).
 * @param dispatchState - Current dispatch state (authoritative for stage).
 * @param oracleAssessments - Map of issueId → OracleAssessment for scouted
 *   issues.  Only scouted issues present in this map are triaged; others
 *   fall through to needsOracle.
 * @param threshold - Maximum allowed file overlap for triage (default 0).
 * @returns PollResult with all four categories populated.
 */
export async function pollForWork(
  client: BeadsClient,
  dispatchState: DispatchState,
  oracleAssessments: Map<string, OracleAssessment> = new Map(),
  threshold: number = 0,
): Promise<PollResult> {
  const readyQueue = await client.getReadyQueue();

  const dispatchable: ScoutedIssue[] = [];
  const suppressed: string[] = [];
  const needsOracle: string[] = [];
  const inProgress: string[] = [];

  const scoutedWithAssessment: ScoutedIssue[] = [];

  for (const issue of readyQueue) {
    const record = dispatchState.records[issue.id];

    if (!record) {
      // No dispatch record yet → needs Oracle
      needsOracle.push(issue.id);
      continue;
    }

    if (record.stage === DispatchStage.Pending) {
      // Pending → needs Oracle assessment
      needsOracle.push(issue.id);
      continue;
    }

    if (isInProgress(record.stage)) {
      // Actively being worked on
      inProgress.push(issue.id);
      continue;
    }

    if (isScouted(record.stage)) {
      const assessment = oracleAssessments.get(issue.id);
      if (assessment) {
        scoutedWithAssessment.push({
          issueId: issue.id,
          assessment,
          record: { ...record },
        });
      } else {
        // Scout complete but assessment not available → needs Oracle
        needsOracle.push(issue.id);
      }
      continue;
    }

    // Any other stage (complete, failed, etc.) → skip
  }

  // Run triage for scouted issues that have assessments.
  if (scoutedWithAssessment.length > 0) {
    const triageResult = triageScouted(scoutedWithAssessment, dispatchState, threshold);
    dispatchable.push(...triageResult.dispatchable);
    suppressed.push(...triageResult.suppressed.map((d) => d.issueId));
  }

  return { dispatchable, suppressed, needsOracle, inProgress };
}
