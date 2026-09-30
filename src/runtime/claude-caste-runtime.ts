import { randomUUID } from "node:crypto";

import type {
  CasteName,
  CasteRunInput,
  CasteRuntime,
  CasteSessionMessage,
  CasteSessionResult,
} from "./caste-runtime.js";
import type { AdapterUsage } from "./adapter-contract.js";
import type { AegisThinkingLevel } from "../config/schema.js";
import { createCasteConfig, type CasteConfigRecord } from "../config/caste-config.js";
import { parseModelReference, tailText, type ParsedModelConfig } from "./model-reference.js";
import {
  buildCliSpawnInvocation,
  runSupervisedProcess,
  terminateRegisteredSessionProcesses,
  terminateWorkspaceProcesses,
} from "./workspace-processes.js";

/**
 * Claude Code runtime adapter.
 *
 * Runs one caste assignment as a headless `claude -p` session with
 * `--output-format stream-json`, so Aegis receives every assistant turn, tool
 * call, and the final result (including usage) as newline-delimited JSON.
 *
 * Contract enforcement:
 * - cwd jail: the session starts in the labor (or project root for Oracle and
 *   Janus); Claude Code confines file tools to that directory, and Aegis still
 *   validates git proof and file scope after the session.
 * - per-caste tool policy: Oracle is read-only, Sentinel and Janus cannot use
 *   edit tools, Janus shell access is limited to read-only git commands.
 * - MCP servers from user config are ignored (`--strict-mcp-config`).
 * - forbidden dev/watch servers are killed and fail the session.
 * - artifacts arrive as final JSON text (`artifactEmissionMode: "json"`).
 */

export const CLAUDE_PROVIDER = "anthropic";
export const CLAUDE_DEFAULT_MODEL = "claude-opus-5-5";
const CLAUDE_PROVIDER_ALIASES = new Set(["anthropic", "claude", "claude-code"]);
const DEFAULT_CLAUDE_SESSION_TIMEOUT_MS = 1_800_000;
const MAX_TERMINAL_LOG_LINES = 400;

export type ClaudeModelConfig = ParsedModelConfig;

export interface ClaudeToolPolicy {
  allowedTools: string[];
  disallowedTools: string[];
}

const READ_TOOLS = ["Read", "Grep", "Glob", "LS"];
const EDIT_TOOLS = ["Edit", "MultiEdit", "Write", "NotebookEdit"];
const OFF_TASK_TOOLS = ["WebFetch", "WebSearch", "Task"];
const READ_ONLY_GIT = [
  "Bash(git status:*)",
  "Bash(git diff:*)",
  "Bash(git log:*)",
  "Bash(git show:*)",
  "Bash(git merge-base:*)",
];

export const CLAUDE_CASTE_TOOL_POLICIES: Record<CasteName, ClaudeToolPolicy> = {
  oracle: {
    allowedTools: [...READ_TOOLS],
    disallowedTools: [...EDIT_TOOLS, "Bash", ...OFF_TASK_TOOLS],
  },
  titan: {
    allowedTools: [...READ_TOOLS, "Edit", "MultiEdit", "Write", "Bash"],
    disallowedTools: ["NotebookEdit", ...OFF_TASK_TOOLS],
  },
  sentinel: {
    allowedTools: [...READ_TOOLS, "Bash"],
    disallowedTools: [...EDIT_TOOLS, ...OFF_TASK_TOOLS],
  },
  janus: {
    allowedTools: [...READ_TOOLS, ...READ_ONLY_GIT],
    disallowedTools: [...EDIT_TOOLS, ...OFF_TASK_TOOLS],
  },
};

const CLAUDE_SYSTEM_PROMPT_APPEND = [
  "You are running as a dispatched Aegis caste subagent in headless mode.",
  "Aegis owns orchestration, tracker state, merge routing, and retries; do only the assigned caste work.",
  "Stay inside the current working directory.",
  "Your final message must be only the requested JSON artifact: no markdown fences and no prose.",
].join(" ");

export interface ClaudeRunRequest {
  cwd: string;
  caste: CasteName;
  command: string;
  modelId: string;
  thinkingLevel: AegisThinkingLevel;
  prompt: string;
  timeoutMs: number;
  maxTurns: number | null;
  extraArgs: string[];
}

