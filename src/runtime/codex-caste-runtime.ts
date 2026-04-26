import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import type {
  CasteName,
  CasteRunInput,
  CasteRuntime,
  CasteSessionResult,
} from "./caste-runtime.js";
import type { AegisThinkingLevel } from "../config/schema.js";
import { createCasteConfig, type CasteConfigRecord } from "../config/caste-config.js";

interface CodexModelConfig {
  reference: string;
  provider: string;
  modelId: string;
  thinkingLevel: AegisThinkingLevel;
}

interface CodexRunRequest {
  cwd: string;
  modelId: string;
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

function parseModelReference(reference: string, thinkingLevel: AegisThinkingLevel): CodexModelConfig {
  const separator = reference.indexOf(":");
  if (separator === -1) {
    return {
      reference,
      provider: "openai-codex",
      modelId: reference,
      thinkingLevel,
    };
  }

  return {
    reference,
    provider: reference.slice(0, separator),
    modelId: reference.slice(separator + 1),
    thinkingLevel,
  };
}

function defaultModelConfigs() {
  return createCasteConfig(() => ({
    reference: "openai-codex:gpt-5.4-mini",
    provider: "openai-codex",
    modelId: "gpt-5.4-mini",
    thinkingLevel: "medium" as const,
  }));
}

function runCodexExec(request: CodexRunRequest): Promise<CodexRunResult> {
  return new Promise((resolve) => {
    const child = spawn("codex", [
      "-C",
      request.cwd,
      "-s",
      "workspace-write",
      "-a",
      "never",
      "-m",
      request.modelId,
      "exec",
      "--json",
      "--output-last-message",
      request.outputPath,
      "-",
    ], {
      cwd: request.cwd,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
    }, request.timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      resolve({
        exitCode: 1,
        stdout,
        stderr: `${stderr}${stderr.length > 0 ? "\n" : ""}${error.message}`,
      });
    });
    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      resolve({ exitCode, stdout, stderr });
    });
    child.stdin.end(request.prompt);
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
      ...defaultModelConfigs(),
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

    const result = await this.runner({
      cwd: input.workingDirectory,
      modelId: modelConfig.modelId,
      prompt: input.prompt,
      outputPath,
      timeoutMs: this.sessionTimeoutMs,
    });
    const finishedAt = new Date().toISOString();
    const outputText = readFileSync(outputPath, "utf8").trim();
    rmSync(outputPath, { force: true });
    const error = result.exitCode === 0
      ? undefined
      : [result.stderr.trim(), result.stdout.trim()].filter((chunk) => chunk.length > 0).join("\n");

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
  return createCasteConfig((caste: CasteName) => parseModelReference(models[caste], thinking[caste]));
}
