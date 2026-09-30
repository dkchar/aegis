import { existsSync } from "node:fs";
import path from "node:path";

import { isPolicyCreatedBlockerDescription } from "../castes/scope-markers.js";
import { parseSentinelVerdict } from "../castes/sentinel/sentinel-parser.js";
import { parseTitanArtifact } from "../castes/titan/titan-parser.js";
import { loadConfig } from "../config/load-config.js";
import { createTrackerClient } from "../tracker/create-tracker.js";
import { hasNewScope, normalizeFileScope, normalizeScopeFile } from "../shared/file-scope.js";
import { listDirtyFiles } from "../shared/git.js";
import { readArtifactRecord } from "../shared/json.js";
import { applyScopeExpansion } from "./control-plane-policy.js";
import { loadDispatchState, saveDispatchState, type DispatchState } from "./dispatch-state.js";
import { writePhaseLog } from "./phase-log.js";

const TRACKER_CLOSED_RECOVERY_STAGES = new Set([
  "rework_required",
  "blocked_on_child",
  "failed_operational",
]);

interface RecoveryStepResult {
  changed: boolean;
  state: DispatchState;
}

export interface DispatchRecoveryInput {
  root: string;
  tracker: ReturnType<typeof createTrackerClient>;
  dispatchState: DispatchState;
  readyIssueIds: string[];
  timestamp: string;
}

const readPolicyArtifact = readArtifactRecord;

function isResolvedPolicyBlockerReady(input: {
  root: string;
  readyIssueIds: Set<string>;
  record: DispatchState["records"][string];
}) {
  const { record } = input;
  if (
    record.stage !== "blocked_on_child"
    && record.stage !== "failed_operational"
    || !input.readyIssueIds.has(record.issueId)
    || !record.blockedByIssueId
    || !record.policyArtifactRef
  ) {
    return false;
  }

  const artifact = readPolicyArtifact(input.root, record.policyArtifactRef);
  return artifact?.["outcome"] !== "rejected"
    && artifact?.["childIssueId"] === record.blockedByIssueId;
}

function isRejectedBlockerChainReady(input: {
  root: string;
  readyIssueIds: Set<string>;
  record: DispatchState["records"][string];
}) {
  const { record } = input;
  if (
    record.runningAgent
    || !input.readyIssueIds.has(record.issueId)
    || !record.policyArtifactRef
  ) {
    return false;
  }

  const artifact = readPolicyArtifact(input.root, record.policyArtifactRef);
  return artifact?.["outcome"] === "rejected"
    && artifact?.["rejectionReason"] === "blocker_chain_not_allowed";
}

function toFreshScoutRecord(
  record: DispatchState["records"][string],
  timestamp: string,
) {
  return {
    ...record,
    stage: "pending" as const,
    runningAgent: null,
    blockedByIssueId: null,
    policyArtifactRef: null,
    oracleAssessmentRef: null,
    oracleReady: null,
    oracleDecompose: null,
    oracleBlockers: null,
    fileScope: null,
    reviewFeedbackRef: null,
    titanHandoffRef: null,
    titanClarificationRef: null,
    sentinelVerdictRef: null,
    janusArtifactRef: null,
    cooldownUntil: null,
    updatedAt: timestamp,
  };
}

function recoverResolvedPolicyBlockedParents(input: {
  root: string;
  dispatchState: DispatchState;
  readyIssueIds: string[];
  timestamp: string;
}): RecoveryStepResult {
  const readyIssueIds = new Set(input.readyIssueIds);
  let changed = false;
  const records = Object.fromEntries(
    Object.entries(input.dispatchState.records).map(([issueId, record]) => {
      if (!isResolvedPolicyBlockerReady({
        root: input.root,
        readyIssueIds,
        record,
      }) && !isRejectedBlockerChainReady({
        root: input.root,
        readyIssueIds,
        record,
      })) {
        return [issueId, record];
      }

      changed = true;
      writePhaseLog(input.root, {
        timestamp: input.timestamp,
        phase: "triage",
        issueId,
        action: "resolved_policy_blocker_recovered",
        outcome: "implemented",
        detail: JSON.stringify({
          blockedByIssueId: record.blockedByIssueId,
          policyArtifactRef: record.policyArtifactRef,
          nextStage: "pending",
        }),
      });

      return [issueId, toFreshScoutRecord(record, input.timestamp)];
    }),
  );

  return {
    changed,
    state: changed
      ? {
          schemaVersion: input.dispatchState.schemaVersion,
          records,
        }
      : input.dispatchState,
  };
}

