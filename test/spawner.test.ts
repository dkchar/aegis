// test/spawner.test.ts
// Unit tests for src/spawner.ts

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { BeadsIssue, MnemosyneRecord, AegisConfig } from "../src/types.js";

const mockSession = { id: "mock-session", prompt: vi.fn() };
const mockCreate = vi.fn().mockResolvedValue({ session: mockSession });
const mockSMInMemory = vi.fn().mockReturnValue("in-memory-sm");
const mockSetRuntimeApiKey = vi.fn();
const mockAuthInstance = { setRuntimeApiKey: mockSetRuntimeApiKey };
// mockAuthCtor supports the static factory methods used by spawner:
//   AuthStorage.create(path)       — file-backed (new behaviour)
//   AuthStorage.fromStorage(...)   — legacy / other callers
//   AuthStorage.inMemory()         — convenience
const mockAuthCtor = vi.fn().mockImplementation(function() { return mockAuthInstance; });
(mockAuthCtor as unknown as Record<string, unknown>).create = vi.fn().mockReturnValue(mockAuthInstance);
(mockAuthCtor as unknown as Record<string, unknown>).fromStorage = vi.fn().mockReturnValue(mockAuthInstance);
(mockAuthCtor as unknown as Record<string, unknown>).inMemory = vi.fn().mockReturnValue(mockAuthInstance);
const mockModelRegistryInstance = { models: [] };
const mockModelRegistryCtor = vi.fn().mockImplementation(function () { return mockModelRegistryInstance; });
const mockROTools = [{ name: "read" }];
const mockCodingTools = [{ name: "read" }, { name: "bash" }, { name: "edit" }, { name: "write" }];
const mockGetModel = vi.fn().mockReturnValue({ provider: "anthropic", id: "claude-haiku-4-5" });

vi.mock("@mariozechner/pi-coding-agent", () => ({
  createAgentSession: mockCreate,
  SessionManager: { inMemory: mockSMInMemory },
  AuthStorage: mockAuthCtor,
  ModelRegistry: mockModelRegistryCtor,
  readOnlyTools: mockROTools,
  codingTools: mockCodingTools,
}));

vi.mock("@mariozechner/pi-ai", () => ({ getModel: mockGetModel }));

const { spawnOracle, spawnTitan, spawnSentinel, buildSystemPrompt, casteToolFilter } = await import("../src/spawner.js");

function makeIssue(o = {}): BeadsIssue {
  return { id: "aegis-001", title: "Test issue", description: "A test description", type: "task", priority: 1, status: "open", comments: [], ...o };
}

function makeLearning(o = {}): MnemosyneRecord {
  return { id: "l1", type: "convention", domain: "typescript", text: "Always use explicit return types", source: "agent", issue: null, ts: 1000, ...o };
}

const CFG: AegisConfig = {
  version: 1,
  auth: { anthropic: "sk-ant-test", openai: null, google: null },
  models: { oracle: "claude-haiku-4-5", titan: "claude-sonnet-4-5", sentinel: "claude-opus-4-5", metis: "claude-haiku-4-5", prometheus: "claude-opus-4-5" },
  concurrency: { max_agents: 10, max_oracles: 3, max_titans: 3, max_sentinels: 2 },
  budgets: { oracle_turns: 50, oracle_tokens: 50000, titan_turns: 200, titan_tokens: 200000, sentinel_turns: 100, sentinel_tokens: 100000 },
  timing: { poll_interval_seconds: 5, stuck_warning_seconds: 90, stuck_kill_seconds: 150 },
  mnemosyne: { max_records: 500, context_budget_tokens: 4000 },
  labors: { base_path: ".aegis/labors" },
  olympus: { port: 7777, open_browser: false },
};

