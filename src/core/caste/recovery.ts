import { existsSync } from "node:fs";
import path from "node:path";

import type { OracleAssessment } from "../../castes/oracle/oracle-parser.js";
import type { SentinelVerdict } from "../../castes/sentinel/sentinel-parser.js";
import type { TitanArtifact } from "../../castes/titan/titan-parser.js";
import { extractDeclaredFileScope } from "../../castes/scope-markers.js";
import type { CasteSessionResult } from "../../runtime/caste-runtime.js";
import type { AegisIssue } from "../../tracker/issue-model.js";
import { normalizeFileScope, normalizeScopeFile } from "../../shared/file-scope.js";
import { listDirtyFiles, runGit } from "../../shared/git.js";
import type { DispatchRecord } from "../dispatch-state.js";
import {
  completeGitProofPair,
  hasAdvancedGitHead,
  resolveCommittedChangedFiles,
} from "../git-proof.js";

/**
 * Deterministic recovery when a live session ends without a valid artifact.
 *
 * Recovery never trusts prose alone: Titan work is recovered only from
 * committed or in-scope dirty git state, and every recovered artifact still
 * goes through Titan validation and Sentinel review.
 */

type GitProofPair = ReturnType<typeof completeGitProofPair>;

export function synthesizeTitanArtifactFromCommittedWork(input: {
  issueId: string;
  session: CasteSessionResult;
  workingDirectory: string;
  proofPair: GitProofPair;
}): TitanArtifact | null {
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

function isMissingSentinelVerdictFailure(session: CasteSessionResult) {
  const haystack = [
    session.error,
    session.outputText,
  ].filter((entry): entry is string => typeof entry === "string").join("\n").toLowerCase();

  return session.status === "failed"
    && haystack.includes("emit_sentinel_verdict")
    && haystack.includes("missing");
}

function isMissingOracleAssessmentFailure(session: CasteSessionResult) {
  const haystack = [
    session.error,
    session.outputText,
  ].filter((entry): entry is string => typeof entry === "string").join("\n").toLowerCase();

  return session.status === "failed"
    && haystack.includes("emit_oracle_assessment")
    && haystack.includes("missing");
}

function truncateDiagnosticSummary(input: string) {
  const compact = input
    .replace(/\s+/g, " ")
    .trim();
  return compact.length > 500 ? `${compact.slice(0, 497)}...` : compact;
}

function extractAssistantDiagnosticText(session: CasteSessionResult) {
  const messageLog = session.messageLog ?? [];
  return messageLog
    .filter((message) => message.role === "assistant")
    .map((message) => message.content)
    .filter((content) => !content.toLowerCase().includes("tool contract repair required"))
    .join("\n")
    .trim();
}

export function synthesizeOracleAssessmentFromDiagnostic(input: {
  issue: AegisIssue;
  session: CasteSessionResult;
}): OracleAssessment | null {
  if (!isMissingOracleAssessmentFailure(input.session)) {
    return null;
  }

  const scopedFiles = normalizeFileScope(input.issue.fileScope ?? [])
    ?? normalizeFileScope(extractDeclaredFileScope(input.issue.description));
  const files = scopedFiles?.files ?? [];
  if (files.length === 0) {
    return null;
  }

  const diagnostic = extractAssistantDiagnosticText(input.session);
  return {
    files_affected: files,
    estimated_complexity: "moderate",
    risks: [
      "Recovered Oracle scout context after missing emit_oracle_assessment.",
    ],
    suggested_checks: [
      "npm.cmd run build",
      "npm.cmd test",
      "npm.cmd run lint",
    ],
    scope_notes: [
      `Declared file ownership is authoritative: ${files.join(", ")}.`,
      ...(diagnostic
        ? [`Recovered Oracle diagnostic: ${truncateDiagnosticSummary(diagnostic)}`]
        : []),
    ],
  };
}

export function synthesizeSentinelVerdictFromDiagnostic(input: {
  issue: AegisIssue;
  record: DispatchRecord;
  session: CasteSessionResult;
  workingDirectory: string;
}): SentinelVerdict | null {
  if (!isMissingSentinelVerdictFailure(input.session)) {
    return null;
  }

  const diagnostic = extractAssistantDiagnosticText(input.session);
  const lowerDiagnostic = diagnostic.toLowerCase();
  const scopedFiles = input.record.fileScope?.files ?? [];
  const hasCandidateDefect = [
    "truncated",
    "missing",
    "does not exist",
    "not present",
    "incomplete",
    "contract_gap",
    "fail",
    "error",
  ].some((marker) => lowerDiagnostic.includes(marker));
  if (!diagnostic) {
    return null;
  }

  const summary = truncateDiagnosticSummary(diagnostic);
  if (!hasCandidateDefect) {
    const allScopedFilesExist = scopedFiles.length > 0
      && scopedFiles.every((entry) => existsSync(path.join(input.workingDirectory, entry)));
    if (!allScopedFilesExist) {
      return null;
    }

    return {
      verdict: "pass",
      reviewSummary: `Recovered Sentinel pass diagnostic for ${input.issue.id} after missing final verdict tool: ${summary}`,
      blockingFindings: [],
      advisories: [
        "Recovered pass verdict from Sentinel diagnostic text after missing emit_sentinel_verdict.",
      ],
      touchedFiles: scopedFiles,
      contractChecks: [
        "Recovered Sentinel diagnostic text after missing final verdict tool.",
        "Verified all owned file-scope paths exist in the candidate worktree.",
      ],
    };
  }

  const ownershipSummary = scopedFiles.length > 0
    ? `Complete the owned file scope before returning success: ${scopedFiles.join(", ")}. `
    : "";
  const findingSummary = truncateDiagnosticSummary(`${ownershipSummary}Sentinel diagnostic: ${summary}`);
  return {
    verdict: "fail_blocking",
    reviewSummary: `Recovered Sentinel blocking diagnostic for ${input.issue.id} after missing final verdict tool: ${findingSummary}`,
    blockingFindings: [
      {
        finding_kind: "contract_gap",
        summary: findingSummary,
        required_files: scopedFiles,
        owner_issue: input.issue.id,
        route: "rework_owner",
      },
    ],
    advisories: [
      "Recovered fail_blocking verdict from Sentinel diagnostic text after missing emit_sentinel_verdict.",
    ],
    touchedFiles: scopedFiles,
    contractChecks: [
      "Recovered Sentinel diagnostic text after missing final verdict tool.",
    ],
  };
}

function isRecoverableDirtyTitanFailure(session: CasteSessionResult) {
  return session.status === "failed";
}

/** Dirty files when every one is inside the owned scope; otherwise `null`. */
function selectInScopeDirtyFiles(dirtyFiles: string[], fileScope: DispatchRecord["fileScope"]) {
  if (dirtyFiles.length === 0 || fileScope === null) {
    return null;
  }

  const allowed = new Set(fileScope.files.map((entry) => normalizeScopeFile(entry)));
  const normalizedDirtyFiles = dirtyFiles.map((entry) => normalizeScopeFile(entry));
  if (!normalizedDirtyFiles.every((entry) => allowed.has(entry))) {
    return null;
  }

  return [...new Set(normalizedDirtyFiles)].sort();
}

function commitRecoveredDirtyTitanWork(input: {
  issueId: string;
  workingDirectory: string;
  filesChanged: string[];
}) {
  return runGit(input.workingDirectory, ["add", "--", ...input.filesChanged]).status === 0
    && runGit(input.workingDirectory, ["commit", "-m", `${input.issueId} recovered Titan changes`]).status === 0;
}

export function synthesizeTitanArtifactFromDirtyWork(input: {
  issueId: string;
  session: CasteSessionResult;
  workingDirectory: string;
  proofPair: GitProofPair;
  fileScope: DispatchRecord["fileScope"];
}): { artifact: TitanArtifact; proofPair: GitProofPair } | null {
  if (!isRecoverableDirtyTitanFailure(input.session)) {
    return null;
  }

  const filesChanged = selectInScopeDirtyFiles(
    resolveCommittedChangedFiles(input.workingDirectory, input.proofPair),
    input.fileScope,
  );
  if (!filesChanged) {
    return null;
  }

  if (!commitRecoveredDirtyTitanWork({
    issueId: input.issueId,
    workingDirectory: input.workingDirectory,
    filesChanged,
  })) {
    return null;
  }

  const completedProofPair = completeGitProofPair(input.workingDirectory, input.proofPair);
  if (!hasAdvancedGitHead(completedProofPair)) {
    return null;
  }

  const sessionDetail = input.session.error?.trim().length
    ? input.session.error
    : `Runtime returned status=${input.session.status}.`;

  return {
    proofPair: completedProofPair,
    artifact: {
      outcome: "success",
      summary: `Recovered dirty Titan work for ${input.issueId} after the session edited in-scope labor files but did not complete a valid handoff.`,
      files_changed: filesChanged,
      tests_and_checks_run: [
        "Recovered from dirty in-scope labor diff; Titan did not report explicit checks.",
      ],
      known_risks: [
        `Titan session did not complete a valid handoff: ${sessionDetail}`,
        "Aegis committed the recovered in-scope labor diff; Sentinel review is still required before merge.",
      ],
      follow_up_work: [],
    },
  };
}

/** True when an existing labor holds only in-scope uncommitted edits worth preserving. */
export function hasRecoverableDirtyTitanLabor(
  workingDirectory: string,
  fileScope: DispatchRecord["fileScope"],
) {
  if (!existsSync(workingDirectory)) {
    return false;
  }

  return selectInScopeDirtyFiles(listDirtyFiles(workingDirectory) ?? [], fileScope) !== null;
}
