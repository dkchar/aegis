import { beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { JANUS_EMIT_RESOLUTION_TOOL_NAME } from "../../../src/castes/janus/janus-tool-contract.js";
import { ORACLE_EMIT_ASSESSMENT_TOOL_NAME } from "../../../src/castes/oracle/oracle-tool-contract.js";
import { SENTINEL_EMIT_VERDICT_TOOL_NAME } from "../../../src/castes/sentinel/sentinel-tool-contract.js";
import { TITAN_EMIT_ARTIFACT_TOOL_NAME } from "../../../src/castes/titan/titan-tool-contract.js";
import type { CasteName } from "../../../src/runtime/caste-runtime.js";
import {
  buildHiddenShellSpawnOptions,
  PiCasteRuntime,
} from "../../../src/runtime/pi-caste-runtime.js";

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
      risks: [],
      suggested_checks: ["npm test"],
      scope_notes: ["scout only"],
    },
    outputSnippet: "\"estimated_complexity\":\"moderate\"",
    expectedActiveTools: ["read", "find", "ls", "grep", ORACLE_EMIT_ASSESSMENT_TOOL_NAME],
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
      blockingFindings: [],
      advisories: [],
      touchedFiles: [],
      contractChecks: [],
    },
    outputSnippet: "\"verdict\":\"pass\"",
    expectedActiveTools: ["read", "find", "ls", "grep", SENTINEL_EMIT_VERDICT_TOOL_NAME],
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
      mutation_proposal: {
        proposal_type: "create_integration_blocker",
        summary: "manual integration decision",
        suggested_title: "Resolve integration conflict",
        suggested_description: "Conflict needs separate integration work.",
        scope_evidence: ["manual conflict context"],
      },
    },
    outputSnippet: "\"create_integration_blocker\"",
    expectedActiveTools: ["read", "find", "ls", "grep", JANUS_EMIT_RESOLUTION_TOOL_NAME],
  },
];

const mockedAgent = vi.hoisted(() => {
  const listeners: MockListener[] = [];
  const createTool = (name: string) => ({
    name,
    parameters: {},
    execute: vi.fn(async () => ({
      content: [],
      isError: false,
    })),
  });
  const createResourceLoader = (options: Record<string, unknown>) => ({
    options,
    reload: vi.fn(async () => undefined),
    getExtensions: vi.fn(() => ({ extensions: [], errors: [], runtime: {} })),
    getSkills: vi.fn(() => ({ skills: [], diagnostics: [] })),
    getPrompts: vi.fn(() => ({ prompts: [], diagnostics: [] })),
    getThemes: vi.fn(() => ({ themes: [], diagnostics: [] })),
    getAgentsFiles: vi.fn(() => ({ agentsFiles: [] })),
    getSystemPrompt: vi.fn(() => undefined),
    getAppendSystemPrompt: vi.fn(() => []),
    extendResources: vi.fn(),
  });
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
    createReadTool: vi.fn(() => createTool("read")),
    createBashTool: vi.fn(() => createTool("bash")),
    createEditTool: vi.fn(() => createTool("edit")),
    createWriteTool: vi.fn(() => createTool("write")),
    createFindTool: vi.fn(() => ({ name: "find" })),
    createLsTool: vi.fn(() => ({ name: "ls" })),
    createGrepTool: vi.fn(() => ({ name: "grep" })),
    DefaultResourceLoader: vi.fn(function DefaultResourceLoader(options: Record<string, unknown>) {
      return createResourceLoader(options);
    }),
  };
});