describe("casteToolFilter()", () => {
  it("returns readOnlyTools for oracle", () => { expect(casteToolFilter("oracle")).toBe(mockROTools); });
  it("returns readOnlyTools for sentinel", () => { expect(casteToolFilter("sentinel")).toBe(mockROTools); });
  it("returns codingTools for titan", () => { expect(casteToolFilter("titan")).toBe(mockCodingTools); });
});

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
      expect(buildSystemPrompt(c as any, issue, learnings, agentsMd)).toContain("Use strict mode");
    });
  });

  it("includes AGENTS.md in all prompts", () => {
    ["oracle", "titan", "sentinel"].forEach((c) => {
      expect(buildSystemPrompt(c as any, issue, learnings, agentsMd)).toContain("Follow conventions.");
    });
  });

  it("shows (none) when no learnings", () => { expect(buildSystemPrompt("oracle", issue, [], agentsMd)).toContain("(none)"); });
  it("oracle prompt says not to modify files", () => { expect(buildSystemPrompt("oracle", issue, [], agentsMd)).toContain("Do NOT modify any files"); });
  it("titan prompt references bd close", () => { expect(buildSystemPrompt("titan", issue, [], agentsMd)).toContain("bd close"); });
  it("sentinel prompt has REVIEWED: PASS and FAIL", () => {
    const p = buildSystemPrompt("sentinel", issue, [], agentsMd);
    expect(p).toContain("REVIEWED: PASS"); expect(p).toContain("REVIEWED: FAIL");
  });
});

describe("spawn functions", () => {
  beforeEach(() => { mockCreate.mockClear(); mockGetModel.mockClear(); mockModelRegistryCtor.mockClear(); });

  it("spawnOracle uses read-only tools", async () => {
    await spawnOracle(makeIssue(), [], CFG, "AGENTS");
    expect(mockCreate.mock.calls[0][0].tools).toBe(mockROTools);
  });

  it("spawnOracle uses oracle model", async () => {
    await spawnOracle(makeIssue(), [], CFG, "AGENTS");
    expect(mockGetModel).toHaveBeenCalledWith("anthropic", "claude-haiku-4-5");
  });

  it("spawnTitan uses full coding tools", async () => {
    await spawnTitan(makeIssue(), [], "/labor", CFG, "AGENTS");
    expect(mockCreate.mock.calls[0][0].tools).toBe(mockCodingTools);
  });

  it("spawnTitan uses titan model", async () => {
    await spawnTitan(makeIssue(), [], "/labor", CFG, "AGENTS");
    expect(mockGetModel).toHaveBeenCalledWith("anthropic", "claude-sonnet-4-5");
  });

  it("spawnTitan sets labor path as cwd", async () => {
    await spawnTitan(makeIssue(), [], "/the/labor", CFG, "AGENTS");
    expect(mockCreate.mock.calls[0][0].cwd).toBe("/the/labor");
  });

  it("spawnSentinel uses read-only tools", async () => {
    await spawnSentinel(makeIssue(), [], CFG, "AGENTS");
    expect(mockCreate.mock.calls[0][0].tools).toBe(mockROTools);
  });

  it("spawnSentinel uses sentinel model", async () => {
    await spawnSentinel(makeIssue(), [], CFG, "AGENTS");
    expect(mockGetModel).toHaveBeenCalledWith("anthropic", "claude-opus-4-5");
  });

  it("uses in-memory session manager", async () => {
    await spawnOracle(makeIssue(), [], CFG, "AGENTS");
    expect(mockCreate.mock.calls[0][0].sessionManager).toBe("in-memory-sm");
  });

  it("returns the session object", async () => {
    const r = await spawnOracle(makeIssue(), [], CFG, "AGENTS");
    expect(r).toBe(mockSession);
  });

  it("handles provider:model format", async () => {
    const cfg = { ...CFG, models: { ...CFG.models, oracle: "openai:gpt-4o" } };
    await spawnOracle(makeIssue(), [], cfg, "AGENTS");
    expect(mockGetModel).toHaveBeenCalledWith("openai", "gpt-4o");
  });

  // aegis-cqp: ModelRegistry must be created from authStorage and passed to createAgentSession
  it("creates a ModelRegistry from authStorage and passes it to createAgentSession", async () => {
    await spawnOracle(makeIssue(), [], CFG, "AGENTS");
    expect(mockModelRegistryCtor).toHaveBeenCalledOnce();
    // First arg to ModelRegistry constructor must be our authStorage instance
    expect(mockModelRegistryCtor.mock.calls[0]?.[0]).toBe(mockAuthInstance);
    // modelRegistry must be passed through to createAgentSession
    expect(mockCreate.mock.calls[0]?.[0].modelRegistry).toBe(mockModelRegistryInstance);
  });

  it("each spawn creates a fresh ModelRegistry bound to its authStorage", async () => {
    await spawnOracle(makeIssue(), [], CFG, "AGENTS");
    await spawnSentinel(makeIssue(), [], CFG, "AGENTS");
    expect(mockModelRegistryCtor).toHaveBeenCalledTimes(2);
  });
});
