import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  CasteName,
  CasteRunInput,
  CasteRuntime,
  CasteSessionResult,
} from "./caste-runtime.js";
import type { AegisThinkingLevel } from "../config/schema.js";
import { createCasteConfig, type CasteConfigRecord } from "../config/caste-config.js";
import { parseModelReference, tailText, type ParsedModelConfig } from "./model-reference.js";
import {
  buildCliSpawnInvocation,
  buildTerminateMatchingWorkspaceProcessesScript,
  runSupervisedProcess,
  terminateWorkspaceProcesses,
} from "./workspace-processes.js";

type CodexModelConfig = ParsedModelConfig;

interface CodexRunRequest {
  cwd: string;
  modelId: string;
  thinkingLevel: AegisThinkingLevel;
  prompt: string;
  outputPath: string;
  timeoutMs: number;
}

interface CodexRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export interface CodexCasteRuntimeOptions {
  sessionTimeoutMs?: number;
  runner?: (request: CodexRunRequest) => Promise<CodexRunResult>;
}

const DEFAULT_CODEX_SESSION_TIMEOUT_MS = 1_800_000;
const CODEX_PROVIDER = "openai-codex";
const CODEX_DEFAULT_MODEL = "gpt-5.4-mini";
const CODEX_PROCESS_PATTERN = "\\bcodex(\\.cmd|\\.exe|\\.js)?\\b";

function resolveCodexSandboxMode(platform: NodeJS.Platform) {
  // Codex workspace-write shell execution is broken on Windows.
  return platform === "win32" ? "danger-full-access" : "workspace-write";
}

export function buildTerminateCodexSessionProcessesScript(workingDirectory: string) {
  return buildTerminateMatchingWorkspaceProcessesScript(workingDirectory, CODEX_PROCESS_PATTERN);
}

/** Kills Codex exec processes (and their trees) rooted in the workspace. */
export function terminateCodexSessionProcesses(
  workingDirectory: string,
  platform: NodeJS.Platform = process.platform,
) {
  terminateWorkspaceProcesses(workingDirectory, new RegExp(CODEX_PROCESS_PATTERN, "i"), platform);
}

export function buildCodexExecArgs(
  request: CodexRunRequest,
  platform: NodeJS.Platform = process.platform,
): string[] {
  return [
    "-a",
    "never",
    "exec",
    "-C",
    request.cwd,
    "-s",
    resolveCodexSandboxMode(platform),
    "-m",
    request.modelId,
    "-c",
    `model_reasoning_effort="${request.thinkingLevel}"`,
    "--ignore-user-config",
    "--ignore-rules",
    "--json",
    "--output-last-message",
    request.outputPath,
    "-",
  ];
}

export function buildCodexSpawnInvocation(
  codexArgs: string[],
  platform: NodeJS.Platform = process.platform,
) {
  return buildCliSpawnInvocation("codex", codexArgs, platform);
}

function runCodexExec(request: CodexRunRequest): Promise<CodexRunResult> {
  const invocation = buildCodexSpawnInvocation(buildCodexExecArgs(request));
  return runSupervisedProcess({
    label: "Codex",
    command: invocation.command,
    args: invocation.args,
    cwd: request.cwd,
    stdin: request.prompt,
    inactivityTimeoutMs: request.timeoutMs,
  });
}

export class CodexCasteRuntime implements CasteRuntime {
  private readonly modelConfigs: CasteConfigRecord<CodexModelConfig>;
  private readonly sessionTimeoutMs: number;
  private readonly runner: (request: CodexRunRequest) => Promise<CodexRunResult>;

  constructor(
    modelConfigs: Partial<CasteConfigRecord<CodexModelConfig>> = {},
    options: CodexCasteRuntimeOptions = {},
  ) {
    this.modelConfigs = {
      ...createCasteConfig(() => parseModelReference(`${CODEX_PROVIDER}:${CODEX_DEFAULT_MODEL}`, "medium", CODEX_PROVIDER)),
      ...modelConfigs,
    };
    this.sessionTimeoutMs = options.sessionTimeoutMs ?? DEFAULT_CODEX_SESSION_TIMEOUT_MS;
    this.runner = options.runner ?? runCodexExec;
  }

  async run(input: CasteRunInput): Promise<CasteSessionResult> {
    const sessionId = randomUUID();
    const startedAt = new Date().toISOString();
    const modelConfig = this.modelConfigs[input.caste];
    const outputDirectory = path.join(tmpdir(), "aegis-codex-runtime");
    mkdirSync(outputDirectory, { recursive: true });
    const outputPath = path.join(outputDirectory, `${sessionId}.txt`);
    writeFileSync(outputPath, "", "utf8");

    let result: CodexRunResult;
    let outputText: string;
    try {
      result = await this.runner({
        cwd: input.workingDirectory,
        modelId: modelConfig.modelId,
        thinkingLevel: modelConfig.thinkingLevel,
        prompt: input.prompt,
        outputPath,
        timeoutMs: this.sessionTimeoutMs,
      });
      outputText = readFileSync(outputPath, "utf8").trim();
    } finally {
      rmSync(outputPath, { force: true });
    }

    const finishedAt = new Date().toISOString();
    const error = result.exitCode === 0
      ? undefined
      : [tailText(result.stderr), tailText(result.stdout)].filter((chunk) => chunk.length > 0).join("\n");

    return {
      sessionId,
      caste: input.caste,
      modelRef: modelConfig.reference,
      provider: modelConfig.provider,
      modelId: modelConfig.modelId,
      thinkingLevel: modelConfig.thinkingLevel,
      status: result.exitCode === 0 ? "succeeded" : "failed",
      outputText,
      toolsUsed: ["codex exec"],
      messageLog: [
        {
          role: "user",
          content: input.prompt,
        },
        {
          role: "assistant",
          content: outputText,
        },
      ],
      startedAt,
      finishedAt,
      ...(error ? { error } : {}),
    };
  }
}

export function createCodexModelConfigs(
  models: CasteConfigRecord<string>,
  thinking: CasteConfigRecord<AegisThinkingLevel>,
) {
  return createCasteConfig((caste: CasteName) => parseModelReference(models[caste], thinking[caste], CODEX_PROVIDER));
}