export interface ClaudeRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export interface ClaudeCasteRuntimeOptions {
  command?: string;
  sessionTimeoutMs?: number;
  maxTurns?: number | null;
  extraArgs?: string[];
  runner?: (request: ClaudeRunRequest) => Promise<ClaudeRunResult>;
}

export function buildClaudeArgs(request: ClaudeRunRequest): string[] {
  const policy = CLAUDE_CASTE_TOOL_POLICIES[request.caste];
  return [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    request.modelId,
    "--permission-mode",
    "default",
    "--allowedTools",
    policy.allowedTools.join(","),
    "--disallowedTools",
    policy.disallowedTools.join(","),
    "--strict-mcp-config",
    "--append-system-prompt",
    CLAUDE_SYSTEM_PROMPT_APPEND,
    ...(request.maxTurns !== null ? ["--max-turns", String(request.maxTurns)] : []),
    ...request.extraArgs,
  ];
}

export function buildClaudeSpawnInvocation(
  command: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
) {
  return buildCliSpawnInvocation(command, args, platform);
}

function runClaudeCli(request: ClaudeRunRequest): Promise<ClaudeRunResult> {
  const invocation = buildClaudeSpawnInvocation(request.command, buildClaudeArgs(request));
  return runSupervisedProcess({
    label: "Claude Code",
    command: invocation.command,
    args: invocation.args,
    cwd: request.cwd,
    stdin: request.prompt,
    inactivityTimeoutMs: request.timeoutMs,
  });
}

/** Kills Claude Code sessions started by this process for the workspace, plus stray dev servers. */
export function terminateClaudeSessionProcesses(workingDirectory: string) {
  terminateRegisteredSessionProcesses(workingDirectory);
  terminateWorkspaceProcesses(workingDirectory, "forbidden");
}

interface ClaudeStreamSummary {
  sessionId: string | null;
  resolvedModel: string | null;
  messageLog: CasteSessionMessage[];
  toolsUsed: string[];
  terminalLog: string[];
  resultText: string | null;
  resultSubtype: string | null;
  isError: boolean;
  usage: AdapterUsage | undefined;
}

type StreamRecord = Record<string, unknown>;

function isRecord(value: unknown): value is StreamRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compact(text: string, maxChars = 240) {
  const single = text.replace(/\s+/g, " ").trim();
  return single.length > maxChars ? `${single.slice(0, maxChars - 3)}...` : single;
}

