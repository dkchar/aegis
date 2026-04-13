/**
 * Oracle prompt contract.
 *
 * The prompt is intentionally declarative: it gives Oracle the issue context
 * and the exact structured output schema, but no write permissions or loose
 * narrative format.
 */

import type { AegisIssue } from "../../tracker/issue-model.js";

export interface OraclePromptIssue {
  id: string;
  title: string;
  description: string | null;
  labels: readonly string[];
  blockers: readonly string[];
  parentId: string | null;
  childIds: readonly string[];
  relevantLearnings?: string;
}

function formatList(values: readonly string[]): string {
  return values.length > 0 ? values.join(", ") : "(none)";
}

/**
 * Build the read-only Oracle prompt for a Beads issue.
 */
export function buildOraclePrompt(issue: OraclePromptIssue): string {
  const description = issue.description ?? "(none)";
  const learningsBlock = issue.relevantLearnings?.trim();

  return [
    "You are Oracle, the scouting caste for Aegis.",
    "Inspect the issue and the codebase, then submit your assessment using the submit_assessment tool.",
    "",
    `Issue ID: ${issue.id}`,
    `Title: ${issue.title}`,
    `Description: ${description}`,
    `Labels: ${formatList(issue.labels)}`,
    `Blockers: ${formatList(issue.blockers)}`,
    `Parent: ${issue.parentId ?? "(none)"}`,
    `Children: ${formatList(issue.childIds)}`,
    "",
    ...(learningsBlock ? [learningsBlock, ""] : []),
    "Allowed actions: read-only shell commands and tracker reads.",
    "No file modifications. No writes.",
    "",
    "Use the submit_assessment tool with your assessment result. Do not output JSON as a message.",
    "The tool accepts these parameters:",
    "  files_affected: string[] — files the issue requires changes to or analysis of",
    '  estimated_complexity: "trivial" | "moderate" | "complex"',
    "  decompose: boolean — whether the issue should be broken into smaller sub-tasks",
    "  sub_issues?: string[] — beads issue IDs for sub-tasks if decompose is true",
    "  blockers?: string[] — blocking issues that must be resolved before work can begin",
    "  ready: boolean — whether the issue is ready for Titan implementation",
  ].join("\n");
}

export function issueToOraclePromptIssue(issue: AegisIssue): OraclePromptIssue {
  return {
    id: issue.id,
    title: issue.title,
    description: issue.description,
    labels: issue.labels,
    blockers: issue.blockers,
    parentId: issue.parentId,
    childIds: issue.childIds,
    relevantLearnings: undefined,
  };
}
