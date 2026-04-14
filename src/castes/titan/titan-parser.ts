export type TitanRunOutcome = "success" | "clarification" | "failure";

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
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
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
  if (outcome === "clarification" && typeof candidate["blocking_question"] !== "string") {
    throw new Error("Titan clarification output must include blocking_question");
  }
  if (outcome === "clarification" && typeof candidate["handoff_note"] !== "string") {
    throw new Error("Titan clarification output must include handoff_note");
  }

  return {
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
}
