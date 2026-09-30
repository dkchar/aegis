import { parseJsonObjectText } from "../../shared/json.js";

export type TitanRunOutcome = "success" | "already_satisfied" | "clarification" | "failure";

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
  blocking_question?: string;
  handoff_note?: string;
  mutation_proposal?: TitanMutationProposal;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function normalizeStringArray(value: unknown, field: string): string[] {
  if (isStringArray(value)) {
    return value;
  }

  if (typeof value === "string") {
    return [value];
  }

  throw new Error(`Titan mutation_proposal field '${field}' must be an array of strings.`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeQuotedEnum(value: unknown) {
  if (typeof value === "string" && /^"[a-z_]+"$/.test(value)) {
    return value.slice(1, -1);
  }

  return value;
}

function normalizeTitanProposalType(value: unknown): TitanMutationProposalType {
  const normalizedValue = normalizeQuotedEnum(value);
  if (
    normalizedValue === "create_clarification_blocker"
    || normalizedValue === "create_prerequisite_blocker"
    || normalizedValue === "create_out_of_scope_blocker"
  ) {
    return normalizedValue;
  }

  if (normalizedValue === "blocking_dependency" || normalizedValue === "out_of_scope_blocker") {
    return "create_out_of_scope_blocker";
  }

  throw new Error(
    "Titan mutation_proposal field 'proposal_type' must be one of create_clarification_blocker, create_prerequisite_blocker, create_out_of_scope_blocker",
  );
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

  const proposalType = normalizeTitanProposalType(value["proposal_type"]);
  if (
    typeof value["summary"] !== "string"
    || typeof value["suggested_title"] !== "string"
    || typeof value["suggested_description"] !== "string"
  ) {
    throw new Error("Titan mutation_proposal must include summary, suggested_title, suggested_description, and scope_evidence");
  }
  const scopeEvidence = normalizeStringArray(value["scope_evidence"], "scope_evidence");

  return {
    proposal_type: proposalType,
    summary: value["summary"],
    suggested_title: value["suggested_title"],
    suggested_description: value["suggested_description"],
    scope_evidence: scopeEvidence,
  };
}

export function parseTitanArtifact(raw: string): TitanArtifact {
  const parsed = parseJsonObjectText(raw);

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
    "blocking_question",
    "handoff_note",
    "mutation_proposal",
  ]);
  const unexpectedKeys = Object.keys(candidate).filter((key) => !allowedKeys.has(key));
  if (unexpectedKeys.length > 0) {
    throw new Error(`Titan output contains unexpected keys: ${unexpectedKeys.join(", ")}`);
  }

  const outcome = normalizeQuotedEnum(candidate["outcome"]);
  if (
    outcome !== "success"
    && outcome !== "already_satisfied"
    && outcome !== "clarification"
    && outcome !== "failure"
  ) {
    throw new Error("Titan output must include outcome=success|already_satisfied|clarification|failure");
  }
  if (typeof candidate["summary"] !== "string") {
    throw new Error("Titan output must include summary");
  }
  if (
    !isStringArray(candidate["files_changed"])
    || !isStringArray(candidate["tests_and_checks_run"])
    || !isStringArray(candidate["known_risks"])
    || !isStringArray(candidate["follow_up_work"])
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
    blocking_question:
      typeof candidate["blocking_question"] === "string" ? candidate["blocking_question"] : undefined,
    handoff_note: typeof candidate["handoff_note"] === "string" ? candidate["handoff_note"] : undefined,
  };

  if ("mutation_proposal" in candidate && candidate["mutation_proposal"] !== null) {
    artifact.mutation_proposal = assertTitanMutationProposal(candidate["mutation_proposal"]);
  }

  return artifact;
}
