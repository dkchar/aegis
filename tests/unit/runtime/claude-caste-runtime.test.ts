import path from "node:path";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildClaudeArgs,
  buildClaudeSpawnInvocation,
  ClaudeCasteRuntime,
  CLAUDE_CASTE_TOOL_POLICIES,
  createClaudeModelConfigs,
  parseClaudeStreamOutput,
  resolveClaudeRuntimeOptionsFromEnv,
  type ClaudeRunRequest,
} from "../../../src/runtime/claude-caste-runtime.js";
import { runCasteCommand } from "../../../src/core/caste-runner.js";
import { loadDispatchState } from "../../../src/core/dispatch-state.js";
import type { AegisIssue } from "../../../src/tracker/issue-model.js";

const tempRoots: string[] = [];

function createTempRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "aegis-claude-runtime-"));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function streamLines(events: object[]) {
  return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
}

function successStream(result: string) {
  return streamLines([
    { type: "system", subtype: "init", session_id: "claude-session-1", model: "claude-opus-5-5", tools: ["Read"] },
    {
      type: "assistant",
      session_id: "claude-session-1",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Inspecting the workspace." },
          { type: "tool_use", id: "tool-1", name: "Read", input: { file_path: "src/App.tsx" } },
        ],
      },
    },
    {
      type: "user",
      session_id: "claude-session-1",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "tool-1", is_error: true, content: "File does not exist." }],
      },
    },
    {
      type: "assistant",
      session_id: "claude-session-1",
      message: { role: "assistant", content: [{ type: "tool_use", id: "tool-2", name: "Grep", input: { pattern: "todo" } }] },
    },
    {
      type: "result",
      subtype: "success",
      is_error: false,
      result,
      session_id: "claude-session-1",
      num_turns: 3,
      duration_ms: 1200,
      total_cost_usd: 0.042,
      usage: {
        input_tokens: 1000,
        output_tokens: 200,
        cache_read_input_tokens: 500,
        cache_creation_input_tokens: 50,
      },
    },
  ]);
}

function baseRequest(overrides: Partial<ClaudeRunRequest> = {}): ClaudeRunRequest {
  return {
    cwd: "/repo/.aegis/labors/AG-1",
    caste: "titan",
    command: "claude",
    modelId: "claude-opus-5-5",
    thinkingLevel: "medium",
    prompt: "Implement.",
    timeoutMs: 1_000,
    maxTurns: null,
    extraArgs: [],
    ...overrides,
  };
}

describe("buildClaudeArgs", () => {
  it("runs headless with streamed JSON, the configured model, and a caste tool policy", () => {
    const args = buildClaudeArgs(baseRequest());

    expect(args.slice(0, 4)).toEqual(["-p", "--output-format", "stream-json", "--verbose"]);
    expect(args).toEqual(expect.arrayContaining(["--model", "claude-opus-5-5", "--strict-mcp-config"]));
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("default");
    expect(args[args.indexOf("--allowedTools") + 1]).toBe(CLAUDE_CASTE_TOOL_POLICIES.titan.allowedTools.join(","));
    expect(args).not.toContain("--max-turns");
  });

  it("keeps Oracle read-only and limits Janus shell access to read-only git", () => {
    const oracle = buildClaudeArgs(baseRequest({ caste: "oracle" }));
    const oracleAllowed = oracle[oracle.indexOf("--allowedTools") + 1]!.split(",");
    const oracleDenied = oracle[oracle.indexOf("--disallowedTools") + 1]!.split(",");
    expect(oracleAllowed).not.toContain("Bash");
    expect(oracleDenied).toEqual(expect.arrayContaining(["Bash", "Edit", "Write"]));

    const janusAllowed = CLAUDE_CASTE_TOOL_POLICIES.janus.allowedTools;
    expect(janusAllowed).not.toContain("Bash");
    expect(janusAllowed.filter((tool) => tool.startsWith("Bash(")).every((tool) => tool.startsWith("Bash(git "))).toBe(true);
    expect(CLAUDE_CASTE_TOOL_POLICIES.sentinel.disallowedTools).toEqual(expect.arrayContaining(["Edit", "Write"]));
  });

  it("appends max turns and extra args when configured", () => {
    const args = buildClaudeArgs(baseRequest({ maxTurns: 40, extraArgs: ["--effort", "high"] }));

    expect(args.slice(-4)).toEqual(["--max-turns", "40", "--effort", "high"]);
  });

  it("wraps the claude launcher with PowerShell on Windows", () => {
    expect(buildClaudeSpawnInvocation("claude", ["-p"], "win32")).toEqual({
      command: "powershell.exe",
      args: [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "& 'claude.cmd' '-p'; exit $LASTEXITCODE",
      ],
    });
    expect(buildClaudeSpawnInvocation("C:\\tools\\claude.exe", ["-p"], "win32").args.at(-1))
      .toBe("& 'C:\\tools\\claude.exe' '-p'; exit $LASTEXITCODE");
    expect(buildClaudeSpawnInvocation("claude", ["-p"], "linux")).toEqual({ command: "claude", args: ["-p"] });
  });
});

