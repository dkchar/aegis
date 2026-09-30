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
import type { AdapterUsage } from "./adapter-contract.js";
import { ActivityLog, compactActivityText as compact } from "./activity-log.js";
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
  /** Called with each `--json` event line as it arrives so activity streams live. */
  onStdoutLine?: (line: string) => void;
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
    onStdoutLine: request.onStdoutLine,
  });
}

type CodexEvent = Record<string, unknown>;

function isRecord(value: unknown): value is CodexEvent {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Folds `codex exec --json` events into operator-facing activity lines and
 * token usage. Unknown events are ignored, so Codex schema drift degrades to
 * a quieter log instead of a failed session.
 */
export class CodexEventParser {
  readonly toolsUsed = new Set<string>(["codex exec"]);
  private readonly activity: ActivityLog;
  private usageTotals: { input: number; cached: number; output: number; turns: number } | null = null;
  private linesSeen = 0;

  constructor(onLogLine?: (line: string) => void) {
    this.activity = new ActivityLog(onLogLine);
  }

  get terminalLog() {
    return this.activity.lines;
  }

  get hasInput() {
    return this.linesSeen > 0;
  }

  get usage(): AdapterUsage | undefined {
    return this.usageTotals
      ? {
        inputTokens: this.usageTotals.input,
        cacheReadInputTokens: this.usageTotals.cached,
        outputTokens: this.usageTotals.output,
        turns: this.usageTotals.turns,
      }
      : undefined;
  }

  push(line: string) {
    this.linesSeen += 1;
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      return;
    }

    let event: unknown;
    try {
      event = JSON.parse(trimmed);
    } catch {
      return;
    }
    if (!isRecord(event)) {
      return;
    }

    switch (event["type"]) {
      case "thread.started":
        this.log(`[session] thread ${String(event["thread_id"] ?? "unknown")}`);
        break;
      case "turn.completed":
        this.addUsage(event["usage"]);
        break;
      case "turn.failed":
      case "error": {
        const error = isRecord(event["error"]) ? event["error"]["message"] : event["message"];
        this.log(`[error] ${compact(typeof error === "string" ? error : "Codex reported an error.")}`);
        break;
      }
      case "item.started":
      case "item.completed":
        this.applyItem(event["type"], event["item"]);
        break;
      default:
        break;
    }
  }

  pushText(stdout: string) {
    for (const line of stdout.split(/\r?\n/)) {
      this.push(line);
    }
  }

  private addUsage(usage: unknown) {
    if (!isRecord(usage)) {
      return;
    }
    const totals = this.usageTotals ?? { input: 0, cached: 0, output: 0, turns: 0 };
    this.usageTotals = {
      input: totals.input + readCount(usage["input_tokens"]),
      cached: totals.cached + readCount(usage["cached_input_tokens"]),
      output: totals.output + readCount(usage["output_tokens"]),
      turns: totals.turns + 1,
    };
  }

  private applyItem(phase: "item.started" | "item.completed", item: unknown) {
    if (!isRecord(item) || typeof item["type"] !== "string") {
      return;
    }

    const kind = item["type"];
    if (kind === "command_execution" && typeof item["command"] === "string") {
      this.toolsUsed.add("shell");
      if (phase === "item.started") {
        this.log(`[tool] shell ${compact(item["command"], 160)}`);
      } else if (typeof item["exit_code"] === "number" && item["exit_code"] !== 0) {
        this.log(`[tool_error] exit ${item["exit_code"]} ${compact(item["command"], 160)}`);
      }
      return;
    }
    if (phase !== "item.completed") {
      return;
    }
    if (kind === "agent_message" && typeof item["text"] === "string" && item["text"].trim()) {
      this.log(`[assistant] ${compact(item["text"])}`);
    } else if (kind === "file_change" && Array.isArray(item["changes"])) {
      this.toolsUsed.add("file_change");
      const paths = item["changes"]
        .map((change) => (isRecord(change) && typeof change["path"] === "string" ? change["path"] : null))
        .filter((entry): entry is string => entry !== null);
      this.log(`[edit] ${compact(paths.join(", "), 160) || "files"}`);
    }
  }

  private log(line: string) {
    this.activity.push(line);
  }
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

    const events = new CodexEventParser(input.onActivity);
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
        onStdoutLine: (line) => events.push(line),
      });
      outputText = readFileSync(outputPath, "utf8").trim();
    } finally {
      rmSync(outputPath, { force: true });
    }
    if (!events.hasInput) {
      events.pushText(result.stdout);
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
      toolsUsed: [...events.toolsUsed],
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
      ...(events.terminalLog.length > 0 ? { terminalLog: events.terminalLog } : {}),
      ...(events.usage ? { usage: events.usage } : {}),
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
