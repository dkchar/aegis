import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

import type { AgentCaste, DispatchRecord } from "./dispatch-state.js";
import type { TrackerClient, TrackerCreateIssueInput } from "../tracker/tracker.js";
import {
  POLICY_FINGERPRINT_MARKER,
  POLICY_PROPOSAL_MARKER,
  POLICY_SCOPE_EVIDENCE_MARKER,
} from "../castes/scope-markers.js";
import { writeJsonAtomic } from "../shared/atomic-write.js";
import { normalizeScopeFile } from "../shared/file-scope.js";
import { readArtifactRecord } from "../shared/json.js";

export type MutationProposalType =
  | "create_clarification_blocker"
  | "create_prerequisite_blocker"
  | "create_out_of_scope_blocker"
  | "create_integration_blocker"
  | "requeue_parent";
export type MutationProposalOrigin = AgentCaste | "router";

export interface MutationProposal {
  originIssueId: string;
  originCaste: MutationProposalOrigin;
  proposalType: MutationProposalType;
  blocking: boolean;
  summary: string;
  suggestedTitle?: string;
  suggestedDescription?: string;
  dependencyType?: "blocks";
  scopeEvidence: string[];
  fileScope?: string[];
  fingerprint: string;
}

export interface ExistingBlocker {
  issueId: string;
  fingerprint: string;
  status?: string;
}

export interface ApplyMutationProposalInput {
  root: string;
  tracker: Pick<TrackerClient, "createIssue" | "linkBlockingIssue">;
  record: DispatchRecord & {
    blockedByIssueId?: string | null;
    policyArtifactRef?: string | null;
  };
  proposal: MutationProposal;
  now: string;
  existingBlockers?: ExistingBlocker[];
  mode?: "auto" | "manual";
}

export interface ApplyScopeExpansionInput {
  root: string;
  tracker: Pick<TrackerClient, "updateIssueScope">;
  issueId: string;
  originCaste: MutationProposalOrigin;
  findingKind: string;
  summary: string;
  previousScope: string[];
  expandedScope: string[];
  fingerprint: string;
  now: string;
}

export type PolicyRejectionReason =
  | "caste_not_permitted"
  | "missing_evidence"
  | "missing_tracker_method"
  | "missing_suggested_title"
  | "missing_suggested_description"
  | "non_blocking_not_allowed"
  | "unsupported_proposal"
  | "blocker_chain_not_allowed";

export type ApplyMutationProposalResult =
  | {
      outcome: "accepted" | "reused";
      parentStage: "blocked_on_child";
      childIssueId: string;
      policyArtifactRef: string;
    }
  | {
      outcome: "requeued";
      parentStage: "rework_required";
      childIssueId: null;
      policyArtifactRef: string;
    }
  | {
      outcome: "rejected";
      parentStage: "failed_operational";
      childIssueId: null;
      rejectionReason: PolicyRejectionReason;
      policyArtifactRef: string;
    };

const TITAN_PROPOSALS = new Set<MutationProposalType>([
  "create_clarification_blocker",
  "create_prerequisite_blocker",
  "create_out_of_scope_blocker",
]);

const JANUS_PROPOSALS = new Set<MutationProposalType>([
  "requeue_parent",
  "create_integration_blocker",
]);

const ROUTER_PROPOSALS = new Set<MutationProposalType>([
  "create_out_of_scope_blocker",
  "create_integration_blocker",
]);

function hasEvidence(proposal: MutationProposal): boolean {
  return proposal.scopeEvidence.some((entry) => entry.trim().length > 0);
}

function extractMentionedFileNames(text: string) {
  const matches = text.match(/[A-Za-z0-9@._/-]+\.[A-Za-z0-9._-]+/g) ?? [];
  return matches.map((entry) => normalizeScopeFile(entry, { lowercase: true }));
}

