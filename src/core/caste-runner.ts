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
import { parseSentinelVerdict, type SentinelFinding } from "../castes/sentinel/sentinel-parser.js";
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
  hasAdvancedGitHead,
  persistGitProofArtifacts,
  resolveCommittedChangedFiles,
  summarizeOperationalStatusDrift,
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
} from "./stage-invariants.js";
import {
  applyMutationProposal,
  type MutationProposal,
} from "./control-plane-policy.js";
import { calculateFailureCooldown, resolveFailureWindowStartMs } from "./failure-policy.js";
import type { TrackerClient } from "../tracker/tracker.js";

interface TrackerLike extends Pick<TrackerClient, "closeIssue" | "createIssue" | "linkBlockingIssue"> {
  getIssue(id: string, root?: string): Promise<AegisIssue>;
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
  artifactEmissionMode?: "tool" | "json";
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
  janusRecommendation?: "requeue_parent" | "create_integration_blocker";
  nextAction?: "merge_next";
}

function createBaseRecord(issueId: string, now: string): DispatchRecord {
  return {
    issueId,
    stage: "pending",
    runningAgent: null,
    lastCompletedCaste: null,
    blockedByIssueId: null,
    reviewFeedbackRef: null,
    policyArtifactRef: null,
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

function artifactEmissionInstruction(
  toolName: string,
  phase: string,
  mode: RunCasteCommandInput["artifactEmissionMode"],
) {
  if (mode === "json") {
    return `Return the final artifact as the JSON object itself after ${phase}; no ${toolName} tool call is available in this adapter.`;
  }

  return `Call tool '${toolName}' exactly once as final step after ${phase}.`;
}

function buildOraclePrompt(
  issue: AegisIssue,
  emissionMode?: RunCasteCommandInput["artifactEmissionMode"],
) {
  const description = issue.description?.trim() || "No description provided.";
  const blockers = issue.blockers.length > 0 ? issue.blockers.join(", ") : "none";
  const labels = issue.labels.length > 0 ? issue.labels.join(", ") : "none";
  const declaredScope = extractDeclaredFileScope(issue.description ?? "");

  return [
    ...AEGIS_CASTE_SESSION_GUARD,
    `Scout ${issue.id}: ${issue.title}`,
    `Description: ${description}`,
    `Status: ${issue.status}`,
    `Blockers: ${blockers}`,
    `Labels: ${labels}`,
    ...(declaredScope.length > 0
      ? [`Declared file ownership: ${declaredScope.join(", ")}`]
      : []),
    "Produce only scout context: files, risks, suggested checks, and scope notes.",
    ...WINDOWS_TERMINAL_GUARD,
    "Do not decide readiness, do not decompose, and do not propose new issues.",
    artifactEmissionInstruction(ORACLE_EMIT_ASSESSMENT_TOOL_NAME, "analysis is complete", emissionMode),
    "Return only JSON. No markdown fences. No prose before or after JSON.",
    "JSON schema keys: files_affected, estimated_complexity, risks, suggested_checks, scope_notes.",
    "files_affected must be an array of path strings, not objects.",
    "estimated_complexity allowed values: trivial, moderate, complex.",
  ].join("\n");
}

function extractDeclaredFileScope(description: string): string[] {
  const match = description.match(/^Aegis file ownership:\s*(.+)$/im);
  if (!match) {
    return [];
  }

  return match[1]!
    .split(",")
    .map((entry) => normalizeScopeFile(entry))
    .filter((entry) => entry.length > 0);
}

function normalizeScopeFile(candidate: string) {
  return candidate.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

function normalizeFileScope(files: string[]) {
  const normalized = [...new Set(
    files
      .map((entry) => normalizeScopeFile(entry))
      .filter((entry) => entry.length > 0),
  )].sort();

  return normalized.length > 0 ? { files: normalized } : null;
}

const AEGIS_CASTE_SESSION_GUARD = [
  "You are a dispatched Aegis caste subagent running one bounded assignment inside a labor worktree.",
  "If local agent skills or workflow guides mention SUBAGENT-STOP, that applies to this session; skip those skills and follow this Aegis prompt directly.",
  "Do not invoke or read local assistant skills, plugin workflows, or broad development playbooks unless this prompt explicitly asks for them.",
];

const WINDOWS_TERMINAL_GUARD = [
  "Windows command guard: run package-manager commands as npm.cmd, npx.cmd, pnpm.cmd, yarn.cmd, or bun.cmd; never invoke .ps1 scripts directly.",
  "Do not use GUI/open/start/invoke-item/Start-Process for checks. All checks must run in the terminal and return to the shell.",
  "Do not run dev, preview, watch, or server commands such as npm run dev, npm run preview, vite, next dev, vitest --watch, or tsc --watch during caste work. Use finite checks like npm.cmd run build or npm.cmd test.",
  "Guard optional file reads and probes so missing paths do not exit nonzero: use Test-Path before Get-Content, rg --files before reading discovered paths, or handle expected misses explicitly.",
  "PowerShell `rg` no-match exits 1 and fails the adapter. For exploratory searches where no match is acceptable, wrap it as: rg -n \"pattern\" path; if ($LASTEXITCODE -eq 1) { exit 0 }.",
];

function readOracleImplementationContext(root: string, artifactRef: string | null) {
  if (!artifactRef) {
    return null;
  }

  const artifactPath = path.join(root, artifactRef);
  if (!existsSync(artifactPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(artifactPath, "utf8")) as {
      suggested_checks?: unknown;
      scope_notes?: unknown;
    };

    const suggestedChecks = Array.isArray(parsed.suggested_checks)
      ? parsed.suggested_checks.filter((entry): entry is string => typeof entry === "string")
      : [];
    const scopeNotes = Array.isArray(parsed.scope_notes)
      ? parsed.scope_notes.filter((entry): entry is string => typeof entry === "string")
      : [];

    return {
      suggestedChecks,
      scopeNotes,
    };
  } catch {
    return null;
  }
}

function readReviewFeedbackContext(root: string, artifactRef: string | null) {
  if (!artifactRef) {
    return [];
  }

  const artifactPath = path.join(root, artifactRef);
  if (!existsSync(artifactPath)) {
    return [];
  }

  try {
    const parsed = JSON.parse(readFileSync(artifactPath, "utf8")) as Record<string, unknown>;
    const lines: string[] = [];
    const reviewSummary = parsed["reviewSummary"];
    if (typeof reviewSummary === "string" && reviewSummary.trim().length > 0) {
      lines.push(`Review summary: ${reviewSummary.trim()}`);
    }

    const blockingFindings = parsed["blockingFindings"];
    if (Array.isArray(blockingFindings)) {
      for (const finding of blockingFindings) {
        if (typeof finding === "string" && finding.trim().length > 0) {
          lines.push(`Blocking finding: ${finding.trim()}`);
        } else if (typeof finding === "object" && finding !== null && !Array.isArray(finding)) {
          const summary = (finding as Record<string, unknown>)["summary"];
          const kind = (finding as Record<string, unknown>)["finding_kind"];
          const route = (finding as Record<string, unknown>)["route"];
          const requiredFiles = (finding as Record<string, unknown>)["required_files"];
          if (typeof summary === "string" && summary.trim().length > 0) {
            const files = Array.isArray(requiredFiles)
              ? requiredFiles.filter((entry): entry is string => typeof entry === "string")
              : [];
            lines.push([
              `Blocking finding: ${summary.trim()}`,
              ...(typeof kind === "string" ? [`kind=${kind}`] : []),
              ...(typeof route === "string" ? [`route=${route}`] : []),
              ...(files.length ? [`required_files=${files.join(", ")}`] : []),
            ].join(" | "));
          }
        }
      }
    }

    const advisories = parsed["advisories"];
    if (Array.isArray(advisories)) {
      for (const advisory of advisories) {
        if (typeof advisory === "string" && advisory.trim().length > 0) {
          lines.push(`Advisory: ${advisory.trim()}`);
        }
      }
    }

    return lines;
  } catch {
    return [];
  }
}

function readTitanChangedFiles(root: string, artifactRef: string | null | undefined) {
  if (!artifactRef) {
    return [];
  }

  const artifactPath = path.join(root, artifactRef);
  if (!existsSync(artifactPath)) {
    return [];
  }

  try {
    const parsed = JSON.parse(readFileSync(artifactPath, "utf8")) as Record<string, unknown>;
    return Array.isArray(parsed["files_changed"])
      ? parsed["files_changed"]
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => normalizeScopeFile(entry))
      : [];
  } catch {
    return [];
  }
}

function isGateLikeIssue(issue: AegisIssue) {
  const labels = new Set(issue.labels.map((label) => label.toLowerCase()));
  return labels.has("gate") || labels.has("release") || labels.has("integration");
}

function hasScopeIntersection(left: string[], right: string[]) {
  const rightSet = new Set(right.map((entry) => normalizeScopeFile(entry)));
  return left.map((entry) => normalizeScopeFile(entry)).some((entry) => rightSet.has(entry));
}

function isAmbientCrossScopeFinding(input: {
  root: string;
  issue: AegisIssue;
  record: DispatchRecord;
  finding: SentinelFinding;
}) {
  if (input.finding.route !== "create_blocker" || isGateLikeIssue(input.issue)) {
    return false;
  }

  const requiredFiles = input.finding.required_files.map((entry) => normalizeScopeFile(entry));
  if (requiredFiles.length === 0) {
    return false;
  }

  const ownerScope = input.record.fileScope?.files ?? extractDeclaredFileScope(input.issue.description ?? "");
  const changedFiles = readTitanChangedFiles(input.root, input.record.titanHandoffRef);
  return !hasScopeIntersection(requiredFiles, ownerScope)
    && !hasScopeIntersection(requiredFiles, changedFiles);
}

function buildTitanPrompt(
  issue: AegisIssue,
  laborPath: string,
  options?: {
    fileScope?: { files: string[] } | null;
    suggestedChecks?: string[];
    scopeNotes?: string[];
    reviewFeedback?: string[];
    resolvedBlockerIssueId?: string | null;
    artifactEmissionMode?: RunCasteCommandInput["artifactEmissionMode"];
  },
) {
  const description = issue.description?.trim() || "No description provided.";
  const blockers = issue.blockers.length > 0 ? issue.blockers.join(", ") : "none";
  const labels = issue.labels.length > 0 ? issue.labels.join(", ") : "none";
  const fileScope = options?.fileScope?.files.length
    ? options.fileScope.files.join(", ")
    : null;
  const scopeNotes = options?.scopeNotes?.length
    ? options.scopeNotes.map((entry) => `- ${entry}`).join("\n")
    : null;
  const suggestedChecks = options?.suggestedChecks?.length
    ? options.suggestedChecks.map((entry) => `- ${entry}`).join("\n")
    : null;
  const reviewFeedback = options?.reviewFeedback?.length
    ? options.reviewFeedback.map((entry) => `- ${entry}`).join("\n")
    : null;
  const resolvedBlockerIssueId = options?.resolvedBlockerIssueId ?? null;

  return [
    ...AEGIS_CASTE_SESSION_GUARD,
    `Implement issue ${issue.id}.`,
    `Title: ${issue.title}`,
    `Description: ${description}`,
    `Status: ${issue.status}`,
    `Blockers: ${blockers}`,
    `Labels: ${labels}`,
    `Working directory: ${laborPath}`,
    ...(fileScope
      ? [
        `Allowed file scope: ${fileScope}`,
        "Current allowed file scope is authoritative for this issue.",
        "Stay within the allowed file scope. If required work is truly outside that scope, emit a blocking mutation_proposal instead of editing unrelated files.",
      ]
      : []),
    ...(scopeNotes
      ? [
        "Oracle scope notes:",
        scopeNotes,
      ]
      : []),
    ...(suggestedChecks
      ? [
        "Oracle suggested checks:",
        suggestedChecks,
      ]
      : []),
    ...(reviewFeedback
      ? [
        "Prior Sentinel or Janus feedback:",
        reviewFeedback,
        "Resolve this feedback before returning success or already_satisfied.",
        "If resolving this feedback requires files outside the allowed file scope, emit a blocking mutation_proposal instead of repeating the same handoff.",
      ]
      : []),
    ...(resolvedBlockerIssueId
      ? [
        `Previously blocked by child issue ${resolvedBlockerIssueId}. Tracker now reports this parent ready, so the child is closed.`,
        "Do not create another blocker for the same out-of-scope need; inspect the current workspace and continue remaining owned-scope work. If the issue contract is already satisfied, return already_satisfied.",
      ]
      : []),
    ...(isPolicyCreatedBlockerDescription(description)
      ? [
        "Policy-created blocker issue: this issue exists to resolve a previously accepted blocking mutation proposal.",
        "Do not resolve this blocker with already_satisfied. Make the required in-scope change and return success, or return failure with evidence if the blocker cannot be resolved.",
        "Do not create another blocker from this issue; policy-created blockers must terminate with success or failure.",
      ]
      : []),
    "Preserve existing Aegis/Beads operational files and ignore rules. Do not modify .aegis/, .beads/, or remove their existing .gitignore coverage.",
    ...WINDOWS_TERMINAL_GUARD,
    "Do not run long-running dev, preview, watcher, or server commands. They block the adapter session and will be treated as an operational failure.",
    "Stage and commit all intended changes in the labor worktree before you call the final artifact tool so the candidate branch head advances.",
    "Use git add/git commit explicitly when you make required implementation changes.",
    "Do not leave required implementation changes uncommitted.",
    "If the issue contract is already satisfied by prior merged work, make no edits and emit outcome 'already_satisfied' with files_changed=[] and the checks you ran.",
    "Report files_changed as paths relative to the working directory, never as absolute paths.",
    artifactEmissionInstruction(TITAN_EMIT_ARTIFACT_TOOL_NAME, "all file edits and checks complete", options?.artifactEmissionMode),
    "If required project files do not exist, create minimal versions that satisfy the issue contract.",
    "Treat ordinary naming/tooling ambiguity as solvable: choose reasonable defaults and proceed.",
    "Use mutation_proposal only for hard blocking missing work: clarification, prerequisite, or required out-of-scope dependency.",
    "Do not create non-blocking follow-up work.",
    "Return only JSON. No markdown fences. No prose before or after JSON.",
    "JSON schema keys: outcome, summary, files_changed, tests_and_checks_run, known_risks, follow_up_work, optional mutation_proposal.",
    "Allowed outcome values: success, already_satisfied, clarification, failure.",
    "mutation_proposal keys: proposal_type, summary, suggested_title, suggested_description, scope_evidence.",
    "Allowed mutation_proposal.proposal_type values: create_clarification_blocker, create_prerequisite_blocker, create_out_of_scope_blocker.",
  ].join("\n");
}

function buildSentinelPrompt(
  issue: AegisIssue,
  emissionMode?: RunCasteCommandInput["artifactEmissionMode"],
) {
  const description = issue.description?.trim() || "No description provided.";
  return [
    ...AEGIS_CASTE_SESSION_GUARD,
    `Pre-merge review issue ${issue.id}.`,
    `Title: ${issue.title}`,
    `Description: ${description}`,
    "Return binary control verdict pass or fail_blocking.",
    ...WINDOWS_TERMINAL_GUARD,
    "Blocking findings must only cover original issue contract, regressions in touched scope, or required out-of-scope blockers.",
    "blockingFindings must be typed objects with fields: finding_kind, summary, required_files, owner_issue, route.",
    "Allowed finding_kind: contract_gap, regression, out_of_scope_blocker, integration_blocker.",
    "Use route=rework_owner for in-scope parent rework. Use route=create_blocker only when required files are outside the owner issue scope.",
    "Sentinel does not create issues. Aegis router handles create_blocker findings deterministically after the verdict.",
    "Advisories are logged only and must not create issues.",
    artifactEmissionInstruction(SENTINEL_EMIT_VERDICT_TOOL_NAME, "review is complete", emissionMode),
    "Return only JSON. No markdown fences. No prose before or after JSON.",
    "JSON schema keys: verdict, reviewSummary, blockingFindings, advisories, touchedFiles, contractChecks.",
    "touchedFiles and contractChecks must be arrays of strings. blockingFindings must be an array of typed objects, not strings.",
  ].join("\n");
}

function offsetTimestamp(baseTimestamp: string, offsetMilliseconds: number) {
  const baseTime = Date.parse(baseTimestamp);
  if (!Number.isFinite(baseTime)) {
    return new Date().toISOString();
  }

  return new Date(baseTime + offsetMilliseconds).toISOString();
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

function buildTitanPolicyProposal(
  issueId: string,
  artifact: ReturnType<typeof parseTitanArtifact>,
): MutationProposal {
  const proposal = artifact.mutation_proposal;
  const summary = proposal?.summary ?? artifact.blocking_question ?? artifact.summary;
  return {
    originIssueId: issueId,
    originCaste: "titan",
    proposalType: proposal?.proposal_type ?? "create_clarification_blocker",
    blocking: true,
    summary,
    suggestedTitle: proposal?.suggested_title,
    suggestedDescription: proposal?.suggested_description,
    dependencyType: "blocks",
    scopeEvidence: proposal?.scope_evidence ?? [],
    fingerprint: buildFindingFingerprint(issueId, `${proposal?.proposal_type ?? "clarification"}:${summary}`),
  };
}

function buildJanusPolicyProposal(
  issueId: string,
  artifact: ReturnType<typeof parseJanusResolutionArtifact>,
): MutationProposal {
  const proposal = artifact.mutation_proposal;
  return {
    originIssueId: issueId,
    originCaste: "janus",
    proposalType: proposal.proposal_type,
    blocking: proposal.proposal_type !== "requeue_parent",
    summary: proposal.summary,
    suggestedTitle: proposal.suggested_title,
    suggestedDescription: proposal.suggested_description,
    dependencyType: "blocks",
    scopeEvidence: proposal.scope_evidence,
    fingerprint: buildFindingFingerprint(issueId, `${proposal.proposal_type}:${proposal.summary}`),
  };
}

function buildSentinelRouterPolicyProposal(
  issueId: string,
  finding: SentinelFinding,
): MutationProposal {
  const proposalType = finding.finding_kind === "integration_blocker"
    ? "create_integration_blocker"
    : "create_out_of_scope_blocker";
  const requiredFiles = finding.required_files.length > 0
    ? finding.required_files.join(", ")
    : "not specified";
  return {
    originIssueId: issueId,
    originCaste: "router",
    proposalType,
    blocking: true,
    summary: finding.summary,
    suggestedTitle: `Resolve Sentinel out-of-scope blocker for ${issueId}`,
    suggestedDescription: [
      `Sentinel found blocking work outside owner issue ${finding.owner_issue}.`,
      `Finding kind: ${finding.finding_kind}.`,
      `Required files: ${requiredFiles}.`,
      "",
      finding.summary,
    ].join("\n"),
    dependencyType: "blocks",
    scopeEvidence: [
      `Sentinel route=${finding.route}`,
      `Sentinel finding_kind=${finding.finding_kind}`,
      `Owner issue=${finding.owner_issue}`,
      `Required files=${requiredFiles}`,
      finding.summary,
    ],
    fingerprint: buildFindingFingerprint(
      issueId,
      `${finding.route}:${finding.finding_kind}:${finding.summary}:${finding.required_files.join(",")}`,
    ),
  };
}

function buildJanusPrompt(
  issue: AegisIssue,
  janusContext?: JanusConflictContext,
  emissionMode?: RunCasteCommandInput["artifactEmissionMode"],
) {
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
    ...AEGIS_CASTE_SESSION_GUARD,
    `Process integration conflict for issue ${issue.id}.`,
    `Title: ${issue.title}`,
    `Description: ${description}`,
    ...contextLines,
    ...WINDOWS_TERMINAL_GUARD,
    artifactEmissionInstruction(JANUS_EMIT_RESOLUTION_TOOL_NAME, "conflict analysis is complete", emissionMode),
    "Return only JSON. No markdown fences. No prose before or after JSON.",
    "JSON schema keys: originatingIssueId, queueItemId, preservedLaborPath, conflictSummary, resolutionStrategy, filesTouched, validationsRun, residualRisks, recommendedNextAction.",
  ].join("\n");
}

function clearDownstreamArtifactRefs(record: DispatchRecord) {
  return {
    ...record,
    runningAgent: null,
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

function toOperationalFailureRecord(record: DispatchRecord, timestamp: string): DispatchRecord {
  return {
    ...record,
    stage: "failed_operational",
    runningAgent: null,
    failureCount: record.failureCount + 1,
    consecutiveFailures: record.consecutiveFailures + 1,
    failureWindowStartMs: record.failureWindowStartMs ?? resolveFailureWindowStartMs(timestamp),
    cooldownUntil: calculateFailureCooldown(timestamp),
    updatedAt: timestamp,
  };
}

function resolveCandidateWorkingDirectory(root: string, laborPath: string) {
  return path.isAbsolute(laborPath)
    ? laborPath
    : path.join(path.resolve(root), laborPath);
}

function validateTitanSessionOutcome(input: {
  issueId: string;
  issueDescription: string;
  artifact: ReturnType<typeof parseTitanArtifact>;
  candidateBranch: string;
  fileScope: { files: string[] } | null;
  candidateWorkingDirectory: string;
  candidateProofPair: { before: ReturnType<typeof captureGitProofPair>["before"]; after: ReturnType<typeof captureGitProofPair>["after"] };
  rootProofPair: { before: ReturnType<typeof captureGitProofPair>["before"]; after: ReturnType<typeof captureGitProofPair>["after"] };
  adoptedRootCommit: boolean;
}) {
  const rootDrift = summarizeOperationalStatusDrift(input.rootProofPair);
  if (rootDrift) {
    return `Titan implementation for ${input.issueId} dirtied the project root outside .aegis: ${rootDrift}.`;
  }

  if (
    input.rootProofPair.before?.headCommit
    && input.rootProofPair.after?.headCommit
    && input.rootProofPair.before.headCommit !== input.rootProofPair.after.headCommit
    && !input.adoptedRootCommit
  ) {
    return `Titan implementation for ${input.issueId} changed the project root HEAD from ${input.rootProofPair.before.headCommit} to ${input.rootProofPair.after.headCommit}.`;
  }

  const normalizedArtifactFiles = normalizeTitanArtifactChangedFiles(
    input.issueId,
    input.artifact.files_changed,
    input.candidateWorkingDirectory,
  );
  const committedFiles = resolveCommittedChangedFiles(
    input.candidateWorkingDirectory,
    input.candidateProofPair,
  ).map((entry) => normalizeScopeFile(entry));
  const scopeError = validateTitanChangedFilesScope(
    input.issueId,
    input.fileScope,
    [...normalizedArtifactFiles, ...committedFiles],
  );
  if (scopeError) {
    return scopeError;
  }

  const hasDurableGitProof = input.candidateProofPair.before !== null && input.candidateProofPair.after !== null;
  if (
    input.artifact.outcome === "success"
    && hasDurableGitProof
    && !hasAdvancedGitHead(input.candidateProofPair, input.candidateBranch)
  ) {
    return `Titan implementation for ${input.issueId} did not advance candidate branch ${input.candidateBranch}.`;
  }

  if (input.artifact.outcome === "already_satisfied") {
    if (input.artifact.files_changed.length > 0) {
      return `Titan already_satisfied handoff for ${input.issueId} must not report changed files.`;
    }

    if (input.artifact.tests_and_checks_run.length === 0) {
      return `Titan already_satisfied handoff for ${input.issueId} must include verification checks.`;
    }

    if (isPolicyCreatedBlockerDescription(input.issueDescription)) {
      return `Titan policy-created blocker ${input.issueId} must resolve with success or failure, not already_satisfied.`;
    }
  }

  if (
    input.artifact.mutation_proposal
    && isPolicyCreatedBlockerDescription(input.issueDescription)
  ) {
    return `Titan policy-created blocker ${input.issueId} must resolve with success or failure, not another blocker.`;
  }

  if (
    input.artifact.outcome === "success"
    && committedFiles.length > 0
    && normalizedArtifactFiles.join("\n") !== committedFiles.join("\n")
  ) {
    return `Titan artifact files_changed for ${input.issueId} must match committed git proof.`;
  }

  return null;
}

function isPolicyCreatedBlockerDescription(description: string) {
  return description.includes("Policy proposal:")
    && description.includes("Fingerprint:")
    && description.includes("Scope evidence:");
}

function hasChangedHead(proofPair: {
  before: ReturnType<typeof captureGitProofPair>["before"];
  after: ReturnType<typeof captureGitProofPair>["after"];
}) {
  return Boolean(
    proofPair.before?.headCommit
    && proofPair.after?.headCommit
    && proofPair.before.headCommit !== proofPair.after.headCommit,
  );
}

function arraysEqual(left: string[], right: string[]) {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function resolveRootCommitAdoption(input: {
  issueId: string;
  root: string;
  artifact: ReturnType<typeof parseTitanArtifact>;
  fileScope: { files: string[] } | null;
  rootProofPair: { before: ReturnType<typeof captureGitProofPair>["before"]; after: ReturnType<typeof captureGitProofPair>["after"] };
}) {
  if (input.artifact.outcome !== "success" || !hasChangedHead(input.rootProofPair)) {
    return null;
  }

  if (summarizeOperationalStatusDrift(input.rootProofPair)) {
    return null;
  }

  const rootCommittedFiles = resolveCommittedChangedFiles(
    input.root,
    input.rootProofPair,
  ).map((entry) => normalizeScopeFile(entry));
  if (rootCommittedFiles.length === 0) {
    return null;
  }

  const artifactFiles = normalizeTitanArtifactChangedFiles(
    input.issueId,
    input.artifact.files_changed,
    input.root,
  );
  if (!arraysEqual(artifactFiles, rootCommittedFiles)) {
    return null;
  }

  if (validateTitanChangedFilesScope(input.issueId, input.fileScope, rootCommittedFiles)) {
    return null;
  }

  const candidateBranch = input.rootProofPair.after?.branch;
  const baseBranch = input.rootProofPair.before?.branch;
  if (!candidateBranch || !baseBranch) {
    return null;
  }

  return {
    candidateBranch,
    baseBranch,
  };
}

function isPathInside(basePath: string, candidatePath: string) {
  const relativePath = path.relative(basePath, candidatePath);
  return relativePath.length > 0
    && !relativePath.startsWith("..")
    && !path.isAbsolute(relativePath);
}

function normalizeAbsoluteTitanFilePath(
  issueId: string,
  candidate: string,
  laborWorkingDirectory: string,
) {
  const normalizedLabor = path.resolve(laborWorkingDirectory);
  const normalizedCandidate = path.resolve(candidate);

  if (!isPathInside(normalizedLabor, normalizedCandidate)) {
    throw new Error(`Titan artifact for ${issueId} contains invalid files_changed path: ${candidate}`);
  }

  return normalizeScopeFile(path.relative(normalizedLabor, normalizedCandidate));
}

function normalizeTitanArtifactChangedFiles(
  issueId: string,
  filesChanged: string[],
  laborWorkingDirectory: string,
) {
  return filesChanged.map((entry) => {
    const trimmed = entry.trim();
    if (
      trimmed.length === 0
      || /\[[^\]]+\]\([^)]+\)/.test(trimmed)
    ) {
      throw new Error(`Titan artifact for ${issueId} contains invalid files_changed path: ${entry}`);
    }

    if (path.isAbsolute(trimmed)) {
      return normalizeAbsoluteTitanFilePath(issueId, trimmed, laborWorkingDirectory);
    }

    if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
      throw new Error(`Titan artifact for ${issueId} contains invalid files_changed path: ${entry}`);
    }

    const normalized = normalizeScopeFile(trimmed);
    if (
      normalized.length === 0
      || normalized.startsWith("../")
      || normalized === ".."
      || path.isAbsolute(normalized)
      || /^[a-zA-Z]:\//.test(normalized)
    ) {
      throw new Error(`Titan artifact for ${issueId} contains invalid files_changed path: ${entry}`);
    }

    return normalized;
  }).sort();
}

function validateTitanChangedFilesScope(
  issueId: string,
  fileScope: { files: string[] } | null,
  changedFiles: string[],
) {
  if (!fileScope) {
    return null;
  }

  const allowed = new Set(fileScope.files.map((entry) => normalizeScopeFile(entry)));
  const outOfScope = [...new Set(changedFiles)]
    .filter((entry) => entry.length > 0 && !allowed.has(entry))
    .sort();

  if (outOfScope.length > 0) {
    return `Titan implementation for ${issueId} changed files outside allowed scope: ${outOfScope.join(", ")}.`;
  }

  return null;
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

function synthesizeTitanArtifactFromCommittedWork(input: {
  issueId: string;
  session: CasteSessionResult;
  workingDirectory: string;
  proofPair: ReturnType<typeof completeGitProofPair>;
}): ReturnType<typeof parseTitanArtifact> | null {
  if (!hasAdvancedGitHead(input.proofPair)) {
    return null;
  }

  const filesChanged = resolveCommittedChangedFiles(input.workingDirectory, input.proofPair);
  if (filesChanged.length === 0) {
    return null;
  }

  const sessionDetail = input.session.error?.trim().length
    ? input.session.error
    : `Runtime returned status=${input.session.status}.`;

  return {
    outcome: "success",
    summary: `Recovered committed Titan work for ${input.issueId} after the session ended before artifact emission.`,
    files_changed: filesChanged,
    tests_and_checks_run: [
      "Recovered from committed git proof; Titan did not report explicit checks.",
    ],
    known_risks: [
      `Titan session did not emit the final artifact: ${sessionDetail}`,
      "Recovered commit still requires Sentinel review before merge.",
    ],
    follow_up_work: [],
  };
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
    prompt: buildOraclePrompt(issue, input.artifactEmissionMode),
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
    fileScope: normalizeFileScope(extractDeclaredFileScope(issue.description ?? ""))
      ?? normalizeFileScope(assessment.files_affected),
    oracleReady: null,
    oracleDecompose: null,
    oracleBlockers: null,
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
  if (record.stage !== "implementing") {
    assertTitanDispatchEligibility(record);
  } else if (!record.oracleAssessmentRef) {
    throw new Error(`Issue ${record.issueId} requires an Oracle assessment artifact.`);
  }

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
    refreshExisting: record.stage === "scouted"
      && record.titanHandoffRef === null
      && record.reviewFeedbackRef === null
      && record.failureCount > 0,
  });

  if (input.ensureLabor) {
    input.ensureLabor(labor);
  } else {
    prepareLaborWorktree(labor);
  }

  const oracleContext = readOracleImplementationContext(input.root, record.oracleAssessmentRef);
  const reviewFeedback = readReviewFeedbackContext(input.root, record.reviewFeedbackRef ?? null);
  const runInput = {
    caste: "titan",
    issueId: issue.id,
    root: input.root,
    workingDirectory: labor.laborPath,
    prompt: buildTitanPrompt(issue, labor.laborPath, {
      fileScope: record.fileScope,
      suggestedChecks: oracleContext?.suggestedChecks,
      scopeNotes: oracleContext?.scopeNotes,
      reviewFeedback,
      resolvedBlockerIssueId: record.blockedByIssueId ?? null,
      artifactEmissionMode: input.artifactEmissionMode,
    }),
  } satisfies CasteRunInput;
  const gitProofPair = captureGitProofPair(labor.laborPath);
  const rootGitProofPair = captureGitProofPair(input.root);
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
    let artifact: ReturnType<typeof parseTitanArtifact> | null = null;
    let parseError: unknown = null;
    if (session.status === "succeeded") {
      try {
        artifact = parseTitanArtifact(session.outputText);
      } catch (error) {
        parseError = error;
      }
    }

    return {
      runInput: candidateInput,
      session,
      transcriptRef,
      artifact,
      parseError,
    };
  };

  const finalAttempt = await runTitanSession(runInput);

  const completedGitProof = completeGitProofPair(labor.laborPath, gitProofPair);
  const completedRootGitProof = completeGitProofPair(input.root, rootGitProofPair);
  const recoveredArtifact = finalAttempt.artifact
    ?? synthesizeTitanArtifactFromCommittedWork({
      issueId: issue.id,
      session: finalAttempt.session,
      workingDirectory: labor.laborPath,
      proofPair: completedGitProof,
    });
  if (!recoveredArtifact) {
    if (finalAttempt.session.status !== "succeeded") {
      assertSuccessfulSession(finalAttempt.runInput, finalAttempt.session);
    }
    if (finalAttempt.parseError) {
      throw finalAttempt.parseError;
    }
    throw new Error(`Titan session for ${issue.id} did not produce a usable artifact.`);
  }
  const baseArtifact = recoveredArtifact;
  const rootAdoption = resolveRootCommitAdoption({
    issueId: issue.id,
    root: input.root,
    artifact: baseArtifact,
    fileScope: record.fileScope,
    rootProofPair: completedRootGitProof,
  });
  const candidateWorkingDirectory = rootAdoption ? input.root : labor.laborPath;
  const candidateProofPair = rootAdoption ? completedRootGitProof : completedGitProof;
  const candidateBranch = rootAdoption?.candidateBranch ?? labor.branchName;
  const candidateBaseBranch = rootAdoption?.baseBranch ?? labor.baseBranch;
  const artifact = {
    ...baseArtifact,
    files_changed: normalizeTitanArtifactChangedFiles(
      issue.id,
      baseArtifact.files_changed,
      candidateWorkingDirectory,
    ),
  };
  const gitProofRefs = persistGitProofArtifacts(
    input.root,
    "titan",
    issue.id,
    candidateWorkingDirectory,
    candidateProofPair,
  );
  const artifactRef = persistArtifact(input.root, {
    family: "titan",
    issueId: issue.id,
    artifact: {
      ...artifact,
      labor_path: candidateWorkingDirectory,
      candidate_branch: candidateBranch,
      base_branch: candidateBaseBranch,
      ...(rootAdoption
        ? {
          adoption: {
            mode: "root_commit",
            original_labor_path: labor.laborPath,
          },
        }
        : {}),
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
  const validationError = validateTitanSessionOutcome({
    issueId: issue.id,
    issueDescription: issue.description ?? "",
    artifact,
    candidateBranch,
    fileScope: record.fileScope,
    candidateWorkingDirectory,
    candidateProofPair,
    rootProofPair: completedRootGitProof,
    adoptedRootCommit: rootAdoption !== null,
  });
  if (validationError) {
    throw new Error(validationError);
  }
  if (artifact.mutation_proposal) {
    if (record.blockedByIssueId) {
      const failureReason = `Titan for ${issue.id} proposed another blocker after resolved child ${record.blockedByIssueId}; failing closed to avoid blocker amplification.`;
      const failureRecord = toOperationalFailureRecord(record, now);
      saveRecord(input.root, issue.id, {
        ...failureRecord,
        titanClarificationRef: artifactRef,
        failureTranscriptRef: finalAttempt.transcriptRef,
      });
      throw new Error(failureReason);
    }

    const policyResult = await applyMutationProposal({
      root: input.root,
      tracker: input.tracker,
      record,
      proposal: buildTitanPolicyProposal(issue.id, artifact),
      now,
    });
    if (
      policyResult.outcome === "rejected"
      && policyResult.rejectionReason === "blocker_chain_not_allowed"
    ) {
      saveRecord(input.root, issue.id, {
        ...clearDownstreamArtifactRefs(record),
        stage: "scouted",
        oracleAssessmentRef: record.oracleAssessmentRef,
        reviewFeedbackRef: null,
        blockedByIssueId: null,
        policyArtifactRef: policyResult.policyArtifactRef,
        titanHandoffRef: null,
        titanClarificationRef: null,
        sentinelVerdictRef: null,
        janusArtifactRef: null,
        cooldownUntil: null,
        updatedAt: now,
      });

      return {
        action: input.action,
        issueId: issue.id,
        stage: "scouted",
        artifactRefs: [artifactRef, policyResult.policyArtifactRef, ...transcriptRefs],
      };
    }

    saveRecord(input.root, issue.id, {
      ...clearDownstreamArtifactRefs(record),
      stage: policyResult.parentStage,
      oracleAssessmentRef: record.oracleAssessmentRef,
      titanClarificationRef: artifactRef,
      blockedByIssueId: policyResult.childIssueId,
      policyArtifactRef: policyResult.policyArtifactRef,
      updatedAt: now,
    });

    return {
      action: input.action,
      issueId: issue.id,
      stage: policyResult.parentStage,
      artifactRefs: [artifactRef, policyResult.policyArtifactRef, ...transcriptRefs],
    };
  }

  const implementationSucceeded = artifact.outcome === "success"
    || artifact.outcome === "already_satisfied";
  saveRecord(input.root, issue.id, {
    ...clearDownstreamArtifactRefs(record),
    stage: implementationSucceeded ? "implemented" : "failed_operational",
    blockedByIssueId: null,
    oracleAssessmentRef: record.oracleAssessmentRef,
    titanHandoffRef: implementationSucceeded ? artifactRef : null,
    titanClarificationRef: artifact.outcome === "clarification" ? artifactRef : null,
    updatedAt: now,
  });

  return {
    action: input.action,
    issueId: issue.id,
    stage: implementationSucceeded ? "implemented" : "failed_operational",
    artifactRefs: [artifactRef, ...transcriptRefs],
  };
}

async function runReview(
  input: RunCasteCommandInput,
  issue: AegisIssue,
  record: DispatchRecord,
  now: string,
): Promise<CasteCommandResult> {
  if (record.stage !== "implemented" && record.stage !== "reviewing") {
    throw new Error("Review requires an implemented issue.");
  }

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
    workingDirectory: resolveCandidateWorkingDirectory(
      input.root,
      readTitanMergeCandidate(input.root, record.titanHandoffRef!).labor_path,
    ),
    prompt: buildSentinelPrompt(issue, input.artifactEmissionMode),
  } satisfies CasteRunInput;
  const session = await input.runtime.run(runInput);
  const transcriptRef = persistSessionArtifact(input.root, input.action, runInput, session);
  assertSuccessfulSession(runInput, session);
  const verdict = parseSentinelVerdict(session.outputText);
  const ambientFindings = verdict.blockingFindings.filter((finding) => isAmbientCrossScopeFinding({
    root: input.root,
    issue,
    record,
    finding,
  }));
  const effectiveBlockingFindings = verdict.blockingFindings.filter((finding) => !ambientFindings.includes(finding));
  const effectiveVerdict = verdict.verdict === "pass" || effectiveBlockingFindings.length === 0
    ? "pass"
    : "fail_blocking";
  const effectiveAdvisories = [
    ...verdict.advisories,
    ...ambientFindings.map((finding) =>
      `Ambient cross-scope finding ignored by deterministic router: ${finding.summary}`),
  ];

  if (verdict.blockingFindings.length > 0) {
    writePhaseLog(input.root, {
      timestamp: offsetTimestamp(now, 10),
      phase: "dispatch",
      issueId: issue.id,
      action: "sentinel_blocking_findings",
      outcome: "found",
      detail: JSON.stringify({
        count: verdict.blockingFindings.length,
        effectiveCount: effectiveBlockingFindings.length,
        ambientIgnoredCount: ambientFindings.length,
      }),
    });
  }
  const reviewStage = effectiveVerdict === "pass" ? "queued_for_merge" : "rework_required";
  const artifactRef = persistArtifact(input.root, {
    family: "sentinel",
    issueId: issue.id,
    artifact: {
      ...verdict,
      verdict: effectiveVerdict,
      blockingFindings: effectiveBlockingFindings,
      advisories: effectiveAdvisories,
      ignoredBlockingFindings: ambientFindings,
      session: createSessionMetadata(transcriptRef, runInput, session),
    },
  });
  const blockerFinding = effectiveBlockingFindings.find((finding) => finding.route === "create_blocker");
  if (blockerFinding) {
    const config = loadConfig(input.root);
    if (!config.thresholds.allow_complex_auto_dispatch) {
      saveRecord(input.root, issue.id, {
        ...clearDownstreamArtifactRefs(record),
        stage: "rework_required",
        oracleAssessmentRef: record.oracleAssessmentRef,
        titanHandoffRef: record.titanHandoffRef ?? null,
        titanClarificationRef: record.titanClarificationRef ?? null,
        sentinelVerdictRef: artifactRef,
        reviewFeedbackRef: artifactRef,
        blockedByIssueId: null,
        policyArtifactRef: null,
        updatedAt: now,
      });
      writePhaseLog(input.root, {
        timestamp: offsetTimestamp(now, 50),
        phase: "dispatch",
        issueId: issue.id,
        action: "sentinel_review_completed",
        outcome: "rework_required",
        sessionId: session.sessionId,
        detail: JSON.stringify({
          blockingFindingCount: verdict.blockingFindings.length,
          effectiveBlockingFindingCount: effectiveBlockingFindings.length,
          ambientIgnoredCount: ambientFindings.length,
          routedFindingKind: blockerFinding.finding_kind,
          routedFindingRoute: "rework_owner",
          originalFindingRoute: blockerFinding.route,
          routeOverride: "complex_auto_dispatch_disabled",
          advisoryCount: effectiveAdvisories.length,
        }),
      });

      return {
        action: input.action,
        issueId: issue.id,
        stage: "rework_required",
        artifactRefs: [artifactRef, transcriptRef],
      };
    }

    const policyResult = await applyMutationProposal({
      root: input.root,
      tracker: input.tracker,
      record,
      proposal: buildSentinelRouterPolicyProposal(issue.id, blockerFinding),
      now,
    });

    saveRecord(input.root, issue.id, {
      ...clearDownstreamArtifactRefs(record),
      stage: policyResult.parentStage,
      oracleAssessmentRef: record.oracleAssessmentRef,
      titanHandoffRef: record.titanHandoffRef ?? null,
      titanClarificationRef: record.titanClarificationRef ?? null,
      sentinelVerdictRef: artifactRef,
      reviewFeedbackRef: artifactRef,
      blockedByIssueId: policyResult.childIssueId,
      policyArtifactRef: policyResult.policyArtifactRef,
      updatedAt: now,
    });
    writePhaseLog(input.root, {
      timestamp: offsetTimestamp(now, 50),
      phase: "dispatch",
      issueId: issue.id,
      action: "sentinel_review_completed",
      outcome: policyResult.parentStage,
      sessionId: session.sessionId,
      detail: JSON.stringify({
        blockingFindingCount: verdict.blockingFindings.length,
        effectiveBlockingFindingCount: effectiveBlockingFindings.length,
        ambientIgnoredCount: ambientFindings.length,
        routedFindingKind: blockerFinding.finding_kind,
        routedFindingRoute: blockerFinding.route,
        advisoryCount: effectiveAdvisories.length,
      }),
    });

    return {
      action: input.action,
      issueId: issue.id,
      stage: policyResult.parentStage,
      artifactRefs: [artifactRef, policyResult.policyArtifactRef, transcriptRef],
    };
  }

  saveRecord(input.root, issue.id, {
    ...clearDownstreamArtifactRefs(record),
    stage: reviewStage,
    oracleAssessmentRef: record.oracleAssessmentRef,
    titanHandoffRef: record.titanHandoffRef ?? null,
    titanClarificationRef: record.titanClarificationRef ?? null,
    sentinelVerdictRef: artifactRef,
    reviewFeedbackRef: artifactRef,
    updatedAt: now,
  });
  writePhaseLog(input.root, {
    timestamp: offsetTimestamp(now, 50),
    phase: "dispatch",
    issueId: issue.id,
    action: "sentinel_review_completed",
    outcome: reviewStage,
    sessionId: session.sessionId,
    detail: JSON.stringify({
      blockingFindingCount: verdict.blockingFindings.length,
      effectiveBlockingFindingCount: effectiveBlockingFindings.length,
      ambientIgnoredCount: ambientFindings.length,
      advisoryCount: effectiveAdvisories.length,
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
    prompt: buildJanusPrompt(issue, input.janusContext, input.artifactEmissionMode),
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
  const policyResult = await applyMutationProposal({
    root: input.root,
    tracker: input.tracker,
    record,
    proposal: buildJanusPolicyProposal(issue.id, artifact),
    now,
  });
  saveRecord(input.root, issue.id, {
    ...clearDownstreamArtifactRefs(record),
    stage: policyResult.parentStage,
    oracleAssessmentRef: record.oracleAssessmentRef,
    titanHandoffRef: record.titanHandoffRef ?? null,
    titanClarificationRef: record.titanClarificationRef ?? null,
    sentinelVerdictRef: record.sentinelVerdictRef,
    janusArtifactRef: artifactRef,
    reviewFeedbackRef: artifactRef,
    blockedByIssueId: policyResult.childIssueId,
    policyArtifactRef: policyResult.policyArtifactRef,
    updatedAt: now,
  });
  writePhaseLog(input.root, {
    timestamp: offsetTimestamp(now, 10),
    phase: "dispatch",
    issueId: issue.id,
    action: "janus_resolution_completed",
    outcome: policyResult.parentStage,
    sessionId: session.sessionId,
    detail: JSON.stringify({
      queueItemId: artifact.queueItemId,
      conflictSummary: artifact.conflictSummary,
      resolutionStrategy: artifact.resolutionStrategy,
      mutationProposal: artifact.mutation_proposal.proposal_type,
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
    stage: policyResult.parentStage,
    janusRecommendation: artifact.mutation_proposal.proposal_type,
    artifactRefs: [artifactRef, policyResult.policyArtifactRef, transcriptRef],
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
    return runReview(input, issue, record, now);
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

  if (input.action === "process" && record.stage === "complete") {
    assertDispatchRecordStage(record, "complete");
    return {
      action: "process",
      issueId: input.issueId,
      stage: "complete",
    };
  }

  if (input.action === "review") {
    return runReview(input, issue, record, now);
  }

  if (
    input.action === "implement"
    || (input.action === "process" && (record.stage === "scouted" || record.stage === "rework_required"))
  ) {
    return runImplement({ ...input, action: input.action }, issue, record, now);
  }

  return runScout({ ...input, action: input.action }, issue, record, now);
}
