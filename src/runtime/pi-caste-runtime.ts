import {
  createAgentSession,
  createCodingTools,
  createEditTool,
  createReadOnlyTools,
  createReadTool,
  createWriteTool,
  type EditOperations,
  type ReadOperations,
  type WriteOperations,
  type AgentSessionEvent,
  type ToolDefinition,
} from "@mariozechner/pi-coding-agent";
import { constants as fsConstants } from "node:fs";
import { access as fsAccess, mkdir as fsMkdir, readFile as fsReadFile, writeFile as fsWriteFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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

type RuntimeTool = ReturnType<typeof createCodingTools>[number];

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

function normalizePathForComparison(candidatePath: string) {
  const resolved = path.resolve(candidatePath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function resolvePathWithinScope(candidatePath: string, allowedRoot: string) {
  const expanded = candidatePath === "~"
    ? os.homedir()
    : candidatePath.startsWith("~/")
      ? path.join(os.homedir(), candidatePath.slice(2))
      : candidatePath;
  return path.isAbsolute(expanded)
    ? path.resolve(expanded)
    : path.resolve(allowedRoot, expanded);
}

function isPathWithinScope(targetPath: string, allowedRoot: string) {
  const normalizedTarget = normalizePathForComparison(
    resolvePathWithinScope(targetPath, allowedRoot),
  );
  const normalizedRoot = normalizePathForComparison(allowedRoot);
  const rootPrefix = normalizedRoot.endsWith(path.sep)
    ? normalizedRoot
    : `${normalizedRoot}${path.sep}`;
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(rootPrefix);
}

function assertMockRunPathScope(targetPath: string, allowedRoot: string) {
  if (isPathWithinScope(targetPath, allowedRoot)) {
    return;
  }

  throw new Error(
    `Mock-run Titan guard blocked path outside labor scope: ${targetPath}`,
  );
}

function isMockRunRepositoryRoot(root: string) {
  return path.basename(path.resolve(root)) === "aegis-mock-run";
}

function resolveToolPathFromInput(
  input: unknown,
  workingDirectory: string,
): string | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const candidate = input as { path?: unknown; file_path?: unknown };
  const rawPath = typeof candidate.path === "string"
    ? candidate.path
    : typeof candidate.file_path === "string"
      ? candidate.file_path
      : null;
  if (!rawPath || rawPath.trim().length === 0) {
    return null;
  }

  return resolvePathWithinScope(rawPath, workingDirectory);
}

function wrapToolWithMockRunPathGuard(
  tool: RuntimeTool,
  workingDirectory: string,
): RuntimeTool {
  if (typeof tool.execute !== "function") {
    return tool;
  }

  const execute = tool.execute.bind(tool);
  return {
    ...tool,
    async execute(
      toolCallId: Parameters<RuntimeTool["execute"]>[0],
      input: Parameters<RuntimeTool["execute"]>[1],
      signal: Parameters<RuntimeTool["execute"]>[2],
      onUpdate: Parameters<RuntimeTool["execute"]>[3],
    ) {
      const resolvedPath = resolveToolPathFromInput(input, workingDirectory);
      if (!resolvedPath) {
        throw new Error(
          `Mock-run Titan guard blocked '${tool.name}' call without explicit path.`,
        );
      }
      assertMockRunPathScope(resolvedPath, workingDirectory);

      return execute(toolCallId, input, signal, onUpdate);
    },
  };
}

function createMockRunGuardedTitanTools(workingDirectory: string) {
  const readOperations: ReadOperations = {
    async readFile(absolutePath) {
      assertMockRunPathScope(absolutePath, workingDirectory);
      return fsReadFile(absolutePath);
    },
    async access(absolutePath) {
      assertMockRunPathScope(absolutePath, workingDirectory);
      await fsAccess(absolutePath, fsConstants.R_OK);
    },
  };

  const editOperations: EditOperations = {
    async readFile(absolutePath) {
      assertMockRunPathScope(absolutePath, workingDirectory);
      return fsReadFile(absolutePath);
    },
    async writeFile(absolutePath, content) {
      assertMockRunPathScope(absolutePath, workingDirectory);
      await fsWriteFile(absolutePath, content, "utf8");
    },
    async access(absolutePath) {
      assertMockRunPathScope(absolutePath, workingDirectory);
      await fsAccess(absolutePath, fsConstants.R_OK | fsConstants.W_OK);
    },
  };

  const writeOperations: WriteOperations = {
    async writeFile(absolutePath, content) {
      assertMockRunPathScope(absolutePath, workingDirectory);
      await fsWriteFile(absolutePath, content, "utf8");
    },
    async mkdir(directoryPath) {
      assertMockRunPathScope(directoryPath, workingDirectory);
      await fsMkdir(directoryPath, { recursive: true });
    },
  };

  return [
    wrapToolWithMockRunPathGuard(
      createReadTool(workingDirectory, { operations: readOperations }),
      workingDirectory,
    ),
    wrapToolWithMockRunPathGuard(
      createEditTool(workingDirectory, { operations: editOperations }),
      workingDirectory,
    ),
    wrapToolWithMockRunPathGuard(
      createWriteTool(workingDirectory, { operations: writeOperations }),
      workingDirectory,
    ),
  ];
}

function resolveTools(caste: CasteName, workingDirectory: string, root: string) {
  if (caste === "titan") {
    if (isMockRunRepositoryRoot(root)) {
      return createMockRunGuardedTitanTools(workingDirectory);
    }

    return createCodingTools(workingDirectory);
  }

  return createReadOnlyTools(workingDirectory);
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
  session: Awaited<ReturnType<typeof createAgentSession>>["session"],
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
  constructor(
    private readonly modelConfigs: Partial<Record<CasteName, ResolvedConfiguredCasteModel>> = {},
  ) {}

  async run(input: CasteRunInput): Promise<CasteSessionResult> {
    const startedAt = new Date().toISOString();
    const modelConfig = this.modelConfigs[input.caste];
    if (!modelConfig) {
      throw new Error(`Missing configured Pi model for caste "${input.caste}".`);
    }

    const messageLog: CasteSessionMessage[] = [{
      role: "user",
      content: input.prompt,
    }];
    const toolContract = CASTE_TOOL_CONTRACTS[input.caste];
    const baseTools = resolveTools(input.caste, input.workingDirectory, input.root);
    const activeToolNames = [...new Set([
      ...baseTools.map((tool) => tool.name),
      toolContract.toolName,
    ])];
    const customTools = resolveCustomTools(input.caste);
    const { session } = await createAgentSession({
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

        const settle = (action: () => void) => {
          if (settled) {
            return;
          }

          settled = true;
          unsubscribe();
          action();
        };

        const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
          const casteOutput = toolContract.extractStructuredOutput(event);
          if (casteOutput) {
            structuredOutput = casteOutput;
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
