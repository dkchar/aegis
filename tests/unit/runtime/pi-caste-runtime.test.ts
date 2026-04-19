import { beforeEach, describe, expect, it, vi } from "vitest";

import { JANUS_EMIT_RESOLUTION_TOOL_NAME } from "../../../src/castes/janus/janus-tool-contract.js";
import { ORACLE_EMIT_ASSESSMENT_TOOL_NAME } from "../../../src/castes/oracle/oracle-tool-contract.js";
import { SENTINEL_EMIT_VERDICT_TOOL_NAME } from "../../../src/castes/sentinel/sentinel-tool-contract.js";
import { TITAN_EMIT_ARTIFACT_TOOL_NAME } from "../../../src/castes/titan/titan-tool-contract.js";
import type { CasteName } from "../../../src/runtime/caste-runtime.js";
import { PiCasteRuntime } from "../../../src/runtime/pi-caste-runtime.js";

type MockListener = (event: any) => void;

interface ContractFixture {
  caste: CasteName;
  label: string;
  toolName: string;
  detailsKey: string;
  detailsValue: Record<string, unknown>;
  outputSnippet: string;
  expectedActiveTools: string[];
}

const CONTRACT_FIXTURES: ContractFixture[] = [
  {
    caste: "oracle",
    label: "Oracle",
    toolName: ORACLE_EMIT_ASSESSMENT_TOOL_NAME,
    detailsKey: "assessment",
    detailsValue: {
      files_affected: ["src/index.ts"],
      estimated_complexity: "moderate",
      decompose: false,
      ready: true,
    },
    outputSnippet: "\"estimated_complexity\":\"moderate\"",
    expectedActiveTools: ["read", "grep", "find", "ls", ORACLE_EMIT_ASSESSMENT_TOOL_NAME],
  },
  {
    caste: "titan",
    label: "Titan",
    toolName: TITAN_EMIT_ARTIFACT_TOOL_NAME,
    detailsKey: "artifact",
    detailsValue: {
      outcome: "success",
      summary: "implemented",
      files_changed: ["src/index.ts"],
      tests_and_checks_run: [],
      known_risks: [],
      follow_up_work: [],
      learnings_written_to_mnemosyne: [],
    },
    outputSnippet: "\"outcome\":\"success\"",
    expectedActiveTools: ["read", "bash", "edit", "write", TITAN_EMIT_ARTIFACT_TOOL_NAME],
  },
  {
    caste: "sentinel",
    label: "Sentinel",
    toolName: SENTINEL_EMIT_VERDICT_TOOL_NAME,
    detailsKey: "verdict",
    detailsValue: {
      verdict: "pass",
      reviewSummary: "clean",
      issuesFound: [],
      followUpIssueIds: [],
      riskAreas: [],
    },
    outputSnippet: "\"verdict\":\"pass\"",
    expectedActiveTools: ["read", "grep", "find", "ls", SENTINEL_EMIT_VERDICT_TOOL_NAME],
  },
  {
    caste: "janus",
    label: "Janus",
    toolName: JANUS_EMIT_RESOLUTION_TOOL_NAME,
    detailsKey: "artifact",
    detailsValue: {
      originatingIssueId: "aegis-1",
      queueItemId: "queue-aegis-1",
      preservedLaborPath: ".aegis/labors/aegis-1",
      conflictSummary: "conflict",
      resolutionStrategy: "manual",
      filesTouched: [],
      validationsRun: [],
      residualRisks: [],
      recommendedNextAction: "manual_decision",
    },
    outputSnippet: "\"recommendedNextAction\":\"manual_decision\"",
    expectedActiveTools: ["read", "grep", "find", "ls", JANUS_EMIT_RESOLUTION_TOOL_NAME],
  },
];

