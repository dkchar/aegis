import path from "node:path";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildCodexExecArgs,
  buildCodexSpawnInvocation,
  buildTerminateCodexSessionProcessesScript,
  CodexCasteRuntime,
  CodexEventParser,
  createCodexModelConfigs,
} from "../../../src/runtime/codex-caste-runtime.js";
import {
  buildAgentShellEnvironment as buildCodexRunEnvironment,
  buildTerminateWorkspaceProcessesScript,
  commandLineReferencesWorkspace,
  isAllowedPlaywrightManagedWorkspaceServer,
  isForbiddenLongRunningCommand as isForbiddenLongRunningWorkspaceCommand,
} from "../../../src/runtime/workspace-processes.js";

const tempRoots: string[] = [];

function createTempRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "aegis-codex-runtime-"));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("CodexEventParser", () => {
  const events = [
    { type: "thread.started", thread_id: "thread-1" },
    { type: "turn.started" },
    { type: "item.started", item: { id: "i1", type: "command_execution", command: "npm test", status: "in_progress" } },
    { type: "item.completed", item: { id: "i1", type: "command_execution", command: "npm test", exit_code: 1 } },
    { type: "item.completed", item: { id: "i2", type: "file_change", changes: [{ path: "src/App.tsx", kind: "update" }] } },
    { type: "item.completed", item: { id: "i3", type: "reasoning", text: "thinking" } },
    { type: "item.completed", item: { id: "i4", type: "agent_message", text: "Fixed the failing test." } },
    { type: "turn.completed", usage: { input_tokens: 900, cached_input_tokens: 300, output_tokens: 120 } },
    { type: "some.future.event" },
  ].map((event) => JSON.stringify(event));

  it("turns --json events into activity lines, tools, and usage", () => {
    const live: string[] = [];
    const parser = new CodexEventParser((line) => live.push(line));
    parser.pushText(["not json", ...events].join("\n"));

    expect(parser.terminalLog).toEqual([
      "[session] thread thread-1",
      "[tool] shell npm test",
      "[tool_error] exit 1 npm test",
      "[edit] src/App.tsx",
      "[assistant] Fixed the failing test.",
    ]);
    expect(live).toEqual(parser.terminalLog);
    expect([...parser.toolsUsed]).toEqual(["codex exec", "shell", "file_change"]);
    expect(parser.usage).toEqual({ inputTokens: 900, cacheReadInputTokens: 300, outputTokens: 120, turns: 1 });
  });

  it("streams activity through the runtime and records it in the session result", async () => {
    const root = createTempRoot();
    const activity: string[] = [];
    const runner = vi.fn(async (request) => {
      for (const line of events) {
        request.onStdoutLine?.(line);
      }
      writeFileSync(request.outputPath, "{}", "utf8");
      return { exitCode: 0, stdout: events.join("\n"), stderr: "" };
    });

    const result = await new CodexCasteRuntime({}, { runner }).run({
      caste: "titan",
      issueId: "aegis-2",
      root,
      workingDirectory: root,
      prompt: "Implement.",
      onActivity: (line) => activity.push(line),
    });

    expect(activity).toContain("[tool] shell npm test");
    expect(result.terminalLog).toEqual(activity);
    expect(result.usage).toMatchObject({ outputTokens: 120 });
  });
});

