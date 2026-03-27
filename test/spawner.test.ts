// test/spawner.test.ts
// Unit tests for src/spawner.ts

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentHandle, BeadsIssue, MnemosyneRecord, AegisConfig } from "../src/types.js";

const mockROTools = [{ name: "read" }];
const mockCodingTools = [{ name: "read" }, { name: "bash" }, { name: "edit" }, { name: "write" }];

const mockHandle: AgentHandle = {
  prompt: vi.fn().mockResolvedValue(undefined),
  steer: vi.fn().mockResolvedValue(undefined),
  abort: vi.fn().mockResolvedValue(undefined),
  subscribe: vi.fn().mockReturnValue(() => {}),
  getStats: vi.fn().mockReturnValue({
    sessionId: "mock-session",
    cost: 0.123,
    tokens: { total: 42, input: 30, output: 12, cacheRead: 0, cacheWrite: 0 },
  }),
};

const mockRuntimeSpawn = vi.fn().mockResolvedValue(mockHandle);
const mockRuntimeGetTools = vi.fn((caste: string) => (caste === "titan" ? mockCodingTools : mockROTools));
const mockPiRuntimeCtor = vi.fn();
class MockPiRuntime {
  getTools = mockRuntimeGetTools;
  spawn = mockRuntimeSpawn;

  constructor(config: AegisConfig) {
    mockPiRuntimeCtor(config);
  }
}

vi.mock("../src/runtimes/pi-runtime.js", () => ({
  PiRuntime: MockPiRuntime,
}));

const { spawnOracle, spawnTitan, spawnSentinel, buildSystemPrompt } = await import("../src/spawner.js");

function makeIssue(o = {}): BeadsIssue {
  return { id: "aegis-001", title: "Test issue", description: "A test description", type: "task", priority: 1, status: "open", comments: [], ...o };
}

function makeLearning(o = {}): MnemosyneRecord {
  return { id: "l1", type: "convention", domain: "typescript", text: "Always use explicit return types", source: "agent", issue: null, ts: 1000, ...o };
}

const CFG: AegisConfig = {
  version: 2,
  runtime: "pi",
  auth: { anthropic: "sk-ant-test", openai: null, google: null },
  models: { oracle: "claude-haiku-4-5", titan: "claude-sonnet-4-5", sentinel: "claude-opus-4-5", metis: "claude-haiku-4-5", prometheus: "claude-opus-4-5" },
  concurrency: { max_agents: 10, max_oracles: 3, max_titans: 3, max_sentinels: 2 },
  budgets: { oracle_turns: 50, oracle_tokens: 50000, titan_turns: 200, titan_tokens: 200000, sentinel_turns: 100, sentinel_tokens: 100000 },
  timing: { poll_interval_seconds: 5, stuck_warning_seconds: 90, stuck_kill_seconds: 150 },
  mnemosyne: { max_records: 500, context_budget_tokens: 4000 },
  labors: { base_path: ".aegis/labors" },
  olympus: { port: 7777, open_browser: false },
};

