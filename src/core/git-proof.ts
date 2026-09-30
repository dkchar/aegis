import { persistArtifact } from "./artifact-store.js";
import { normalizeScopeFile } from "../shared/file-scope.js";
import { isAegisControlPlanePath, isGitWorkingTree, parseGitStatusPath, runGit } from "../shared/git.js";

type GitProofFamily = "titan" | "janus";

interface GitSnapshot {
  branch: string | null;
  headCommit: string | null;
  statusLines: string[];
  changedFiles: string[];
  diff: string;
}

export interface GitProofRefs {
  statusBeforeRef: string | null;
  statusAfterRef: string | null;
  changedFilesManifestRef: string | null;
  diffRef: string | null;
}

function parseChangedFiles(statusLines: string[]) {
  return [...new Set(
    statusLines
      .map((line) => parseGitStatusPath(line))
      .filter((entry): entry is string => entry !== null),
  )].sort();
}

function parseChangedFileOutput(raw: string) {
  return raw
    .split(/\r?\n/)
    .map((line) => normalizeScopeFile(line))
    .filter((line) => line.length > 0)
    .sort();
}

function captureGitSnapshot(workingDirectory: string): GitSnapshot | null {
  if (!isGitWorkingTree(workingDirectory)) {
    return null;
  }

  const headCommit = runGit(workingDirectory, ["rev-parse", "HEAD"]);
  const branch = runGit(workingDirectory, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const status = runGit(workingDirectory, ["status", "--porcelain", "--branch", "--untracked-files=all"]);
  const diff = runGit(workingDirectory, ["diff", "--no-color"]);
  const stagedDiff = runGit(workingDirectory, ["diff", "--no-color", "--staged"]);

  if (status.status !== 0) {
    return null;
  }

  const statusLines = status.stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
  const diffChunks = [diff.stdout, stagedDiff.stdout]
    .map((chunk) => chunk.trimEnd())
    .filter((chunk) => chunk.length > 0);

  return {
    branch: branch.status === 0 ? branch.stdout.trim() : null,
    headCommit: headCommit.status === 0 ? headCommit.stdout.trim() : null,
    statusLines,
    changedFiles: parseChangedFiles(statusLines),
    diff: diffChunks.join("\n\n"),
  };
}

export function captureGitProofPair(
  workingDirectory: string,
): { before: GitSnapshot | null; after: GitSnapshot | null } {
  const before = captureGitSnapshot(workingDirectory);
  return {
    before,
    after: null,
  };
}

export function completeGitProofPair(
  workingDirectory: string,
  proofPair: { before: GitSnapshot | null; after: GitSnapshot | null },
): { before: GitSnapshot | null; after: GitSnapshot | null } {
  return {
    before: proofPair.before,
    after: captureGitSnapshot(workingDirectory),
  };
}

export function listOperationalDirtyFiles(snapshot: GitSnapshot | null) {
  if (!snapshot) {
    return [] as string[];
  }

  return snapshot.changedFiles.filter((candidate) => !isAegisControlPlanePath(candidate));
}

function listOperationalStatusLines(snapshot: GitSnapshot | null) {
  if (!snapshot) {
    return [] as string[];
  }

  return snapshot.statusLines
    .filter((line) => {
      const statusPath = parseGitStatusPath(line);
      return statusPath !== null && !isAegisControlPlanePath(statusPath);
    })
    .sort();
}

function formatFileList(files: string[]) {
  if (files.length <= 5) {
    return files.join(", ");
  }

  return `${files.slice(0, 5).join(", ")} (+${files.length - 5} more)`;
}

export function summarizeOperationalDirtyFiles(snapshot: GitSnapshot | null) {
  const files = listOperationalDirtyFiles(snapshot);
  return files.length > 0 ? formatFileList(files) : null;
}

export function summarizeOperationalStatusDrift(
  proofPair: { before: GitSnapshot | null; after: GitSnapshot | null },
) {
  const beforeLines = new Set(listOperationalStatusLines(proofPair.before));
  const afterLines = new Set(listOperationalStatusLines(proofPair.after));
  const added = [...afterLines].filter((line) => !beforeLines.has(line));
  const removed = [...beforeLines].filter((line) => !afterLines.has(line));

  if (added.length === 0 && removed.length === 0) {
    return null;
  }

  const parts: string[] = [];
  if (added.length > 0) {
    parts.push(`added ${formatFileList(added)}`);
  }
  if (removed.length > 0) {
    parts.push(`removed ${formatFileList(removed)}`);
  }

  return parts.join("; ");
}

export function hasAdvancedGitHead(
  proofPair: { before: GitSnapshot | null; after: GitSnapshot | null },
  expectedBranch?: string,
) {
  if (!proofPair.before || !proofPair.after) {
    return false;
  }

  if (!proofPair.before.headCommit || !proofPair.after.headCommit) {
    return false;
  }

  if (expectedBranch && proofPair.after.branch !== expectedBranch) {
    return false;
  }

  return proofPair.before.headCommit !== proofPair.after.headCommit;
}

function isAegisMergeCommitSubject(subject: string) {
  return /^Merge branch 'aegis\/[^']+'/.test(subject);
}

