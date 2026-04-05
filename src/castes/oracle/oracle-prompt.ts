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
}

function formatList(values: readonly string[]): string {
  return values.length > 0 ? values.join(", ") : "(none)";
}

/**
 * Build the read-only Oracle prompt for a Beads issue.
 */
export function buildOraclePrompt(issue: OraclePromptIssue): string {
  const description = issue.description ?? "(none)";

  return [
    "You are Oracle, the scouting caste for Aegis.",
    "Inspect the issue and the codebase, then return only JSON.",
    "",
    `Issue ID: ${issue.id}`,
    `Title: ${issue.title}`,
    `Description: ${description}`,
    `Labels: ${formatList(issue.labels)}`,
    `Blockers: ${formatList(issue.blockers)}`,
    `Parent: ${issue.parentId ?? "(none)"}`,
    `Children: ${formatList(issue.childIds)}`,
    "",
    "Allowed actions: read-only shell commands and tracker reads.",
    "No file modifications. No writes.",
    "",
    "Return JSON with exactly these fields:",
    "{",
    '  "files_affected": string[],',
    '  "estimated_complexity": "trivial" | "moderate" | "complex",',
    '  "decompose": boolean,',
    '  "sub_issues"?: string[],',
    '  "blockers"?: string[],',
    '  "ready": boolean',
    "}",
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
  };
}
