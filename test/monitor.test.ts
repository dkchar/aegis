// test/monitor.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  calculateCost,
  track,
  checkStuck,
  checkBudget,
  checkRepeatedToolCall,
} from "../src/monitor.js";
import type { MonitoredAgent } from "../src/monitor.js";
import type { AgentState, AegisConfig, SSEEvent } from "../src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<AegisConfig["timing"]> = {}): AegisConfig {
  return {
    version: 1,
    auth: { anthropic: null, openai: null, google: null },
    models: {
      oracle: "claude-haiku-4-5",
      titan: "claude-sonnet-4-5",
      sentinel: "claude-opus-4-5",
      metis: "claude-haiku-4-5",
      prometheus: "claude-opus-4-5",
    },
    concurrency: { max_agents: 4, max_oracles: 2, max_titans: 2, max_sentinels: 1 },
    budgets: {
      oracle_turns: 20, oracle_tokens: 50000,
      titan_turns: 100, titan_tokens: 200000,
      sentinel_turns: 30, sentinel_tokens: 80000,
    },
    timing: {
      poll_interval_seconds: 5,
      stuck_warning_seconds: 120,
      stuck_kill_seconds: 300,
      ...overrides,
    },
    mnemosyne: { max_records: 500, context_budget_tokens: 4000 },
    labors: { base_path: ".aegis/labors" },
    olympus: { port: 3737, open_browser: false },
  };
}

function makeAgentState(overrides: Partial<AgentState> = {}): AgentState {
  return {
    id: "agent-test-1",
    caste: "titan",
    issue_id: "aegis-001",
    issue_title: "Test issue",
    model: "claude-sonnet-4-5",
    turns: 0,
    max_turns: 100,
    tokens: 0,
    max_tokens: 200000,
    cost_usd: 0,
    started_at: Date.now(),
    last_tool_call_at: Date.now(),
    status: "running",
    labor_path: null,
    ...overrides,
  };
}

function makeAgent(stateOverrides: Partial<AgentState> = {}): MonitoredAgent {
  return { state: makeAgentState(stateOverrides) };
}

