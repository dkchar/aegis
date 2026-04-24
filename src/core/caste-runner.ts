import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { DispatchRecord } from "./dispatch-state.js";
import { loadDispatchState, replaceDispatchRecord, saveDispatchState } from "./dispatch-state.js";
import { persistArtifact } from "./artifact-store.js";
import { parseOracleAssessment } from "../castes/oracle/oracle-parser.js";
import { ORACLE_EMIT_ASSESSMENT_TOOL_NAME } from "../castes/oracle/oracle-tool-contract.js";
import { parseTitanArtifact } from "../castes/titan/titan-parser.js";
import { TITAN_EMIT_ARTIFACT_TOOL_NAME } from "../castes/titan/titan-tool-contract.js";
import { parseSentinelVerdict } from "../castes/sentinel/sentinel-parser.js";
import { SENTINEL_EMIT_VERDICT_TOOL_NAME } from "../castes/sentinel/sentinel-tool-contract.js";
import { parseJanusResolutionArtifact } from "../castes/janus/janus-parser.js";
import { JANUS_EMIT_RESOLUTION_TOOL_NAME } from "../castes/janus/janus-tool-contract.js";
import { planLaborCreation, prepareLaborWorktree, type LaborCreationPlan } from "../labor/create-labor.js";
import type { RuntimeCasteAction } from "../cli/runtime-command.js";
import type { AegisIssue } from "../tracker/issue-model.js";
import type { CasteRunInput, CasteRuntime, CasteSessionResult } from "../runtime/caste-runtime.js";
import { loadConfig } from "../config/load-config.js";
import {
  captureGitProofPair,
  completeGitProofPair,
  persistGitProofArtifacts,
} from "./git-proof.js";
import {
  enqueueMergeCandidate,
  loadMergeQueueState,
  readTitanMergeCandidate,
  saveMergeQueueState,
} from "../merge/merge-state.js";
import { writePhaseLog } from "./phase-log.js";
import {
  assertDispatchRecordStage,
  assertTitanDispatchEligibility,
  canRerunSentinelReview,
} from "./stage-invariants.js";

interface TrackerLike {
  getIssue(id: string, root?: string): Promise<AegisIssue>;
  closeIssue?(id: string, root?: string): Promise<void>;
  createIssue?(
    input: {
      title: string;
      description: string;
      dependencies?: string[];
    },
    root?: string,
  ): Promise<string>;
}

export interface JanusConflictContext {
  queueItemId: string;
  mergeOutcome: "merged" | "stale_branch" | "conflict";
  mergeDetail: string;
  attempt: number;
  tier: "T3";
  janusInvocation: number;
}

export interface RunCasteCommandInput {
  root: string;
  action: RuntimeCasteAction;
  issueId: string;
  tracker: TrackerLike;
  runtime: CasteRuntime;
  janusContext?: JanusConflictContext;
  resolveBaseBranch?: () => string;
  resolveLaborBasePath?: () => string;
  ensureLabor?: (plan: LaborCreationPlan) => void;
  now?: string;
}

export interface CasteCommandResult {
  action: RuntimeCasteAction;
  issueId: string;
  stage: string;
  artifactRefs?: string[];
  queueItemId?: string;
  janusRecommendation?: "requeue" | "manual_decision" | "fail";
  nextAction?: "merge_next";
}