async function recoverClosedTrackerRecords(input: {
  root: string;
  tracker: ReturnType<typeof createTrackerClient>;
  dispatchState: DispatchState;
  timestamp: string;
}): Promise<RecoveryStepResult> {
  let changed = false;
  const records = { ...input.dispatchState.records };

  for (const [issueId, record] of Object.entries(input.dispatchState.records)) {
    if (
      record.runningAgent !== null
      || !TRACKER_CLOSED_RECOVERY_STAGES.has(record.stage)
    ) {
      continue;
    }

    let issueStatus: string;
    try {
      issueStatus = (await input.tracker.getIssue(issueId, input.root)).status;
    } catch {
      continue;
    }

    if (issueStatus !== "closed") {
      continue;
    }

    changed = true;
    records[issueId] = {
      ...record,
      stage: "complete",
      runningAgent: null,
      cooldownUntil: null,
      updatedAt: input.timestamp,
    };
    writePhaseLog(input.root, {
      timestamp: input.timestamp,
      phase: "dispatch",
      issueId,
      action: "closed_tracker_record_recovered",
      outcome: "complete",
      detail: JSON.stringify({ trackerStatus: issueStatus }),
    });
  }

  return {
    changed,
    state: changed
      ? {
          schemaVersion: input.dispatchState.schemaVersion,
          records,
        }
      : input.dispatchState,
  };
}

function resolveDurableSentinelRef(root: string, issueId: string, currentRef: string | null) {
  const candidates = [
    currentRef,
    path.join(".aegis", "sentinel", `${issueId}.json`),
  ].filter((entry): entry is string => entry !== null);

  return candidates.find((candidate) => existsSync(path.join(root, candidate))) ?? null;
}

/** Re-validates the verdict fields of a persisted Sentinel artifact (session metadata is ignored). */
function parseSentinelVerdictRecord(payload: Record<string, unknown>) {
  return parseSentinelVerdict(JSON.stringify({
    verdict: payload["verdict"],
    reviewSummary: payload["reviewSummary"],
    blockingFindings: payload["blockingFindings"],
    advisories: payload["advisories"],
    touchedFiles: payload["touchedFiles"],
    contractChecks: payload["contractChecks"],
  }));
}

function readDurableSentinelVerdict(root: string, artifactRef: string) {
  const payload = readArtifactRecord(root, artifactRef);
  if (!payload) {
    throw new Error(`Sentinel artifact ${artifactRef} is unreadable.`);
  }
  return parseSentinelVerdictRecord(payload);
}

export function recoverReviewingRecord(root: string, issueId: string, timestamp: string) {
  const dispatchState = loadDispatchState(root);
  const record = dispatchState.records[issueId];
  if (!record || record.stage !== "reviewing") {
    return false;
  }

  const sentinelVerdictRef = resolveDurableSentinelRef(root, issueId, record.sentinelVerdictRef);
  if (!sentinelVerdictRef) {
    return false;
  }

  let verdict: ReturnType<typeof readDurableSentinelVerdict>;
  try {
    verdict = readDurableSentinelVerdict(root, sentinelVerdictRef);
  } catch {
    // An unreadable verdict is treated as no verdict: Sentinel runs again.
    return false;
  }
  const reviewStage = verdict.verdict === "pass" ? "queued_for_merge" : "rework_required";
  saveDispatchState(root, {
    schemaVersion: dispatchState.schemaVersion,
    records: {
      ...dispatchState.records,
      [issueId]: {
        ...record,
        stage: reviewStage,
        runningAgent: null,
        sentinelVerdictRef,
        reviewFeedbackRef: sentinelVerdictRef,
        updatedAt: timestamp,
      },
    },
  });

  writePhaseLog(root, {
    timestamp,
    phase: "dispatch",
    issueId,
    action: "sentinel_review_recovered",
    outcome: reviewStage,
    detail: JSON.stringify({
      blockingFindingCount: verdict.blockingFindings.length,
      advisoryCount: verdict.advisories.length,
    }),
  });

  return true;
}

function resolveDurableTitanRef(root: string, issueId: string, currentRef: string | null) {
  const candidates = [
    currentRef,
    path.join(".aegis", "titan", `${issueId}.json`),
  ].filter((entry): entry is string => entry !== null);

  return candidates.find((candidate) => existsSync(path.join(root, candidate))) ?? null;
}

