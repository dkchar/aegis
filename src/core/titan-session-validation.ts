import path from "node:path";

import { buildLaborBranchName } from "../labor/create-labor.js";
import type { TitanArtifact } from "../castes/titan/titan-parser.js";
import {
  captureGitProofPair,
  hasAdvancedGitHead,
  hasOnlyAegisRootControlCommits,
  resolveCommittedChangedFiles,
  summarizeOperationalStatusDrift,
} from "./git-proof.js";
import { isPolicyCreatedBlockerDescription } from "../castes/scope-markers.js";
import { normalizeScopeFile } from "../shared/file-scope.js";
import { formatGitOutput, isAegisControlPlanePath, runGit } from "../shared/git.js";

type GitProofPair = {
  before: ReturnType<typeof captureGitProofPair>["before"];
  after: ReturnType<typeof captureGitProofPair>["after"];
};

function hasChangedHead(proofPair: GitProofPair) {
  return Boolean(
    proofPair.before?.headCommit
    && proofPair.after?.headCommit
    && proofPair.before.headCommit !== proofPair.after.headCommit,
  );
}

function arraysEqual(left: string[], right: string[]) {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
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

export function normalizeTitanArtifactChangedFiles(
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

export function validateTitanSessionOutcome(input: {
  root: string;
  issueId: string;
  issueDescription: string;
  artifact: TitanArtifact;
  candidateBranch: string;
  fileScope: { files: string[] } | null;
  candidateWorkingDirectory: string;
  candidateProofPair: GitProofPair;
  rootProofPair: GitProofPair;
  adoptedRootCommit: boolean;
  requiresIntegrationRework: boolean;
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
    && !hasOnlyAegisRootControlCommits(input.root, input.rootProofPair, input.issueId)
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

  const isPolicyCreatedBlocker = isPolicyCreatedBlockerDescription(input.issueDescription);
  const isVerifiedPolicyNoopSuccess = isPolicyCreatedBlocker
    && input.artifact.outcome === "success"
    && input.artifact.files_changed.length === 0
    && committedFiles.length === 0
    && input.artifact.tests_and_checks_run.length > 0;
  const hasDurableGitProof = input.candidateProofPair.before !== null && input.candidateProofPair.after !== null;
  if (
    input.artifact.outcome === "success"
    && hasDurableGitProof
    && !isVerifiedPolicyNoopSuccess
    && !(input.adoptedRootCommit
      ? hasChangedHead(input.candidateProofPair)
      : hasAdvancedGitHead(input.candidateProofPair, input.candidateBranch))
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

    if (isPolicyCreatedBlocker) {
      return `Titan policy-created blocker ${input.issueId} must resolve with success or failure, not already_satisfied.`;
    }

    if (input.requiresIntegrationRework) {
      return `Titan integration rework for ${input.issueId} must advance the candidate branch, not return already_satisfied.`;
    }
  }

  if (
    input.artifact.mutation_proposal
    && isPolicyCreatedBlocker
  ) {
    return `Titan policy-created blocker ${input.issueId} must resolve with success or failure, not another blocker.`;
  }

  if (
    input.artifact.outcome === "success"
    && committedFiles.length > 0
    && !committedFiles.every((entry) => normalizedArtifactFiles.includes(entry))
  ) {
    return `Titan artifact files_changed for ${input.issueId} must include committed git proof files.`;
  }

  return null;
}

export function resolveRootCommitAdoption(input: {
  issueId: string;
  root: string;
  artifact: TitanArtifact;
  fileScope: { files: string[] } | null;
  rootProofPair: GitProofPair;
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

  const baseBranch = input.rootProofPair.before?.branch;
  const adoptedHeadCommit = input.rootProofPair.after?.headCommit;
  if (!baseBranch || !adoptedHeadCommit) {
    return null;
  }

  return {
    adoptedHeadCommit,
    baseBranch,
  };
}

function buildAdoptedRootBranchName(issueId: string) {
  return buildLaborBranchName(`adopted/${issueId}`).replace("aegis/adopted-", "aegis/adopted/");
}

export function materializeAdoptedRootCandidate(input: {
  issueId: string;
  root: string;
  adoptedHeadCommit: string;
}) {
  const candidateBranch = buildAdoptedRootBranchName(input.issueId);
  const createBranch = runGit(input.root, [
    "branch",
    "-f",
    candidateBranch,
    input.adoptedHeadCommit,
  ]);
  if (createBranch.status !== 0) {
    throw new Error(
      `Failed to create adopted root candidate branch ${candidateBranch} for ${input.issueId}. ${formatGitOutput(createBranch)}`,
    );
  }

  const verifyBranch = runGit(input.root, ["rev-parse", "--verify", candidateBranch]);
  if (verifyBranch.status !== 0 || verifyBranch.stdout.trim() !== input.adoptedHeadCommit) {
    throw new Error(
      `Failed to verify adopted root candidate branch ${candidateBranch} for ${input.issueId}. ${formatGitOutput(verifyBranch)}`,
    );
  }

  return candidateBranch;
}

function listNewOperationalRootDirtyFiles(proofPair: GitProofPair) {
  const before = new Set((proofPair.before?.changedFiles ?? []).map((entry) => normalizeScopeFile(entry)));
  return (proofPair.after?.changedFiles ?? [])
    .map((entry) => normalizeScopeFile(entry))
    .filter((entry) => !isAegisControlPlanePath(entry) && !before.has(entry));
}

export function cleanupRejectedTitanRootDrift(root: string, proofPair: GitProofPair) {
  const dirtyFiles = listNewOperationalRootDirtyFiles(proofPair);
  if (dirtyFiles.length === 0) {
    return;
  }

  runGit(root, ["restore", "--staged", "--worktree", "--", ...dirtyFiles]);
  runGit(root, ["clean", "-f", "--", ...dirtyFiles]);
}
