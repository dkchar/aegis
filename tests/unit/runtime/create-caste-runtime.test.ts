import path from "node:path";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createCasteRuntime,
  resolvePiRuntimeOptionsFromEnv,
} from "../../../src/runtime/create-caste-runtime.js";

const tempRoots: string[] = [];

function createTempRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "aegis-create-caste-runtime-"));
  tempRoots.push(root);
  return root;
}

function writeConfig(root: string, overrides: Record<string, unknown> = {}) {
  const configPath = path.join(root, ".aegis", "config.json");
  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(
    configPath,
    `${JSON.stringify({
      runtime: "scripted",
      models: {
        oracle: "openai-codex:gpt-5.4-mini",
        titan: "anthropic:claude-sonnet-4-20250514",
        sentinel: "openai-codex:gpt-5.4-mini",
        janus: "openai-codex:gpt-5.4-mini",
      },
      thinking: {
        oracle: "medium",
        titan: "high",
        sentinel: "medium",
        janus: "medium",
      },
      ...overrides,
    }, null, 2)}\n`,
    "utf8",
  );
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("createCasteRuntime", () => {
  it("parses pi timeout overrides from env", () => {
    expect(resolvePiRuntimeOptionsFromEnv({
      AEGIS_PI_SESSION_TIMEOUT_MS: "1800000",
      AEGIS_PI_ORACLE_TIMEOUT_MS: "2400000",
      AEGIS_PI_TITAN_TIMEOUT_MS: "2100000",
      AEGIS_PI_SENTINEL_TIMEOUT_MS: "2100000",
      AEGIS_PI_JANUS_TIMEOUT_MS: "2100000",
      AEGIS_PI_TIMEOUT_RETRY_COUNT: "0",
      AEGIS_PI_TIMEOUT_RETRY_DELAY_MS: "0",
    })).toEqual({
      sessionTimeoutMs: 1_800_000,
      sessionTimeoutMsByCaste: {
        oracle: 2_400_000,
        titan: 2_100_000,
        sentinel: 2_100_000,
        janus: 2_100_000,
      },
      timeoutRetryCount: 0,
      timeoutRetryDelayMs: 0,
    });
  });

  it("ignores invalid pi timeout overrides from env", () => {
    expect(resolvePiRuntimeOptionsFromEnv({
      AEGIS_PI_SESSION_TIMEOUT_MS: "-1",
      AEGIS_PI_ORACLE_TIMEOUT_MS: "0",
      AEGIS_PI_TITAN_TIMEOUT_MS: "abc",
      AEGIS_PI_TIMEOUT_RETRY_COUNT: "-5",
      AEGIS_PI_TIMEOUT_RETRY_DELAY_MS: "nope",
    })).toEqual({});
  });

  it("uses the scripted runtime for deterministic proof adapters", () => {
    const createPiRuntime = vi.fn();
    const scriptedRuntime = { kind: "scripted", run: vi.fn() };
    const createScriptedRuntime = vi.fn(() => scriptedRuntime);

    const runtime = createCasteRuntime("scripted", {
      createPiRuntime,
      createScriptedRuntime,
    });

    expect(runtime).toBe(scriptedRuntime);
    expect(createScriptedRuntime).toHaveBeenCalledOnce();
    expect(createPiRuntime).not.toHaveBeenCalled();
  });

  it("uses the pi runtime when configured", () => {
    const piRuntime = { kind: "pi", run: vi.fn() };
    const createPiRuntime = vi.fn(() => piRuntime);
    const createScriptedRuntime = vi.fn();

    const runtime = createCasteRuntime("pi", {
      createPiRuntime,
      createScriptedRuntime,
    });

    expect(runtime).toBe(piRuntime);
    expect(createPiRuntime).toHaveBeenCalledOnce();
    expect(createScriptedRuntime).not.toHaveBeenCalled();
  });

  it("threads configured model and thinking metadata into the default scripted runtime", async () => {
    const root = createTempRoot();
    writeConfig(root);

    const runtime = createCasteRuntime("scripted", {}, { root, issueId: "aegis-123" });
    const result = await runtime.run({
      caste: "titan",
      issueId: "aegis-123",
      root,
      workingDirectory: path.join(root, ".aegis", "labors", "labor-aegis-123"),
      prompt: "Implement aegis-123",
    });

    expect(result).toMatchObject({
      caste: "titan",
      modelRef: "anthropic:claude-sonnet-4-20250514",
      provider: "anthropic",
      modelId: "claude-sonnet-4-20250514",
      thinkingLevel: "high",
      messageLog: [
        {
          role: "user",
          content: "Implement aegis-123",
        },
        {
          role: "assistant",
          content: expect.stringContaining("\"outcome\":\"success\""),
        },
      ],
    });
  });
});