function shouldRequeueMissingOwnedFileProposal(input: ApplyMutationProposalInput) {
  const { proposal, record } = input;
  if (
    proposal.originCaste !== "titan"
    || !proposal.proposalType.startsWith("create_")
    || !record.fileScope
    || record.fileScope.files.length === 0
  ) {
    return false;
  }

  const text = [
    proposal.summary,
    proposal.suggestedTitle ?? "",
    proposal.suggestedDescription ?? "",
    ...proposal.scopeEvidence,
  ].join("\n").toLowerCase();
  if (!/\b(absent|missing|not present|no matches|does not contain|does not exist|doesn't exist|not found|returned false)\b/.test(text)) {
    return false;
  }

  const owned = new Set(record.fileScope.files.map((entry) => normalizeScopeFile(entry, { lowercase: true })));
  const mentionedOwnedFiles = extractMentionedFileNames(text).filter((entry) => owned.has(entry));
  return mentionedOwnedFiles.length > 0;
}

function isOpenBlocker(blocker: ExistingBlocker): boolean {
  return blocker.status === undefined || blocker.status === "open" || blocker.status === "blocked";
}

function sanitizeArtifactPart(value: string): string {
  const sanitized = value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return sanitized.length > 0 ? sanitized.slice(0, 96) : "proposal";
}

function policyArtifactRef(input: ApplyMutationProposalInput, suffix: string): string {
  const fileName = [
    sanitizeArtifactPart(input.proposal.originIssueId),
    sanitizeArtifactPart(input.proposal.fingerprint),
    suffix,
  ].join("--");
  return path.join(".aegis", "policy", `${fileName}.json`);
}

function persistPolicyArtifact(
  root: string,
  ref: string,
  artifact: unknown,
): string {
  writeJsonAtomic(path.join(path.resolve(root), ref), artifact);
  return ref;
}

function hasAcceptedChildPolicyForOrigin(root: string, originIssueId: string): boolean {
  const policyDir = path.join(path.resolve(root), ".aegis", "policy");
  if (!existsSync(policyDir)) {
    return false;
  }

  let entries: string[];
  try {
    entries = readdirSync(policyDir);
  } catch {
    return false;
  }

  return entries.some((entry) => {
    if (!entry.endsWith(".json")) {
      return false;
    }

    const payload = readArtifactRecord(root, path.join(".aegis", "policy", entry));
    return payload !== null
      && payload["originIssueId"] === originIssueId
      && payload["outcome"] !== "rejected"
      && typeof payload["childIssueId"] === "string";
  });
}

function findReusableIssueId(input: ApplyMutationProposalInput): string | null {
  const explicit = input.existingBlockers?.find((blocker) => (
    blocker.fingerprint === input.proposal.fingerprint && isOpenBlocker(blocker)
  ));
  if (explicit) {
    return explicit.issueId;
  }

  const payload = readArtifactRecord(input.root, input.record.policyArtifactRef);
  if (
    payload
    && payload["fingerprint"] === input.proposal.fingerprint
    && typeof payload["childIssueId"] === "string"
    && payload["outcome"] !== "rejected"
  ) {
    return payload["childIssueId"];
  }

  return null;
}

function reject(
  input: ApplyMutationProposalInput,
  rejectionReason: PolicyRejectionReason,
): ApplyMutationProposalResult {
  const ref = policyArtifactRef(input, "rejected");
  const policyArtifactRefValue = persistPolicyArtifact(input.root, ref, {
    schemaVersion: 1,
    outcome: "rejected",
    rejectionReason,
    originIssueId: input.proposal.originIssueId,
    originCaste: input.proposal.originCaste,
    proposalType: input.proposal.proposalType,
    fingerprint: input.proposal.fingerprint,
    summary: input.proposal.summary,
    createdAt: input.now,
  });

  return {
    outcome: "rejected",
    parentStage: "failed_operational",
    childIssueId: null,
    rejectionReason,
    policyArtifactRef: policyArtifactRefValue,
  };
}

function accept(
  input: ApplyMutationProposalInput,
  outcome: "accepted" | "reused",
  childIssueId: string,
): ApplyMutationProposalResult {
  const ref = policyArtifactRef(input, outcome);
  const policyArtifactRefValue = persistPolicyArtifact(input.root, ref, {
    schemaVersion: 1,
    outcome,
    originIssueId: input.proposal.originIssueId,
    originCaste: input.proposal.originCaste,
    proposalType: input.proposal.proposalType,
    fingerprint: input.proposal.fingerprint,
    summary: input.proposal.summary,
    childIssueId,
    parentStage: "blocked_on_child",
    createdAt: input.now,
  });

  return {
    outcome,
    parentStage: "blocked_on_child",
    childIssueId,
    policyArtifactRef: policyArtifactRefValue,
  };
}

function requeue(input: ApplyMutationProposalInput): ApplyMutationProposalResult {
  const ref = policyArtifactRef(input, "requeue");
  const policyArtifactRefValue = persistPolicyArtifact(input.root, ref, {
    schemaVersion: 1,
    outcome: "requeued",
    originIssueId: input.proposal.originIssueId,
    originCaste: input.proposal.originCaste,
    proposalType: input.proposal.proposalType,
    fingerprint: input.proposal.fingerprint,
    summary: input.proposal.summary,
    parentStage: "rework_required",
    createdAt: input.now,
  });

  return {
    outcome: "requeued",
    parentStage: "rework_required",
    childIssueId: null,
    policyArtifactRef: policyArtifactRefValue,
  };
}

function buildCreateIssueInput(proposal: MutationProposal): TrackerCreateIssueInput {
  return {
    title: proposal.suggestedTitle ?? "",
    description: [
      proposal.suggestedDescription ?? "",
      "",
      `${POLICY_PROPOSAL_MARKER} ${proposal.proposalType}`,
      `Summary: ${proposal.summary}`,
      `${POLICY_FINGERPRINT_MARKER} ${proposal.fingerprint}`,
      POLICY_SCOPE_EVIDENCE_MARKER,
      ...proposal.scopeEvidence.map((entry) => `- ${entry}`),
    ].join("\n"),
    fileScope: proposal.fileScope,
  };
}

function validateProposal(input: ApplyMutationProposalInput): PolicyRejectionReason | null {
  const { proposal } = input;

  if (proposal.originCaste === "oracle" || proposal.originCaste === "sentinel") {
    return "caste_not_permitted";
  }

  if (proposal.originCaste === "titan" && !TITAN_PROPOSALS.has(proposal.proposalType)) {
    return "unsupported_proposal";
  }

  if (proposal.originCaste === "janus" && !JANUS_PROPOSALS.has(proposal.proposalType)) {
    return "unsupported_proposal";
  }

  if (proposal.originCaste === "router" && !ROUTER_PROPOSALS.has(proposal.proposalType)) {
    return "unsupported_proposal";
  }

  if (proposal.proposalType.startsWith("create_")) {
    if (hasAcceptedChildPolicyForOrigin(input.root, proposal.originIssueId)) {
      return "blocker_chain_not_allowed";
    }
  }

  if (proposal.originCaste !== "titan" && proposal.originCaste !== "janus" && proposal.originCaste !== "router") {
    return "caste_not_permitted";
  }

  if (!hasEvidence(proposal)) {
    return "missing_evidence";
  }

  if (proposal.proposalType === "requeue_parent") {
    return null;
  }

  if (!proposal.blocking && (input.mode ?? "auto") === "auto") {
    return "non_blocking_not_allowed";
  }

  if (!proposal.suggestedTitle || proposal.suggestedTitle.trim().length === 0) {
    return "missing_suggested_title";
  }

  if (!proposal.suggestedDescription || proposal.suggestedDescription.trim().length === 0) {
    return "missing_suggested_description";
  }

  if (!input.tracker.createIssue || !input.tracker.linkBlockingIssue) {
    return "missing_tracker_method";
  }

  return null;
}

export async function applyMutationProposal(
  input: ApplyMutationProposalInput,
): Promise<ApplyMutationProposalResult> {
  const rejectionReason = validateProposal(input);
  if (rejectionReason) {
    return reject(input, rejectionReason);
  }

  if (input.proposal.proposalType === "requeue_parent") {
    return requeue(input);
  }

  if (shouldRequeueMissingOwnedFileProposal(input)) {
    return requeue(input);
  }

  const reusedIssueId = findReusableIssueId(input);
  if (reusedIssueId) {
    return accept(input, "reused", reusedIssueId);
  }

  const childIssueId = await input.tracker.createIssue!(buildCreateIssueInput(input.proposal), input.root);
  await input.tracker.linkBlockingIssue!({
    blockingIssueId: childIssueId,
    blockedIssueId: input.record.issueId,
  }, input.root);

  return accept(input, "accepted", childIssueId);
}

export async function applyScopeExpansion(
  input: ApplyScopeExpansionInput,
): Promise<{
  outcome: "expanded";
  parentStage: "rework_required";
  fileScope: { files: string[] };
  policyArtifactRef: string;
}> {
  if (!input.tracker.updateIssueScope) {
    throw new Error("Tracker cannot update issue scope.");
  }

  await input.tracker.updateIssueScope({
    issueId: input.issueId,
    fileScope: input.expandedScope,
    reason: `Aegis expanded scope from ${input.originCaste} typed finding ${input.fingerprint}.`,
  }, input.root);

  const policyArtifactRefValue = persistPolicyArtifact(
    input.root,
    path.join(
      ".aegis",
      "policy",
      `${sanitizeArtifactPart(input.issueId)}--${sanitizeArtifactPart(input.fingerprint)}--scope-expanded.json`,
    ),
    {
      schemaVersion: 1,
      outcome: "scope_expanded",
      originIssueId: input.issueId,
      originCaste: input.originCaste,
      findingKind: input.findingKind,
      fingerprint: input.fingerprint,
      summary: input.summary,
      previousScope: input.previousScope,
      expandedScope: input.expandedScope,
      parentStage: "rework_required",
      createdAt: input.now,
    },
  );

  return {
    outcome: "expanded",
    parentStage: "rework_required",
    fileScope: { files: input.expandedScope },
    policyArtifactRef: policyArtifactRefValue,
  };
}