function summarizeToolInput(input: unknown) {
  if (!isRecord(input)) {
    return "";
  }
  const preferred = input["command"] ?? input["file_path"] ?? input["path"] ?? input["pattern"];
  return typeof preferred === "string" ? compact(preferred, 160) : "";
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseUsage(event: StreamRecord): AdapterUsage | undefined {
  const usage = isRecord(event["usage"]) ? event["usage"] : {};
  const parsed: AdapterUsage = {
    inputTokens: readNumber(usage["input_tokens"]),
    outputTokens: readNumber(usage["output_tokens"]),
    cacheReadInputTokens: readNumber(usage["cache_read_input_tokens"]),
    cacheCreationInputTokens: readNumber(usage["cache_creation_input_tokens"]),
    costUsd: readNumber(event["total_cost_usd"]),
    turns: readNumber(event["num_turns"]),
    durationMs: readNumber(event["duration_ms"]),
  };
  const defined = Object.fromEntries(Object.entries(parsed).filter(([, value]) => value !== undefined));
  return Object.keys(defined).length > 0 ? defined as AdapterUsage : undefined;
}

function pushLog(summary: ClaudeStreamSummary, line: string) {
  summary.terminalLog.push(line);
  if (summary.terminalLog.length > MAX_TERMINAL_LOG_LINES) {
    summary.terminalLog.splice(0, summary.terminalLog.length - MAX_TERMINAL_LOG_LINES);
  }
}

function applyAssistantEvent(summary: ClaudeStreamSummary, event: StreamRecord) {
  const message = isRecord(event["message"]) ? event["message"] : null;
  const content = Array.isArray(message?.["content"]) ? message["content"] : [];
  const texts: string[] = [];

  for (const block of content) {
    if (!isRecord(block)) {
      continue;
    }
    if (block["type"] === "text" && typeof block["text"] === "string" && block["text"].trim()) {
      texts.push(block["text"]);
      pushLog(summary, `[assistant] ${compact(block["text"])}`);
    } else if (block["type"] === "tool_use" && typeof block["name"] === "string") {
      summary.toolsUsed.push(block["name"]);
      const detail = summarizeToolInput(block["input"]);
      pushLog(summary, `[tool] ${block["name"]}${detail ? ` ${detail}` : ""}`);
    }
  }

  if (texts.length > 0) {
    summary.messageLog.push({ role: "assistant", content: texts.join("\n") });
  }
}

function applyUserEvent(summary: ClaudeStreamSummary, event: StreamRecord) {
  const message = isRecord(event["message"]) ? event["message"] : null;
  const content = Array.isArray(message?.["content"]) ? message["content"] : [];
  for (const block of content) {
    if (isRecord(block) && block["type"] === "tool_result" && block["is_error"] === true) {
      const detail = typeof block["content"] === "string" ? compact(block["content"]) : "tool error";
      pushLog(summary, `[tool_error] ${detail}`);
    }
  }
}

/** Folds Claude Code `stream-json` output into an Aegis session summary. */
export function parseClaudeStreamOutput(stdout: string, prompt: string): ClaudeStreamSummary {
  const summary: ClaudeStreamSummary = {
    sessionId: null,
    resolvedModel: null,
    messageLog: [{ role: "user", content: prompt }],
    toolsUsed: [],
    terminalLog: [],
    resultText: null,
    resultSubtype: null,
    isError: false,
    usage: undefined,
  };

  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }

    let event: unknown;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!isRecord(event)) {
      continue;
    }

    if (typeof event["session_id"] === "string" && !summary.sessionId) {
      summary.sessionId = event["session_id"];
    }

    switch (event["type"]) {
      case "system":
        if (event["subtype"] === "init") {
          summary.resolvedModel = typeof event["model"] === "string" ? event["model"] : null;
          pushLog(summary, `[session] init model=${summary.resolvedModel ?? "unknown"}`);
        }
        break;
      case "assistant":
        applyAssistantEvent(summary, event);
        break;
      case "user":
        applyUserEvent(summary, event);
        break;
      case "result":
        summary.resultSubtype = typeof event["subtype"] === "string" ? event["subtype"] : null;
        summary.isError = event["is_error"] === true;
        summary.resultText = typeof event["result"] === "string" ? event["result"] : null;
        summary.usage = parseUsage(event);
        pushLog(summary, `[result] ${summary.resultSubtype ?? "unknown"}${summary.isError ? " (error)" : ""}`);
        break;
      default:
        break;
    }
  }

  summary.toolsUsed = [...new Set(summary.toolsUsed)];
  return summary;
}

function resolveClaudeError(result: ClaudeRunResult, summary: ClaudeStreamSummary) {
  if (summary.resultSubtype && summary.resultSubtype !== "success") {
    return `Claude Code session ended with ${summary.resultSubtype}.${summary.resultText ? ` ${summary.resultText}` : ""}`;
  }
  if (summary.isError) {
    return summary.resultText?.trim() || "Claude Code reported an error result.";
  }
  if (result.exitCode !== 0) {
    const detail = tailText(result.stderr) || summary.resultText?.trim() || "";
    return `Claude Code exited with code ${result.exitCode ?? "null"}.${detail ? ` ${detail}` : ""}`;
  }
  if (summary.resultSubtype === null) {
    return `Claude Code produced no result event.${result.stderr.trim() ? ` ${tailText(result.stderr)}` : ""}`;
  }
  return null;
}

function parseOptionalPositiveInteger(value: string | undefined) {
  if (!value?.trim()) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseExtraArgs(value: string | undefined) {
  if (!value?.trim()) {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
      throw new Error("AEGIS_CLAUDE_EXTRA_ARGS must be a JSON array of strings.");
    }
    return parsed as string[];
  }
  return trimmed.split(/\s+/);
}

