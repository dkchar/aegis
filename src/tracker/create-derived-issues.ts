/**
 * Derived-issue scaffolding for Oracle decomposition.
 *
 * Oracle can request decomposition via sub_issues. This helper converts that
 * parsed assessment into Beads issue creation inputs while preserving the
 * origin link explicitly.
 */

import type { CreateIssueInput, IssuePriority, AegisIssue } from "./issue-model.js";
import type { OracleAssessment } from "../castes/oracle/oracle-parser.js";

/**
 * Build Beads issue creation inputs from an Oracle assessment.
 *
 * Only decomposition-derived sub-issues are converted here. Blockers remain
 * part of the assessment contract for the caller to handle mechanically.
 */
export function createDerivedIssueInputs(
  originIssue: Pick<AegisIssue, "id" | "priority">,
  assessment: OracleAssessment,
): CreateIssueInput[] {
  if (!assessment.decompose) {
    return [];
  }

  if (!assessment.sub_issues?.length) {
    throw new Error(
      "Oracle assessment with decompose=true must include at least one sub_issues entry.",
    );
  }

  return assessment.sub_issues.map((title) => ({
    title,
    description: `Derived from Oracle assessment for ${originIssue.id}.`,
    issueClass: "sub",
    priority: originIssue.priority as IssuePriority,
    originId: originIssue.id,
    labels: [],
  }));
}