function readDurableTitanArtifact(root: string, artifactRef: string) {
  const payload = readArtifactRecord(root, artifactRef);
  if (!payload) {
    throw new Error(`Titan artifact ${artifactRef} is unreadable.`);
  }

  return parseTitanArtifact(JSON.stringify({
    outcome: payload["outcome"],
    summary: payload["summary"],
    files_changed: payload["files_changed"],
    tests_and_checks_run: payload["tests_and_checks_run"],
    known_risks: payload["known_risks"],
    follow_up_work: payload["follow_up_work"],
    mutation_proposal: payload["mutation_proposal"],
  }));
}

function isRecoverableTitanArtifact(root: string, artifactRef: string) {
  try {
    const artifact = readDurableTitanArtifact(root, artifactRef);
    if (artifact.mutation_proposal) {
      return false;
    }

    if (artifact.outcome === "success") {
      return true;
    }

    return artifact.outcome === "already_satisfied"
      && artifact.files_changed.length === 0
      && artifact.tests_and_checks_run.length > 0;
  } catch {
    return false;
  }
}

function recoverFailedTitanRecord(root: string, issueId: string, timestamp: string) {
  const dispatchState = loadDispatchState(root);
  const record = dispatchState.records[issueId];
  if (!record || record.stage !== "failed_operational") {
    return false;
  }

  const titanHandoffRef = resolveDurableTitanRef(root, issueId, record.titanHandoffRef ?? null);
  if (!titanHandoffRef || !isRecoverableTitanArtifact(root, titanHandoffRef)) {
    return false;
  }

  saveDispatchState(root, {
    schemaVersion: dispatchState.schemaVersion,
    records: {
      ...dispatchState.records,
      [issueId]: {
        ...record,
        stage: "implemented",
        runningAgent: null,
        lastCompletedCaste: "titan",
        titanHandoffRef,
        consecutiveFailures: 0,
        cooldownUntil: null,
        updatedAt: timestamp,
      },
    },
  });

  writePhaseLog(root, {
    timestamp,
    phase: "dispatch",
    issueId,
    action: "titan_handoff_recovered",
    outcome: "implemented",
    detail: JSON.stringify({ titanHandoffRef }),
  });

  return true;
}

function readSentinelCreateBlockerFinding(root: string, ref: string | null | undefined) {
  const raw = readArtifactRecord(root, ref);
  if (!raw) {
    return null;
  }

  try {
    return parseSentinelVerdictRecord(raw).blockingFindings.find((finding) =>
      finding.route === "create_blocker" && finding.required_files.length > 0
    ) ?? null;
  } catch {
    return null;
  }
}

function fingerprintScopeExpansion(issueId: string, finding: {
  finding_kind: string;
  summary: string;
  required_files: string[];
}) {
  return `${issueId}-${finding.finding_kind}-${finding.required_files.map((entry) => normalizeScopeFile(entry)).sort().join("-")}`
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "scope-expansion";
}

function readDirtyLaborFiles(laborPath: string) {
  const files = listDirtyFiles(laborPath);
  return files && files.length > 0 ? files : null;
}

async function recoverFailedPolicyBlockerScopeRecords(input: {
  root: string;
  tracker: ReturnType<typeof createTrackerClient>;
  dispatchState: DispatchState;
  readyIssueIds: string[];
  timestamp: string;
}): Promise<RecoveryStepResult> {
  const readyIssueIds = new Set(input.readyIssueIds);
  let changed = false;
  const records = { ...input.dispatchState.records };

  for (const [issueId, record] of Object.entries(input.dispatchState.records)) {
    if (
      !readyIssueIds.has(issueId)
      || record.stage !== "failed_operational"
      || record.runningAgent !== null
      || record.fileScope === null
      || !record.reviewFeedbackRef
    ) {
      continue;
    }

    const finding = readSentinelCreateBlockerFinding(input.root, record.reviewFeedbackRef);
    if (!finding) {
      continue;
    }

    let issueDescription: string | null;
    try {
      issueDescription = (await input.tracker.getIssue(issueId, input.root)).description;
    } catch {
      continue;
    }
    if (!isPolicyCreatedBlockerDescription(issueDescription)) {
      continue;
    }

    const expandedScope = normalizeFileScope([
      ...record.fileScope.files,
      ...finding.required_files,
    ]);
    if (!expandedScope || !hasNewScope(record.fileScope.files, expandedScope.files)) {
      continue;
    }

    const policyResult = await applyScopeExpansion({
      root: input.root,
      tracker: input.tracker,
      issueId,
      originCaste: "router",
      findingKind: finding.finding_kind,
      summary: finding.summary,
      previousScope: record.fileScope.files,
      expandedScope: expandedScope.files,
      fingerprint: fingerprintScopeExpansion(issueId, finding),
      now: input.timestamp,
    });

    changed = true;
    records[issueId] = {
      ...record,
      stage: policyResult.parentStage,
      runningAgent: null,
      blockedByIssueId: null,
      policyArtifactRef: policyResult.policyArtifactRef,
      fileScope: policyResult.fileScope,
      failureTranscriptRef: null,
      consecutiveFailures: 0,
      cooldownUntil: null,
      updatedAt: input.timestamp,
    };
    writePhaseLog(input.root, {
      timestamp: input.timestamp,
      phase: "triage",
      issueId,
      action: "policy_blocker_scope_expanded",
      outcome: "rework_required",
      detail: JSON.stringify({
        reviewFeedbackRef: record.reviewFeedbackRef,
        policyArtifactRef: policyResult.policyArtifactRef,
        expandedScope: expandedScope.files,
      }),
    });
  }

  return {
    changed,
    state: changed
      ? {
          schemaVersion: input.dispatchState.schemaVersion,
          records,
        }
      : input.dispatchState,
  };
}