describe("parseClaudeStreamOutput", () => {
  it("collects assistant text, tools, errors, usage, and the final result", () => {
    const summary = parseClaudeStreamOutput(`not json\n${successStream("{\"ok\":true}")}`, "prompt");

    expect(summary.sessionId).toBe("claude-session-1");
    expect(summary.resolvedModel).toBe("claude-opus-5-5");
    expect(summary.toolsUsed).toEqual(["Read", "Grep"]);
    expect(summary.resultSubtype).toBe("success");
    expect(summary.resultText).toBe("{\"ok\":true}");
    expect(summary.messageLog).toEqual([
      { role: "user", content: "prompt" },
      { role: "assistant", content: "Inspecting the workspace." },
    ]);
    expect(summary.terminalLog).toEqual(expect.arrayContaining([
      "[session] init model=claude-opus-5-5",
      "[tool] Read src/App.tsx",
      "[tool_error] File does not exist.",
      "[result] success",
    ]));
    expect(summary.usage).toEqual({
      inputTokens: 1000,
      outputTokens: 200,
      cacheReadInputTokens: 500,
      cacheCreationInputTokens: 50,
      costUsd: 0.042,
      turns: 3,
      durationMs: 1200,
    });
  });
});

describe("ClaudeCasteRuntime", () => {
  it("returns the final result text with session metadata", async () => {
    const runner = vi.fn(async () => ({ exitCode: 0, stdout: successStream("{\"outcome\":\"success\"}"), stderr: "" }));
    const runtime = new ClaudeCasteRuntime({}, { runner, maxTurns: 25 });

    const result = await runtime.run({
      caste: "titan",
      issueId: "AG-1",
      root: "/repo",
      workingDirectory: "/repo/.aegis/labors/AG-1",
      prompt: "Implement.",
    });

    expect(runner).toHaveBeenCalledWith(expect.objectContaining({
      cwd: "/repo/.aegis/labors/AG-1",
      caste: "titan",
      command: "claude",
      modelId: "claude-opus-5-5",
      maxTurns: 25,
    }));
    expect(result).toMatchObject({
      sessionId: "claude-session-1",
      provider: "anthropic",
      modelRef: "anthropic:claude-opus-5-5",
      status: "succeeded",
      outputText: "{\"outcome\":\"success\"}",
      toolsUsed: ["Read", "Grep"],
      usage: { costUsd: 0.042 },
    });
    expect(result.error).toBeUndefined();
    expect(result.terminalLog?.length).toBeGreaterThan(0);
  });

  it("fails sessions whose result is an error so provider limits are classified", async () => {
    const runner = vi.fn(async () => ({
      exitCode: 1,
      stdout: streamLines([
        { type: "result", subtype: "success", is_error: true, result: "Claude AI usage limit reached|1760000000", session_id: "s-2" },
      ]),
      stderr: "",
    }));
    const runtime = new ClaudeCasteRuntime({}, { runner });

    const result = await runtime.run({
      caste: "oracle",
      issueId: "AG-2",
      root: "/repo",
      workingDirectory: "/repo",
      prompt: "Scout.",
    });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("usage limit");
  });

  it("fails sessions that exit without a result event", async () => {
    const runner = vi.fn(async () => ({ exitCode: 1, stdout: "", stderr: "command not found: claude" }));
    const runtime = new ClaudeCasteRuntime({}, { runner });

    const result = await runtime.run({
      caste: "sentinel",
      issueId: "AG-3",
      root: "/repo",
      workingDirectory: "/repo",
      prompt: "Review.",
    });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("command not found: claude");
  });

  it("reports max-turn exhaustion as a failure", async () => {
    const runner = vi.fn(async () => ({
      exitCode: 0,
      stdout: streamLines([{ type: "result", subtype: "error_max_turns", is_error: true, session_id: "s-4" }]),
      stderr: "",
    }));
    const result = await new ClaudeCasteRuntime({}, { runner }).run({
      caste: "titan",
      issueId: "AG-4",
      root: "/repo",
      workingDirectory: "/repo",
      prompt: "Implement.",
    });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("error_max_turns");
  });

  it("rejects non-Anthropic model refs before spawning", async () => {
    const runner = vi.fn();
    const runtime = new ClaudeCasteRuntime(createClaudeModelConfigs({
      oracle: "openai-codex:gpt-5.4-mini",
      titan: "anthropic:claude-opus-5-5",
      sentinel: "anthropic:claude-opus-5-5",
      janus: "anthropic:claude-opus-5-5",
    }, {
      oracle: "medium",
      titan: "medium",
      sentinel: "medium",
      janus: "medium",
    }), { runner });

    await expect(runtime.run({
      caste: "oracle",
      issueId: "AG-5",
      root: "/repo",
      workingDirectory: "/repo",
      prompt: "Scout.",
    })).rejects.toThrow(/anthropic:<model-id>/);
    expect(runner).not.toHaveBeenCalled();
  });
});