describe("CodexCasteRuntime", () => {
  it("runs codex exec in the requested working directory and reads final output", async () => {
    const root = createTempRoot();
    const workingDirectory = path.join(root, "labor");
    const runner = vi.fn(async (request) => {
      writeFileSync(request.outputPath, "{\"outcome\":\"success\"}\n", "utf8");
      return {
        exitCode: 0,
        stdout: "{\"type\":\"done\"}\n",
        stderr: "",
      };
    });
    const runtime = new CodexCasteRuntime({
      titan: {
        reference: "openai-codex:gpt-5.4-mini",
        provider: "openai-codex",
        modelId: "gpt-5.4-mini",
        thinkingLevel: "medium",
      },
    }, { runner });

    const result = await runtime.run({
      caste: "titan",
      issueId: "aegis-1",
      root,
      workingDirectory,
      prompt: "Return Titan JSON.",
    });

    expect(runner).toHaveBeenCalledWith(expect.objectContaining({
      cwd: workingDirectory,
      modelId: "gpt-5.4-mini",
      thinkingLevel: "medium",
      prompt: "Return Titan JSON.",
    }));
    expect(result).toMatchObject({
      caste: "titan",
      provider: "openai-codex",
      modelId: "gpt-5.4-mini",
      status: "succeeded",
      outputText: "{\"outcome\":\"success\"}",
      toolsUsed: ["codex exec"],
    });
    expect(existsSync(runner.mock.calls[0]![0].outputPath)).toBe(false);
  });

  it("marks failed codex exec sessions failed", async () => {
    const root = createTempRoot();
    const runner = vi.fn(async (request) => {
      writeFileSync(request.outputPath, "", "utf8");
      return {
        exitCode: 1,
        stdout: "",
        stderr: "auth failed",
      };
    });
    const runtime = new CodexCasteRuntime({}, { runner });

    const result = await runtime.run({
      caste: "oracle",
      issueId: "aegis-1",
      root,
      workingDirectory: root,
      prompt: "Scout.",
    });

    expect(result.status).toBe("failed");
    expect(result.error).toBe("auth failed");
  });

  it("parses configured model refs for each caste", () => {
    const configs = createCodexModelConfigs({
      oracle: "openai-codex:gpt-5.4-mini",
      titan: "gpt-5.4",
      sentinel: "openai-codex:gpt-5.4-mini",
      janus: "openai-codex:gpt-5.4-mini",
    }, {
      oracle: "high",
      titan: "medium",
      sentinel: "medium",
      janus: "medium",
    });

    expect(configs.oracle).toMatchObject({
      provider: "openai-codex",
      modelId: "gpt-5.4-mini",
      thinkingLevel: "high",
    });
    expect(configs.titan).toMatchObject({
      provider: "openai-codex",
      modelId: "gpt-5.4",
    });
  });

  it("passes configured thinking level to codex exec", () => {
    const args = buildCodexExecArgs({
      cwd: "C:\\repo\\labor",
      modelId: "gpt-5.4-mini",
      thinkingLevel: "medium",
      prompt: "Run.",
      outputPath: "C:\\tmp\\out.txt",
      timeoutMs: 1000,
    }, "linux");

    expect(args).toEqual([
      "-a",
      "never",
      "exec",
      "-C",
      "C:\\repo\\labor",
      "-s",
      "workspace-write",
      "-m",
      "gpt-5.4-mini",
      "-c",
      "model_reasoning_effort=\"medium\"",
      "--ignore-user-config",
      "--ignore-rules",
      "--json",
      "--output-last-message",
      "C:\\tmp\\out.txt",
      "-",
    ]);
  });

  it("uses full-access Codex sandbox on Windows because workspace-write shell execution is broken", () => {
    const args = buildCodexExecArgs({
      cwd: "C:\\repo\\labor",
      modelId: "gpt-5.4-mini",
      thinkingLevel: "medium",
      prompt: "Run.",
      outputPath: "C:\\tmp\\out.txt",
      timeoutMs: 1000,
    }, "win32");

    expect(args).toContain("danger-full-access");
    expect(args).not.toContain("workspace-write");
  });

  it("wraps codex command with PowerShell on Windows", () => {
    expect(buildCodexSpawnInvocation(["--version"], "win32")).toEqual({
      command: "powershell.exe",
      args: [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "& 'codex.cmd' '--version'; exit $LASTEXITCODE",
      ],
    });
  });

  it("matches leaked processes by labor workspace path", () => {
    expect(commandLineReferencesWorkspace(
      "node C:\\repo\\.aegis\\labors\\ISSUE-1\\node_modules\\vite\\bin\\vite.js",
      "C:\\repo\\.aegis\\labors\\ISSUE-1",
      "win32",
    )).toBe(true);

    expect(commandLineReferencesWorkspace(
      "node C:\\repo\\.aegis\\labors\\ISSUE-2\\node_modules\\vite\\bin\\vite.js",
      "C:\\repo\\.aegis\\labors\\ISSUE-1",
      "win32",
    )).toBe(false);
  });

  it("detects forbidden long-running workspace commands", () => {
    expect(isForbiddenLongRunningWorkspaceCommand(
      '"node" "C:/repo/.aegis/labors/ISSUE/node_modules/vite/bin/vite.js" --host 127.0.0.1',
    )).toBe(true);
    expect(isForbiddenLongRunningWorkspaceCommand(
      '"node" "C:/repo/.aegis/labors/ISSUE/node_modules/vite/bin/vite.js" build',
    )).toBe(false);
    expect(isForbiddenLongRunningWorkspaceCommand("npm.cmd run dev -- --host 127.0.0.1")).toBe(true);
    expect(isForbiddenLongRunningWorkspaceCommand("npm.cmd run build")).toBe(false);
  });

  it("allows Playwright-managed webServer children while still detecting direct dev servers", () => {
    const parentByPid = new Map([
      [42, 41],
      [41, 40],
    ]);
    const commandByPid = new Map([
      [40, "node C:/repo/node_modules/@playwright/test/cli.js test --config playwright.config.ts"],
      [41, "npm.cmd run dev -- --host 127.0.0.1 --port 4173"],
      [42, "node C:/repo/node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4173"],
    ]);

    expect(isAllowedPlaywrightManagedWorkspaceServer(42, parentByPid, commandByPid)).toBe(true);
    expect(isAllowedPlaywrightManagedWorkspaceServer(41, parentByPid, commandByPid)).toBe(true);
    expect(isAllowedPlaywrightManagedWorkspaceServer(99, parentByPid, commandByPid)).toBe(false);
  });

  it("builds a Windows cleanup script that only kills forbidden workspace processes", () => {
    const script = buildTerminateWorkspaceProcessesScript("C:\\repo\\.aegis\\labors\\ISSUE-1");

    expect(script).toContain("$current = $PID");
    expect(script).toContain("Stop-Process");
    expect(script).toContain("ISSUE-1");
    expect(script).toContain("ProcessId -eq $current");
    expect(script).toContain("forbiddenPatterns");
    expect(script).toContain("webpack");
  });

  it("builds a Windows session termination script for Codex exec processes", () => {
    const script = buildTerminateCodexSessionProcessesScript("C:\\repo\\.aegis\\labors\\ISSUE-1");

    expect(script).toContain("taskkill");
    expect(script).toContain("ISSUE-1");
    expect(script).toContain("codex");
    expect(script).not.toContain("forbiddenPatterns");
  });

  it("prepends Windows command shims for npm and npx cmd launchers", () => {
    const root = createTempRoot();
    const shimDirectory = path.join(root, "shims");
    const env = buildCodexRunEnvironment(
      { Path: "C:\\Windows\\System32" },
      "win32",
      (commandName) => commandName === "npm.cmd" ? "C:\\Program Files\\nodejs\\npm.cmd" : null,
      shimDirectory,
    );

    expect(env.Path?.startsWith(`${shimDirectory}${path.delimiter}`)).toBe(true);
    expect(existsSync(path.join(shimDirectory, "npm.cmd"))).toBe(true);
  });

  it("adds a ripgrep shim that treats no-match as non-fatal for Codex shell sessions", () => {
    const root = createTempRoot();
    const shimDirectory = path.join(root, "shims");
    const env = buildCodexRunEnvironment(
      { Path: "C:\\Windows\\System32" },
      "win32",
      (commandName) => commandName === "rg.exe" ? "C:\\tools\\rg.exe" : null,
      shimDirectory,
    );

    const shimPath = path.join(shimDirectory, "rg.cmd");
    expect(env.Path?.startsWith(`${shimDirectory}${path.delimiter}`)).toBe(true);
    expect(existsSync(shimPath)).toBe(true);
    expect(readFileSync(shimPath, "utf8")).toContain("if %ERRORLEVEL% EQU 1 exit /B 0");
  });
});