const mockedAgent = vi.hoisted(() => {
  const listeners: MockListener[] = [];
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
    subscribe: vi.fn((listener: MockListener) => {
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

      listener({ type: "agent_end" });
    }),
    setActiveToolsByName: vi.fn(),
    dispose: vi.fn(),
  };

  return {
    listeners,
    session,
    createAgentSession: vi.fn(async () => ({ session })),
    createCodingTools: vi.fn(() => [
      { name: "read" },
      { name: "bash" },
      { name: "edit" },
      { name: "write" },
    ]),
    createReadOnlyTools: vi.fn(() => [
      { name: "read" },
      { name: "grep" },
      { name: "find" },
      { name: "ls" },
    ]),
  };
});

vi.mock("@mariozechner/pi-coding-agent", () => ({
  createAgentSession: mockedAgent.createAgentSession,
  createCodingTools: mockedAgent.createCodingTools,
  createReadOnlyTools: mockedAgent.createReadOnlyTools,
}));

function configureToolSuccess(fixture: ContractFixture) {
  mockedAgent.session.prompt.mockImplementationOnce(async () => {
    const listener = mockedAgent.listeners.at(-1);
    if (!listener) {
      return;
    }

    listener({
      type: "tool_execution_start",
      toolCallId: "call-1",
      toolName: fixture.toolName,
      args: {},
    });
    listener({
      type: "tool_execution_end",
      toolCallId: "call-1",
      toolName: fixture.toolName,
      isError: false,
      result: {
        content: [{ type: "text", text: `${fixture.label} payload captured.` }],
        details: {
          [fixture.detailsKey]: fixture.detailsValue,
        },
      },
    });
    listener({ type: "agent_end" });
  });
}

function configureMissingToolOutput() {
  mockedAgent.session.prompt.mockImplementation(async () => {
    const listener = mockedAgent.listeners.at(-1);
    if (!listener) {
      return;
    }

    listener({ type: "agent_end" });
  });
}

function configureRepairThenToolSuccess(fixture: ContractFixture) {
  let promptCount = 0;
  mockedAgent.session.prompt.mockImplementation(async () => {
    const listener = mockedAgent.listeners.at(-1);
    if (!listener) {
      return;
    }

    promptCount += 1;
    if (promptCount === 1) {
      listener({ type: "agent_end" });
      return;
    }

    listener({
      type: "tool_execution_start",
      toolCallId: "call-1",
      toolName: fixture.toolName,
      args: {},
    });
    listener({
      type: "tool_execution_end",
      toolCallId: "call-1",
      toolName: fixture.toolName,
      isError: false,
      result: {
        content: [{ type: "text", text: `${fixture.label} payload captured.` }],
        details: {
          [fixture.detailsKey]: fixture.detailsValue,
        },
      },
    });
    listener({ type: "agent_end" });
  });
}

function createModelConfig(caste: CasteName) {
  return {
    caste,
    reference: "openai-codex:gpt-5.4-mini",
    provider: "openai-codex",
    modelId: "gpt-5.4-mini",
    thinkingLevel: "medium" as const,
    model: {} as never,
  };
}

function createSingleCasteRuntime(caste: CasteName) {
  return new PiCasteRuntime({
    [caste]: createModelConfig(caste),
  });
}

