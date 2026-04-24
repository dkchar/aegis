import {
  type BashOperations,
  type AgentSessionEvent,
  type FindOperations,
  type ToolDefinition,
} from "@mariozechner/pi-coding-agent";
import { spawn, type SpawnOptions } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { globSync } from "glob";

import {
  createOracleEmitAssessmentTool,
  enforceOracleToolPayloadContract,
  extractOracleAssessmentFromToolEvent,
  ORACLE_EMIT_ASSESSMENT_TOOL_NAME,
  stringifyOracleAssessment,
} from "../castes/oracle/oracle-tool-contract.js";
import {
  createTitanEmitArtifactTool,
  enforceTitanToolPayloadContract,
  extractTitanArtifactFromToolEvent,
  stringifyTitanArtifact,
  TITAN_EMIT_ARTIFACT_TOOL_NAME,
} from "../castes/titan/titan-tool-contract.js";
import {
  createSentinelEmitVerdictTool,
  enforceSentinelToolPayloadContract,
  extractSentinelVerdictFromToolEvent,
  SENTINEL_EMIT_VERDICT_TOOL_NAME,
  stringifySentinelVerdict,
} from "../castes/sentinel/sentinel-tool-contract.js";
import {
  createJanusEmitResolutionTool,
  enforceJanusToolPayloadContract,
  extractJanusResolutionFromToolEvent,
  JANUS_EMIT_RESOLUTION_TOOL_NAME,
  stringifyJanusResolutionArtifact,
} from "../castes/janus/janus-tool-contract.js";
import type {
  CasteName,
  CasteRunInput,
  CasteRuntime,
  CasteSessionMessage,
  CasteSessionResult,
} from "./caste-runtime.js";
import type { ResolvedConfiguredCasteModel } from "./pi-model-config.js";

type PiCodingAgentModule = typeof import("@mariozechner/pi-coding-agent");
const require = createRequire(import.meta.url);
let childProcessPatched = false;
let piCodingAgentModulePromise: Promise<PiCodingAgentModule> | null = null;
const DEFAULT_PI_SESSION_TIMEOUT_MS = 60_000;
const DEFAULT_PI_SESSION_TIMEOUT_BY_CASTE: Record<CasteName, number> = {
  oracle: 300_000,
  titan: 180_000,
  sentinel: 180_000,
  janus: 180_000,
};
const DEFAULT_PI_TIMEOUT_RETRY_COUNT = 1;
const DEFAULT_PI_TIMEOUT_RETRY_DELAY_MS = 1_000;

function withWindowsHide<T>(value: T): T | (T & { windowsHide: true }) {
  if (process.platform !== "win32") {
    return value;
  }

  if (value && typeof value === "object") {
    return {
      ...(value as Record<string, unknown>),
      windowsHide: true,
    } as T & { windowsHide: true };
  }

  return { windowsHide: true } as T & { windowsHide: true };
}

function patchChildProcessWindowsDefaults() {
  if (process.platform !== "win32" || childProcessPatched) {
    return;
  }

  const childProcess = require("node:child_process") as typeof import("node:child_process");
  const originalSpawn = childProcess.spawn;
  const originalSpawnSync = childProcess.spawnSync;
  const originalExecFile = childProcess.execFile;
  const originalExecFileSync = childProcess.execFileSync;

  childProcess.spawn = ((...args: unknown[]) => {
    if (Array.isArray(args[1])) {
      args[2] = withWindowsHide(args[2]);
    } else {
      args[1] = withWindowsHide(args[1]);
    }

    return (originalSpawn as (...innerArgs: unknown[]) => ReturnType<typeof originalSpawn>)(...args);
  }) as typeof childProcess.spawn;

  childProcess.spawnSync = ((...args: unknown[]) => {
    if (Array.isArray(args[1])) {
      args[2] = withWindowsHide(args[2]);
    } else {
      args[1] = withWindowsHide(args[1]);
    }

    return (originalSpawnSync as (...innerArgs: unknown[]) => ReturnType<typeof originalSpawnSync>)(...args);
  }) as typeof childProcess.spawnSync;

  childProcess.execFile = ((...args: unknown[]) => {
    const callbackIndex = typeof args[args.length - 1] === "function" ? args.length - 1 : -1;

    if (Array.isArray(args[1])) {
      if (callbackIndex === 2) {
        args.splice(2, 0, withWindowsHide(undefined));
      } else {
        args[2] = withWindowsHide(args[2]);
      }
    } else if (callbackIndex === 1) {
      args.splice(1, 0, withWindowsHide(undefined));
    } else {
      args[1] = withWindowsHide(args[1]);
    }

    return (originalExecFile as (...innerArgs: unknown[]) => ReturnType<typeof originalExecFile>)(...args);
  }) as typeof childProcess.execFile;

  childProcess.execFileSync = ((...args: unknown[]) => {
    if (Array.isArray(args[1])) {
      args[2] = withWindowsHide(args[2]);
    } else {
      args[1] = withWindowsHide(args[1]);
    }

    return (originalExecFileSync as (...innerArgs: unknown[]) => ReturnType<typeof originalExecFileSync>)(...args);
  }) as typeof childProcess.execFileSync;

  childProcessPatched = true;
}