function recoverDirtyFailedTitanRecords(input: {
  root: string;
  dispatchState: DispatchState;
  readyIssueIds: string[];
  timestamp: string;
}): RecoveryStepResult {
  const config = loadConfig(input.root);
  const readyIssueIds = new Set(input.readyIssueIds);
  let changed = false;
  const records = Object.fromEntries(
    Object.entries(input.dispatchState.records).map(([issueId, record]) => {
      if (
        !readyIssueIds.has(issueId)
        || record.stage !== "failed_operational"
        || record.runningAgent !== null
        || record.oracleAssessmentRef === null
        || record.fileScope === null
      ) {
        return [issueId, record];
      }

      const laborPath = path.join(input.root, config.labor.base_path, issueId);
      if (!existsSync(laborPath)) {
        return [issueId, record];
      }

      const dirtyFiles = readDirtyLaborFiles(laborPath);
      const allowedFiles = new Set(record.fileScope.files.map((entry) => normalizeScopeFile(entry)));
      if (!dirtyFiles || !dirtyFiles.every((entry) => allowedFiles.has(entry))) {
        return [issueId, record];
      }

      changed = true;
      writePhaseLog(input.root, {
        timestamp: input.timestamp,
        phase: "triage",
        issueId,
        action: "dirty_titan_labor_requeued",
        outcome: "scouted",
        detail: JSON.stringify({
          dirtyFiles,
          failureTranscriptRef: record.failureTranscriptRef,
        }),
      });

      return [issueId, {
        ...record,
        stage: "scouted" as const,
        runningAgent: null,
        consecutiveFailures: 0,
        cooldownUntil: null,
        updatedAt: input.timestamp,
      }];
    }),
  );

  return {
    changed,
    state: changed
      ? {
          schemaVersion: input.dispatchState.schemaVersion,
          records,
        }
      : input.dispatchState,
  };
}

function saveIfChanged(root: string, result: RecoveryStepResult) {
  if (result.changed) {
    saveDispatchState(root, result.state);
  }

  return result.state;
}

export async function recoverDispatchStateAfterPoll(input: DispatchRecoveryInput) {
  let dispatchState = input.dispatchState;

  dispatchState = saveIfChanged(input.root, await recoverClosedTrackerRecords({
    root: input.root,
    tracker: input.tracker,
    dispatchState,
    timestamp: input.timestamp,
  }));

  dispatchState = saveIfChanged(input.root, recoverResolvedPolicyBlockedParents({
    root: input.root,
    dispatchState,
    readyIssueIds: input.readyIssueIds,
    timestamp: input.timestamp,
  }));

  dispatchState = saveIfChanged(input.root, await recoverFailedPolicyBlockerScopeRecords({
    root: input.root,
    tracker: input.tracker,
    dispatchState,
    readyIssueIds: input.readyIssueIds,
    timestamp: input.timestamp,
  }));

  dispatchState = saveIfChanged(input.root, recoverDirtyFailedTitanRecords({
    root: input.root,
    dispatchState,
    readyIssueIds: input.readyIssueIds,
    timestamp: input.timestamp,
  }));

  const recoveredTitanIssues = input.readyIssueIds
    .filter((issueId) => recoverFailedTitanRecord(input.root, issueId, input.timestamp));
  if (recoveredTitanIssues.length > 0) {
    dispatchState = loadDispatchState(input.root);
  }

  return dispatchState;
}
