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

export function createTitanPromptContract(
  context: TitanPromptContext,
): TitanPromptContract {
  return {
    ...context,
    sections: TITAN_PROMPT_SECTIONS,
    rules: TITAN_PROMPT_RULES,
  };
}