async function loadPiCodingAgentModule(): Promise<PiCodingAgentModule> {
  if (!piCodingAgentModulePromise) {
    patchChildProcessWindowsDefaults();
    piCodingAgentModulePromise = import("@mariozechner/pi-coding-agent");
  }

  return piCodingAgentModulePromise;
}

function extractAssistantText(event: AgentSessionEvent): string {
  if (event.type !== "message_end") {
    return "";
  }

  const message = event.message as { content?: unknown } | undefined;
  const content = message?.content;
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .filter((part) => {
      return (
        part !== null
        && typeof part === "object"
        && "type" in part
        && (part as { type?: string }).type === "text"
      );
    })
    .map((part) => (part as { text?: string }).text ?? "")
    .join("");
}

function extractMessageRole(event: AgentSessionEvent): CasteSessionMessage["role"] | null {
  if (event.type !== "message_end") {
    return null;
  }

  const message = event.message as { role?: unknown } | undefined;
  return message?.role === "user" || message?.role === "assistant"
    ? message.role
    : null;
}

function resolveShellInvocation(command: string) {
  if (process.platform === "win32") {
    return {
      shell: process.env.ComSpec ?? "cmd.exe",
      args: ["/d", "/s", "/c", command],
    };
  }

  return {
    shell: process.env.SHELL ?? "/bin/bash",
    args: ["-lc", command],
  };
}

export function buildHiddenShellSpawnOptions(
  cwd: string,
  env?: NodeJS.ProcessEnv,
): SpawnOptions {
  return {
    cwd,
    detached: process.platform !== "win32",
    env: env ?? process.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  };
}

function terminateProcessTree(pid: number) {
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    killer.on("error", () => undefined);
    return;
  }

  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    // Ignore missing process group.
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // Ignore missing process.
  }
}

function createHiddenShellBashOperations(): BashOperations {
  return {
    exec: (command, cwd, { onData, signal, timeout, env }) =>
      new Promise((resolve, reject) => {
        const { shell, args } = resolveShellInvocation(command);
        const child = spawn(shell, args, buildHiddenShellSpawnOptions(cwd, env));

        let timeoutHandle: NodeJS.Timeout | undefined;
        let timedOut = false;
        let settled = false;

        const settleResolve = (exitCode: number | null) => {
          if (settled) {
            return;
          }
          settled = true;
          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
          }
          if (signal) {
            signal.removeEventListener("abort", onAbort);
          }
          resolve({ exitCode });
        };

        const settleReject = (error: unknown) => {
          if (settled) {
            return;
          }
          settled = true;
          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
          }
          if (signal) {
            signal.removeEventListener("abort", onAbort);
          }
          reject(error);
        };

        const onAbort = () => {
          if (typeof child.pid === "number") {
            terminateProcessTree(child.pid);
          }
        };

        if (timeout !== undefined && timeout > 0) {
          timeoutHandle = setTimeout(() => {
            timedOut = true;
            onAbort();
          }, timeout * 1_000);
        }

        if (signal) {
          if (signal.aborted) {
            onAbort();
          } else {
            signal.addEventListener("abort", onAbort, { once: true });
          }
        }

        child.stdout?.on("data", onData);
        child.stderr?.on("data", onData);
        child.on("error", settleReject);
        child.on("close", (code) => {
          if (timedOut) {
            settleReject(new Error(`timeout:${timeout}`));
            return;
          }

          if (signal?.aborted) {
            settleReject(new Error("aborted"));
            return;
          }

          settleResolve(code);
        });
      }),
  };
}

