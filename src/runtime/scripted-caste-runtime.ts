import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type {
  CasteName,
  CasteRunInput,
  CasteRuntime,
  CasteSessionResult,
} from "./caste-runtime.js";
import type { AegisThinkingLevel } from "../config/schema.js";

type ScriptedResponse = {
  output: string;
  toolsUsed?: string[];
  error?: string;
};

type ScriptedHandlers = Partial<Record<CasteName, (input: CasteRunInput) => ScriptedResponse>>;
type ScriptedModelConfig = {
  reference: string;
  provider: string;
  modelId: string;
  thinkingLevel: AegisThinkingLevel;
};
type ScriptedModelConfigs = Partial<Record<CasteName, ScriptedModelConfig>>;

const SCRIPTED_TITAN_PROOF_FILE = "aegis-scripted-proof.txt";

function normalizeScriptedScopeFile(candidate: string) {
  return candidate.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

function extractAllowedFileScope(prompt: string): string[] {
  const match = prompt.match(/^Allowed file scope:\s*(.+)$/im);
  if (!match) {
    return [];
  }

  return match[1]!
    .split(",")
    .map((entry) => normalizeScriptedScopeFile(entry))
    .filter((entry) => entry.length > 0);
}

function selectScriptedTitanProofFile(input: CasteRunInput) {
  return extractAllowedFileScope(input.prompt)[0] ?? SCRIPTED_TITAN_PROOF_FILE;
}

function isScriptedHandlers(
  value: ScriptedModelConfigs | ScriptedHandlers,
): value is ScriptedHandlers {
  return Object.values(value).every((entry) => entry === undefined || typeof entry === "function");
}

export class ScriptedCasteRuntime implements CasteRuntime {
  private readonly modelConfigs: ScriptedModelConfigs;
  private readonly handlers: ScriptedHandlers;

  constructor(
    modelConfigsOrHandlers: ScriptedModelConfigs | ScriptedHandlers = {},
    handlers: ScriptedHandlers = {},
  ) {
    if (Object.keys(handlers).length === 0 && isScriptedHandlers(modelConfigsOrHandlers)) {
      this.modelConfigs = {};
      this.handlers = modelConfigsOrHandlers;
      return;
    }

    this.modelConfigs = modelConfigsOrHandlers as ScriptedModelConfigs;
    this.handlers = handlers;
  }

  async run(input: CasteRunInput): Promise<CasteSessionResult> {
    const startedAt = new Date().toISOString();
    const response = this.handlers[input.caste]?.(input) ?? {
      output: "{}",
      toolsUsed: [],
    };
    const finishedAt = new Date().toISOString();
    const modelConfig = this.modelConfigs[input.caste] ?? {
      reference: "scripted:deterministic",
      provider: "scripted",
      modelId: "deterministic",
      thinkingLevel: "off" as const,
    };

    return {
      sessionId: randomUUID(),
      caste: input.caste,
      modelRef: modelConfig.reference,
      provider: modelConfig.provider,
      modelId: modelConfig.modelId,
      thinkingLevel: modelConfig.thinkingLevel,
      status: response.error ? "failed" : "succeeded",
      outputText: response.output,
      toolsUsed: response.toolsUsed ?? [],
      messageLog: [
        {
          role: "user",
          content: input.prompt,
        },
        {
          role: "assistant",
          content: response.output,
        },
      ],
      startedAt,
      finishedAt,
      ...(response.error ? { error: response.error } : {}),
    };
  }
}

function parseConfiguredModel(
  reference: string,
  thinkingLevel: AegisThinkingLevel,
): ScriptedModelConfig {
  const separatorIndex = reference.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex === reference.length - 1) {
    return {
      reference,
      provider: "unknown",
      modelId: "unknown",
      thinkingLevel,
    };
  }

  return {
    reference,
    provider: reference.slice(0, separatorIndex),
    modelId: reference.slice(separatorIndex + 1),
    thinkingLevel,
  };
}

function parseForcedIssueSet(value: string | undefined) {
  if (!value || value.trim().length === 0) {
    return new Set<string>();
  }

  return new Set(
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  );
}

function parseForcedJanusAction(
  value: string | undefined,
): "requeue_parent" | "create_integration_blocker" {
  if (value === "create_integration_blocker" || value === "manual_decision" || value === "fail") {
    return "create_integration_blocker";
  }

  if (value === "requeue_parent" || value === "requeue") {
    return "requeue_parent";
  }

  return "requeue_parent";
}

function runGit(workingDirectory: string, args: string[]) {
  return spawnSync("git", args, {
    cwd: workingDirectory,
    encoding: "utf8",
    windowsHide: true,
  });
}

function isGitWorkingTree(workingDirectory: string) {
  const probe = runGit(workingDirectory, ["rev-parse", "--is-inside-work-tree"]);
  return probe.status === 0 && probe.stdout.trim() === "true";
}