function createBaseRecord(issueId: string, now: string): DispatchRecord {
  return {
    issueId,
    stage: "pending",
    runningAgent: null,
    oracleAssessmentRef: null,
    oracleReady: null,
    oracleDecompose: null,
    oracleBlockers: null,
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
  const description = issue.description?.trim() || "No description provided.";
  const blockers = issue.blockers.length > 0 ? issue.blockers.join(", ") : "none";
  const labels = issue.labels.length > 0 ? issue.labels.join(", ") : "none";

  return [
    `Scout ${issue.id}: ${issue.title}`,
    `Description: ${description}`,
    `Status: ${issue.status}`,
    `Blockers: ${blockers}`,
    `Labels: ${labels}`,
    "The tracker already contains the work breakdown for executable issues.",
    "Do not decompose ordinary implementation breakdown into new sub-issues.",
    "Set decompose=true only for missing prerequisite work that cannot be satisfied by implementing this issue as written.",
    "If the issue is implementable as currently written, return decompose=false.",
    `Call tool '${ORACLE_EMIT_ASSESSMENT_TOOL_NAME}' exactly once as final step after analysis is complete.`,
    "Return only JSON. No markdown fences. No prose before or after JSON.",
    "JSON schema keys: files_affected, estimated_complexity, decompose, ready.",
  ].join("\n");
}

function buildTitanPrompt(issue: AegisIssue, laborPath: string) {
  const description = issue.description?.trim() || "No description provided.";
  const blockers = issue.blockers.length > 0 ? issue.blockers.join(", ") : "none";
  const labels = issue.labels.length > 0 ? issue.labels.join(", ") : "none";

  return [
    `Implement issue ${issue.id}.`,
    `Title: ${issue.title}`,
    `Description: ${description}`,
    `Status: ${issue.status}`,
    `Blockers: ${blockers}`,
    `Labels: ${labels}`,
    `Working directory: ${laborPath}`,
    `Call tool '${TITAN_EMIT_ARTIFACT_TOOL_NAME}' exactly once as final step after all file edits and checks complete.`,
    "If required project files do not exist, create minimal versions that satisfy the issue contract.",
    "Treat ordinary naming/tooling ambiguity as solvable: choose reasonable defaults and proceed.",
    "Use outcome=clarification only for hard blockers (missing required credentials/access, missing mandatory external inputs, or conflicting non-resolvable requirements).",
    "Return only JSON. No markdown fences. No prose before or after JSON.",
    "JSON schema keys: outcome, summary, files_changed, tests_and_checks_run, known_risks, follow_up_work, learnings_written_to_mnemosyne, blocking_question, handoff_note.",
    "If work is blocked, set outcome to clarification and include blocking_question plus handoff_note.",
  ].join("\n");
}

function buildSentinelPrompt(issue: AegisIssue) {
  const description = issue.description?.trim() || "No description provided.";
  return [
    `Review merged issue ${issue.id}.`,
    `Title: ${issue.title}`,
    `Description: ${description}`,
    `Call tool '${SENTINEL_EMIT_VERDICT_TOOL_NAME}' exactly once as final step after review is complete.`,
    "Return only JSON. No markdown fences. No prose before or after JSON.",
    "JSON schema keys: verdict, reviewSummary, issuesFound, followUpIssueIds, riskAreas.",
  ].join("\n");
}

function truncate(text: string, maxLength: number) {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 3)}...`;
}

function offsetTimestamp(baseTimestamp: string, offsetMilliseconds: number) {
  const baseTime = Date.parse(baseTimestamp);
  if (!Number.isFinite(baseTime)) {
    return new Date().toISOString();
  }

  return new Date(baseTime + offsetMilliseconds).toISOString();
}

function resolveArtifactPath(root: string, artifactRef: string) {
  return path.join(path.resolve(root), ...artifactRef.split(/[\\/]/));
}

function readPersistedArtifact(root: string, artifactRef: string | null): Record<string, unknown> | null {
  if (!artifactRef) {
    return null;
  }

  const artifactPath = resolveArtifactPath(root, artifactRef);
  if (!existsSync(artifactPath)) {
    return null;
  }

  const parsed = JSON.parse(readFileSync(artifactPath, "utf8")) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  return parsed as Record<string, unknown>;
}

function normalizeFinding(finding: string) {
  return finding.trim().replace(/\s+/g, " ").toLowerCase();
}

function buildFindingFingerprint(issueId: string, finding: string) {
  return createHash("sha256")
    .update(`${issueId}\n${normalizeFinding(finding)}`)
    .digest("hex")
    .slice(0, 16);
}

interface FollowUpIssueLink {
  finding: string;
  fingerprint: string;
  issueId: string;
}

function readExistingSentinelFollowUps(
  root: string,
  record: DispatchRecord,
): Map<string, string> {
  const existing = new Map<string, string>();
  const artifact = readPersistedArtifact(root, record.sentinelVerdictRef ?? null);
  if (!artifact) {
    return existing;
  }

  const followUpIssues = artifact["followUpIssues"];
  if (Array.isArray(followUpIssues)) {
    for (const candidate of followUpIssues) {
      if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
        continue;
      }

      const entry = candidate as Record<string, unknown>;
      if (typeof entry["fingerprint"] !== "string" || typeof entry["issueId"] !== "string") {
        continue;
      }

      existing.set(entry["fingerprint"], entry["issueId"]);
    }
  }

  const issuesFound = artifact["issuesFound"];
  const followUpIssueIds = artifact["followUpIssueIds"];
  if (!Array.isArray(issuesFound) || !Array.isArray(followUpIssueIds)) {
    return existing;
  }

  for (let index = 0; index < issuesFound.length; index += 1) {
    const finding = issuesFound[index];
    const issueId = followUpIssueIds[index];
    if (typeof finding !== "string" || typeof issueId !== "string") {
      continue;
    }

    existing.set(buildFindingFingerprint(record.issueId, finding), issueId);
  }

  return existing;
}

async function resolveTitanClarificationIssueId(
  input: RunCasteCommandInput,
  issue: AegisIssue,
  record: DispatchRecord,
  artifact: ReturnType<typeof parseTitanArtifact>,
  now: string,
) {
  if (artifact.outcome !== "clarification") {
    return null;
  }

  const fingerprint = buildFindingFingerprint(issue.id, artifact.blocking_question ?? artifact.summary);
  const previousArtifact = readPersistedArtifact(input.root, record.titanClarificationRef ?? null);
  if (
    previousArtifact
    && previousArtifact["clarificationFingerprint"] === fingerprint
    && typeof previousArtifact["clarificationIssueId"] === "string"
  ) {
    return {
      fingerprint,
      issueId: previousArtifact["clarificationIssueId"],
    };
  }

  if (!input.tracker.createIssue) {
    return {
      fingerprint,
      issueId: null,
    };
  }

  const clarificationTitle = truncate(
    `[clarification][${issue.id}] ${artifact.blocking_question ?? artifact.summary}`,
    120,
  );
  const clarificationDescription = [
    `Auto-created from Titan clarification for ${issue.id}.`,
    `Summary: ${artifact.summary}`,
    `Blocking question: ${artifact.blocking_question ?? "none"}`,
    `Handoff note: ${artifact.handoff_note ?? "none"}`,
  ].join("\n");
  const clarificationIssueId = await input.tracker.createIssue(
    {
      title: clarificationTitle,
      description: clarificationDescription,
      dependencies: [`discovered-from:${issue.id}`],
    },
    input.root,
  );
  writePhaseLog(input.root, {
    timestamp: offsetTimestamp(now, 20),
    phase: "dispatch",
    issueId: issue.id,
    action: "titan_clarification_issue_created",
    outcome: "created",
    detail: JSON.stringify({
      clarificationIssueId,
      fingerprint,
    }),
  });

  return {
    fingerprint,
    issueId: clarificationIssueId,
  };
}

async function createSentinelFollowUpIssues(
  input: RunCasteCommandInput,
  issue: AegisIssue,
  record: DispatchRecord,
  verdict: ReturnType<typeof parseSentinelVerdict>,
  now: string,
) {
  if (verdict.verdict !== "fail" || verdict.issuesFound.length === 0) {
    return [] as FollowUpIssueLink[];
  }

  const existingFollowUps = readExistingSentinelFollowUps(input.root, record);
  const resolvedFollowUps: FollowUpIssueLink[] = [];
  for (let index = 0; index < verdict.issuesFound.length; index += 1) {
    const finding = verdict.issuesFound[index]!;
    const fingerprint = buildFindingFingerprint(issue.id, finding);
    const preRegisteredIssueId = verdict.followUpIssueIds[index];
    const existingIssueId = existingFollowUps.get(fingerprint);
    const followUpIssueId = typeof preRegisteredIssueId === "string"
      ? preRegisteredIssueId
      : existingIssueId ?? null;

    if (followUpIssueId) {
      resolvedFollowUps.push({
        finding,
        fingerprint,
        issueId: followUpIssueId,
      });
      continue;
    }

    if (!input.tracker.createIssue) {
      continue;
    }

    const issueTitle = truncate(`[sentinel][${issue.id}] ${finding}`, 120);
    const issueDescription = [
      `Auto-created from Sentinel review for ${issue.id}.`,
      `Review summary: ${verdict.reviewSummary}`,
      `Finding: ${finding}`,
      verdict.riskAreas.length > 0
        ? `Risk areas: ${verdict.riskAreas.join(", ")}`
        : "Risk areas: none",
    ].join("\n");

    const createdIssueId = await input.tracker.createIssue(
      {
        title: issueTitle,
        description: issueDescription,
        dependencies: [`discovered-from:${issue.id}`],
      },
      input.root,
    );
    resolvedFollowUps.push({
      finding,
      fingerprint,
      issueId: createdIssueId,
    });
    writePhaseLog(input.root, {
      timestamp: offsetTimestamp(now, 20 + resolvedFollowUps.length),
      phase: "dispatch",
      issueId: issue.id,
      action: "sentinel_followup_created",
      outcome: "created",
      detail: JSON.stringify({
        followUpIssueId: createdIssueId,
        finding,
      }),
    });
  }

  return resolvedFollowUps;
}

function buildJanusPrompt(issue: AegisIssue, janusContext?: JanusConflictContext) {
  const description = issue.description?.trim() || "No description provided.";
  const contextLines = janusContext
    ? [
      `Merge queue item: ${janusContext.queueItemId}`,
      `Merge tier: ${janusContext.tier}`,
      `Merge attempt: ${janusContext.attempt}`,
      `Janus invocation: ${janusContext.janusInvocation}`,
      `Merge outcome: ${janusContext.mergeOutcome}`,
      `Merge detail: ${janusContext.mergeDetail}`,
    ]
    : [];

  return [
    `Process integration conflict for issue ${issue.id}.`,
    `Title: ${issue.title}`,
    `Description: ${description}`,
    ...contextLines,
    `Call tool '${JANUS_EMIT_RESOLUTION_TOOL_NAME}' exactly once as final step after conflict analysis is complete.`,
    "Return only JSON. No markdown fences. No prose before or after JSON.",
    "JSON schema keys: originatingIssueId, queueItemId, preservedLaborPath, conflictSummary, resolutionStrategy, filesTouched, validationsRun, residualRisks, recommendedNextAction.",
  ].join("\n");
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

function persistSessionArtifact(
  root: string,
  action: RuntimeCasteAction,
  runInput: CasteRunInput,
  session: CasteSessionResult,
  options: { artifactId?: string } = {},
) {
  return persistArtifact(root, {
    family: "transcripts",
    issueId: runInput.issueId,
    artifactId: options.artifactId ?? runInput.caste,
    artifact: {
      issueId: runInput.issueId,
      caste: runInput.caste,
      action,
      prompt: runInput.prompt,
      workingDirectory: runInput.workingDirectory,
      modelRef: session.modelRef,
      provider: session.provider,
      modelId: session.modelId,
      thinkingLevel: session.thinkingLevel,
      sessionId: session.sessionId,
      toolsUsed: session.toolsUsed,
      messageLog: session.messageLog,
      outputText: session.outputText,
      status: session.status,
      error: session.error ?? null,
      startedAt: session.startedAt,
      finishedAt: session.finishedAt,
    },
  });
}

function createSessionMetadata(
  transcriptRef: string,
  runInput: CasteRunInput,
  session: CasteSessionResult,
) {
  return {
    transcriptRef,
    prompt: runInput.prompt,
    workingDirectory: runInput.workingDirectory,
    modelRef: session.modelRef,
    provider: session.provider,
    modelId: session.modelId,
    thinkingLevel: session.thinkingLevel,
    sessionId: session.sessionId,
    toolsUsed: session.toolsUsed,
    status: session.status,
  };
}

function assertSuccessfulSession(
  runInput: CasteRunInput,
  session: CasteSessionResult,
) {
  if (session.status === "succeeded") {
    return;
  }

  const casteLabel = `${runInput.caste[0].toUpperCase()}${runInput.caste.slice(1)}`;
  const detail = session.error?.trim().length
    ? session.error
    : `Runtime returned status=${session.status}.`;
  throw new Error(`${casteLabel} session failed for ${runInput.issueId}: ${detail}`);
}

async function runScout(
  input: RunCasteCommandInput,
  issue: AegisIssue,
  record: DispatchRecord,
  now: string,
): Promise<CasteCommandResult> {
  const runInput = {
    caste: "oracle",
    issueId: issue.id,
    root: input.root,
    workingDirectory: input.root,
    prompt: buildOraclePrompt(issue),
  } satisfies CasteRunInput;
  const session = await input.runtime.run(runInput);
  const transcriptRef = persistSessionArtifact(input.root, input.action, runInput, session);
  assertSuccessfulSession(runInput, session);
  const assessment = parseOracleAssessment(session.outputText);
  const artifactRef = persistArtifact(input.root, {
    family: "oracle",
    issueId: issue.id,
    artifact: {
      ...assessment,
      session: createSessionMetadata(transcriptRef, runInput, session),
    },
  });
  if (assessment.decompose) {
    saveRecord(input.root, issue.id, {
      ...clearDownstreamArtifactRefs(record),
      stage: "failed",
      oracleAssessmentRef: artifactRef,
      oracleReady: assessment.ready,
      oracleDecompose: assessment.decompose,
      oracleBlockers: assessment.blockers ?? [],
      updatedAt: now,
    });
    throw new Error("Oracle decomposition is not supported for executable issue progression.");
  }
  saveRecord(input.root, issue.id, {
    ...clearDownstreamArtifactRefs(record),
    stage: "scouted",
    oracleAssessmentRef: artifactRef,
    oracleReady: assessment.ready,
    oracleDecompose: assessment.decompose,
    oracleBlockers: assessment.blockers ?? [],
    updatedAt: now,
  });

  return {
    action: input.action,
    issueId: issue.id,
    stage: "scouted",
    artifactRefs: [artifactRef, transcriptRef],
  };
}

async function runImplement(
  input: RunCasteCommandInput,
  issue: AegisIssue,
  record: DispatchRecord,
  now: string,
): Promise<CasteCommandResult> {
  assertTitanDispatchEligibility(record);

  let configCache: ReturnType<typeof loadConfig> | null = null;
  const resolveConfig = () => {
    if (configCache === null) {
      configCache = loadConfig(input.root);
    }
    return configCache;
  };
  const baseBranch = input.resolveBaseBranch?.() ?? resolveConfig().git.base_branch;
  const laborBasePath = input.resolveLaborBasePath?.() ?? resolveConfig().labor.base_path;
  const labor = planLaborCreation({
    issueId: issue.id,
    projectRoot: input.root,
    baseBranch,
    laborBasePath,
  });

  if (input.ensureLabor) {
    input.ensureLabor(labor);
  } else {
    prepareLaborWorktree(labor);
  }

  const runInput = {
    caste: "titan",
    issueId: issue.id,
    root: input.root,
    workingDirectory: labor.laborPath,
    prompt: buildTitanPrompt(issue, labor.laborPath),
  } satisfies CasteRunInput;
  const gitProofPair = captureGitProofPair(labor.laborPath);
  const transcriptRefs: string[] = [];

  const runTitanSession = async (candidateInput: CasteRunInput) => {
    const session = await input.runtime.run(candidateInput);
    const attemptIndex = transcriptRefs.length;
    const transcriptArtifactId = attemptIndex === 0
      ? candidateInput.caste
      : `${candidateInput.caste}-retry-${attemptIndex}`;
    const transcriptRef = persistSessionArtifact(input.root, input.action, candidateInput, session, {
      artifactId: transcriptArtifactId,
    });
    transcriptRefs.push(transcriptRef);
    assertSuccessfulSession(candidateInput, session);
    const artifact = parseTitanArtifact(session.outputText);

    return {
      runInput: candidateInput,
      session,
      transcriptRef,
      artifact,
    };
  };

  const finalAttempt = await runTitanSession(runInput);

  const completedGitProof = completeGitProofPair(labor.laborPath, gitProofPair);
  const gitProofRefs = persistGitProofArtifacts(
    input.root,
    "titan",
    issue.id,
    labor.laborPath,
    completedGitProof,
  );
  const artifact = finalAttempt.artifact;
  const clarificationIssue = await resolveTitanClarificationIssueId(
    input,
    issue,
    record,
    artifact,
    now,
  );
  const artifactRef = persistArtifact(input.root, {
    family: "titan",
    issueId: issue.id,
    artifact: {
      ...artifact,
      labor_path: labor.laborPath,
      candidate_branch: labor.branchName,
      base_branch: labor.baseBranch,
      git_proof: {
        status_before_ref: gitProofRefs.statusBeforeRef,
        status_after_ref: gitProofRefs.statusAfterRef,
        changed_files_manifest_ref: gitProofRefs.changedFilesManifestRef,
        diff_ref: gitProofRefs.diffRef,
      },
      clarificationFingerprint: clarificationIssue?.fingerprint ?? null,
      clarificationIssueId: clarificationIssue?.issueId ?? null,
      session: createSessionMetadata(
        finalAttempt.transcriptRef,
        finalAttempt.runInput,
        finalAttempt.session,
      ),
    },
  });
  const implementationSucceeded = artifact.outcome === "success";
  saveRecord(input.root, issue.id, {
    ...clearDownstreamArtifactRefs(record),
    stage: implementationSucceeded ? "implemented" : "failed",
    oracleAssessmentRef: record.oracleAssessmentRef,
    titanHandoffRef: implementationSucceeded ? artifactRef : null,
    titanClarificationRef: artifact.outcome === "clarification" ? artifactRef : null,
    updatedAt: now,
  });

  return {
    action: input.action,
    issueId: issue.id,
    stage: implementationSucceeded ? "implemented" : "failed",
    artifactRefs: [artifactRef, ...transcriptRefs],
  };
}

async function runReview(
  input: RunCasteCommandInput,
  issue: AegisIssue,
  record: DispatchRecord,
  now: string,
): Promise<CasteCommandResult> {
  if (record.stage !== "merged" && !canRerunSentinelReview(record)) {
    throw new Error("Review requires a merged issue.");
  }
  assertDispatchRecordStage(record, "merged");

  writePhaseLog(input.root, {
    timestamp: offsetTimestamp(now, 0),
    phase: "dispatch",
    issueId: issue.id,
    action: "sentinel_review_started",
    outcome: "running",
  });

  const runInput = {
    caste: "sentinel",
    issueId: issue.id,
    root: input.root,
    workingDirectory: input.root,
    prompt: buildSentinelPrompt(issue),
  } satisfies CasteRunInput;
  const session = await input.runtime.run(runInput);
  const transcriptRef = persistSessionArtifact(input.root, input.action, runInput, session);
  assertSuccessfulSession(runInput, session);
  const verdict = parseSentinelVerdict(session.outputText);
  if (verdict.issuesFound.length > 0) {
    writePhaseLog(input.root, {
      timestamp: offsetTimestamp(now, 10),
      phase: "dispatch",
      issueId: issue.id,
      action: "sentinel_issues_discovered",
      outcome: "found",
      detail: JSON.stringify({
        count: verdict.issuesFound.length,
      }),
    });
  }
  const followUpIssues = await createSentinelFollowUpIssues(input, issue, record, verdict, now);
  const resolvedFollowUpIssueIds = followUpIssues.map((followUpIssue) => followUpIssue.issueId);
  const reviewHasFollowUps = resolvedFollowUpIssueIds.length > 0;
  const reviewStage = verdict.verdict === "pass" ? "reviewed" : "failed";
  const artifactRef = persistArtifact(input.root, {
    family: "sentinel",
    issueId: issue.id,
    artifact: {
      ...verdict,
      followUpIssueIds: resolvedFollowUpIssueIds,
      followUpIssues,
      session: createSessionMetadata(transcriptRef, runInput, session),
    },
  });

  if (verdict.verdict === "pass" && input.tracker.closeIssue) {
    await input.tracker.closeIssue(issue.id, input.root);
    writePhaseLog(input.root, {
      timestamp: offsetTimestamp(now, 40),
      phase: "dispatch",
      issueId: issue.id,
      action: "sentinel_originating_issue_closed",
      outcome: "closed",
    });
  }

  saveRecord(input.root, issue.id, {
    ...clearDownstreamArtifactRefs(record),
    stage: reviewStage,
    oracleAssessmentRef: record.oracleAssessmentRef,
    titanHandoffRef: record.titanHandoffRef ?? null,
    titanClarificationRef: record.titanClarificationRef ?? null,
    sentinelVerdictRef: artifactRef,
    updatedAt: now,
  });
  writePhaseLog(input.root, {
    timestamp: offsetTimestamp(now, 50),
    phase: "dispatch",
    issueId: issue.id,
    action: "sentinel_review_completed",
    outcome: verdict.verdict === "pass"
      ? "reviewed"
      : reviewHasFollowUps
        ? "failed_with_followups"
        : "failed",
    sessionId: session.sessionId,
    detail: JSON.stringify({
      followUpIssueCount: resolvedFollowUpIssueIds.length,
    }),
  });

  return {
    action: input.action,
    issueId: issue.id,
    stage: reviewStage,
    artifactRefs: [artifactRef, transcriptRef],
  };
}

async function runJanus(
  input: RunCasteCommandInput,
  issue: AegisIssue,
  record: DispatchRecord,
  now: string,
): Promise<CasteCommandResult> {
  writePhaseLog(input.root, {
    timestamp: offsetTimestamp(now, 0),
    phase: "dispatch",
    issueId: issue.id,
    action: "janus_resolution_started",
    outcome: "running",
    detail: input.janusContext ? JSON.stringify(input.janusContext) : undefined,
  });

  const runInput = {
    caste: "janus",
    issueId: issue.id,
    root: input.root,
    workingDirectory: input.root,
    prompt: buildJanusPrompt(issue, input.janusContext),
  } satisfies CasteRunInput;
  const gitProofPair = captureGitProofPair(runInput.workingDirectory);
  const session = await input.runtime.run(runInput);
  const completedGitProof = completeGitProofPair(runInput.workingDirectory, gitProofPair);
  const transcriptRef = persistSessionArtifact(input.root, input.action, runInput, session);
  assertSuccessfulSession(runInput, session);
  const artifact = parseJanusResolutionArtifact(session.outputText);
  const gitProofRefs = persistGitProofArtifacts(
    input.root,
    "janus",
    issue.id,
    runInput.workingDirectory,
    completedGitProof,
  );
  const artifactRef = persistArtifact(input.root, {
    family: "janus",
    issueId: issue.id,
    artifact: {
      ...artifact,
      git_proof: {
        status_before_ref: gitProofRefs.statusBeforeRef,
        status_after_ref: gitProofRefs.statusAfterRef,
        changed_files_manifest_ref: gitProofRefs.changedFilesManifestRef,
        diff_ref: gitProofRefs.diffRef,
      },
      session: createSessionMetadata(transcriptRef, runInput, session),
    },
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
  writePhaseLog(input.root, {
    timestamp: offsetTimestamp(now, 10),
    phase: "dispatch",
    issueId: issue.id,
    action: "janus_resolution_completed",
    outcome: stage,
    sessionId: session.sessionId,
    detail: JSON.stringify({
      queueItemId: artifact.queueItemId,
      conflictSummary: artifact.conflictSummary,
      resolutionStrategy: artifact.resolutionStrategy,
      recommendedNextAction: artifact.recommendedNextAction,
      mergeOutcome: input.janusContext?.mergeOutcome ?? null,
      mergeDetail: input.janusContext?.mergeDetail ?? null,
      attempt: input.janusContext?.attempt ?? null,
      tier: input.janusContext?.tier ?? null,
      janusInvocation: input.janusContext?.janusInvocation ?? null,
    }),
  });

  return {
    action: input.action,
    issueId: issue.id,
    stage,
    janusRecommendation: artifact.recommendedNextAction,
    artifactRefs: [artifactRef, transcriptRef],
  };
}

function enqueueImplementedIssue(
  root: string,
  issueId: string,
  record: DispatchRecord,
  now: string,
) {
  assertDispatchRecordStage(record, "implemented");

  const candidate = readTitanMergeCandidate(root, record.titanHandoffRef!);
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
    assertDispatchRecordStage(record, "resolving_integration");
    return runJanus(input, issue, record, now);
  }

  if (input.action === "process" && record.stage === "queued_for_merge") {
    assertDispatchRecordStage(record, "queued_for_merge");
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
    assertDispatchRecordStage(record, "reviewed");
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
