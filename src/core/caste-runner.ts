import { createDispatchRecord, loadDispatchState } from "./dispatch-state.js";
import { assertDispatchRecordStage } from "./stage-invariants.js";
import { runImplement } from "./caste/implement.js";
import { runJanus } from "./caste/janus.js";
import { runReview } from "./caste/review.js";
import { runScout } from "./caste/scout.js";
import type { CasteCommandResult, RunCasteCommandInput } from "./caste/types.js";

export type {
  CasteCommandResult,
  JanusConflictContext,
  RunCasteCommandInput,
  TrackerLike,
} from "./caste/types.js";

/**
 * Runs one caste action for an issue and persists the resulting dispatch
 * record, artifacts, and transcript.
 *
 * Explicit actions (`scout`, `implement`, `review`) run that caste. `process`
 * advances the issue one step from its current stage: scout, implement,
 * review, Janus integration resolution, or report that merge/complete is next.
 */
export async function runCasteCommand(input: RunCasteCommandInput): Promise<CasteCommandResult> {
  const now = input.now ?? new Date().toISOString();
  const issue = await input.tracker.getIssue(input.issueId, input.root);
  const record = loadDispatchState(input.root).records[input.issueId]
    ?? createDispatchRecord(input.issueId, "direct-caste-command", now);

  if (input.action === "review") {
    return runReview(input, issue, record, now);
  }

  if (input.action === "process") {
    switch (record.stage) {
      case "implemented":
        return runReview(input, issue, record, now);
      case "resolving_integration":
        assertDispatchRecordStage(record, "resolving_integration");
        return runJanus(input, issue, record, now);
      case "queued_for_merge":
        assertDispatchRecordStage(record, "queued_for_merge");
        return {
          action: "process",
          issueId: input.issueId,
          stage: "queued_for_merge",
          nextAction: "merge_next",
        };
      case "complete":
        assertDispatchRecordStage(record, "complete");
        return {
          action: "process",
          issueId: input.issueId,
          stage: "complete",
        };
      case "scouted":
      case "rework_required":
        return runImplement(input, issue, record, now);
      default:
        return runScout(input, issue, record, now);
    }
  }

  if (input.action === "implement") {
    return runImplement(input, issue, record, now);
  }

  return runScout(input, issue, record, now);
}
