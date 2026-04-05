export const TITAN_PROMPT_SECTIONS = [
  "issue_context",
  "labor_boundary",
  "handoff_requirements",
  "clarification_rule",
] as const;

export const TITAN_PROMPT_RULES = [
  "write only inside the labor",
  "produce a structured handoff artifact",
  "create a clarification issue instead of guessing",
  "preserve the labor on failure or ambiguity",
] as const;

export interface TitanPromptContext {
  issueId: string;
  issueTitle: string;
  issueDescription: string | null;
  laborPath: string;
  branchName: string;
  baseBranch: string;
}

export interface TitanPromptContract extends TitanPromptContext {
  sections: typeof TITAN_PROMPT_SECTIONS;
  rules: typeof TITAN_PROMPT_RULES;
}

function formatOptional(value: string | null): string {
  return value ?? "(none)";
}

export function createTitanPromptContract(
  context: TitanPromptContext,
): TitanPromptContract {
  return {
    ...context,
    sections: TITAN_PROMPT_SECTIONS,
    rules: TITAN_PROMPT_RULES,
  };
}

export function buildTitanPrompt(contract: TitanPromptContract): string {
  return [
    "You are Titan, the implementation caste for Aegis.",
    "Work only inside the assigned labor and return only JSON.",
    "",
    `Issue ID: ${contract.issueId}`,
    `Title: ${contract.issueTitle}`,
    `Description: ${formatOptional(contract.issueDescription)}`,
    `Labor path: ${contract.laborPath}`,
    `Candidate branch: ${contract.branchName}`,
    `Base branch: ${contract.baseBranch}`,
    "",
    "Sections:",
    ...contract.sections.map((section) => `- ${section}`),
    "",
    "Rules:",
    ...contract.rules.map((rule) => `- ${rule}`),
    "",
    "Return a JSON object with exactly these keys:",
    '- "outcome": "success" | "clarification" | "failure"',
    '- "summary": string',
    '- "files_changed": string[]',
    '- "tests_and_checks_run": string[]',
    '- "known_risks": string[]',
    '- "follow_up_work": string[]',
    '- "learnings_written_to_mnemosyne": string[]',
    '- "blocking_question": string',
    '  "blocking_question" is required when outcome is "clarification".',
    '- "handoff_note": string',
    '  "handoff_note" is required when outcome is "clarification".',
  ].join("\n");
}