const HIDDEN_SHELL_TOOL_OPTIONS = {
  bash: {
    operations: createHiddenShellBashOperations(),
  },
};

const HIDDEN_FIND_OPERATIONS: FindOperations = {
  exists: (absolutePath) => existsSync(absolutePath),
  glob: (pattern, cwd, options) =>
    globSync(pattern, {
      cwd,
      dot: true,
      absolute: true,
      ignore: options.ignore,
    }).slice(0, options.limit),
};

function resolveTools(
  piCodingAgent: PiCodingAgentModule,
  caste: CasteName,
  workingDirectory: string,
) {
  if (caste === "titan") {
    return piCodingAgent.createCodingTools(workingDirectory, HIDDEN_SHELL_TOOL_OPTIONS);
  }

  return [
    piCodingAgent.createReadTool(workingDirectory),
    piCodingAgent.createFindTool(workingDirectory, { operations: HIDDEN_FIND_OPERATIONS }),
    piCodingAgent.createLsTool(workingDirectory),
    piCodingAgent.createGrepTool(workingDirectory),
  ];
}

interface CasteToolContract {
  label: string;
  toolName: string;
  createTool: () => ToolDefinition;
  enforcePayloadContract: (payload: unknown) => unknown | undefined;
  extractStructuredOutput: (event: AgentSessionEvent) => string | null;
}

const CASTE_TOOL_CONTRACTS: Record<CasteName, CasteToolContract> = {
  oracle: {
    label: "Oracle",
    toolName: ORACLE_EMIT_ASSESSMENT_TOOL_NAME,
    createTool: createOracleEmitAssessmentTool,
    enforcePayloadContract: enforceOracleToolPayloadContract,
    extractStructuredOutput(event) {
      const assessment = extractOracleAssessmentFromToolEvent(event);
      return assessment ? stringifyOracleAssessment(assessment) : null;
    },
  },
  titan: {
    label: "Titan",
    toolName: TITAN_EMIT_ARTIFACT_TOOL_NAME,
    createTool: createTitanEmitArtifactTool,
    enforcePayloadContract: enforceTitanToolPayloadContract,
    extractStructuredOutput(event) {
      const artifact = extractTitanArtifactFromToolEvent(event);
      return artifact ? stringifyTitanArtifact(artifact) : null;
    },
  },
  sentinel: {
    label: "Sentinel",
    toolName: SENTINEL_EMIT_VERDICT_TOOL_NAME,
    createTool: createSentinelEmitVerdictTool,
    enforcePayloadContract: enforceSentinelToolPayloadContract,
    extractStructuredOutput(event) {
      const verdict = extractSentinelVerdictFromToolEvent(event);
      return verdict ? stringifySentinelVerdict(verdict) : null;
    },
  },
  janus: {
    label: "Janus",
    toolName: JANUS_EMIT_RESOLUTION_TOOL_NAME,
    createTool: createJanusEmitResolutionTool,
    enforcePayloadContract: enforceJanusToolPayloadContract,
    extractStructuredOutput(event) {
      const artifact = extractJanusResolutionFromToolEvent(event);
      return artifact ? stringifyJanusResolutionArtifact(artifact) : null;
    },
  },
};

function resolveCustomTools(caste: CasteName): ToolDefinition[] {
  return [CASTE_TOOL_CONTRACTS[caste].createTool()];
}

function installPayloadContractHook(
  contract: CasteToolContract,
  session: Awaited<ReturnType<PiCodingAgentModule["createAgentSession"]>>["session"],
  shouldEnforce: () => boolean,
) {

  const existingOnPayload = session.agent.onPayload;
  session.agent.onPayload = async (payload, model) => {
    const existingPayload = existingOnPayload
      ? await existingOnPayload(payload, model)
      : undefined;
    const effectivePayload = existingPayload === undefined ? payload : existingPayload;
    if (!shouldEnforce()) {
      if (existingPayload !== undefined) {
        return effectivePayload;
      }

      return undefined;
    }
    const enforcedPayload = contract.enforcePayloadContract(effectivePayload);

    if (enforcedPayload !== undefined) {
      return enforcedPayload;
    }

    if (existingPayload !== undefined) {
      return effectivePayload;
    }

    return undefined;
  };
}