function formatGitFailure(result: ReturnType<typeof runGit>) {
  return `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
}

function buildDeterministicTitanResponse(input: CasteRunInput): ScriptedResponse {
  if (!isGitWorkingTree(input.workingDirectory)) {
    return {
      output: JSON.stringify({
        outcome: "success",
        summary: "deterministic scripted implementation",
        files_changed: [],
        tests_and_checks_run: [],
        known_risks: [],
        follow_up_work: [],
      }),
      toolsUsed: ["write_file"],
    };
  }

  const proofFile = selectScriptedTitanProofFile(input);
  const proofPath = path.join(input.workingDirectory, ...proofFile.split("/"));
  mkdirSync(path.dirname(proofPath), { recursive: true });
  const existingProof = existsSync(proofPath)
    ? readFileSync(proofPath, "utf8")
    : "";
  const nextSequence = (existingProof.match(/^sequence:/gm) ?? []).length + 1;
  writeFileSync(
    proofPath,
    `scripted titan proof for ${input.issueId}\nsequence:${nextSequence}\n`,
    "utf8",
  );

  const add = runGit(input.workingDirectory, ["add", proofFile]);
  if (add.status !== 0) {
    return {
      output: "{}",
      error: `Failed to stage scripted Titan proof. ${formatGitFailure(add)}`,
      toolsUsed: ["write_file"],
    };
  }

  const commit = runGit(
    input.workingDirectory,
    ["commit", "-m", `chore(${input.issueId}): scripted titan proof`],
  );
  if (commit.status !== 0) {
    return {
      output: "{}",
      error: `Failed to commit scripted Titan proof. ${formatGitFailure(commit)}`,
      toolsUsed: ["write_file"],
    };
  }

  return {
    output: JSON.stringify({
      outcome: "success",
      summary: "deterministic scripted implementation",
      files_changed: [proofFile],
      tests_and_checks_run: ["git rev-parse HEAD"],
      known_risks: [],
      follow_up_work: [],
    }),
    toolsUsed: ["write_file", "shell"],
  };
}

export function createScriptedModelConfigs(
  configuredModels: Record<CasteName, string>,
  thinkingLevels: Record<CasteName, AegisThinkingLevel>,
): ScriptedModelConfigs {
  return {
    oracle: parseConfiguredModel(configuredModels.oracle, thinkingLevels.oracle),
    titan: parseConfiguredModel(configuredModels.titan, thinkingLevels.titan),
    sentinel: parseConfiguredModel(configuredModels.sentinel, thinkingLevels.sentinel),
    janus: parseConfiguredModel(configuredModels.janus, thinkingLevels.janus),
  };
}

export function createDefaultScriptedCasteRuntime(
  modelConfigs: ScriptedModelConfigs = {},
  root = process.cwd(),
  issueId = "issue",
): CasteRuntime {
  const forcedSentinelFailures = parseForcedIssueSet(process.env.AEGIS_SCRIPTED_SENTINEL_FAIL_ISSUES);
  const forcedJanusAction = parseForcedJanusAction(process.env.AEGIS_SCRIPTED_JANUS_NEXT_ACTION);

  return new ScriptedCasteRuntime(modelConfigs, {
    oracle: () => ({
      output: JSON.stringify({
        files_affected: [],
        estimated_complexity: "moderate",
        risks: [],
        suggested_checks: [],
        scope_notes: [],
      }),
      toolsUsed: ["read_file"],
    }),
    titan: (input) => buildDeterministicTitanResponse(input),
    sentinel: (input) => {
      if (forcedSentinelFailures.has("*") || forcedSentinelFailures.has(input.issueId)) {
        return {
          output: JSON.stringify({
            verdict: "fail_blocking",
            reviewSummary: "deterministic scripted review failure",
            blockingFindings: [
              "add missing sentinel regression coverage",
            ],
            advisories: ["review-observability"],
            touchedFiles: [],
            contractChecks: ["scripted contract check"],
          }),
          toolsUsed: ["read_file"],
        };
      }

      return {
        output: JSON.stringify({
          verdict: "pass",
          reviewSummary: "deterministic scripted review",
          blockingFindings: [],
          advisories: [],
          touchedFiles: [],
          contractChecks: ["scripted contract check"],
        }),
        toolsUsed: ["read_file"],
      };
    },
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
        mutation_proposal: forcedJanusAction === "requeue_parent"
          ? {
              proposal_type: "requeue_parent",
              summary: "deterministic scripted requeue",
              scope_evidence: ["scripted merge conflict remains in parent scope"],
            }
          : {
              proposal_type: "create_integration_blocker",
              summary: "deterministic scripted integration blocker",
              suggested_title: `Resolve integration blocker for ${issueId}`,
              suggested_description: "Scripted Janus found integration work outside parent scope.",
              scope_evidence: ["scripted merge conflict outside parent scope"],
            },
      }),
      toolsUsed: ["read_file"],
    }),
  });
}
