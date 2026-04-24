export type JanusMutationProposalType = "requeue_parent" | "create_integration_blocker";

export interface JanusMutationProposal {
  proposal_type: JanusMutationProposalType;
  summary: string;
  suggested_title?: string;
  suggested_description?: string;
  scope_evidence: string[];
}

export interface JanusResolutionArtifact {
  originatingIssueId: string;
  queueItemId: string;
  preservedLaborPath: string;
  conflictSummary: string;
  resolutionStrategy: string;
  filesTouched: string[];
  validationsRun: string[];
  residualRisks: string[];
  mutation_proposal: JanusMutationProposal;
}

const JANUS_ARTIFACT_KEYS = new Set([
  "originatingIssueId",
  "queueItemId",
  "preservedLaborPath",
  "conflictSummary",
  "resolutionStrategy",
  "filesTouched",
  "validationsRun",
  "residualRisks",
  "mutation_proposal",
]);

function assertPlainObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Janus resolution artifact must be a JSON object.");
  }

  return value as Record<string, unknown>;
}

function assertString(value: unknown, key: string): string {
  if (typeof value !== "string") {
    throw new Error(`Janus resolution artifact field '${key}' must be a string.`);
  }

  return value;
}

function assertStringArray(value: unknown, key: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Janus resolution artifact field '${key}' must be an array of strings.`);
  }

  return value.slice();
}

function assertJanusMutationProposal(value: unknown): JanusMutationProposal {
  const obj = assertPlainObject(value);
  const allowedKeys = new Set([
    "proposal_type",
    "summary",
    "suggested_title",
    "suggested_description",
    "scope_evidence",
  ]);
  for (const key of Object.keys(obj)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`Janus mutation_proposal contains an unexpected field: ${key}`);
    }
  }

  const proposalType = obj["proposal_type"];
  if (proposalType !== "requeue_parent" && proposalType !== "create_integration_blocker") {
    throw new Error(
      "Janus mutation_proposal field 'proposal_type' must be one of: requeue_parent, create_integration_blocker.",
    );
  }

  const proposal: JanusMutationProposal = {
    proposal_type: proposalType,
    summary: assertString(obj["summary"], "mutation_proposal.summary"),
    scope_evidence: assertStringArray(obj["scope_evidence"], "mutation_proposal.scope_evidence"),
  };

  if ("suggested_title" in obj && obj["suggested_title"] !== null) {
    proposal.suggested_title = assertString(obj["suggested_title"], "mutation_proposal.suggested_title");
  }
  if ("suggested_description" in obj && obj["suggested_description"] !== null) {
    proposal.suggested_description = assertString(
      obj["suggested_description"],
      "mutation_proposal.suggested_description",
    );
  }

  return proposal;
}

export function parseJanusResolutionArtifact(raw: string): JanusResolutionArtifact {
  const parsed = JSON.parse(raw) as unknown;
  const obj = assertPlainObject(parsed);

  for (const key of Object.keys(obj)) {
    if (!JANUS_ARTIFACT_KEYS.has(key)) {
      throw new Error(`Janus resolution artifact contains an unexpected field: ${key}`);
    }
  }

  for (const field of [
    "originatingIssueId",
    "queueItemId",
    "preservedLaborPath",
    "conflictSummary",
    "resolutionStrategy",
    "filesTouched",
    "validationsRun",
    "residualRisks",
    "mutation_proposal",
  ]) {
    if (!(field in obj)) {
      throw new Error(`Janus resolution artifact is missing required field '${field}'.`);
    }
  }

  return {
    originatingIssueId: assertString(obj["originatingIssueId"], "originatingIssueId"),
    queueItemId: assertString(obj["queueItemId"], "queueItemId"),
    preservedLaborPath: assertString(obj["preservedLaborPath"], "preservedLaborPath"),
    conflictSummary: assertString(obj["conflictSummary"], "conflictSummary"),
    resolutionStrategy: assertString(obj["resolutionStrategy"], "resolutionStrategy"),
    filesTouched: assertStringArray(obj["filesTouched"], "filesTouched"),
    validationsRun: assertStringArray(obj["validationsRun"], "validationsRun"),
    residualRisks: assertStringArray(obj["residualRisks"], "residualRisks"),
    mutation_proposal: assertJanusMutationProposal(obj["mutation_proposal"]),
  };
}
