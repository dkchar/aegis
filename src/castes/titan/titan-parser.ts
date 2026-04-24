export type TitanRunOutcome = "success" | "clarification" | "failure";

export type TitanMutationProposalType =
  | "create_clarification_blocker"
  | "create_prerequisite_blocker"
  | "create_out_of_scope_blocker";

export interface TitanMutationProposal {
  proposal_type: TitanMutationProposalType;
  summary: string;
  suggested_title: string;
  suggested_description: string;
  scope_evidence: string[];
}

export interface TitanArtifact {
  outcome: TitanRunOutcome;
  summary: string;
  files_changed: string[];
  tests_and_checks_run: string[];
  known_risks: string[];
  follow_up_work: string[];
  learnings_written_to_mnemosyne: string[];
  blocking_question?: string;
  handoff_note?: string;
  mutation_proposal?: TitanMutationProposal;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertTitanMutationProposal(value: unknown): TitanMutationProposal {
  if (!isPlainObject(value)) {
    throw new Error("Titan mutation_proposal must be a JSON object");
  }

  const allowedKeys = new Set([
    "proposal_type",
    "summary",
    "suggested_title",
    "suggested_description",
    "scope_evidence",
  ]);
  const unexpectedKeys = Object.keys(value).filter((key) => !allowedKeys.has(key));
  if (unexpectedKeys.length > 0) {
    throw new Error(`Titan mutation_proposal contains unexpected keys: ${unexpectedKeys.join(", ")}`);
  }

  const proposalType = value["proposal_type"];
  if (
    proposalType !== "create_clarification_blocker"
    && proposalType !== "create_prerequisite_blocker"
    && proposalType !== "create_out_of_scope_blocker"
  ) {
    throw new Error(
      "Titan mutation_proposal field 'proposal_type' must be one of create_clarification_blocker, create_prerequisite_blocker, create_out_of_scope_blocker",
    );
  }
  if (
    typeof value["summary"] !== "string"
    || typeof value["suggested_title"] !== "string"
    || typeof value["suggested_description"] !== "string"
    || !isStringArray(value["scope_evidence"])
  ) {
    throw new Error("Titan mutation_proposal must include summary, suggested_title, suggested_description, and scope_evidence");
  }

  return {
    proposal_type: proposalType,
    summary: value["summary"],
    suggested_title: value["suggested_title"],
    suggested_description: value["suggested_description"],
    scope_evidence: value["scope_evidence"],
  };
}

export function parseTitanArtifact(raw: string): TitanArtifact {
  const parsed = JSON.parse(raw) as unknown;

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Titan output must be a JSON object");
  }

  const candidate = parsed as Record<string, unknown>;
  const allowedKeys = new Set([
    "outcome",
    "summary",
    "files_changed",
    "tests_and_checks_run",
    "known_risks",
    "follow_up_work",
    "learnings_written_to_mnemosyne",
    "blocking_question",
    "handoff_note",
    "mutation_proposal",
  ]);
  const unexpectedKeys = Object.keys(candidate).filter((key) => !allowedKeys.has(key));
  if (unexpectedKeys.length > 0) {
    throw new Error(`Titan output contains unexpected keys: ${unexpectedKeys.join(", ")}`);
  }

  const outcome = candidate["outcome"];
  if (outcome !== "success" && outcome !== "clarification" && outcome !== "failure") {
    throw new Error("Titan output must include outcome=success|clarification|failure");
  }
  if (typeof candidate["summary"] !== "string") {
    throw new Error("Titan output must include summary");
  }
  if (
    !isStringArray(candidate["files_changed"])
    || !isStringArray(candidate["tests_and_checks_run"])
    || !isStringArray(candidate["known_risks"])
    || !isStringArray(candidate["follow_up_work"])
    || !isStringArray(candidate["learnings_written_to_mnemosyne"])
  ) {
    throw new Error("Titan output must include string array artifact fields");
  }
  const artifact: TitanArtifact = {
    outcome,
    summary: candidate["summary"],
    files_changed: candidate["files_changed"],
    tests_and_checks_run: candidate["tests_and_checks_run"],
    known_risks: candidate["known_risks"],
    follow_up_work: candidate["follow_up_work"],
    learnings_written_to_mnemosyne: candidate["learnings_written_to_mnemosyne"],
    blocking_question:
      typeof candidate["blocking_question"] === "string" ? candidate["blocking_question"] : undefined,
    handoff_note: typeof candidate["handoff_note"] === "string" ? candidate["handoff_note"] : undefined,
  };

  if ("mutation_proposal" in candidate && candidate["mutation_proposal"] !== null) {
    artifact.mutation_proposal = assertTitanMutationProposal(candidate["mutation_proposal"]);
  }

  return artifact;
}
