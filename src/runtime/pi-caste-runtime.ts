import {
  codingTools,
  createAgentSession,
  readOnlyTools,
  type AgentSessionEvent,
} from "@mariozechner/pi-coding-agent";

import type { CasteName, CasteRunInput, CasteRuntime, CasteSessionResult } from "./caste-runtime.js";

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

function resolveTools(caste: CasteName) {
  if (caste === "titan") {
    return codingTools;
  }

  return readOnlyTools;
}

export class PiCasteRuntime implements CasteRuntime {
  async run(input: CasteRunInput): Promise<CasteSessionResult> {
    const startedAt = new Date().toISOString();
    const { session } = await createAgentSession({
      cwd: input.workingDirectory,
      tools: resolveTools(input.caste),
    });
    const messages: string[] = [];
    const toolsUsed: string[] = [];

    try {
      await new Promise<void>((resolve, reject) => {
        const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
          if (event.type === "tool_execution_start") {
            toolsUsed.push(event.toolName);
            return;
          }

          const text = extractAssistantText(event);
          if (text.length > 0) {
            messages.push(text);
            return;
          }

          if (event.type === "agent_end") {
            unsubscribe();
            const state = session.state as { error?: string | null };
            if (state.error) {
              reject(new Error(state.error));
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
        status: "succeeded",
        outputText: messages.at(-1) ?? "",
        toolsUsed,
        startedAt,
        finishedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        sessionId: session.sessionId,
        caste: input.caste,
        status: "failed",
        outputText: messages.at(-1) ?? "",
        toolsUsed,
        startedAt,
        finishedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      session.dispose();
    }
  }
}
