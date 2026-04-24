import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { AgentCaste, DispatchRecord } from "./dispatch-state.js";
import type { TrackerClient, TrackerCreateIssueInput } from "../tracker/tracker.js";

export type MutationProposalType =
  | "create_clarification_blocker"
  | "create_prerequisite_blocker"
  | "create_out_of_scope_blocker"
  | "create_integration_blocker"
  | "requeue_parent";

export interface MutationProposal {
  originIssueId: string;
  originCaste: AgentCaste;
  proposalType: MutationProposalType;
  blocking: boolean;
  summary: string;
  suggestedTitle?: string;
  suggestedDescription?: string;
  dependencyType?: "blocks";
  scopeEvidence: string[];
  fingerprint: string;
}

export interface ExistingBlocker {
  issueId: string;
  fingerprint: string;
  status?: string;
}

export interface ApplyMutationProposalInput {
  root: string;
  tracker: TrackerClient;
  record: DispatchRecord & {
    blockedByIssueId?: string | null;
    policyArtifactRef?: string | null;
  };
  proposal: MutationProposal;
  now: string;
  existingBlockers?: ExistingBlocker[];
  mode?: "auto" | "manual";
}

export type PolicyRejectionReason =
  | "caste_not_permitted"
  | "missing_evidence"
  | "missing_tracker_method"
  | "missing_suggested_title"
  | "missing_suggested_description"
  | "non_blocking_not_allowed"
  | "unsupported_proposal";

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

function hasEvidence(proposal: MutationProposal): boolean {
  return proposal.scopeEvidence.some((entry) => entry.trim().length > 0);
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
  const artifactPath = path.join(path.resolve(root), ref);
  const temporaryPath = `${artifactPath}.tmp`;

  mkdirSync(path.dirname(artifactPath), { recursive: true });
  writeFileSync(temporaryPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, artifactPath);

  return ref;
}

function readPolicyArtifact(root: string, ref: string | null | undefined): unknown {
  if (!ref) {
    return null;
  }

  const artifactPath = path.join(path.resolve(root), ref);
  if (!existsSync(artifactPath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(artifactPath, "utf8"));
  } catch {
    return null;
  }
}

function findReusableIssueId(input: ApplyMutationProposalInput): string | null {
  const explicit = input.existingBlockers?.find((blocker) => (
    blocker.fingerprint === input.proposal.fingerprint && isOpenBlocker(blocker)
  ));
  if (explicit) {
    return explicit.issueId;
  }

  const artifact = readPolicyArtifact(input.root, input.record.policyArtifactRef);
  if (!artifact || typeof artifact !== "object") {
    return null;
  }

  const payload = artifact as Record<string, unknown>;
  if (
    payload["fingerprint"] === input.proposal.fingerprint
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
      `Policy proposal: ${proposal.proposalType}`,
      `Summary: ${proposal.summary}`,
      `Fingerprint: ${proposal.fingerprint}`,
      "Scope evidence:",
      ...proposal.scopeEvidence.map((entry) => `- ${entry}`),
    ].join("\n"),
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

  if (proposal.originCaste !== "titan" && proposal.originCaste !== "janus") {
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