/** Reads `AEGIS_CLAUDE_*` overrides for the Claude Code adapter. */
export function resolveClaudeRuntimeOptionsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Omit<ClaudeCasteRuntimeOptions, "runner"> {
  const command = env.AEGIS_CLAUDE_BIN?.trim();
  const sessionTimeoutMs = parseOptionalPositiveInteger(env.AEGIS_CLAUDE_SESSION_TIMEOUT_MS);
  const maxTurns = parseOptionalPositiveInteger(env.AEGIS_CLAUDE_MAX_TURNS);
  const extraArgs = parseExtraArgs(env.AEGIS_CLAUDE_EXTRA_ARGS);
  return {
    ...(command ? { command } : {}),
    ...(sessionTimeoutMs !== undefined ? { sessionTimeoutMs } : {}),
    ...(maxTurns !== undefined ? { maxTurns } : {}),
    ...(extraArgs ? { extraArgs } : {}),
  };
}

export function parseClaudeModelReference(reference: string, thinkingLevel: AegisThinkingLevel): ClaudeModelConfig {
  const parsed = parseModelReference(reference, thinkingLevel, CLAUDE_PROVIDER);
  return CLAUDE_PROVIDER_ALIASES.has(parsed.provider)
    ? { ...parsed, provider: CLAUDE_PROVIDER }
    : parsed;
}

export function createClaudeModelConfigs(
  models: CasteConfigRecord<string>,
  thinking: CasteConfigRecord<AegisThinkingLevel>,
) {
  return createCasteConfig((caste: CasteName) => parseClaudeModelReference(models[caste], thinking[caste]));
}

export class ClaudeCasteRuntime implements CasteRuntime {
  private readonly modelConfigs: CasteConfigRecord<ClaudeModelConfig>;
  private readonly command: string;
  private readonly sessionTimeoutMs: number;
  private readonly maxTurns: number | null;
  private readonly extraArgs: string[];
  private readonly runner: (request: ClaudeRunRequest) => Promise<ClaudeRunResult>;

  constructor(
    modelConfigs: Partial<CasteConfigRecord<ClaudeModelConfig>> = {},
    options: ClaudeCasteRuntimeOptions = {},
  ) {
    this.modelConfigs = {
      ...createCasteConfig(() => parseClaudeModelReference(`${CLAUDE_PROVIDER}:${CLAUDE_DEFAULT_MODEL}`, "medium")),
      ...modelConfigs,
    };
    this.command = options.command ?? "claude";
    this.sessionTimeoutMs = options.sessionTimeoutMs ?? DEFAULT_CLAUDE_SESSION_TIMEOUT_MS;
    this.maxTurns = options.maxTurns ?? null;
    this.extraArgs = options.extraArgs ?? [];
    this.runner = options.runner ?? runClaudeCli;
  }

  async run(input: CasteRunInput): Promise<CasteSessionResult> {
    const startedAt = new Date().toISOString();
    const modelConfig = this.modelConfigs[input.caste];
    if (modelConfig.provider !== CLAUDE_PROVIDER) {
      throw new Error(
        `Claude runtime cannot run "${modelConfig.reference}" for "${input.caste}": expected an anthropic:<model-id> reference.`,
      );
    }

    const result = await this.runner({
      cwd: input.workingDirectory,
      caste: input.caste,
      command: this.command,
      modelId: modelConfig.modelId,
      thinkingLevel: modelConfig.thinkingLevel,
      prompt: input.prompt,
      timeoutMs: this.sessionTimeoutMs,
      maxTurns: this.maxTurns,
      extraArgs: this.extraArgs,
    });
    const summary = parseClaudeStreamOutput(result.stdout, input.prompt);
    const error = resolveClaudeError(result, summary);
    const outputText = (summary.resultText ?? summary.messageLog.at(-1)?.content ?? "").trim();

    return {
      sessionId: summary.sessionId ?? randomUUID(),
      caste: input.caste,
      modelRef: modelConfig.reference,
      provider: modelConfig.provider,
      modelId: summary.resolvedModel ?? modelConfig.modelId,
      thinkingLevel: modelConfig.thinkingLevel,
      status: error ? "failed" : "succeeded",
      outputText,
      toolsUsed: summary.toolsUsed,
      messageLog: summary.messageLog,
      terminalLog: summary.terminalLog,
      ...(summary.usage ? { usage: summary.usage } : {}),
      startedAt,
      finishedAt: new Date().toISOString(),
      ...(error ? { error } : {}),
    };
  }
}
