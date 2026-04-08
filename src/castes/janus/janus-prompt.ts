/**
 * Janus prompt construction.
 *
 * SPECv2 §10.4:
 *   - Janus resolves merge-boundary escalations that the deterministic queue cannot safely clear
 *   - Default budget: 12 turns, 120k tokens
 *   - Allowed tools: read, write/edit only inside preserved conflict labor or dedicated integration labor, shell, tracker commands
 *   - Success: produces structured integration-resolution artifact, prepares refreshed candidate for requeue OR emits explicit unresolved escalation artifact
 *   - NEVER merges directly outside the queue
 *   - Does NOT replace Titan for ordinary implementation
 *   - Returns control to deterministic queue processing or explicit human decision point
 */

export const JANUS_PROMPT_SECTIONS = [
  "issue_context",
  "queue_context",
  "conflict_analysis",
  "labor_boundary",
  "budget_constraints",
  "tool_restrictions",
  "resolution_contract",
  "output_format",
] as const;

export const JANUS_PROMPT_RULES = [
  "work only inside the preserved conflict labor or dedicated integration labor",
  "do NOT merge directly outside the queue",
  "do NOT replace Titan for ordinary implementation",
  "produce a structured integration-resolution artifact as JSON",
  "return control to deterministic queue processing or emit an explicit human-decision artifact",
  "stay within 12 turns and 120k token budget",
  "use only: read, write/edit inside labor, shell, tracker commands",
] as const;

/** Context required to construct a Janus escalation prompt. */
export interface JanusPromptContext {
  /** The originating Beads issue ID (e.g. "aegis-fjm.5"). */
  originatingIssueId: string;

  /** The merge queue item ID. */
  queueItemId: string;

  /** Path to the preserved conflict labor or integration branch workspace. */
  preservedLaborPath: string;

  /** Summary of the conflict or failure that triggered Janus escalation. */
  conflictSummary: string;

  /** List of files involved in the conflict or failure. */
  filesInvolved: string[];

  /** Error output from the previous merge attempt(s). */
  previousMergeErrors: string;

  /** The conflict tier that triggered this escalation (per SPECv2 §12.8). */
  conflictTier: number;
}

/** Full prompt contract returned to the caller. */
export interface JanusPromptContract extends JanusPromptContext {
  sections: typeof JANUS_PROMPT_SECTIONS;
  rules: typeof JANUS_PROMPT_RULES;
  /** Budget: maximum turns allowed for this Janus session. */
  maxTurns: number;
  /** Budget: maximum tokens allowed for this Janus session. */
  maxTokens: number;
}

/**
 * Build the full Janus prompt contract from the escalation context.
 *
 * @param context - The escalation context from the merge queue.
 * @returns A validated JanusPromptContract ready for prompt rendering.
 */
export function createJanusPromptContract(
  context: JanusPromptContext,
): JanusPromptContract {
  return {
    ...context,
    sections: JANUS_PROMPT_SECTIONS,
    rules: JANUS_PROMPT_RULES,
    maxTurns: 12,
    maxTokens: 120_000,
  };
}

/**
 * Render the Janus prompt as a string for the agent runtime.
 *
 * The prompt embeds all escalation context, labor boundaries, budget
 * constraints, and the required structured output contract.
 *
 * @param contract - The Janus prompt contract.
 * @returns The rendered prompt string.
 */
export function buildJanusPrompt(contract: JanusPromptContract): string {
  const filesList = contract.filesInvolved.length > 0
    ? contract.filesInvolved.map((f) => `  - ${f}`).join("\n")
    : "  (none identified)";

  return [
    "You are Janus, the escalation-only integration caste for Aegis.",
    "You resolve merge-boundary escalations that the deterministic queue cannot safely clear.",
    "Return ONLY a structured JSON integration-resolution artifact.",
    "",
    "=== Issue Context ===",
    `Originating issue: ${contract.originatingIssueId}`,
    `Queue item: ${contract.queueItemId}`,
    `Preserved labor path: ${contract.preservedLaborPath}`,
    `Conflict tier: ${contract.conflictTier}`,
    "",
    "=== Conflict Analysis ===",
    `Conflict summary: ${contract.conflictSummary}`,
    "",
    "Files involved in the conflict:",
    filesList,
    "",
    "Previous merge attempt errors:",
    contract.previousMergeErrors || "  (none recorded)",
    "",
    "=== Labor Boundary ===",
    "You may ONLY read, write, or edit files inside the preserved conflict labor or dedicated integration labor.",
    "Do NOT modify files outside the labor directory.",
    "Do NOT merge directly outside the queue.",
    "Do NOT replace Titan for ordinary implementation work.",
    "",
    "=== Budget Constraints ===",
    `Maximum turns: ${contract.maxTurns}`,
    `Maximum tokens: ${contract.maxTokens}`,
    "If you approach these limits without resolution, emit an explicit unresolved escalation artifact.",
    "",
    "=== Tool Restrictions ===",
    "Allowed tools:",
    "  - read (any file inside the labor)",
    "  - write/edit (ONLY inside the preserved conflict labor or dedicated integration labor)",
    "  - shell (git commands, test runners, build commands)",
    "  - tracker commands (bd create, bd update, bd close for issue management)",
    "",
    "Sections:",
    ...contract.sections.map((section) => `- ${section}`),
    "",
    "Rules:",
    ...contract.rules.map((rule) => `- ${rule}`),
    "",
    "=== Output Format ===",
    "Return a JSON object with exactly these keys:",
    '- "originatingIssueId": string — the originating Beads issue ID',
    '- "queueItemId": string — the merge queue item ID',
    '- "preservedLaborPath": string — path to the labor workspace',
    '- "conflictSummary": string — summary of what was resolved or why resolution failed',
    '- "resolutionStrategy": string — the strategy chosen and applied',
    '- "filesTouched": string[] — list of files modified during resolution',
    '- "validationsRun": string[] — list of checks run after resolution (tests, lint, build)',
    '- "residualRisks": string[] — remaining risks or concerns',
    '- "recommendedNextAction": "requeue" | "manual_decision" | "fail"',
    "",
    "recommendedNextAction must be one of:",
    '  - "requeue" — the conflict was resolved; return the candidate to the queue for a fresh mechanical pass',
    '  - "manual_decision" — semantic ambiguity or policy conflict requires human decision',
    '  - "fail" — resolution failed, budget exhausted, or unsafe to proceed',
    "",
    "Do NOT include any text outside the JSON object.",
  ].join("\n");
}