function createContractRepairPrompt(contract: CasteToolContract) {
  return [
    `Tool contract repair required: no '${contract.toolName}' output was captured.`,
    `Call '${contract.toolName}' now with the final artifact payload.`,
    "Do not call any other tools.",
    "Do not return prose or markdown.",
  ].join("\n");
}

export class PiCasteRuntime implements CasteRuntime {
  private readonly sessionTimeoutMs: number;
  private readonly sessionTimeoutMsByCaste: Record<CasteName, number>;
  private readonly timeoutRetryCount: number;
  private readonly timeoutRetryDelayMs: number;

  constructor(
    private readonly modelConfigs: Partial<Record<CasteName, ResolvedConfiguredCasteModel>> = {},
    options: {
      sessionTimeoutMs?: number;
      sessionTimeoutMsByCaste?: Partial<Record<CasteName, number>>;
      timeoutRetryCount?: number;
      timeoutRetryDelayMs?: number;
    } = {},
  ) {
    this.sessionTimeoutMs = Math.max(1, options.sessionTimeoutMs ?? DEFAULT_PI_SESSION_TIMEOUT_MS);
    const hasGlobalTimeoutOverride = options.sessionTimeoutMs !== undefined;
    this.sessionTimeoutMsByCaste = {
      oracle: Math.max(
        1,
        options.sessionTimeoutMsByCaste?.oracle
          ?? (hasGlobalTimeoutOverride ? this.sessionTimeoutMs : DEFAULT_PI_SESSION_TIMEOUT_BY_CASTE.oracle),
      ),
      titan: Math.max(
        1,
        options.sessionTimeoutMsByCaste?.titan
          ?? (hasGlobalTimeoutOverride ? this.sessionTimeoutMs : DEFAULT_PI_SESSION_TIMEOUT_BY_CASTE.titan),
      ),
      sentinel: Math.max(
        1,
        options.sessionTimeoutMsByCaste?.sentinel
          ?? (hasGlobalTimeoutOverride ? this.sessionTimeoutMs : DEFAULT_PI_SESSION_TIMEOUT_BY_CASTE.sentinel),
      ),
      janus: Math.max(
        1,
        options.sessionTimeoutMsByCaste?.janus
          ?? (hasGlobalTimeoutOverride ? this.sessionTimeoutMs : DEFAULT_PI_SESSION_TIMEOUT_BY_CASTE.janus),
      ),
    };
    this.timeoutRetryCount = Math.max(0, options.timeoutRetryCount ?? DEFAULT_PI_TIMEOUT_RETRY_COUNT);
    this.timeoutRetryDelayMs = Math.max(0, options.timeoutRetryDelayMs ?? DEFAULT_PI_TIMEOUT_RETRY_DELAY_MS);
  }

  private getSessionTimeoutMs(caste: CasteName): number {
    return this.sessionTimeoutMsByCaste[caste] ?? this.sessionTimeoutMs;
  }