// ---------------------------------------------------------------------------
// calculateCost()
// ---------------------------------------------------------------------------
describe("calculateCost()", () => {
  it("returns 0 for all-zero token counts", () => {
    expect(calculateCost("claude-sonnet-4-5", 0, 0, 0)).toBe(0);
  });

  it("calculates correct cost for claude-haiku-4-5", () => {
    // 1M input @ $0.25, 1M output @ $1.25, 1M cacheRead @ $0.03
    const cost = calculateCost("claude-haiku-4-5", 1_000_000, 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(0.25 + 1.25 + 0.03, 6);
  });

  it("calculates correct cost for claude-sonnet-4-5", () => {
    // 1M input @ $3, 1M output @ $15, 1M cacheRead @ $0.3
    const cost = calculateCost("claude-sonnet-4-5", 1_000_000, 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(3.0 + 15.0 + 0.3, 6);
  });

  it("calculates correct cost for claude-opus-4-5", () => {
    // 1M input @ $15, 1M output @ $75, 1M cacheRead @ $1.5
    const cost = calculateCost("claude-opus-4-5", 1_000_000, 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(15.0 + 75.0 + 1.5, 6);
  });

  it("calculates correct cost for claude-haiku-4-5-20251001 (same as haiku-4-5)", () => {
    const dated = calculateCost("claude-haiku-4-5-20251001", 1_000_000, 1_000_000, 1_000_000);
    const base  = calculateCost("claude-haiku-4-5",          1_000_000, 1_000_000, 1_000_000);
    expect(dated).toBeCloseTo(base, 6);
  });

  it("calculates correct cost for claude-sonnet-4-6 (same tier as sonnet-4-5)", () => {
    const v6 = calculateCost("claude-sonnet-4-6", 1_000_000, 1_000_000, 1_000_000);
    const v5 = calculateCost("claude-sonnet-4-5", 1_000_000, 1_000_000, 1_000_000);
    expect(v6).toBeCloseTo(v5, 6);
  });

  it("calculates correct cost for claude-opus-4-6 (same tier as opus-4-5)", () => {
    const v6 = calculateCost("claude-opus-4-6", 1_000_000, 1_000_000, 1_000_000);
    const v5 = calculateCost("claude-opus-4-5", 1_000_000, 1_000_000, 1_000_000);
    expect(v6).toBeCloseTo(v5, 6);
  });

  it("falls back to Sonnet pricing for unknown models", () => {
    const known = calculateCost("claude-sonnet-4-5", 500_000, 200_000, 100_000);
    const unknown = calculateCost("some-unknown-model-v99", 500_000, 200_000, 100_000);
    expect(unknown).toBeCloseTo(known, 6);
  });

  it("handles cache read tokens with reduced pricing", () => {
    // Cache read should be much cheaper than input tokens
    const cacheOnly = calculateCost("claude-sonnet-4-5", 0, 0, 1_000_000);
    const inputOnly = calculateCost("claude-sonnet-4-5", 1_000_000, 0, 0);
    expect(cacheOnly).toBeLessThan(inputOnly);
  });

  it("scales linearly with token counts", () => {
    const half = calculateCost("claude-haiku-4-5", 500_000, 0, 0);
    const full = calculateCost("claude-haiku-4-5", 1_000_000, 0, 0);
    expect(full).toBeCloseTo(half * 2, 10);
  });
});

// ---------------------------------------------------------------------------
// track()
// ---------------------------------------------------------------------------
describe("track()", () => {
  it("calls onEvent with a tracking_started event", () => {
    const agent = makeAgent();
    const config = makeConfig();
    const events: SSEEvent[] = [];

    track(agent, config, (e) => events.push(e));

    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("agent.tracking_started");
  });

  it("includes agent_id and issue_id in the event data", () => {
    const agent = makeAgent({ id: "agent-xyz", issue_id: "aegis-999" });
    const config = makeConfig();
    const events: SSEEvent[] = [];

    track(agent, config, (e) => events.push(e));

    const data = events[0]!.data as Record<string, unknown>;
    expect(data["agent_id"]).toBe("agent-xyz");
    expect(data["issue_id"]).toBe("aegis-999");
  });

  it("sets a timestamp on the emitted event", () => {
    const before = Date.now();
    const agent = makeAgent();
    const events: SSEEvent[] = [];

    track(agent, makeConfig(), (e) => events.push(e));

    const after = Date.now();
    expect(events[0]!.timestamp).toBeGreaterThanOrEqual(before);
    expect(events[0]!.timestamp).toBeLessThanOrEqual(after);
  });

  it("forwards events via the onEvent callback", () => {
    const onEvent = vi.fn();
    track(makeAgent(), makeConfig(), onEvent);
    expect(onEvent).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// checkStuck()
// ---------------------------------------------------------------------------
describe("checkStuck()", () => {
  it("returns { stuck: false } when agent has very recent activity", () => {
    const agent = makeAgent({ last_tool_call_at: Date.now() });
    const result = checkStuck(agent, makeConfig());
    expect(result.stuck).toBe(false);
  });

  it("returns { stuck: false } below the warning threshold", () => {
    const config = makeConfig({ stuck_warning_seconds: 120, stuck_kill_seconds: 300 });
    // 60s ago — well below 120s warning threshold
    const agent = makeAgent({ last_tool_call_at: Date.now() - 60_000 });
    const result = checkStuck(agent, config);
    expect(result.stuck).toBe(false);
  });

  it("returns warning when idle >= stuck_warning_seconds", () => {
    const config = makeConfig({ stuck_warning_seconds: 120, stuck_kill_seconds: 300 });
    // 130s ago — past warning threshold (120s) but before kill (300s)
    const agent = makeAgent({ last_tool_call_at: Date.now() - 130_000 });
    const result = checkStuck(agent, config);
    expect(result.stuck).toBe(true);
    if (result.stuck) {
      expect(result.severity).toBe("warning");
      expect(result.reason).toBeTruthy();
    }
  });

  it("returns kill when idle >= stuck_kill_seconds", () => {
    const config = makeConfig({ stuck_warning_seconds: 120, stuck_kill_seconds: 300 });
    // 310s ago — past kill threshold
    const agent = makeAgent({ last_tool_call_at: Date.now() - 310_000 });
    const result = checkStuck(agent, config);
    expect(result.stuck).toBe(true);
    if (result.stuck) {
      expect(result.severity).toBe("kill");
      expect(result.reason).toContain("300s");
    }
  });

  it("kill threshold takes priority over warning threshold", () => {
    const config = makeConfig({ stuck_warning_seconds: 10, stuck_kill_seconds: 30 });
    // 40s idle — past both thresholds, kill should win
    const agent = makeAgent({ last_tool_call_at: Date.now() - 40_000 });
    const result = checkStuck(agent, config);
    expect(result.stuck).toBe(true);
    if (result.stuck) {
      expect(result.severity).toBe("kill");
    }
  });

  it("reason string includes elapsed seconds", () => {
    const config = makeConfig({ stuck_warning_seconds: 120, stuck_kill_seconds: 300 });
    const agent = makeAgent({ last_tool_call_at: Date.now() - 150_000 });
    const result = checkStuck(agent, config);
    expect(result.stuck).toBe(true);
    if (result.stuck) {
      expect(result.reason).toMatch(/\d+s/);
    }
  });
});

// ---------------------------------------------------------------------------
// checkBudget()
// ---------------------------------------------------------------------------
describe("checkBudget()", () => {
  const config = makeConfig();

  it("returns { exceeded: false } when under both limits", () => {
    const agent = makeAgent({ turns: 50, max_turns: 100, tokens: 100_000, max_tokens: 200_000 });
    const result = checkBudget(agent, config);
    expect(result.exceeded).toBe(false);
  });

  it("returns exceeded for turns when turns >= max_turns", () => {
    const agent = makeAgent({ turns: 100, max_turns: 100 });
    const result = checkBudget(agent, config);
    expect(result.exceeded).toBe(true);
    if (result.exceeded) {
      expect(result.resource).toBe("turns");
      expect(result.current).toBe(100);
      expect(result.limit).toBe(100);
    }
  });

  it("returns exceeded for turns when turns exceeds max_turns", () => {
    const agent = makeAgent({ turns: 150, max_turns: 100 });
    const result = checkBudget(agent, config);
    expect(result.exceeded).toBe(true);
    if (result.exceeded) {
      expect(result.resource).toBe("turns");
    }
  });

  it("returns exceeded for tokens when tokens >= max_tokens", () => {
    const agent = makeAgent({ tokens: 200_000, max_tokens: 200_000 });
    const result = checkBudget(agent, config);
    expect(result.exceeded).toBe(true);
    if (result.exceeded) {
      expect(result.resource).toBe("tokens");
      expect(result.current).toBe(200_000);
      expect(result.limit).toBe(200_000);
    }
  });

  it("checks turns before tokens (turns exceeded takes priority)", () => {
    // Both exceeded — turns should be reported first
    const agent = makeAgent({ turns: 200, max_turns: 100, tokens: 300_000, max_tokens: 200_000 });
    const result = checkBudget(agent, config);
    expect(result.exceeded).toBe(true);
    if (result.exceeded) {
      expect(result.resource).toBe("turns");
    }
  });

  it("returns { exceeded: false } for turn count of 0", () => {
    const agent = makeAgent({ turns: 0, max_turns: 100 });
    const result = checkBudget(agent, config);
    expect(result.exceeded).toBe(false);
  });

  it("returns { exceeded: false } for 1 turn below limit", () => {
    const agent = makeAgent({ turns: 99, max_turns: 100 });
    const result = checkBudget(agent, config);
    expect(result.exceeded).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkRepeatedToolCall() — SPEC §10.2
// ---------------------------------------------------------------------------
describe("checkRepeatedToolCall()", () => {
  it("returns { repeated: false } for empty buffer", () => {
    expect(checkRepeatedToolCall([])).toEqual({ repeated: false });
  });

  it("returns { repeated: false } when buffer has fewer entries than threshold", () => {
    expect(checkRepeatedToolCall(["read:{}", "read:{}"])).toEqual({ repeated: false });
  });

  it("returns { repeated: true } when last 3 calls are identical", () => {
    const buf = ["read:{}", "read:{}", "read:{}"];
    const result = checkRepeatedToolCall(buf);
    expect(result.repeated).toBe(true);
    if (result.repeated) {
      expect(result.toolName).toBe("read");
      expect(result.count).toBe(3);
    }
  });

  it("returns { repeated: false } when last 3 are not all identical", () => {
    const buf = ["read:{}", "bash:{}", "read:{}"];
    expect(checkRepeatedToolCall(buf)).toEqual({ repeated: false });
  });

  it("considers only the last N entries when buffer is longer than threshold", () => {
    // First two differ but last 3 are all the same
    const buf = ["bash:{}", "write:{}", "read:{}", "read:{}", "read:{}"];
    const result = checkRepeatedToolCall(buf);
    expect(result.repeated).toBe(true);
    if (result.repeated) {
      expect(result.toolName).toBe("read");
    }
  });

  it("returns { repeated: false } when last 3 entries in longer buffer are not identical", () => {
    const buf = ["read:{}", "read:{}", "read:{}", "bash:{}"];
    expect(checkRepeatedToolCall(buf)).toEqual({ repeated: false });
  });

  it("extracts toolName correctly from fingerprint with JSON args", () => {
    const fingerprint = 'bash:{"command":"ls -la"}';
    const buf = [fingerprint, fingerprint, fingerprint];
    const result = checkRepeatedToolCall(buf);
    expect(result.repeated).toBe(true);
    if (result.repeated) {
      expect(result.toolName).toBe("bash");
    }
  });

  it("handles fingerprint with no colon (bare tool name)", () => {
    const buf = ["read", "read", "read"];
    const result = checkRepeatedToolCall(buf);
    expect(result.repeated).toBe(true);
    if (result.repeated) {
      expect(result.toolName).toBe("read");
    }
  });

  it("respects a custom threshold", () => {
    // threshold=2 — two identical calls should trigger
    const buf = ["read:{}", "read:{}"];
    const result = checkRepeatedToolCall(buf, 2);
    expect(result.repeated).toBe(true);
  });

  it("does not trigger at threshold-1 identical calls", () => {
    const buf = ["read:{}", "read:{}"];
    // default threshold is 3, so 2 identical calls should not trigger
    expect(checkRepeatedToolCall(buf)).toEqual({ repeated: false });
  });
});
