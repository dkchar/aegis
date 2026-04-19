import type { DispatchRecord } from "./dispatch-state.js";
import { loadDispatchState, replaceDispatchRecord, saveDispatchState } from "./dispatch-state.js";
import { persistArtifact } from "./artifact-store.js";
import { parseOracleAssessment } from "../castes/oracle/oracle-parser.js";
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

function buildTitanClarificationRetryPrompt(
  issue: AegisIssue,
  laborPath: string,
  clarificationSummary: string,
) {
  return [
    buildTitanPrompt(issue, laborPath),
    "",
    "AUTOMATIC RETRY CONTEXT:",
    `Previous run returned clarification: ${clarificationSummary}`,
    "Assume default stack when unspecified: Node.js + TypeScript + node:test.",
    "Proceed with best-effort implementation now and emit success/failure artifact.",
    "Only return clarification if a hard blocker still exists after applying defaults.",
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

function buildJanusPrompt(issue: AegisIssue) {
  const description = issue.description?.trim() || "No description provided.";
  return [
    `Process integration conflict for issue ${issue.id}.`,
    `Title: ${issue.title}`,
    `Description: ${description}`,
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
    artifactRefs: [artifactRef, transcriptRef],
  };
}

async function runImplement(
  input: RunCasteCommandInput,
  issue: AegisIssue,
  record: DispatchRecord,
  now: string,
): Promise<CasteCommandResult> {
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

  const firstAttempt = await runTitanSession(runInput);
  const finalAttempt = firstAttempt.artifact.outcome === "clarification"
    ? await runTitanSession({
      ...runInput,
      prompt: buildTitanClarificationRetryPrompt(
        issue,
        labor.laborPath,
        firstAttempt.artifact.summary,
      ),
    })
    : firstAttempt;

  const completedGitProof = completeGitProofPair(labor.laborPath, gitProofPair);
  const gitProofRefs = persistGitProofArtifacts(
    input.root,
    "titan",
    issue.id,
    labor.laborPath,
    completedGitProof,
  );
  const artifact = finalAttempt.artifact;
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
      session: createSessionMetadata(
        finalAttempt.transcriptRef,
        finalAttempt.runInput,
        finalAttempt.session,
      ),
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
    artifactRefs: [artifactRef, ...transcriptRefs],
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
  const artifactRef = persistArtifact(input.root, {
    family: "sentinel",
    issueId: issue.id,
    artifact: {
      ...verdict,
      session: createSessionMetadata(transcriptRef, runInput, session),
    },
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
    artifactRefs: [artifactRef, transcriptRef],
  };
}

async function runJanus(
  input: RunCasteCommandInput,
  issue: AegisIssue,
  record: DispatchRecord,
  now: string,
): Promise<CasteCommandResult> {
  const runInput = {
    caste: "janus",
    issueId: issue.id,
    root: input.root,
    workingDirectory: input.root,
    prompt: buildJanusPrompt(issue),
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

  return {
    action: input.action,
    issueId: issue.id,
    stage,
    artifactRefs: [artifactRef, transcriptRef],
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
