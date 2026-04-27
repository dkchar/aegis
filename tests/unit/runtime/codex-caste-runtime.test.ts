import path from "node:path";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildCodexExecArgs,
  buildCodexSpawnInvocation,
  CodexCasteRuntime,
  createCodexModelConfigs,
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
    });

    expect(args).toEqual([
      "-C",
      "C:\\repo\\labor",
      "-s",
      "workspace-write",
      "-a",
      "never",
      "-m",
      "gpt-5.4-mini",
      "-c",
      "model_reasoning_effort=\"medium\"",
      "exec",
      "--json",
      "--output-last-message",
      "C:\\tmp\\out.txt",
      "-",
    ]);
  });

  it("wraps codex command with cmd.exe on Windows", () => {
    expect(buildCodexSpawnInvocation(["--version"], "win32")).toEqual({
      command: "cmd.exe",
      args: ["/d", "/s", "/c", "codex.cmd", "--version"],
    });
  });
});
