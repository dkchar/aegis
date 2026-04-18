import { beforeEach, describe, expect, it, vi } from "vitest";

import { ORACLE_EMIT_ASSESSMENT_TOOL_NAME } from "../../../src/castes/oracle/oracle-tool-contract.js";
import { PiCasteRuntime } from "../../../src/runtime/pi-caste-runtime.js";

const mockedAgent = vi.hoisted(() => {
  const listeners: Array<(event: any) => void> = [];
  const session = {
    sessionId: "pi-session-1",
    agent: {
      onPayload: undefined as
        | ((payload: unknown, model: unknown) => unknown | Promise<unknown>)
        | undefined,
    },
    state: {
      error: null as string | null,
    },
    subscribe: vi.fn((listener: (event: any) => void) => {
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index >= 0) {
          listeners.splice(index, 1);
        }
      };
    }),
    prompt: vi.fn(async () => {
      const listener = listeners.at(-1);
      if (!listener) {
        return;
      }

      listener({
        type: "tool_execution_start",
        toolCallId: "call-1",
        toolName: ORACLE_EMIT_ASSESSMENT_TOOL_NAME,
        args: {},
      });
      listener({
        type: "tool_execution_end",
        toolCallId: "call-1",
        toolName: ORACLE_EMIT_ASSESSMENT_TOOL_NAME,
        isError: false,
        result: {
          content: [{ type: "text", text: "Oracle assessment captured." }],
          details: {
            assessment: {
              files_affected: ["src/index.ts"],
              estimated_complexity: "moderate",
              decompose: false,
              ready: true,
            },
          },
        },
      });
      listener({ type: "agent_end" });
    }),
    dispose: vi.fn(),
  };

  return {
    listeners,
    session,
    createAgentSession: vi.fn(async () => ({ session })),
    createCodingTools: vi.fn(() => []),
    createReadOnlyTools: vi.fn(() => []),
  };
});

vi.mock("@mariozechner/pi-coding-agent", () => ({
  createAgentSession: mockedAgent.createAgentSession,
  createCodingTools: mockedAgent.createCodingTools,
  createReadOnlyTools: mockedAgent.createReadOnlyTools,
}));

describe("PiCasteRuntime", () => {
  beforeEach(() => {
    mockedAgent.listeners.splice(0, mockedAgent.listeners.length);
    mockedAgent.createAgentSession.mockClear();
    mockedAgent.createCodingTools.mockClear();
    mockedAgent.createReadOnlyTools.mockClear();
    mockedAgent.session.subscribe.mockClear();
    mockedAgent.session.prompt.mockClear();
    mockedAgent.session.dispose.mockClear();
    mockedAgent.session.state.error = null;
    mockedAgent.session.agent.onPayload = undefined;
  });

  it("rejects runs without an explicit configured model for the caste", async () => {
    const runtime = new PiCasteRuntime();

    await expect(runtime.run({
      caste: "oracle",
      issueId: "aegis-123",
      root: "repo",
      workingDirectory: "repo",
      prompt: "Scout aegis-123",
    })).rejects.toThrow('Missing configured Pi model for caste "oracle".');
  });

  it("captures oracle output from tool contract instead of assistant prose", async () => {
    const runtime = new PiCasteRuntime({
      oracle: {
        caste: "oracle",
        reference: "openai-codex:gpt-5.4-mini",
        provider: "openai-codex",
        modelId: "gpt-5.4-mini",
        thinkingLevel: "medium",
        model: {} as never,
      },
    });

    const result = await runtime.run({
      caste: "oracle",
      issueId: "aegis-123",
      root: "repo",
      workingDirectory: "repo",
      prompt: "Scout aegis-123",
    });

    expect(result.status).toBe("succeeded");
    expect(result.outputText).toContain("\"estimated_complexity\":\"moderate\"");
    expect(result.toolsUsed).toContain(ORACLE_EMIT_ASSESSMENT_TOOL_NAME);

    const createSessionCalls = mockedAgent.createAgentSession.mock.calls as unknown as Array<Array<{
      customTools?: unknown[];
    }>>;
    const createSessionCall = createSessionCalls.at(0)?.at(0);
    expect(createSessionCall?.customTools).toHaveLength(1);

    const transformedPayload = await mockedAgent.session.agent.onPayload?.(
      {
        tool_choice: "auto",
        parallel_tool_calls: true,
        tools: [],
      },
      {},
    );
    expect(transformedPayload).toEqual({
      tool_choice: {
        type: "function",
        name: ORACLE_EMIT_ASSESSMENT_TOOL_NAME,
      },
      parallel_tool_calls: false,
      tools: [],
    });

    const passthroughAfterToolResult = await mockedAgent.session.agent.onPayload?.(
      {
        tool_choice: "auto",
        parallel_tool_calls: true,
        tools: [],
        input: [
          {
            type: "function_call_output",
            call_id: "call_1",
            output: "{\"ready\":true}",
          },
        ],
      },
      {},
    );
    expect(passthroughAfterToolResult).toBeUndefined();
  });

  it("marks oracle run failed when contract tool output is missing", async () => {
    mockedAgent.session.prompt.mockImplementationOnce(async () => {
      const listener = mockedAgent.listeners.at(-1);
      if (!listener) {
        return;
      }

      listener({ type: "agent_end" });
    });

    const runtime = new PiCasteRuntime({
      oracle: {
        caste: "oracle",
        reference: "openai-codex:gpt-5.4-mini",
        provider: "openai-codex",
        modelId: "gpt-5.4-mini",
        thinkingLevel: "medium",
        model: {} as never,
      },
    });

    const result = await runtime.run({
      caste: "oracle",
      issueId: "aegis-123",
      root: "repo",
      workingDirectory: "repo",
      prompt: "Scout aegis-123",
    });

    expect(result.status).toBe("failed");
    expect(result.error).toBe(
      `Oracle tool contract violation: missing '${ORACLE_EMIT_ASSESSMENT_TOOL_NAME}' output.`,
    );
  });
});
