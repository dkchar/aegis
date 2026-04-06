/**
 * Fix-issue scaffolding for Sentinel corrective work.
 *
 * When Sentinel emits a fail verdict, it must create explicit corrective work
 * rather than silently burying the problem. This helper converts a Sentinel
 * verdict into Beads issue creation inputs while preserving the origin link
 * explicitly.
 */

import type { CreateIssueInput, IssuePriority, AegisIssue } from "./issue-model.js";
import type { SentinelVerdict } from "../castes/sentinel/sentinel-parser.js";

/**
 * Build the standard description string for a Sentinel fix issue.
 */
export function sentinelFixDescription(
  originIssueId: string,
  verdictRef: string,
  reviewSummary: string,
  riskAreas: string[],
): string {
  const lines = [
    `Corrective work from Sentinel review of ${originIssueId}. Verdict: ${verdictRef}`,
    "",
    `Review summary: ${reviewSummary}`,
  ];

  if (riskAreas.length > 0) {
    lines.push("");
    lines.push("Risk areas flagged for attention:");
    for (const area of riskAreas) {
      lines.push(`- ${area}`);
    }
  }

  return lines.join("\n");
}

/**
 * Build Beads issue creation inputs from a Sentinel fail verdict.
 *
 * Each issue found in the verdict becomes a separate fix issue. The follow-up
 * issue IDs in the verdict reference the issues this function creates.
 */
export function createFixIssueInputs(
  originIssue: Pick<AegisIssue, "id" | "priority">,
  verdict: SentinelVerdict,
): CreateIssueInput[] {
  if (verdict.verdict !== "fail") {
    return [];
  }

  if (!verdict.issuesFound.length) {
    return [];
  }

  const verdictRef = `sentinel-verdict-${originIssue.id}`;

  return verdict.issuesFound.map((issueDescription) => ({
    title: `Fix: ${issueDescription}`,
    description: sentinelFixDescription(
      originIssue.id,
      verdictRef,
      verdict.reviewSummary,
      verdict.riskAreas,
    ),
    issueClass: "fix",
    priority: originIssue.priority as IssuePriority,
    originId: originIssue.id,
    labels: ["sentinel-fix"],
  }));
}