vi.mock("@mariozechner/pi-coding-agent", () => ({
  createAgentSession: mockedAgent.createAgentSession,
  createCodingTools: mockedAgent.createCodingTools,
  createReadTool: mockedAgent.createReadTool,
  createBashTool: mockedAgent.createBashTool,
  createEditTool: mockedAgent.createEditTool,
  createWriteTool: mockedAgent.createWriteTool,
  createFindTool: mockedAgent.createFindTool,
  createLsTool: mockedAgent.createLsTool,
  createGrepTool: mockedAgent.createGrepTool,
  DefaultResourceLoader: mockedAgent.DefaultResourceLoader,
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
    mockedAgent.createReadTool.mockClear();
    mockedAgent.createBashTool.mockClear();
    mockedAgent.createEditTool.mockClear();
    mockedAgent.createWriteTool.mockClear();
    mockedAgent.createFindTool.mockClear();
    mockedAgent.createLsTool.mockClear();
    mockedAgent.createGrepTool.mockClear();
    mockedAgent.DefaultResourceLoader.mockClear();
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
    const repairPromptCall = mockedAgent.session.prompt.mock.calls[1] as unknown[] | undefined;
    expect(repairPromptCall?.[1]).toEqual({
      streamingBehavior: "followUp",
    });
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

  it("fails bounded when pi session never reaches agent_end", async () => {
    mockedAgent.session.prompt.mockImplementation(async () => {
      // Simulate provider/session hang: no events emitted.
    });

    const runtime = new PiCasteRuntime({
      oracle: createModelConfig("oracle"),
    }, {
      sessionTimeoutMs: 10,
      timeoutRetryCount: 0,
    });

    const result = await runtime.run({
      caste: "oracle",
      issueId: "aegis-timeout",
      root: "repo",
      workingDirectory: "repo",
      prompt: "Scout timeout",
    });

    expect(result.status).toBe("failed");
    expect(result.error).toBe("Pi oracle session timed out after 10ms.");
  });

  it("uses caste-specific timeout override when configured", async () => {
    mockedAgent.session.prompt.mockImplementation(async () => {
      // Simulate provider/session hang: no events emitted.
    });

    const runtime = new PiCasteRuntime({
      sentinel: createModelConfig("sentinel"),
    }, {
      sessionTimeoutMs: 10,
      sessionTimeoutMsByCaste: {
        sentinel: 5,
      },
      timeoutRetryCount: 0,
    });

    const result = await runtime.run({
      caste: "sentinel",
      issueId: "aegis-timeout-sentinel",
      root: "repo",
      workingDirectory: "repo",
      prompt: "Review timeout",
    });

    expect(result.status).toBe("failed");
    expect(result.error).toBe("Pi sentinel session timed out after 5ms.");
  });

  it("defaults oracle sessions to a five-minute timeout budget", async () => {
    vi.useFakeTimers();
    try {
      mockedAgent.session.prompt.mockImplementation(async () => {
        // Simulate provider/session hang: no events emitted.
      });

      const runtime = new PiCasteRuntime({
        oracle: createModelConfig("oracle"),
      }, {
        timeoutRetryCount: 0,
      });

      const resultPromise = runtime.run({
        caste: "oracle",
        issueId: "aegis-default-oracle-timeout",
        root: "repo",
        workingDirectory: "repo",
        prompt: "Scout default-timeout",
      });

      await vi.advanceTimersByTimeAsync(300_000);
      const result = await resultPromise;

      expect(result.status).toBe("failed");
      expect(result.error).toBe("Pi oracle session timed out after 300000ms.");
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries timed-out sessions once and succeeds when second attempt returns", async () => {
    let attempt = 0;
    mockedAgent.session.prompt.mockImplementation(async () => {
      attempt += 1;
      if (attempt === 1) {
        return;
      }

      const listener = mockedAgent.listeners.at(-1);
      if (!listener) {
        return;
      }

      listener({
        type: "tool_execution_start",
        toolCallId: "call-timeout-retry",
        toolName: ORACLE_EMIT_ASSESSMENT_TOOL_NAME,
        args: {},
      });
      listener({
        type: "tool_execution_end",
        toolCallId: "call-timeout-retry",
        toolName: ORACLE_EMIT_ASSESSMENT_TOOL_NAME,
        isError: false,
        result: {
          content: [{ type: "text", text: "Recovered after timeout retry." }],
          details: {
            assessment: {
              files_affected: ["src/index.ts"],
              estimated_complexity: "moderate",
              risks: [],
              suggested_checks: ["npm test"],
              scope_notes: ["retry"],
            },
          },
        },
      });
      listener({ type: "agent_end" });
    });

    const runtime = new PiCasteRuntime({
      oracle: createModelConfig("oracle"),
    }, {
      sessionTimeoutMs: 10,
      timeoutRetryCount: 1,
      timeoutRetryDelayMs: 0,
    });

    const result = await runtime.run({
      caste: "oracle",
      issueId: "aegis-timeout-retry",
      root: "repo",
      workingDirectory: "repo",
      prompt: "Scout timeout retry",
    });

    expect(result.status).toBe("succeeded");
    expect(result.outputText).toContain("\"estimated_complexity\":\"moderate\"");
    expect(mockedAgent.createAgentSession).toHaveBeenCalledTimes(2);
  });

  it("completes on oracle tool payload even when agent_end never arrives", async () => {
    mockedAgent.session.prompt.mockImplementation(async () => {
      const listener = mockedAgent.listeners.at(-1);
      if (!listener) {
        return;
      }

      listener({
        type: "tool_execution_start",
        toolCallId: "call-oracle-direct",
        toolName: ORACLE_EMIT_ASSESSMENT_TOOL_NAME,
        args: {},
      });
      listener({
        type: "tool_execution_end",
        toolCallId: "call-oracle-direct",
        toolName: ORACLE_EMIT_ASSESSMENT_TOOL_NAME,
        isError: false,
        result: {
          content: [{ type: "text", text: "Oracle payload emitted." }],
          details: {
            assessment: {
              files_affected: ["src/index.ts"],
              estimated_complexity: "moderate",
              risks: [],
              suggested_checks: ["npm test"],
              scope_notes: ["direct"],
            },
          },
        },
      });
      // Intentionally no agent_end event.
    });

    const runtime = new PiCasteRuntime({
      oracle: createModelConfig("oracle"),
    }, {
      sessionTimeoutMs: 100,
      timeoutRetryCount: 0,
    });

    const result = await runtime.run({
      caste: "oracle",
      issueId: "aegis-no-agent-end",
      root: "repo",
      workingDirectory: "repo",
      prompt: "Scout no-agent-end",
    });

    expect(result.status).toBe("succeeded");
    expect(result.outputText).toContain("\"estimated_complexity\":\"moderate\"");
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

    expect(mockedAgent.createReadTool).toHaveBeenCalledWith(
      "repo/titan",
    );
    expect(mockedAgent.createBashTool).toHaveBeenCalledWith(
      "repo/titan",
      expect.objectContaining({
        operations: expect.any(Object),
      }),
    );
    expect(mockedAgent.createEditTool).toHaveBeenCalledWith(
      "repo/titan",
    );
    expect(mockedAgent.createWriteTool).toHaveBeenCalledWith(
      "repo/titan",
    );
    expect(mockedAgent.createReadTool).toHaveBeenCalledWith(
      "repo/oracle",
    );
    expect(mockedAgent.createReadTool).toHaveBeenCalledWith(
      "repo/sentinel",
    );
    expect(mockedAgent.createReadTool).toHaveBeenCalledWith(
      "repo/janus",
    );
    expect(mockedAgent.createFindTool).toHaveBeenCalledWith(
      "repo/oracle",
      expect.objectContaining({
        operations: expect.objectContaining({
          exists: expect.any(Function),
          glob: expect.any(Function),
        }),
      }),
    );
    expect(mockedAgent.createFindTool).toHaveBeenCalledWith(
      "repo/sentinel",
      expect.objectContaining({
        operations: expect.objectContaining({
          exists: expect.any(Function),
          glob: expect.any(Function),
        }),
      }),
    );
    expect(mockedAgent.createFindTool).toHaveBeenCalledWith(
      "repo/janus",
      expect.objectContaining({
        operations: expect.objectContaining({
          exists: expect.any(Function),
          glob: expect.any(Function),
        }),
      }),
    );
    expect(mockedAgent.createLsTool).toHaveBeenCalledWith(
      "repo/oracle",
    );
    expect(mockedAgent.createLsTool).toHaveBeenCalledWith(
      "repo/sentinel",
    );
    expect(mockedAgent.createLsTool).toHaveBeenCalledWith(
      "repo/janus",
    );
    expect(mockedAgent.createGrepTool).toHaveBeenCalledWith(
      "repo/oracle",
    );
    expect(mockedAgent.createGrepTool).toHaveBeenCalledWith(
      "repo/sentinel",
    );
    expect(mockedAgent.createGrepTool).toHaveBeenCalledWith(
      "repo/janus",
    );
  });

  it("blocks titan tool paths and shell escapes outside the working directory", async () => {
    const fixture = CONTRACT_FIXTURES.find((candidate) => candidate.caste === "titan");
    if (!fixture) {
      throw new Error("Missing titan fixture.");
    }

    configureToolSuccess(fixture);
    const runtime = createSingleCasteRuntime("titan");

    await runtime.run({
      caste: "titan",
      issueId: "aegis-tool-guard",
      root: "repo",
      workingDirectory: "repo/titan",
      prompt: "Titan tool guard",
    });

    const createSessionCall = mockedAgent.createAgentSession.mock.calls.at(-1) as [
      { tools?: Array<{ name: string; execute: (...args: any[]) => Promise<unknown> }> },
    ] | undefined;
    const tools = createSessionCall?.[0].tools ?? [];
    const writeTool = tools.find((tool) => tool.name === "write");
    const bashTool = tools.find((tool) => tool.name === "bash");

    await expect(writeTool?.execute("call-1", {
      path: "../escape.txt",
      content: "escape\n",
    }, undefined, undefined)).rejects.toThrow("write path escapes working directory");
    await expect(bashTool?.execute("call-2", {
      command: "cd ../../.. && pwd",
    }, undefined, undefined)).rejects.toThrow("bash path escapes working directory");
    await expect(bashTool?.execute("call-3", {
      command: "git checkout main",
    }, undefined, undefined)).rejects.toThrow("Titan bash command cannot change git branch state");

    const originalWriteTool = mockedAgent.createWriteTool.mock.results.at(-1)?.value as
      | { execute: ReturnType<typeof vi.fn> }
      | undefined;
    const originalBashTool = mockedAgent.createBashTool.mock.results.at(-1)?.value as
      | { execute: ReturnType<typeof vi.fn> }
      | undefined;

    expect(originalWriteTool?.execute).not.toHaveBeenCalled();
    expect(originalBashTool?.execute).not.toHaveBeenCalled();
  });

  it("blocks Titan package installs outside declared package file scope", async () => {
    const fixture = CONTRACT_FIXTURES.find((candidate) => candidate.caste === "titan");
    if (!fixture) {
      throw new Error("Missing titan fixture.");
    }

    configureToolSuccess(fixture);
    const runtime = createSingleCasteRuntime("titan");

    await runtime.run({
      caste: "titan",
      issueId: "aegis-package-guard",
      root: "repo",
      workingDirectory: "repo/titan",
      prompt: "Allowed file scope: docs/setup-contract.md",
    });

    const createSessionCall = mockedAgent.createAgentSession.mock.calls.at(-1) as [
      { tools?: Array<{ name: string; execute: (...args: any[]) => Promise<unknown> }> },
    ] | undefined;
    const bashTool = createSessionCall?.[0].tools?.find((tool) => tool.name === "bash");

    await expect(bashTool?.execute("call-1", {
      command: "npm install react",
    }, undefined, undefined)).rejects.toThrow("Titan package install requires package files in allowed scope");

    const originalBashTool = mockedAgent.createBashTool.mock.results.at(-1)?.value as
      | { execute: ReturnType<typeof vi.fn> }
      | undefined;
    expect(originalBashTool?.execute).not.toHaveBeenCalled();
  });

  it("blocks Titan file mutations outside declared file scope", async () => {
    const fixture = CONTRACT_FIXTURES.find((candidate) => candidate.caste === "titan");
    if (!fixture) {
      throw new Error("Missing titan fixture.");
    }

    configureToolSuccess(fixture);
    const runtime = createSingleCasteRuntime("titan");

    await runtime.run({
      caste: "titan",
      issueId: "aegis-file-scope",
      root: "repo",
      workingDirectory: "repo/titan",
      prompt: "Allowed file scope: docs/setup-contract.md",
    });

    const createSessionCall = mockedAgent.createAgentSession.mock.calls.at(-1) as [
      { tools?: Array<{ name: string; execute: (...args: any[]) => Promise<unknown> }> },
    ] | undefined;
    const writeTool = createSessionCall?.[0].tools?.find((tool) => tool.name === "write");

    await expect(writeTool?.execute("call-1", {
      path: "package.json",
      content: "{}\n",
    }, undefined, undefined)).rejects.toThrow("write path is outside allowed file scope");

    await expect(writeTool?.execute("call-2", {
      path: "docs/setup-contract.md",
      content: "contract\n",
    }, undefined, undefined)).resolves.toEqual({ content: [], isError: false });

    const originalWriteTool = mockedAgent.createWriteTool.mock.results.at(-1)?.value as
      | { execute: ReturnType<typeof vi.fn> }
      | undefined;
    expect(originalWriteTool?.execute).toHaveBeenLastCalledWith("call-2", {
      path: path.resolve("repo/titan", "docs/setup-contract.md"),
      content: "contract\n",
    }, undefined, undefined);
  });

  it("blocks Titan package scaffolds outside declared package file scope", async () => {
    const fixture = CONTRACT_FIXTURES.find((candidate) => candidate.caste === "titan");
    if (!fixture) {
      throw new Error("Missing titan fixture.");
    }

    configureToolSuccess(fixture);
    const runtime = createSingleCasteRuntime("titan");

    await runtime.run({
      caste: "titan",
      issueId: "aegis-bash-scope",
      root: "repo",
      workingDirectory: "repo/titan",
      prompt: "Allowed file scope: docs/setup-contract.md",
    });

    const createSessionCall = mockedAgent.createAgentSession.mock.calls.at(-1) as [
      { tools?: Array<{ name: string; execute: (...args: any[]) => Promise<unknown> }> },
    ] | undefined;
    const bashTool = createSessionCall?.[0].tools?.find((tool) => tool.name === "bash");

    await expect(bashTool?.execute("call-1", {
      command: "npm create vite@latest .",
    }, undefined, undefined)).rejects.toThrow("Titan package install requires package files in allowed scope");
  });

  it("rejects Titan bash commands that dirty files outside declared file scope", async () => {
    const fixture = CONTRACT_FIXTURES.find((candidate) => candidate.caste === "titan");
    if (!fixture) {
      throw new Error("Missing titan fixture.");
    }

    const workingDirectory = mkdtempSync(path.join(tmpdir(), "aegis-pi-scope-"));
    try {
      execFileSync("git", ["init"], { cwd: workingDirectory, stdio: "ignore" });
      mkdirSync(path.join(workingDirectory, "docs"));
      mockedAgent.createBashTool.mockReturnValueOnce({
        name: "bash",
        parameters: {},
        execute: vi.fn(async () => {
          writeFileSync(path.join(workingDirectory, "package.json"), "{}\n");
          return { content: [], isError: false };
        }),
      });
      configureToolSuccess(fixture);
      const runtime = createSingleCasteRuntime("titan");

      await runtime.run({
        caste: "titan",
        issueId: "aegis-bash-drift",
        root: workingDirectory,
        workingDirectory,
        prompt: "Allowed file scope: docs/setup-contract.md",
      });

      const createSessionCall = mockedAgent.createAgentSession.mock.calls.at(-1) as [
        { tools?: Array<{ name: string; execute: (...args: any[]) => Promise<unknown> }> },
      ] | undefined;
      const bashTool = createSessionCall?.[0].tools?.find((tool) => tool.name === "bash");

      await expect(bashTool?.execute("call-1", {
        command: "node scripts/scaffold.js",
      }, undefined, undefined)).rejects.toThrow(
        "Titan bash command changed files outside allowed scope: package.json",
      );
    } finally {
      rmSync(workingDirectory, { recursive: true, force: true });
    }
  });

  it("isolates Pi sessions from discovered extensions", async () => {
    const fixture = CONTRACT_FIXTURES.find((candidate) => candidate.caste === "titan");
    if (!fixture) {
      throw new Error("Missing titan fixture.");
    }

    configureToolSuccess(fixture);
    const runtime = createSingleCasteRuntime("titan");

    await runtime.run({
      caste: "titan",
      issueId: "aegis-isolated-loader",
      root: "repo",
      workingDirectory: "repo/titan",
      prompt: "Titan isolated loader",
    });

    expect(mockedAgent.DefaultResourceLoader).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: "repo/titan",
        noExtensions: true,
      }),
    );

    const resourceLoader = mockedAgent.DefaultResourceLoader.mock.results.at(-1)?.value as {
      reload: ReturnType<typeof vi.fn>;
    } | undefined;
    expect(resourceLoader?.reload).toHaveBeenCalledTimes(1);

    const createSessionCall = mockedAgent.createAgentSession.mock.calls.at(-1) as [
      { resourceLoader?: unknown },
    ] | undefined;
    expect(createSessionCall?.[0].resourceLoader).toBe(resourceLoader);
  });

  it("does not detach hidden shell commands on Windows", () => {
    const options = buildHiddenShellSpawnOptions("repo", process.env);

    expect(options.windowsHide).toBe(true);
    expect(options.detached).toBe(process.platform !== "win32");
    expect(options.stdio).toEqual(["ignore", "pipe", "pipe"]);
  });
});