function isOtherAegisIssueCommitSubject(subject: string, currentIssueId?: string) {
  const match = /^(AG-\d+)\b/.exec(subject);
  return match !== null && match[1] !== currentIssueId;
}

export function hasOnlyAegisRootControlCommits(
  workingDirectory: string,
  proofPair: { before: GitSnapshot | null; after: GitSnapshot | null },
  currentIssueId?: string,
) {
  if (!proofPair.before?.headCommit || !proofPair.after?.headCommit) {
    return false;
  }
  if (proofPair.before.headCommit === proofPair.after.headCommit) {
    return false;
  }

  const result = runGit(workingDirectory, [
    "log",
    "--first-parent",
    "--format=%s",
    `${proofPair.before.headCommit}..${proofPair.after.headCommit}`,
  ]);
  if (result.status !== 0) {
    return false;
  }

  const subjects = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return subjects.length > 0
    && subjects.every((subject) =>
      isAegisMergeCommitSubject(subject)
      || isOtherAegisIssueCommitSubject(subject, currentIssueId));
}

export function resolveCommittedChangedFiles(
  workingDirectory: string,
  proofPair: { before: GitSnapshot | null; after: GitSnapshot | null },
) {
  if (!proofPair.before || !proofPair.after) {
    return proofPair.after?.changedFiles ?? [];
  }

  if (!proofPair.before.headCommit || !proofPair.after.headCommit) {
    return proofPair.after.changedFiles;
  }

  if (proofPair.before.headCommit === proofPair.after.headCommit) {
    return proofPair.after.changedFiles;
  }

  const result = runGit(workingDirectory, [
    "diff",
    "--name-only",
    "--no-renames",
    `${proofPair.before.headCommit}..${proofPair.after.headCommit}`,
  ]);

  if (result.status !== 0) {
    return proofPair.after.changedFiles;
  }

  return parseChangedFileOutput(result.stdout);
}

function resolveCommittedDiff(
  workingDirectory: string,
  proofPair: { before: GitSnapshot | null; after: GitSnapshot | null },
) {
  if (!proofPair.before || !proofPair.after) {
    return proofPair.after?.diff ?? "";
  }

  if (!proofPair.before.headCommit || !proofPair.after.headCommit) {
    return proofPair.after.diff;
  }

  if (proofPair.before.headCommit === proofPair.after.headCommit) {
    return proofPair.after.diff;
  }

  const result = runGit(workingDirectory, [
    "diff",
    "--no-color",
    `${proofPair.before.headCommit}..${proofPair.after.headCommit}`,
  ]);

  if (result.status !== 0) {
    return proofPair.after.diff;
  }

  return result.stdout.trimEnd();
}

export function persistGitProofArtifacts(
  root: string,
  family: GitProofFamily,
  issueId: string,
  workingDirectory: string,
  proofPair: { before: GitSnapshot | null; after: GitSnapshot | null },
): GitProofRefs {
  const before = proofPair.before;
  const after = proofPair.after;
  const changedFiles = resolveCommittedChangedFiles(workingDirectory, proofPair);
  const committedDiff = resolveCommittedDiff(workingDirectory, proofPair);

  const statusBeforeRef = before
    ? persistArtifact(root, {
      family,
      issueId,
      artifactId: "git-status-before",
      artifact: {
        issueId,
        workingDirectory,
        branch: before.branch,
        headCommit: before.headCommit,
        statusLines: before.statusLines,
      },
    })
    : null;

  const statusAfterRef = after
    ? persistArtifact(root, {
      family,
      issueId,
      artifactId: "git-status-after",
      artifact: {
        issueId,
        workingDirectory,
        branch: after.branch,
        headCommit: after.headCommit,
        statusLines: after.statusLines,
      },
    })
    : null;

  const changedFilesManifestRef = after
    ? persistArtifact(root, {
      family,
      issueId,
      artifactId: "changed-files",
      artifact: {
        issueId,
        workingDirectory,
        files: changedFiles,
      },
    })
    : null;

  const diffRef = after
    ? persistArtifact(root, {
      family,
      issueId,
      artifactId: "git-diff",
      artifact: {
        issueId,
        workingDirectory,
        diff: committedDiff,
      },
    })
    : null;

  return {
    statusBeforeRef,
    statusAfterRef,
    changedFilesManifestRef,
    diffRef,
  };
}
