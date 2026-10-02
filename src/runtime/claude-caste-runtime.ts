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
import { buildCasteArtifactJsonSchema } from "../castes/artifact-schemas.js";
import { ActivityLog, compactActivityText as compact } from "./activity-log.js";
import { parseModelReference, tailText, type ParsedModelConfig } from "./model-reference.js";
import {
  buildAgentShellEnvironment,
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
 * - artifacts arrive as JSON (`artifactEmissionMode: "json"`). With structured
 *   output on, `--json-schema` makes Claude Code validate the final artifact
 *   against the caste schema and re-prompt on mismatch; Aegis still parses it.
 * - thinking level maps to Claude Code effort (`CLAUDE_CODE_EFFORT_LEVEL`).
 * - tool calls the policy denied are recorded in the terminal log.
 */

export const CLAUDE_PROVIDER = "anthropic";
export const CLAUDE_DEFAULT_MODEL = "claude-opus-5-5";
const CLAUDE_PROVIDER_ALIASES = new Set(["anthropic", "claude", "claude-code"]);
const DEFAULT_CLAUDE_SESSION_TIMEOUT_MS = 1_800_000;

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
  /** Caste artifact JSON Schema passed as `--json-schema`, or null for text JSON. */
  jsonSchema: string | null;
  /** Called with each stdout line as it arrives so activity streams live. */
  onStdoutLine?: (line: string) => void;
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
  /**
   * Validate the final artifact with `--json-schema`. Defaults on, except on
   * Windows where the PowerShell launcher cannot pass JSON arguments intact.
   */
  structuredOutput?: boolean;
  runner?: (request: ClaudeRunRequest) => Promise<ClaudeRunResult>;
}

type ClaudeEffortLevel = "low" | "medium" | "high";

/** Aegis thinking levels map onto Claude Code effort; `off` runs at the lowest effort. */
export function resolveClaudeEffortLevel(thinkingLevel: AegisThinkingLevel): ClaudeEffortLevel {
  return thinkingLevel === "off" ? "low" : thinkingLevel;
}

export function buildClaudeEnvironment(
  request: Pick<ClaudeRunRequest, "thinkingLevel">,
  baseEnv: NodeJS.ProcessEnv = buildAgentShellEnvironment(),
): NodeJS.ProcessEnv {
  return {
    ...baseEnv,
    CLAUDE_CODE_EFFORT_LEVEL: resolveClaudeEffortLevel(request.thinkingLevel),
  };
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
    ...(request.jsonSchema !== null ? ["--json-schema", request.jsonSchema] : []),
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
    env: buildClaudeEnvironment(request),
    inactivityTimeoutMs: request.timeoutMs,
    onStdoutLine: request.onStdoutLine,
  });
}

/** Kills Claude Code sessions started by this process for the workspace, plus stray dev servers. */
export function terminateClaudeSessionProcesses(workingDirectory: string) {
  terminateRegisteredSessionProcesses(workingDirectory);
  terminateWorkspaceProcesses(workingDirectory, "forbidden");
}

export interface ClaudeStreamSummary {
  sessionId: string | null;
  resolvedModel: string | null;
  messageLog: CasteSessionMessage[];
  toolsUsed: string[];
  terminalLog: string[];
  resultText: string | null;
  resultSubtype: string | null;
  /** Schema-validated artifact from `--json-schema`, when the session produced one. */
  structuredOutput: unknown;
  permissionDenials: string[];
  isError: boolean;
  usage: AdapterUsage | undefined;
}

type StreamRecord = Record<string, unknown>;

function isRecord(value: unknown): value is StreamRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function parsePermissionDenials(event: StreamRecord) {
  const denials = Array.isArray(event["permission_denials"]) ? event["permission_denials"] : [];
  return denials.flatMap((denial) => {
    if (!isRecord(denial) || typeof denial["tool_name"] !== "string") {
      return [];
    }
    const detail = summarizeToolInput(denial["tool_input"]);
    return [`${denial["tool_name"]}${detail ? ` ${detail}` : ""}`];
  });
}

/**
 * Folds Claude Code `stream-json` lines into an Aegis session summary as they
 * arrive. Each new operator-facing log line is also handed to `onLogLine`, so
 * the same parse feeds the durable transcript and live session activity.
 */
export class ClaudeStreamParser {
  readonly summary: ClaudeStreamSummary;
  private readonly activity: ActivityLog;
  private linesSeen = 0;

  constructor(prompt: string, onLogLine?: (line: string) => void) {
    this.activity = new ActivityLog(onLogLine);
    this.summary = {
      sessionId: null,
      resolvedModel: null,
      messageLog: [{ role: "user", content: prompt }],
      toolsUsed: [],
      terminalLog: this.activity.lines,
      resultText: null,
      resultSubtype: null,
      structuredOutput: undefined,
      permissionDenials: [],
      isError: false,
      usage: undefined,
    };
  }

