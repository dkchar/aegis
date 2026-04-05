/**
 * Oracle execution contract.
 *
 * This module composes the Oracle prompt, parses the assessment, and derives
 * sub-issue inputs. It stays side-effect free so lane B can wire dispatch and
 * Beads mutations independently.
 */

import type { AegisIssue, CreateIssueInput } from "../tracker/issue-model.js";
import {
  type OracleAssessment,
  parseOracleAssessment,
} from "../castes/oracle/oracle-parser.js";
import {
  buildOraclePrompt,
  issueToOraclePromptIssue,
} from "../castes/oracle/oracle-prompt.js";
import { createDerivedIssueInputs } from "../tracker/create-derived-issues.js";

export interface OracleResponder {
  (prompt: string): Promise<string>;
}

export interface RunOracleInput {
  issue: AegisIssue;
  askOracle: OracleResponder;
}

export interface RunOracleOutcome {
  prompt: string;
  assessment: OracleAssessment;
  derivedIssues: CreateIssueInput[];
  requiresHumanApproval: boolean;
}

/**
 * Run Oracle in a pure, dependency-injected form.
 *
 * The caller supplies the Oracle transport via `askOracle`. The function
 * builds the canonical prompt, parses the strict assessment, and derives any
 * sub-issue creation inputs. A complex assessment is surfaced through the
 * `requiresHumanApproval` flag so the caller can pause Titan dispatch.
 */
export async function runOracle(input: RunOracleInput): Promise<RunOracleOutcome> {
  const prompt = buildOraclePrompt(issueToOraclePromptIssue(input.issue));
  const raw = await input.askOracle(prompt);
  const assessment = parseOracleAssessment(raw);
  const derivedIssues = createDerivedIssueInputs(input.issue, assessment);

  return {
    prompt,
    assessment,
    derivedIssues,
    requiresHumanApproval: assessment.estimated_complexity === "complex",
  };
}
