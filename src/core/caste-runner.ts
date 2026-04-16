import { mkdirSync } from "node:fs";

import type { DispatchRecord } from "./dispatch-state.js";
import { loadDispatchState, replaceDispatchRecord, saveDispatchState } from "./dispatch-state.js";
import { persistArtifact } from "./artifact-store.js";
import { parseOracleAssessment } from "../castes/oracle/oracle-parser.js";
import { parseTitanArtifact } from "../castes/titan/titan-parser.js";
import { parseSentinelVerdict } from "../castes/sentinel/sentinel-parser.js";
import { parseJanusResolutionArtifact } from "../castes/janus/janus-parser.js";
import { planLaborCreation } from "../labor/create-labor.js";
import type { RuntimeCasteAction } from "../cli/runtime-command.js";
import type { AegisIssue } from "../tracker/issue-model.js";
import type { CasteRuntime } from "../runtime/caste-runtime.js";
import { loadConfig } from "../config/load-config.js";
import {
  enqueueMergeCandidate,
  loadMergeQueueState,
  readTitanMergeCandidate,
  saveMergeQueueState,
} from "../merge/merge-state.js";

interface TrackerLike {
  getIssue(id: string, root?: string): Promise<AegisIssue>;
  closeIssue?(id: string, root?: string): Promise<void>;
}

export interface RunCasteCommandInput {
  root: string;
  action: RuntimeCasteAction;
  issueId: string;
  tracker: TrackerLike;
  runtime: CasteRuntime;
  resolveBaseBranch?: () => string;
  ensureLabor?: (laborPath: string) => void;
  now?: string;
}

export interface CasteCommandResult {
  action: RuntimeCasteAction;
  issueId: string;
  stage: string;
  artifactRefs?: string[];
  queueItemId?: string;
  nextAction?: "merge_next";
}

function createBaseRecord(issueId: string, now: string): DispatchRecord {
  return {
    issueId,
    stage: "pending",
    runningAgent: null,
    oracleAssessmentRef: null,
    titanHandoffRef: null,
    titanClarificationRef: null,
    sentinelVerdictRef: null,
    janusArtifactRef: null,
    failureTranscriptRef: null,
    fileScope: null,
    failureCount: 0,
    consecutiveFailures: 0,
    failureWindowStartMs: null,
    cooldownUntil: null,
    sessionProvenanceId: "direct-caste-command",
    updatedAt: now,
  };
}

function buildOraclePrompt(issue: AegisIssue) {
  return `Scout ${issue.id}: ${issue.title}`;
}

function buildTitanPrompt(issue: AegisIssue, laborPath: string) {
  return `Implement ${issue.id} in ${laborPath}: ${issue.title}`;
}

function buildSentinelPrompt(issue: AegisIssue) {
  return `Review ${issue.id}: ${issue.title}`;
}

function buildJanusPrompt(issue: AegisIssue) {
  return `Process integration for ${issue.id}: ${issue.title}`;
}

function clearDownstreamArtifactRefs(record: DispatchRecord) {
  return {
    ...record,
    titanHandoffRef: null,
    titanClarificationRef: null,
    sentinelVerdictRef: null,
    janusArtifactRef: null,
    failureTranscriptRef: null,
  };
}

function saveRecord(root: string, issueId: string, record: DispatchRecord) {
  const state = loadDispatchState(root);
  saveDispatchState(root, replaceDispatchRecord(state, issueId, record));
}

async function runScout(
  input: RunCasteCommandInput,
  issue: AegisIssue,
  record: DispatchRecord,
  now: string,
): Promise<CasteCommandResult> {
  const session = await input.runtime.run({
    caste: "oracle",
    issueId: issue.id,
    root: input.root,
    workingDirectory: input.root,
    prompt: buildOraclePrompt(issue),
  });
  const assessment = parseOracleAssessment(session.outputText);
  const artifactRef = persistArtifact(input.root, {
    family: "oracle",
    issueId: issue.id,
    artifact: assessment,
  });
  saveRecord(input.root, issue.id, {
    ...clearDownstreamArtifactRefs(record),
    stage: "scouted",
    oracleAssessmentRef: artifactRef,
    updatedAt: now,
  });

  return {
    action: input.action,
    issueId: issue.id,
    stage: "scouted",
    artifactRefs: [artifactRef],
  };
}

async function runImplement(
  input: RunCasteCommandInput,
  issue: AegisIssue,
  record: DispatchRecord,
  now: string,
): Promise<CasteCommandResult> {
  const baseBranch = input.resolveBaseBranch?.() ?? loadConfig(input.root).git.base_branch;
  const labor = planLaborCreation({
    issueId: issue.id,
    projectRoot: input.root,
    baseBranch,
  });

  input.ensureLabor?.(labor.laborPath);
  if (!input.ensureLabor) {
    mkdirSync(labor.laborPath, { recursive: true });
  }

  const session = await input.runtime.run({
    caste: "titan",
    issueId: issue.id,
    root: input.root,
    workingDirectory: labor.laborPath,
    prompt: buildTitanPrompt(issue, labor.laborPath),
  });
  const artifact = parseTitanArtifact(session.outputText);
  const artifactRef = persistArtifact(input.root, {
    family: "titan",
    issueId: issue.id,
    artifact: {
      ...artifact,
      labor_path: labor.laborPath,
      candidate_branch: labor.branchName,
      base_branch: labor.baseBranch,
    },
  });
  saveRecord(input.root, issue.id, {
    ...clearDownstreamArtifactRefs(record),
    stage: artifact.outcome === "success" ? "implemented" : "failed",
    oracleAssessmentRef: record.oracleAssessmentRef,
    titanHandoffRef: artifactRef,
    updatedAt: now,
  });

  return {
    action: input.action,
    issueId: issue.id,
    stage: artifact.outcome === "success" ? "implemented" : "failed",
    artifactRefs: [artifactRef],
  };
}