describe("buildSystemPrompt()", () => {
  const issue = makeIssue({ id: "aegis-42", title: "My Issue", description: "Do the thing" });
  const learnings = [makeLearning({ text: "Use strict mode" })];
  const agentsMd = "AGENTS Follow conventions.";

  it("includes issue title in oracle prompt", () => { expect(buildSystemPrompt("oracle", issue, learnings, agentsMd)).toContain("My Issue"); });
  it("includes description in oracle prompt", () => { expect(buildSystemPrompt("oracle", issue, learnings, agentsMd)).toContain("Do the thing"); });
  it("includes issue title in titan prompt", () => { expect(buildSystemPrompt("titan", issue, learnings, agentsMd)).toContain("My Issue"); });
  it("includes description in titan prompt", () => { expect(buildSystemPrompt("titan", issue, learnings, agentsMd)).toContain("Do the thing"); });
  it("includes issue title in sentinel prompt", () => { expect(buildSystemPrompt("sentinel", issue, learnings, agentsMd)).toContain("My Issue"); });
  it("includes description in sentinel prompt", () => { expect(buildSystemPrompt("sentinel", issue, learnings, agentsMd)).toContain("Do the thing"); });
  it("includes priority in oracle prompt", () => { expect(buildSystemPrompt("oracle", issue, learnings, agentsMd)).toContain("PRIORITY:"); });

  it("includes SCOUTED comment in titan prompt", () => {
    const i = makeIssue({ comments: [{ id: "c1", body: "SCOUTED: straightforward", author: "a", created_at: "2026-01-01T00:00:00Z" }] });
    expect(buildSystemPrompt("titan", i, [], agentsMd)).toContain("SCOUTED: straightforward");
  });

  it("includes SCOUTED comment in sentinel prompt", () => {
    const i = makeIssue({ comments: [{ id: "c1", body: "SCOUTED: simple", author: "a", created_at: "2026-01-01T00:00:00Z" }] });
    expect(buildSystemPrompt("sentinel", i, [], agentsMd)).toContain("SCOUTED: simple");
  });

  it("includes learnings in all prompts", () => {
    ["oracle", "titan", "sentinel"].forEach((c) => {
      expect(buildSystemPrompt(c as "oracle" | "titan" | "sentinel", issue, learnings, agentsMd)).toContain("Use strict mode");
    });
  });

  it("includes AGENTS.md in all prompts", () => {
    ["oracle", "titan", "sentinel"].forEach((c) => {
      expect(buildSystemPrompt(c as "oracle" | "titan" | "sentinel", issue, learnings, agentsMd)).toContain("Follow conventions.");
    });
  });

  it("shows (none) when no learnings", () => { expect(buildSystemPrompt("oracle", issue, [], agentsMd)).toContain("(none)"); });
  it("oracle prompt says not to modify files", () => { expect(buildSystemPrompt("oracle", issue, [], agentsMd)).toContain("Do NOT modify any files"); });
  it("titan prompt references bd close", () => { expect(buildSystemPrompt("titan", issue, [], agentsMd)).toContain("bd close"); });
  it("sentinel prompt has REVIEWED: PASS and FAIL", () => {
    const p = buildSystemPrompt("sentinel", issue, [], agentsMd);
    expect(p).toContain("REVIEWED: PASS");
    expect(p).toContain("REVIEWED: FAIL");
  });
});

describe("spawn functions", () => {
  beforeEach(() => {
    mockPiRuntimeCtor.mockClear();
    mockRuntimeSpawn.mockClear();
    mockRuntimeGetTools.mockClear();
  });

  it("spawnOracle instantiates the configured runtime and uses read-only tools", async () => {
    await spawnOracle(makeIssue(), [], CFG, "AGENTS");

    expect(mockPiRuntimeCtor).toHaveBeenCalledWith(CFG);
    expect(mockRuntimeGetTools).toHaveBeenCalledWith("oracle");
    expect(mockRuntimeSpawn).toHaveBeenCalledWith(expect.objectContaining({
      caste: "oracle",
      cwd: process.cwd(),
      tools: mockROTools,
      model: "claude-haiku-4-5",
    }));
  });

  it("spawnTitan uses the labor path and coding tools", async () => {
    await spawnTitan(makeIssue(), [], "/the/labor", CFG, "AGENTS");

    expect(mockRuntimeGetTools).toHaveBeenCalledWith("titan");
    expect(mockRuntimeSpawn).toHaveBeenCalledWith(expect.objectContaining({
      caste: "titan",
      cwd: "/the/labor",
      tools: mockCodingTools,
      model: "claude-sonnet-4-5",
    }));
  });

  it("spawnSentinel uses read-only tools", async () => {
    await spawnSentinel(makeIssue(), [], CFG, "AGENTS");

    expect(mockRuntimeGetTools).toHaveBeenCalledWith("sentinel");
    expect(mockRuntimeSpawn).toHaveBeenCalledWith(expect.objectContaining({
      caste: "sentinel",
      cwd: process.cwd(),
      tools: mockROTools,
      model: "claude-opus-4-5",
    }));
  });

  it("passes the built system prompt to the runtime", async () => {
    const issue = makeIssue({ id: "aegis-42", title: "My Issue", description: "Do the thing" });
    const learnings = [makeLearning({ text: "Use strict mode" })];

    await spawnOracle(issue, learnings, CFG, "AGENTS Follow conventions.");

    expect(mockRuntimeSpawn).toHaveBeenCalledWith(expect.objectContaining({
      systemPrompt: expect.stringContaining("AGENTS Follow conventions."),
    }));
  });

  it("returns the AgentHandle produced by the runtime", async () => {
    const handle = await spawnOracle(makeIssue(), [], CFG, "AGENTS");
    expect(handle).toBe(mockHandle);
  });

  it("propagates runtime spawn failures", async () => {
    mockRuntimeSpawn.mockRejectedValueOnce(new Error("runtime failed"));

    await expect(spawnOracle(makeIssue(), [], CFG, "AGENTS")).rejects.toThrow("runtime failed");
  });
});
