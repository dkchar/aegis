import {
  createAgentSession,
  createCodingTools,
  createReadOnlyTools,
  type AgentSessionEvent,
  type ToolDefinition,
} from "@mariozechner/pi-coding-agent";

import {
  createOracleEmitAssessmentTool,
  enforceOracleToolPayloadContract,
  extractOracleAssessmentFromToolEvent,
  ORACLE_EMIT_ASSESSMENT_TOOL_NAME,
  stringifyOracleAssessment,
} from "../castes/oracle/oracle-tool-contract.js";
import type {
  CasteName,
  CasteRunInput,
  CasteRuntime,
  CasteSessionMessage,
  CasteSessionResult,
} from "./caste-runtime.js";
import type { ResolvedConfiguredCasteModel } from "./pi-model-config.js";

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

function resolveTools(caste: CasteName, workingDirectory: string) {
  if (caste === "titan") {
    return createCodingTools(workingDirectory);
  }

  return createReadOnlyTools(workingDirectory);
}

function resolveCustomTools(caste: CasteName): ToolDefinition[] | undefined {
  if (caste === "oracle") {
    return [createOracleEmitAssessmentTool()];
  }

  return undefined;
}

function installPayloadContractHook(caste: CasteName, session: Awaited<ReturnType<typeof createAgentSession>>["session"]) {
  if (caste !== "oracle") {
    return;
  }

  const existingOnPayload = session.agent.onPayload;
  session.agent.onPayload = async (payload, model) => {
    const existingPayload = existingOnPayload
      ? await existingOnPayload(payload, model)
      : undefined;
    const effectivePayload = existingPayload === undefined ? payload : existingPayload;
    const enforcedPayload = enforceOracleToolPayloadContract(effectivePayload);

    if (enforcedPayload !== undefined) {
      return enforcedPayload;
    }

    if (existingPayload !== undefined) {
      return effectivePayload;
    }

    return undefined;
  };
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
    const customTools = resolveCustomTools(input.caste);
    const { session } = await createAgentSession({
      cwd: input.workingDirectory,
      model: modelConfig.model,
      thinkingLevel: modelConfig.thinkingLevel,
      tools: resolveTools(input.caste, input.workingDirectory),
      ...(customTools ? { customTools } : {}),
    });
    installPayloadContractHook(input.caste, session);
    const messages: string[] = [];
    const toolsUsed: string[] = [];
    let oracleStructuredOutput: string | null = null;

    try {
      await new Promise<void>((resolve, reject) => {
        const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
          const oracleAssessment = extractOracleAssessmentFromToolEvent(event);
          if (oracleAssessment) {
            oracleStructuredOutput = stringifyOracleAssessment(oracleAssessment);
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
            unsubscribe();
            const state = session.state as { error?: string | null };
            if (state.error) {
              reject(new Error(state.error));
              return;
            }
            if (input.caste === "oracle" && !oracleStructuredOutput) {
              reject(new Error(
                `Oracle tool contract violation: missing '${ORACLE_EMIT_ASSESSMENT_TOOL_NAME}' output.`,
              ));
              return;
            }
            resolve();
          }
        });

        void session.prompt(input.prompt).catch((error: unknown) => {
          reject(error);
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
        outputText: oracleStructuredOutput ?? messages.at(-1) ?? "",
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
        outputText: oracleStructuredOutput ?? messages.at(-1) ?? "",
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