async function runReview(
  input: RunCasteCommandInput,
  issue: AegisIssue,
  record: DispatchRecord,
  now: string,
): Promise<CasteCommandResult> {
  if (record.stage !== "merged") {
    throw new Error("Review requires a merged issue.");
  }

  const session = await input.runtime.run({
    caste: "sentinel",
    issueId: issue.id,
    root: input.root,
    workingDirectory: input.root,
    prompt: buildSentinelPrompt(issue),
  });
  const verdict = parseSentinelVerdict(session.outputText);
  const artifactRef = persistArtifact(input.root, {
    family: "sentinel",
    issueId: issue.id,
    artifact: verdict,
  });

  if (verdict.verdict === "pass" && input.tracker.closeIssue) {
    await input.tracker.closeIssue(issue.id, input.root);
  }

  saveRecord(input.root, issue.id, {
    ...clearDownstreamArtifactRefs(record),
    stage: verdict.verdict === "pass" ? "reviewed" : "failed",
    oracleAssessmentRef: record.oracleAssessmentRef,
    titanHandoffRef: record.titanHandoffRef ?? null,
    titanClarificationRef: record.titanClarificationRef ?? null,
    sentinelVerdictRef: artifactRef,
    updatedAt: now,
  });

  return {
    action: input.action,
    issueId: issue.id,
    stage: verdict.verdict === "pass" ? "reviewed" : "failed",
    artifactRefs: [artifactRef],
  };
}

async function runJanus(
  input: RunCasteCommandInput,
  issue: AegisIssue,
  record: DispatchRecord,
  now: string,
): Promise<CasteCommandResult> {
  const session = await input.runtime.run({
    caste: "janus",
    issueId: issue.id,
    root: input.root,
    workingDirectory: input.root,
    prompt: buildJanusPrompt(issue),
  });
  const artifact = parseJanusResolutionArtifact(session.outputText);
  const artifactRef = persistArtifact(input.root, {
    family: "janus",
    issueId: issue.id,
    artifact,
  });
  const stage = artifact.recommendedNextAction === "requeue"
    ? "queued_for_merge"
    : "failed";
  saveRecord(input.root, issue.id, {
    ...clearDownstreamArtifactRefs(record),
    stage,
    oracleAssessmentRef: record.oracleAssessmentRef,
    titanHandoffRef: record.titanHandoffRef ?? null,
    titanClarificationRef: record.titanClarificationRef ?? null,
    sentinelVerdictRef: record.sentinelVerdictRef,
    janusArtifactRef: artifactRef,
    updatedAt: now,
  });

  return {
    action: input.action,
    issueId: issue.id,
    stage,
    artifactRefs: [artifactRef],
  };
}

function enqueueImplementedIssue(
  root: string,
  issueId: string,
  record: DispatchRecord,
  now: string,
) {
  if (!record.titanHandoffRef) {
    throw new Error(`Implemented issue ${issueId} is missing titan handoff artifact.`);
  }

  const candidate = readTitanMergeCandidate(root, record.titanHandoffRef);
  const queueState = loadMergeQueueState(root);
  const queued = enqueueMergeCandidate(queueState, {
    issueId,
    candidateBranch: candidate.candidate_branch,
    targetBranch: candidate.base_branch,
    laborPath: candidate.labor_path,
    now,
  });

  saveMergeQueueState(root, queued.state);
  saveRecord(root, issueId, {
    ...record,
    stage: "queued_for_merge",
    updatedAt: now,
  });

  return queued.item;
}

export async function runCasteCommand(input: RunCasteCommandInput): Promise<CasteCommandResult> {
  const now = input.now ?? new Date().toISOString();
  const issue = await input.tracker.getIssue(input.issueId, input.root);
  const state = loadDispatchState(input.root);
  const record = state.records[input.issueId] ?? createBaseRecord(input.issueId, now);

  if (input.action === "process" && record.stage === "implemented") {
    const queueItem = enqueueImplementedIssue(input.root, input.issueId, record, now);
    return {
      action: "process",
      issueId: input.issueId,
      stage: "queued_for_merge",
      queueItemId: queueItem.queueItemId,
      nextAction: "merge_next",
    };
  }

  if (input.action === "process" && record.stage === "resolving_integration") {
    return runJanus(input, issue, record, now);
  }

  if (input.action === "process" && record.stage === "queued_for_merge") {
    return {
      action: "process",
      issueId: input.issueId,
      stage: "queued_for_merge",
      nextAction: "merge_next",
    };
  }

  if (input.action === "process" && record.stage === "merged") {
    return runReview(input, issue, record, now);
  }

  if (input.action === "process" && record.stage === "reviewed") {
    return {
      action: "process",
      issueId: input.issueId,
      stage: "reviewed",
    };
  }

  if (input.action === "review") {
    return runReview(input, issue, record, now);
  }

  if (
    input.action === "implement"
    || (input.action === "process" && record.stage === "scouted")
  ) {
    return runImplement({ ...input, action: input.action }, issue, record, now);
  }

  return runScout({ ...input, action: input.action }, issue, record, now);
}
