import { normalizeScopeFile } from "../../shared/file-scope.js";
import { isJsonRecord, readArtifactRecord, readStringArray } from "../../shared/json.js";

/**
 * Readers that turn durable caste artifacts into prompt context. They never
 * throw: a missing or malformed artifact yields empty context, and the
 * control plane's stage invariants decide whether that is acceptable.
 */

function nonEmpty(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/** Oracle checks and scope notes forwarded to Titan. */
export function readOracleImplementationContext(root: string, artifactRef: string | null) {
  const artifact = readArtifactRecord(root, artifactRef);
  if (!artifact) {
    return null;
  }

  return {
    suggestedChecks: readStringArray(artifact["suggested_checks"]),
    scopeNotes: readStringArray(artifact["scope_notes"]),
  };
}

function formatBlockingFinding(finding: unknown) {
  if (typeof finding === "string") {
    return nonEmpty(finding) ? `Blocking finding: ${finding.trim()}` : null;
  }
  if (!isJsonRecord(finding)) {
    return null;
  }

  const summary = nonEmpty(finding["summary"]);
  if (!summary) {
    return null;
  }

  const kind = finding["finding_kind"];
  const route = finding["route"];
  const files = readStringArray(finding["required_files"]);
  return [
    `Blocking finding: ${summary}`,
    ...(typeof kind === "string" ? [`kind=${kind}`] : []),
    ...(typeof route === "string" ? [`route=${route}`] : []),
    ...(files.length ? [`required_files=${files.join(", ")}`] : []),
  ].join(" | ");
}

/** Sentinel or Janus feedback lines for Titan rework prompts. */
export function readReviewFeedbackContext(root: string, artifactRef: string | null) {
  const artifact = readArtifactRecord(root, artifactRef);
  if (!artifact) {
    return [];
  }

  const lines: string[] = [];
  const reviewSummary = nonEmpty(artifact["reviewSummary"]);
  if (reviewSummary) {
    lines.push(`Review summary: ${reviewSummary}`);
  }

  const blockingFindings = Array.isArray(artifact["blockingFindings"]) ? artifact["blockingFindings"] : [];
  for (const finding of blockingFindings) {
    const line = formatBlockingFinding(finding);
    if (line) {
      lines.push(line);
    }
  }

  for (const advisory of readStringArray(artifact["advisories"])) {
    if (advisory.trim().length > 0) {
      lines.push(`Advisory: ${advisory.trim()}`);
    }
  }

  return lines;
}

export function readTitanChangedFiles(root: string, artifactRef: string | null | undefined) {
  const artifact = readArtifactRecord(root, artifactRef);
  return artifact
    ? readStringArray(artifact["files_changed"]).map((entry) => normalizeScopeFile(entry))
    : [];
}

/** Candidate summary shown to Sentinel. */
export function readTitanReviewContext(root: string, artifactRef: string | null | undefined) {
  const artifact = readArtifactRecord(root, artifactRef);
  if (!artifact) {
    return [];
  }

  const lines: string[] = ["Candidate Titan artifact summary:"];
  if (typeof artifact["outcome"] === "string") {
    lines.push(`Outcome: ${artifact["outcome"]}`);
  }
  const summary = nonEmpty(artifact["summary"]);
  if (summary) {
    lines.push(`Summary: ${summary}`);
  }

  const files = readStringArray(artifact["files_changed"]);
  if (files.length > 0) {
    lines.push(`Files changed: ${files.join(", ")}`);
  }
  const checks = readStringArray(artifact["tests_and_checks_run"]);
  if (checks.length > 0) {
    lines.push(`Checks: ${checks.join("; ")}`);
  }
  const risks = readStringArray(artifact["known_risks"]);
  if (risks.length > 0) {
    lines.push(`Known risks: ${risks.join("; ")}`);
  }

  return lines.length > 1 ? lines : [];
}
