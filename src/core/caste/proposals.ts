import { createHash } from "node:crypto";

import type { JanusResolutionArtifact } from "../../castes/janus/janus-parser.js";
import type { SentinelFinding } from "../../castes/sentinel/sentinel-parser.js";
import type { TitanArtifact } from "../../castes/titan/titan-parser.js";
import { normalizeFileScope, normalizeScopeFile } from "../../shared/file-scope.js";
import type { MutationProposal } from "../control-plane-policy.js";

/**
 * Converts typed caste outputs into mutation proposals for the deterministic
 * control-plane policy. Fingerprints make repeated proposals idempotent.
 */

export function mergeFileScope(left: { files: string[] } | null, right: string[]) {
  return normalizeFileScope([
    ...(left?.files ?? []),
    ...right,
  ]);
}

function extractScopeFilesFromEvidence(entries: string[]) {
  const candidates = entries.flatMap((entry) => {
    const trimmed = entry.trim();
    const requiredFilesPrefix = trimmed.match(/^Required files=(.+)$/i);
    if (requiredFilesPrefix?.[1]) {
      return requiredFilesPrefix[1].split(",");
    }

    if (!/\b(add|create|implement|missing|absent|required|requires|needs|include|includes|no)\b/i.test(trimmed)) {
      return [];
    }

    return [...trimmed.matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? "");
  });
  return candidates
    .map((entry) => normalizeScopeFile(entry))
    .filter((entry) => /^[\w@./-]+\.[\w.-]+$/.test(entry));
}

function extractScopeFilesFromProposalText(input: {
  summary: string;
  suggestedTitle?: string;
  suggestedDescription?: string;
  scopeEvidence: string[];
}) {
  return extractScopeFilesFromEvidence([
    input.summary,
    input.suggestedTitle ?? "",
    input.suggestedDescription ?? "",
    ...input.scopeEvidence,
  ]);
}

function normalizeFinding(finding: string) {
  return finding.trim().replace(/\s+/g, " ").toLowerCase();
}

export function buildFindingFingerprint(issueId: string, finding: string) {
  return createHash("sha256")
    .update(`${issueId}\n${normalizeFinding(finding)}`)
    .digest("hex")
    .slice(0, 16);
}

export function buildTitanPolicyProposal(
  issueId: string,
  artifact: TitanArtifact,
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
    fileScope: normalizeFileScope(extractScopeFilesFromProposalText({
      summary,
      suggestedTitle: proposal?.suggested_title,
      suggestedDescription: proposal?.suggested_description,
      scopeEvidence: proposal?.scope_evidence ?? [],
    }))?.files,
    fingerprint: buildFindingFingerprint(issueId, `${proposal?.proposal_type ?? "clarification"}:${summary}`),
  };
}

export function buildJanusPolicyProposal(
  issueId: string,
  artifact: JanusResolutionArtifact,
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
    fileScope: normalizeFileScope(extractScopeFilesFromProposalText({
      summary: proposal.summary,
      suggestedTitle: proposal.suggested_title,
      suggestedDescription: proposal.suggested_description,
      scopeEvidence: proposal.scope_evidence,
    }))?.files,
    fingerprint: buildFindingFingerprint(issueId, `${proposal.proposal_type}:${proposal.summary}`),
  };
}

export function buildSentinelRouterPolicyProposal(
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
    fileScope: normalizeFileScope(finding.required_files)?.files,
    fingerprint: buildFindingFingerprint(
      issueId,
      `${finding.route}:${finding.finding_kind}:${finding.summary}:${finding.required_files.join(",")}`,
    ),
  };
}
