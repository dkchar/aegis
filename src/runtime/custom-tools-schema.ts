/**
 * Custom Pi SDK tools for structured artifact output.
 *
 * Provider-agnostic TypeBox schemas that work across all LLM backends
 * (OpenAI, Anthropic, Google/Gemini, etc.) via the Pi SDK's custom tool layer.
 *
 * These tools replace the fragile "parse JSON from assistant message" approach
 * with provider-validated structured tool-call payloads.
 */

import { Type, type Static } from "@sinclair/typebox";

// ---------------------------------------------------------------------------
// submit_assessment — Oracle structured output
// ---------------------------------------------------------------------------

export const SubmitAssessmentParams = Type.Object({
  files_affected: Type.Array(Type.String(), {
    description: "List of files the issue requires changes to or analysis of.",
  }),
  estimated_complexity: Type.Union(
    [Type.Literal("trivial"), Type.Literal("moderate"), Type.Literal("complex")],
    { description: "Estimated implementation complexity." },
  ),
  decompose: Type.Boolean({
    description:
      "Whether the issue should be broken into smaller sub-tasks. " +
      "True triggers the orchestrator to pause and request decomposition.",
  }),
  sub_issues: Type.Optional(
    Type.Array(Type.String(), {
      description: "Beads issue IDs for sub-tasks if decompose is true.",
    }),
  ),
  blockers: Type.Optional(
    Type.Array(Type.String(), {
      description: "Blocking issues that must be resolved before work can begin.",
    }),
  ),
  ready: Type.Boolean({
    description: "Whether the issue is ready for Titan implementation.",
  }),
});

export type SubmitAssessmentParams = Static<typeof SubmitAssessmentParams>;

// ---------------------------------------------------------------------------
// submit_handoff — Titan structured output
// ---------------------------------------------------------------------------

export const SubmitHandoffParams = Type.Object({
  issueId: Type.String({ description: "Beads issue ID this handoff corresponds to." }),
  laborPath: Type.String({
    description: "Filesystem path to the labor directory for this session.",
  }),
  candidateBranch: Type.String({
    description: "Git branch name containing the candidate merge.",
  }),
  baseBranch: Type.String({ description: "Target branch for the merge (usually 'main')." }),
  filesChanged: Type.Array(Type.String(), {
    description: "List of files modified in this Titan session.",
  }),
  testsAndChecksRun: Type.Optional(
    Type.Array(Type.String(), {
      description: "Test suites or lint checks executed during implementation.",
    }),
  ),
  knownRisks: Type.Optional(
    Type.Array(Type.String(), {
      description: "Known risks or areas requiring close Sentinel review.",
    }),
  ),
  followUpWork: Type.Optional(
    Type.Array(Type.String(), {
      description: "Follow-up tasks discovered during implementation.",
    }),
  ),
  learningsWrittenToMnemosyne: Type.Optional(
    Type.Array(Type.String(), {
      description: "Key learnings persisted to Mnemosyne during this session.",
    }),
  ),
  handoffNote: Type.Optional(
    Type.String({ description: "Free-form note for the merge/Sentinel reviewer." }),
  ),
});

export type SubmitHandoffParams = Static<typeof SubmitHandoffParams>;

// ---------------------------------------------------------------------------
// submit_verdict — Sentinel structured output
// ---------------------------------------------------------------------------

export const SubmitVerdictParams = Type.Object({
  verdict: Type.Union(
    [Type.Literal("pass"), Type.Literal("fail")],
    { description: "Review verdict. 'pass' allows merge; 'fail' blocks it." },
  ),
  reviewSummary: Type.String({
    description: "Human-readable summary of the review findings.",
  }),
  issuesFound: Type.Array(Type.String(), {
    description: "Specific issues identified during review.",
  }),
  followUpIssueIds: Type.Array(Type.String(), {
    description: "Beads issue IDs for follow-up work created during review.",
  }),
  riskAreas: Type.Array(Type.String(), {
    description: "Code areas flagged as risky or needing attention.",
  }),
});

export type SubmitVerdictParams = Static<typeof SubmitVerdictParams>;

// ---------------------------------------------------------------------------
// Re-export for convenience
// ---------------------------------------------------------------------------

export type { TSchema } from "@sinclair/typebox";
