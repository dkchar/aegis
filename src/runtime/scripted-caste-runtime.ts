import { randomUUID } from "node:crypto";

import type { CasteName, CasteRunInput, CasteRuntime, CasteSessionResult } from "./caste-runtime.js";

type ScriptedResponse = {
  output: string;
  toolsUsed?: string[];
  error?: string;
};

type ScriptedHandlers = Partial<Record<CasteName, (input: CasteRunInput) => ScriptedResponse>>;

export class ScriptedCasteRuntime implements CasteRuntime {
  constructor(private readonly handlers: ScriptedHandlers = {}) {}

  async run(input: CasteRunInput): Promise<CasteSessionResult> {
    const startedAt = new Date().toISOString();
    const response = this.handlers[input.caste]?.(input) ?? {
      output: "{}",
      toolsUsed: [],
    };
    const finishedAt = new Date().toISOString();

    return {
      sessionId: randomUUID(),
      caste: input.caste,
      status: response.error ? "failed" : "succeeded",
      outputText: response.output,
      toolsUsed: response.toolsUsed ?? [],
      startedAt,
      finishedAt,
      ...(response.error ? { error: response.error } : {}),
    };
  }
}

export function createDefaultScriptedCasteRuntime(root = process.cwd(), issueId = "issue"): CasteRuntime {
  return new ScriptedCasteRuntime({
    oracle: () => ({
      output: JSON.stringify({
        files_affected: [],
        estimated_complexity: "moderate",
        decompose: false,
        ready: true,
      }),
      toolsUsed: ["read_file"],
    }),
    titan: () => ({
      output: JSON.stringify({
        outcome: "success",
        summary: "deterministic scripted implementation",
        files_changed: [],
        tests_and_checks_run: [],
        known_risks: [],
        follow_up_work: [],
        learnings_written_to_mnemosyne: [],
      }),
      toolsUsed: ["write_file"],
    }),
    sentinel: () => ({
      output: JSON.stringify({
        verdict: "pass",
        reviewSummary: "deterministic scripted review",
        issuesFound: [],
        followUpIssueIds: [],
        riskAreas: [],
      }),
      toolsUsed: ["read_file"],
    }),
    janus: () => ({
      output: JSON.stringify({
        originatingIssueId: issueId,
        queueItemId: `queue-${issueId}`,
        preservedLaborPath: root,
        conflictSummary: "deterministic scripted resolution",
        resolutionStrategy: "no-op scripted handoff",
        filesTouched: [],
        validationsRun: [],
        residualRisks: [],
        recommendedNextAction: "requeue",
      }),
      toolsUsed: ["read_file"],
    }),
  });
}
