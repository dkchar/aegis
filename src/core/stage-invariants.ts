import type { DispatchRecord } from "./dispatch-state.js";

const ORACLE_AND_TITAN_REQUIRED_STAGES = new Set([
  "implemented",
  "queued_for_merge",
  "merging",
  "merged",
  "reviewed",
  "resolving_integration",
]);

function hasOracleBlockers(record: DispatchRecord) {
  return (record.oracleBlockers?.length ?? 0) > 0;
}

export function validateDispatchRecordStage(
  record: DispatchRecord,
  stage = record.stage,
): string | null {
  if (stage === "scouted" && !record.oracleAssessmentRef) {
    return `Issue ${record.issueId} stage scouted requires an Oracle assessment artifact.`;
  }

  if (ORACLE_AND_TITAN_REQUIRED_STAGES.has(stage)) {
    if (!record.oracleAssessmentRef) {
      return `Issue ${record.issueId} stage ${stage} requires an Oracle assessment artifact.`;
    }

    if (!record.titanHandoffRef) {
      return `Issue ${record.issueId} stage ${stage} requires a Titan handoff artifact.`;
    }
  }

  if (stage === "reviewed" && !record.sentinelVerdictRef) {
    return `Issue ${record.issueId} stage reviewed requires a Sentinel verdict artifact.`;
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
  if (record.stage === "pending" || record.stage === "scouting") {
    return "Titan requires an Oracle-ready scouted issue.";
  }

  const stageError = validateDispatchRecordStage(record, "scouted");
  if (stageError) {
    return stageError;
  }

  if (record.oracleReady === false || record.oracleDecompose === true || hasOracleBlockers(record)) {
    return "Titan requires an Oracle-ready scouted issue.";
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
  return record.stage === "scouted"
    && (record.oracleReady === false
      || record.oracleDecompose === true
      || hasOracleBlockers(record));
}

export function canRerunSentinelReview(record: DispatchRecord) {
  return record.stage === "failed"
    && record.oracleAssessmentRef !== null
    && record.titanHandoffRef !== null
    && record.sentinelVerdictRef !== null;
}