  async run(input: CasteRunInput): Promise<CasteSessionResult> {
    const piCodingAgent = await loadPiCodingAgentModule();
    const modelConfig = this.modelConfigs[input.caste];
    if (!modelConfig) {
      throw new Error(`Missing configured Pi model for caste "${input.caste}".`);
    }

    const maxAttempts = this.timeoutRetryCount + 1;
    let latestResult: CasteSessionResult | null = null;
    const sessionTimeoutMs = this.getSessionTimeoutMs(input.caste);

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const attemptResult = await this.runSingleAttempt(
        input,
        piCodingAgent,
        modelConfig,
        sessionTimeoutMs,
      );
      latestResult = attemptResult;

      const timedOut = attemptResult.status === "failed"
        && typeof attemptResult.error === "string"
        && attemptResult.error.includes(`Pi ${input.caste} session timed out`);
      const hasRetry = attempt < maxAttempts;

      if (!timedOut || !hasRetry) {
        return attemptResult;
      }

      if (this.timeoutRetryDelayMs > 0) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, this.timeoutRetryDelayMs);
        });
      }
    }

    return latestResult ?? {
      sessionId: "unknown",
      caste: input.caste,
      modelRef: modelConfig.reference,
      provider: modelConfig.provider,
      modelId: modelConfig.modelId,
      thinkingLevel: modelConfig.thinkingLevel,
      status: "failed",
      outputText: "",
      toolsUsed: [],
      messageLog: [{
        role: "user",
        content: input.prompt,
      }],
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      error: `Pi ${input.caste} session failed without result.`,
    };
  }

  private async runSingleAttempt(
    input: CasteRunInput,
    piCodingAgent: PiCodingAgentModule,
    modelConfig: ResolvedConfiguredCasteModel,
    sessionTimeoutMs: number,
  ): Promise<CasteSessionResult> {
    const startedAt = new Date().toISOString();
    const messageLog: CasteSessionMessage[] = [{
      role: "user",
      content: input.prompt,
    }];
    const toolContract = CASTE_TOOL_CONTRACTS[input.caste];
    const baseTools = resolveTools(piCodingAgent, input.caste, input.workingDirectory);
    const customTools = resolveCustomTools(input.caste);
    const activeToolNames = [...new Set([
      ...baseTools.map((tool) => tool.name),
      ...customTools.map((tool) => tool.name),
    ])];
    const { session } = await piCodingAgent.createAgentSession({
      cwd: input.workingDirectory,
      model: modelConfig.model,
      thinkingLevel: modelConfig.thinkingLevel,
      tools: baseTools,
      customTools,
    });
    session.setActiveToolsByName(activeToolNames);
    let enforceContractPayload = false;
    installPayloadContractHook(toolContract, session, () => enforceContractPayload);
    const messages: string[] = [];
    const toolsUsed: string[] = [];
    let structuredOutput: string | null = null;

    try {
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        let repairAttempted = false;
        const sessionTimeout = setTimeout(() => {
          settle(() => {
            reject(new Error(
              `Pi ${input.caste} session timed out after ${sessionTimeoutMs}ms.`,
            ));
          });
        }, sessionTimeoutMs);

        const settle = (action: () => void) => {
          if (settled) {
            return;
          }

          settled = true;
          clearTimeout(sessionTimeout);
          unsubscribe();
          action();
        };

        const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
          const casteOutput = toolContract.extractStructuredOutput(event);
          if (casteOutput) {
            structuredOutput = casteOutput;
            settle(() => {
              resolve();
            });
            return;
          }

          if (event.type === "tool_execution_start") {
            toolsUsed.push(event.toolName);
            return;
          }

          const text = extractAssistantText(event);
          const role = extractMessageRole(event);
          if (text.length > 0) {
            messages.push(text);
            if (role) {
              messageLog.push({
                role,
                content: text,
              });
            }
            return;
          }

          if (event.type === "agent_end") {
            const state = session.state as { error?: string | null };
            if (state.error) {
              const errorMessage = typeof state.error === "string"
                ? state.error
                : "Unknown Pi session error.";
              settle(() => {
                reject(new Error(errorMessage));
              });
              return;
            }

            if (structuredOutput) {
              settle(() => {
                resolve();
              });
              return;
            }

            if (!repairAttempted) {
              repairAttempted = true;
              enforceContractPayload = true;
              const repairPrompt = createContractRepairPrompt(toolContract);
              messageLog.push({
                role: "user",
                content: repairPrompt,
              });

              void session.prompt(repairPrompt).catch((error: unknown) => {
                settle(() => {
                  reject(error);
                });
              });
              return;
            }

            settle(() => {
              reject(new Error(
                `${toolContract.label} tool contract violation: missing '${toolContract.toolName}' output.`,
              ));
            });
          }
        });

        void session.prompt(input.prompt).catch((error: unknown) => {
          settle(() => {
            reject(error);
          });
        });
      });

      return {
        sessionId: session.sessionId,
        caste: input.caste,
        modelRef: modelConfig.reference,
        provider: modelConfig.provider,
        modelId: modelConfig.modelId,
        thinkingLevel: modelConfig.thinkingLevel,
        status: "succeeded",
        outputText: structuredOutput ?? messages.at(-1) ?? "",
        toolsUsed,
        messageLog,
        startedAt,
        finishedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        sessionId: session.sessionId,
        caste: input.caste,
        modelRef: modelConfig.reference,
        provider: modelConfig.provider,
        modelId: modelConfig.modelId,
        thinkingLevel: modelConfig.thinkingLevel,
        status: "failed",
        outputText: structuredOutput ?? messages.at(-1) ?? "",
        toolsUsed,
        messageLog,
        startedAt,
        finishedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      session.dispose();
    }
  }
}
