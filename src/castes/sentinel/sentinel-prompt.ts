/**
 * Sentinel prompt contract.
 *
 * SPECv2 §10.3 defines the Sentinel review caste. This module provides the
 * structured prompt contract for instructing the Sentinel agent.
 */

export const SENTINEL_PROMPT_SECTIONS = [
  "review_context",
  "sentinel_boundary",
  "verdict_requirements",
  "corrective_action_rule",
] as const;

export const SENTINEL_PROMPT_RULES = [
  "review only the merged code on the target branch",
  "return only structured JSON verdict",
  "create a fail verdict with explicit follow-up issues",
  "identify risk areas and test gaps for human attention",
] as const;

export interface SentinelPromptContext {
  issueId: string;
  issueTitle: string;
  issueDescription: string | null;
  targetBranch: string;
  baseBranch: string;
}

export interface SentinelPromptContract extends SentinelPromptContext {
  sections: typeof SENTINEL_PROMPT_SECTIONS;
  rules: typeof SENTINEL_PROMPT_RULES;
}

function formatOptional(value: string | null): string {
  return value ?? "(none)";
}

export function createSentinelPromptContract(
  context: SentinelPromptContext,
): SentinelPromptContract {
  return {
    ...context,
    sections: SENTINEL_PROMPT_SECTIONS,
    rules: SENTINEL_PROMPT_RULES,
  };
}

export function buildSentinelPrompt(contract: SentinelPromptContract): string {
  return [
    "You are Sentinel, the review caste for Aegis.",
    "Review the merged code on the target branch and return only JSON.",
    "",
    `Issue ID: ${contract.issueId}`,
    `Title: ${contract.issueTitle}`,
    `Description: ${formatOptional(contract.issueDescription)}`,
    `Target branch: ${contract.targetBranch}`,
    `Base branch: ${contract.baseBranch}`,
    "",
    "Allowed tools: read-only. Use read commands and read-only shell commands only.",
    "Do not modify files. Do not write. Do not push.",
    "",
    "Sections:",
    ...contract.sections.map((section) => `- ${section}`),
    "",
    "Rules:",
    ...contract.rules.map((rule) => `- ${rule}`),
    "",
    "Return a JSON object with exactly these keys:",
    '- "verdict": "pass" | "fail"',
    '- "reviewSummary": string',
    '- "issuesFound": string[]',
    '- "followUpIssueIds": string[]',
    '  "followUpIssueIds" must be non-empty when verdict is "fail".',
    '- "riskAreas": string[]',
  ].join("\n");
}