describe("PiCasteRuntime", () => {
  beforeEach(() => {
    mockedAgent.listeners.splice(0, mockedAgent.listeners.length);
    mockedAgent.createAgentSession.mockClear();
    mockedAgent.createCodingTools.mockClear();
    mockedAgent.createReadOnlyTools.mockClear();
    mockedAgent.session.subscribe.mockClear();
    mockedAgent.session.prompt.mockReset();
    mockedAgent.session.setActiveToolsByName.mockClear();
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

  it("captures structured tool outputs for all castes without forcing payload on normal turn", async () => {
    for (const fixture of CONTRACT_FIXTURES) {
      mockedAgent.session.agent.onPayload = undefined;
      configureToolSuccess(fixture);
      const runtime = createSingleCasteRuntime(fixture.caste);

      const result = await runtime.run({
        caste: fixture.caste,
        issueId: "aegis-123",
        root: "repo",
        workingDirectory: `repo/${fixture.caste}`,
        prompt: `${fixture.caste} run`,
      });

      expect(result.status).toBe("succeeded");
      expect(result.outputText).toContain(fixture.outputSnippet);
      expect(result.toolsUsed).toContain(fixture.toolName);

      const createSessionCall = (mockedAgent.createAgentSession.mock.calls as unknown[][])
        .at(-1)?.[0] as {
        customTools?: unknown[];
      } | undefined;
      expect(createSessionCall?.customTools).toHaveLength(1);
      expect(mockedAgent.session.setActiveToolsByName).toHaveBeenLastCalledWith(
        fixture.expectedActiveTools,
      );

      const onPayload = mockedAgent.session.agent.onPayload as
        | ((payload: unknown, model: unknown) => unknown | Promise<unknown>)
        | undefined;
      const transformedPayload = onPayload
        ? await onPayload(
          {
            tool_choice: "auto",
            parallel_tool_calls: true,
            tools: [],
          },
          {},
        )
        : undefined;
      expect(transformedPayload).toBeUndefined();

      const passthroughAfterToolResult = onPayload
        ? await onPayload(
          {
            tool_choice: "auto",
            parallel_tool_calls: true,
            tools: [],
            input: [
              {
                type: "function_call_output",
                call_id: "call_1",
                output: "{\"ok\":true}",
              },
            ],
          },
          {},
        )
        : undefined;
      expect(passthroughAfterToolResult).toBeUndefined();
    }
  });

  it("retries once with contract repair prompt when first run misses tool output", async () => {
    const fixture = CONTRACT_FIXTURES.find((candidate) => candidate.caste === "titan");
    if (!fixture) {
      throw new Error("Missing titan fixture.");
    }

    configureRepairThenToolSuccess(fixture);
    const runtime = createSingleCasteRuntime(fixture.caste);

    const result = await runtime.run({
      caste: fixture.caste,
      issueId: "aegis-123",
      root: "repo",
      workingDirectory: "repo",
      prompt: `${fixture.caste} run`,
    });

    expect(result.status).toBe("succeeded");
    expect(result.outputText).toContain(fixture.outputSnippet);
    expect(mockedAgent.session.prompt).toHaveBeenCalledTimes(2);
    expect(result.messageLog.some((entry) => (
      entry.role === "user"
      && entry.content.includes("Tool contract repair required")
    ))).toBe(true);
  });

  it("fails run when tool output is still missing after repair", async () => {
    for (const fixture of CONTRACT_FIXTURES) {
      configureMissingToolOutput();
      const runtime = createSingleCasteRuntime(fixture.caste);
      const promptCallsBefore = mockedAgent.session.prompt.mock.calls.length;

      const result = await runtime.run({
        caste: fixture.caste,
        issueId: "aegis-123",
        root: "repo",
        workingDirectory: "repo",
        prompt: `${fixture.caste} run`,
      });

      expect(result.status).toBe("failed");
      expect(result.error).toBe(
        `${fixture.label} tool contract violation: missing '${fixture.toolName}' output.`,
      );
      expect(mockedAgent.session.prompt.mock.calls.length - promptCallsBefore).toBe(2);
    }
  });

  it("keeps Phase H/I tool setup: titan coding tools, others read-only tools", async () => {
    for (const fixture of CONTRACT_FIXTURES) {
      configureToolSuccess(fixture);
      const runtime = createSingleCasteRuntime(fixture.caste);
      await runtime.run({
        caste: fixture.caste,
        issueId: "aegis-123",
        root: "repo",
        workingDirectory: `repo/${fixture.caste}`,
        prompt: `${fixture.caste} run`,
      });
    }

    expect(mockedAgent.createCodingTools).toHaveBeenCalledWith("repo/titan");
    expect(mockedAgent.createReadOnlyTools).toHaveBeenCalledWith("repo/oracle");
    expect(mockedAgent.createReadOnlyTools).toHaveBeenCalledWith("repo/sentinel");
    expect(mockedAgent.createReadOnlyTools).toHaveBeenCalledWith("repo/janus");
  });
});