describe("createClaudeModelConfigs", () => {
  it("accepts anthropic refs, bare model ids, and claude provider aliases", () => {
    const configs = createClaudeModelConfigs({
      oracle: "anthropic:claude-opus-5-5",
      titan: "claude-sonnet-5-5",
      sentinel: "claude:claude-haiku-4-5",
      janus: "claude-code:claude-opus-5-5",
    }, {
      oracle: "low",
      titan: "high",
      sentinel: "medium",
      janus: "off",
    });

    expect(configs.oracle).toMatchObject({ provider: "anthropic", modelId: "claude-opus-5-5", thinkingLevel: "low" });
    expect(configs.titan).toMatchObject({ provider: "anthropic", modelId: "claude-sonnet-5-5" });
    expect(configs.sentinel).toMatchObject({ provider: "anthropic", modelId: "claude-haiku-4-5" });
    expect(configs.janus).toMatchObject({ provider: "anthropic", modelId: "claude-opus-5-5" });
  });
});

describe("resolveClaudeRuntimeOptionsFromEnv", () => {
  it("reads binary, timeout, max turns, and extra args", () => {
    expect(resolveClaudeRuntimeOptionsFromEnv({
      AEGIS_CLAUDE_BIN: "/opt/claude/bin/claude",
      AEGIS_CLAUDE_SESSION_TIMEOUT_MS: "90000",
      AEGIS_CLAUDE_MAX_TURNS: "30",
      AEGIS_CLAUDE_EXTRA_ARGS: "[\"--effort\",\"high\"]",
    })).toEqual({
      command: "/opt/claude/bin/claude",
      sessionTimeoutMs: 90_000,
      maxTurns: 30,
      extraArgs: ["--effort", "high"],
    });
    expect(resolveClaudeRuntimeOptionsFromEnv({ AEGIS_CLAUDE_EXTRA_ARGS: "--effort high" }))
      .toEqual({ extraArgs: ["--effort", "high"] });
    expect(resolveClaudeRuntimeOptionsFromEnv({ AEGIS_CLAUDE_MAX_TURNS: "nope" })).toEqual({});
  });
});

describe("Claude runtime through the caste runner", () => {
  it("scouts with JSON-mode prompts and tolerates a fenced artifact", async () => {
    const root = createTempRoot();
    const issue: AegisIssue = {
      id: "AG-10",
      title: "Scaffold app",
      description: "Create the app shell.\n\nAegis file ownership: src/App.tsx",
      issueClass: "primary",
      status: "open",
      priority: 1,
      blockers: [],
      parentId: null,
      childIds: [],
      labels: [],
    };
    const fencedAssessment = [
      "```json",
      JSON.stringify({
        files_affected: ["src/App.tsx"],
        estimated_complexity: "trivial",
        risks: [],
        suggested_checks: ["npm run build"],
        scope_notes: [],
      }),
      "```",
    ].join("\n");
    const runner = vi.fn(async (_request: ClaudeRunRequest) => ({
      exitCode: 0,
      stdout: successStream(fencedAssessment),
      stderr: "",
    }));

    const result = await runCasteCommand({
      root,
      action: "scout",
      issueId: issue.id,
      tracker: { getIssue: vi.fn(async () => issue) },
      runtime: new ClaudeCasteRuntime({}, { runner }),
      artifactEmissionMode: "json",
    });

    expect(result.stage).toBe("scouted");
    const prompt = runner.mock.calls[0]![0].prompt;
    expect(prompt).toContain("Return the final artifact as the JSON object itself");
    expect(prompt).not.toContain("Call tool 'emit_oracle_assessment'");
    expect(loadDispatchState(root).records["AG-10"]).toMatchObject({
      stage: "scouted",
      fileScope: { files: ["src/App.tsx"] },
    });

    const transcript = JSON.parse(readFileSync(path.join(root, ".aegis", "transcripts", "AG-10--oracle.json"), "utf8"));
    expect(transcript).toMatchObject({
      provider: "anthropic",
      usage: { costUsd: 0.042 },
    });
    expect(transcript.terminalLog).toContain("[tool] Read src/App.tsx");
  });
});
