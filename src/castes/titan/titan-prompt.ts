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
  relevantLearnings?: string;
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
  const learningsBlock = contract.relevantLearnings?.trim();

  return [
    "You are Titan, the implementation caste for Aegis.",
    "Work only inside the assigned labor and submit your handoff using the submit_handoff tool.",
    "",
    `Issue ID: ${contract.issueId}`,
    `Title: ${contract.issueTitle}`,
    `Description: ${formatOptional(contract.issueDescription)}`,
    `Labor path: ${contract.laborPath}`,
    `Candidate branch: ${contract.branchName}`,
    `Base branch: ${contract.baseBranch}`,
    "",
    ...(learningsBlock ? [learningsBlock, ""] : []),
    "Sections:",
    ...contract.sections.map((section) => `- ${section}`),
    "",
    "Rules:",
    ...contract.rules.map((rule) => `- ${rule}`),
    "",
    "Use the submit_handoff tool with your handoff result. Do not output JSON as a message.",
    "The tool accepts these parameters:",
    `  issueId: string — ${contract.issueId}`,
    `  laborPath: string — ${contract.laborPath}`,
    `  candidateBranch: string — ${contract.branchName}`,
    `  baseBranch: string — ${contract.baseBranch}`,
    "  filesChanged: string[] — files modified in this session",
    "  testsAndChecksRun?: string[] — test suites or lint checks executed",
    "  knownRisks?: string[] — known risks or areas requiring close Sentinel review",
    "  followUpWork?: string[] — follow-up tasks discovered during implementation",
    "  learningsWrittenToMnemosyne?: string[] — key learnings persisted to Mnemosyne",
    "  handoffNote?: string — free-form note for the merge/Sentinel reviewer",
  ].join("\n");
}
