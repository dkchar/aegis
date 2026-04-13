/**
 * Custom Pi SDK tools for structured artifact output.
 *
 * Provider-agnostic TypeBox schemas that work across all LLM backends
 * (OpenAI, Anthropic, Google/Gemini, etc.) via the Pi SDK's custom tool layer.
 *
 * These tools replace the fragile "parse JSON from assistant message" approach
 * with provider-validated structured tool-call payloads.
 */

import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { defineTool, type ToolDefinition, type ExtensionContext, type AgentToolResult } from "@mariozechner/pi-coding-agent";

// ---------------------------------------------------------------------------
// submit_assessment — Oracle structured output
// ---------------------------------------------------------------------------

const SubmitAssessmentParams = Type.Object({
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

type SubmitAssessmentParams = Static<typeof SubmitAssessmentParams>;

/** Oracle assessment custom tool. The LLM calls this with structured params;
 * the execute function is a no-op passthrough since Aegis captures the args
 * from the tool_use event for reaper verification. */
export const submitAssessmentTool: ToolDefinition = defineTool({
  name: "submit_assessment",
  label: "Submit Oracle Assessment",
  description:
    "Submit a structured Oracle assessment result. Call this with your full " +
    "assessment instead of outputting JSON in a message.",
  promptSnippet: "Use submit_assessment to submit your Oracle assessment.",
  promptGuidelines: [
    "Always call submit_assessment with your complete assessment result.",
    "Do not output the assessment as a JSON message.",
  ],
  parameters: SubmitAssessmentParams,
  execute: async (
    _toolCallId: string,
    params: SubmitAssessmentParams,
    _signal: AbortSignal | undefined,
    _onUpdate: undefined,
    _ctx: ExtensionContext,
  ): Promise<AgentToolResult<unknown>> => {
    // Passthrough — Aegis captures the tool_use event args for reaper verification.
    // Return a brief acknowledgement so the agent knows the tool succeeded.
    return {
      content: [
        {
          type: "text",
          text: `Assessment recorded: ${params.files_affected.length} file(s), ` +
            `complexity=${params.estimated_complexity}, ready=${params.ready}`,
        },
      ],
      details: {},
    };
  },
});

// ---------------------------------------------------------------------------
// submit_handoff — Titan structured output
// ---------------------------------------------------------------------------

const SubmitHandoffParams = Type.Object({
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

type SubmitHandoffParams = Static<typeof SubmitHandoffParams>;

export const submitHandoffTool: ToolDefinition = defineTool({
  name: "submit_handoff",
  label: "Submit Titan Handoff",
  description:
    "Submit a structured Titan handoff result. Call this with your full " +
    "handoff instead of outputting JSON in a message.",
  promptSnippet: "Use submit_handoff to submit your Titan handoff.",
  promptGuidelines: [
    "Always call submit_handoff with your complete handoff result.",
    "Do not output the handoff as a JSON message.",
  ],
  parameters: SubmitHandoffParams,
  execute: async (
    _toolCallId: string,
    params: SubmitHandoffParams,
    _signal: AbortSignal | undefined,
    _onUpdate: undefined,
    _ctx: ExtensionContext,
  ): Promise<AgentToolResult<unknown>> => {
    return {
      content: [
        {
          type: "text",
          text: `Handoff recorded: ${params.filesChanged.length} file(s) changed on ${params.candidateBranch}`,
        },
      ],
      details: {},
    };
  },
});

// ---------------------------------------------------------------------------
// submit_verdict — Sentinel structured output
// ---------------------------------------------------------------------------

const SubmitVerdictParams = Type.Object({
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

type SubmitVerdictParams = Static<typeof SubmitVerdictParams>;

export const submitVerdictTool: ToolDefinition = defineTool({
  name: "submit_verdict",
  label: "Submit Sentinel Verdict",
  description:
    "Submit a structured Sentinel review verdict. Call this with your full " +
    "verdict instead of outputting JSON in a message.",
  promptSnippet: "Use submit_verdict to submit your Sentinel verdict.",
  promptGuidelines: [
    "Always call submit_verdict with your complete verdict.",
    "Do not output the verdict as a JSON message.",
  ],
  parameters: SubmitVerdictParams,
  execute: async (
    _toolCallId: string,
    params: SubmitVerdictParams,
    _signal: AbortSignal | undefined,
    _onUpdate: undefined,
    _ctx: ExtensionContext,
  ): Promise<AgentToolResult<unknown>> => {
    return {
      content: [
        {
          type: "text",
          text: `Verdict recorded: ${params.verdict}`,
        },
      ],
      details: {},
    };
  },
});

// ---------------------------------------------------------------------------
// All custom tools, keyed by caste for easy lookup
// ---------------------------------------------------------------------------

const ORACLE_TOOLS = [submitAssessmentTool];
const TITAN_TOOLS = [submitHandoffTool];
const SENTINEL_TOOLS = [submitVerdictTool];
// Janus has no custom tool yet — uses message-based artifacts.

/** Return the custom tools for a given caste. */
export function getCustomToolsForCaste(caste: string): ToolDefinition[] {
  switch (caste) {
    case "oracle":
      return ORACLE_TOOLS;
    case "titan":
      return TITAN_TOOLS;
    case "sentinel":
      return SENTINEL_TOOLS;
    default:
      return [];
  }
}

// Re-export schemas for tests or other consumers
export { SubmitAssessmentParams, SubmitHandoffParams, SubmitVerdictParams };
export type { SubmitAssessmentParams as SubmitAssessmentParamsType, SubmitHandoffParams as SubmitHandoffParamsType, SubmitVerdictParams as SubmitVerdictParamsType };
export type { TSchema };
