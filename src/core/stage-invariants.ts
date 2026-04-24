import type { DispatchRecord, DispatchStage } from "./dispatch-state.js";

const ORACLE_REQUIRED_STAGES = new Set<DispatchStage>([
  "scouted",
  "implementing",
  "implemented",
  "reviewing",
  "queued_for_merge",
  "merging",
  "rework_required",
  "resolving_integration",
  "blocked_on_child",
  "complete",
]);

export function validateDispatchRecordStage(
  record: DispatchRecord,
  stage = record.stage,
): string | null {
  if (ORACLE_REQUIRED_STAGES.has(stage as DispatchStage)) {
    if (!record.oracleAssessmentRef) {
      return `Issue ${record.issueId} stage ${stage} requires an Oracle assessment artifact.`;
    }
  }

  if (
    stage === "implemented"
    || stage === "reviewing"
    || stage === "queued_for_merge"
    || stage === "merging"
    || stage === "resolving_integration"
    || stage === "complete"
  ) {
    if (!record.titanHandoffRef) {
      return `Issue ${record.issueId} stage ${stage} requires a Titan handoff artifact.`;
    }
  }

  if ((stage === "queued_for_merge" || stage === "merging" || stage === "complete") && !record.sentinelVerdictRef) {
    return `Issue ${record.issueId} stage ${stage} requires a Sentinel verdict artifact.`;
  }

  if (stage === "rework_required" && !record.reviewFeedbackRef) {
    return `Issue ${record.issueId} rework loop requires review or Janus feedback.`;
  }

  if (stage === "blocked_on_child" && !record.blockedByIssueId) {
    return `Issue ${record.issueId} blocked_on_child requires a blocking child issue.`;
  }

  return null;
}

export function assertDispatchRecordStage(
  record: DispatchRecord,
  stage = record.stage,
) {
  const error = validateDispatchRecordStage(record, stage);
  if (error) {
    throw new Error(error);
  }
}

export function validateTitanDispatchEligibility(record: DispatchRecord): string | null {
  if (record.stage !== "scouted" && record.stage !== "rework_required") {
    return "Titan requires a scouted issue or same-parent rework loop.";
  }

  if (!record.oracleAssessmentRef) {
    return `Issue ${record.issueId} requires an Oracle assessment artifact.`;
  }

  if (record.stage === "rework_required" && !record.reviewFeedbackRef) {
    return `Issue ${record.issueId} rework loop requires review or Janus feedback.`;
  }

  return null;
}

export function assertTitanDispatchEligibility(record: DispatchRecord) {
  const error = validateTitanDispatchEligibility(record);
  if (error) {
    throw new Error(error);
  }
}

export function isOracleBlockedFromTitan(record: DispatchRecord) {
  void record;
  return false;
}

export function canRerunSentinelReview(record: DispatchRecord) {
  return record.stage === "rework_required"
    && record.oracleAssessmentRef !== null
    && record.titanHandoffRef !== null
    && record.sentinelVerdictRef !== null;
}
