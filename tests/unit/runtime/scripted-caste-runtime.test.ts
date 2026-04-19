import { describe, expect, it } from "vitest";

import {
  ScriptedCasteRuntime,
  createDefaultScriptedCasteRuntime,
} from "../../../src/runtime/scripted-caste-runtime.js";

describe("ScriptedCasteRuntime", () => {
  it("returns deterministic output and tool usage for the requested caste", async () => {
    const runtime = new ScriptedCasteRuntime(
      {
        oracle: {
          reference: "openai-codex:gpt-5.4-mini",
          provider: "openai-codex",
          modelId: "gpt-5.4-mini",
          thinkingLevel: "medium",
        },
      },
      {
        oracle: () => ({
          output: JSON.stringify({
            files_affected: ["src/index.ts"],
            estimated_complexity: "moderate",
            decompose: false,
            ready: true,
          }),
          toolsUsed: ["read_file"],
        }),
      },
    );

    const result = await runtime.run({
      caste: "oracle",
      issueId: "aegis-123",
      root: "repo",
      workingDirectory: "repo",
      prompt: "prompt",
    });

    expect(result.caste).toBe("oracle");
    expect(result.status).toBe("succeeded");
    expect(result.toolsUsed).toEqual(["read_file"]);
    expect(result.outputText).toContain("\"ready\":true");
    expect(result).toMatchObject({
      modelRef: "openai-codex:gpt-5.4-mini",
      provider: "openai-codex",
      modelId: "gpt-5.4-mini",
      thinkingLevel: "medium",
      messageLog: [
        {
          role: "user",
          content: "prompt",
        },
        {
          role: "assistant",
          content: expect.stringContaining("\"ready\":true"),
        },
      ],
    });
  });

  it("can force deterministic sentinel failure for selected issues through env override", async () => {
    const previous = process.env.AEGIS_SCRIPTED_SENTINEL_FAIL_ISSUES;
    process.env.AEGIS_SCRIPTED_SENTINEL_FAIL_ISSUES = "aegis-999";

    try {
      const runtime = createDefaultScriptedCasteRuntime({
        sentinel: {
          reference: "openai-codex:gpt-5.4-mini",
          provider: "openai-codex",
          modelId: "gpt-5.4-mini",
          thinkingLevel: "medium",
        },
      });

      const result = await runtime.run({
        caste: "sentinel",
        issueId: "aegis-999",
        root: "repo",
        workingDirectory: "repo",
        prompt: "review prompt",
      });

      expect(result.status).toBe("succeeded");
      expect(result.outputText).toContain("\"verdict\":\"fail\"");
      expect(result.outputText).toContain("review-observability");
    } finally {
      if (previous === undefined) {
        delete process.env.AEGIS_SCRIPTED_SENTINEL_FAIL_ISSUES;
      } else {
        process.env.AEGIS_SCRIPTED_SENTINEL_FAIL_ISSUES = previous;
      }
    }
  });

  it("can force deterministic Janus recommendation through env override", async () => {
    const previous = process.env.AEGIS_SCRIPTED_JANUS_NEXT_ACTION;
    process.env.AEGIS_SCRIPTED_JANUS_NEXT_ACTION = "manual_decision";

    try {
      const runtime = createDefaultScriptedCasteRuntime({
        janus: {
          reference: "openai-codex:gpt-5.4-mini",
          provider: "openai-codex",
          modelId: "gpt-5.4-mini",
          thinkingLevel: "medium",
        },
      });

      const result = await runtime.run({
        caste: "janus",
        issueId: "aegis-janus",
        root: "repo",
        workingDirectory: "repo",
        prompt: "janus prompt",
      });

      expect(result.status).toBe("succeeded");
      expect(result.outputText).toContain("\"recommendedNextAction\":\"manual_decision\"");
    } finally {
      if (previous === undefined) {
        delete process.env.AEGIS_SCRIPTED_JANUS_NEXT_ACTION;
      } else {
        process.env.AEGIS_SCRIPTED_JANUS_NEXT_ACTION = previous;
      }
    }
  });
});