  /** True once any stdout line has been pushed. */
  get hasInput() {
    return this.linesSeen > 0;
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

    if (typeof event["session_id"] === "string" && !this.summary.sessionId) {
      this.summary.sessionId = event["session_id"];
    }

    switch (event["type"]) {
      case "system":
        if (event["subtype"] === "init") {
          this.summary.resolvedModel = typeof event["model"] === "string" ? event["model"] : null;
          this.log(`[session] init model=${this.summary.resolvedModel ?? "unknown"}`);
        } else if (event["subtype"] === "api_retry") {
          // Backoff is visible activity, not a stuck session.
          const error = typeof event["error"] === "string" ? event["error"] : "unknown";
          this.log(`[api_retry] ${error} attempt ${String(event["attempt"] ?? "?")}/${String(event["max_retries"] ?? "?")}`);
        }
        break;
      case "assistant":
        this.applyAssistantEvent(event);
        break;
      case "user":
        this.applyUserEvent(event);
        break;
      case "result":
        this.applyResultEvent(event);
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

  finish(): ClaudeStreamSummary {
    this.summary.toolsUsed = [...new Set(this.summary.toolsUsed)];
    return this.summary;
  }

  private log(line: string) {
    this.activity.push(line);
  }

  private applyAssistantEvent(event: StreamRecord) {
    const message = isRecord(event["message"]) ? event["message"] : null;
    const content = Array.isArray(message?.["content"]) ? message["content"] : [];
    const texts: string[] = [];

    for (const block of content) {
      if (!isRecord(block)) {
        continue;
      }
      if (block["type"] === "text" && typeof block["text"] === "string" && block["text"].trim()) {
        texts.push(block["text"]);
        this.log(`[assistant] ${compact(block["text"])}`);
      } else if (block["type"] === "tool_use" && typeof block["name"] === "string") {
        this.summary.toolsUsed.push(block["name"]);
        const detail = summarizeToolInput(block["input"]);
        this.log(`[tool] ${block["name"]}${detail ? ` ${detail}` : ""}`);
      }
    }

    if (texts.length > 0) {
      this.summary.messageLog.push({ role: "assistant", content: texts.join("\n") });
    }
  }

  private applyUserEvent(event: StreamRecord) {
    const message = isRecord(event["message"]) ? event["message"] : null;
    const content = Array.isArray(message?.["content"]) ? message["content"] : [];
    for (const block of content) {
      if (isRecord(block) && block["type"] === "tool_result" && block["is_error"] === true) {
        const detail = typeof block["content"] === "string" ? compact(block["content"]) : "tool error";
        this.log(`[tool_error] ${detail}`);
      }
    }
  }

  private applyResultEvent(event: StreamRecord) {
    const summary = this.summary;
    summary.resultSubtype = typeof event["subtype"] === "string" ? event["subtype"] : null;
    summary.isError = event["is_error"] === true;
    summary.resultText = typeof event["result"] === "string" ? event["result"] : null;
    summary.structuredOutput = event["structured_output"] ?? undefined;
    summary.usage = parseUsage(event);
    summary.permissionDenials = parsePermissionDenials(event);
    for (const denial of summary.permissionDenials) {
      this.log(`[denied] ${denial}`);
    }
    this.log(`[result] ${summary.resultSubtype ?? "unknown"}${summary.isError ? " (error)" : ""}`);
  }
}

/** Folds complete Claude Code `stream-json` output into an Aegis session summary. */
export function parseClaudeStreamOutput(stdout: string, prompt: string): ClaudeStreamSummary {
  const parser = new ClaudeStreamParser(prompt);
  parser.pushText(stdout);
  return parser.finish();
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

function parseOptionalBoolean(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "on") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "off") {
    return false;
  }
  return undefined;
}

/** Reads `AEGIS_CLAUDE_*` overrides for the Claude Code adapter. */
export function resolveClaudeRuntimeOptionsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Omit<ClaudeCasteRuntimeOptions, "runner"> {
  const command = env.AEGIS_CLAUDE_BIN?.trim();
  const sessionTimeoutMs = parseOptionalPositiveInteger(env.AEGIS_CLAUDE_SESSION_TIMEOUT_MS);
  const maxTurns = parseOptionalPositiveInteger(env.AEGIS_CLAUDE_MAX_TURNS);
  const extraArgs = parseExtraArgs(env.AEGIS_CLAUDE_EXTRA_ARGS);
  const structuredOutput = parseOptionalBoolean(env.AEGIS_CLAUDE_STRUCTURED_OUTPUT);
  return {
    ...(command ? { command } : {}),
    ...(sessionTimeoutMs !== undefined ? { sessionTimeoutMs } : {}),
    ...(maxTurns !== undefined ? { maxTurns } : {}),
    ...(extraArgs ? { extraArgs } : {}),
    ...(structuredOutput !== undefined ? { structuredOutput } : {}),
  };
}

/** Structured output renders as compact JSON so the caste parsers see one object. */
function resolveOutputText(summary: ClaudeStreamSummary) {
  if (summary.structuredOutput !== undefined && summary.structuredOutput !== null) {
    return JSON.stringify(summary.structuredOutput);
  }
  return (summary.resultText ?? summary.messageLog.at(-1)?.content ?? "").trim();
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
  private readonly structuredOutput: boolean;
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
    this.structuredOutput = options.structuredOutput ?? process.platform !== "win32";
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

    const parser = new ClaudeStreamParser(input.prompt, input.onActivity);
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
      jsonSchema: this.structuredOutput ? buildCasteArtifactJsonSchema(input.caste) : null,
      onStdoutLine: (line) => parser.push(line),
    });
    // Runners that do not stream (tests, custom runners) hand back stdout only.
    if (!parser.hasInput) {
      parser.pushText(result.stdout);
    }
    const summary = parser.finish();
    const error = resolveClaudeError(result, summary);
    const outputText = resolveOutputText(summary);

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
