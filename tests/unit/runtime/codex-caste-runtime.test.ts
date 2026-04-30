import path from "node:path";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildCodexExecArgs,
  buildCodexRunEnvironment,
  buildCodexSpawnInvocation,
  buildTerminateCodexSessionProcessesScript,
  buildTerminateWorkspaceProcessesScript,
  CodexCasteRuntime,
  commandLineReferencesWorkspace,
  createCodexModelConfigs,
  isForbiddenLongRunningWorkspaceCommand,
} from "../../../src/runtime/codex-caste-runtime.js";

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
