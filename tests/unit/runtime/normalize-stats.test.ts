/**
 * S05 contract seed — unit tests for normalize-stats.
 *
 * Tests are organised by metering mode.  Each describe block validates the
 * contract that normalizeStats() and isWithinBudget() must honour once Lane B
 * (aegis-fjm.6.3) implements those functions.
 *
 * Approach:
 *   - Structural assertions (type shapes, constant values) are live tests.
 *   - Behavioural assertions that require real implementations use .todo()
 *     so they fail visibly when Lane B is ready to be filled in.
 *
 * Canonical contract: SPECv2 §8.2.2.
 */

import { describe, expect, it } from "vitest";

import {
  normalizeStats,
  isWithinBudget,
  type AuthMode,
  type MeteringCapability,
  type NormalizedBudgetStatus,
  type UsageObservation,
} from "../../../src/runtime/normalize-stats.js";
import type { AgentStats } from "../../../src/runtime/agent-runtime.js";
import type { BudgetLimit } from "../../../src/config/schema.js";

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

function makeStats(overrides: Partial<AgentStats> = {}): AgentStats {
  return {
    input_tokens: 1000,
    output_tokens: 500,
    session_turns: 5,
    wall_time_sec: 120,
    ...overrides,
  };
}

function makeBudgetLimit(overrides: Partial<BudgetLimit> = {}): BudgetLimit {
  return {
    turns: 20,
    tokens: 10000,
    ...overrides,
  };
}

function makeObservation(
  metering: MeteringCapability,
  auth_mode: AuthMode,
  overrides: Partial<UsageObservation> = {}
): UsageObservation {
  return {
    provider: "pi",
    auth_mode,
    metering,
    confidence: "exact",
    source: "session_stats",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Type-shape assertions (live — no implementation needed)
// ---------------------------------------------------------------------------

describe("MeteringCapability type values", () => {
  it("covers all five canonical SPECv2 §8.2.2 values", () => {
    const values: MeteringCapability[] = [
      "exact_usd",
      "credits",
      "quota",
      "stats_only",
      "unknown",
    ];
    expect(values).toHaveLength(5);
    expect(values).toContain("exact_usd");
    expect(values).toContain("credits");
    expect(values).toContain("quota");
    expect(values).toContain("stats_only");
    expect(values).toContain("unknown");
  });
});

describe("AuthMode type values", () => {
  it("covers all five canonical SPECv2 §8.2.2 values", () => {
    const values: AuthMode[] = [
      "api_key",
      "subscription",
      "workspace_subscription",
      "local",
      "unknown",
    ];
    expect(values).toHaveLength(5);
    expect(values).toContain("api_key");
    expect(values).toContain("subscription");
    expect(values).toContain("workspace_subscription");
    expect(values).toContain("local");
    expect(values).toContain("unknown");
  });
});

describe("NormalizedBudgetStatus shape", () => {
  it("carries required fields: metering, auth_mode, confidence, total_tokens, session_turns, wall_time_sec, budget_warning", () => {
    // Purely structural — build an object literal and assert the keys compile.
    const status: NormalizedBudgetStatus = {
      metering: "stats_only",
      auth_mode: "api_key",
      confidence: "estimated",
      total_tokens: 1500,
      session_turns: 5,
      wall_time_sec: 120,
      budget_warning: false,
    };
    expect(status.metering).toBe("stats_only");
    expect(status.auth_mode).toBe("api_key");
    expect(status.total_tokens).toBe(1500);
    expect(status.budget_warning).toBe(false);
  });

  it("allows optional cost/credit/quota fields to be absent", () => {
    const status: NormalizedBudgetStatus = {
      metering: "stats_only",
      auth_mode: "local",
      confidence: "estimated",
      total_tokens: 0,
      session_turns: 0,
      wall_time_sec: 0,
      budget_warning: false,
    };
    expect(status.exact_cost_usd).toBeUndefined();
    expect(status.credits_used).toBeUndefined();
    expect(status.quota_used_pct).toBeUndefined();
    expect(status.active_context_pct).toBeUndefined();
  });
});

describe("UsageObservation shape", () => {
  it("requires provider, auth_mode, metering, confidence, and source", () => {
    const obs = makeObservation("exact_usd", "api_key", {
      exact_cost_usd: 0.05,
      input_tokens: 1000,
      output_tokens: 500,
    });
    expect(obs.provider).toBe("pi");
    expect(obs.metering).toBe("exact_usd");
    expect(obs.confidence).toBe("exact");
    expect(obs.source).toBe("session_stats");
  });
});

// ---------------------------------------------------------------------------
// exact_usd metering
// ---------------------------------------------------------------------------

describe("normalizeStats — exact_usd metering", () => {
  it("populates exact_cost_usd from observation", () => {
    const raw = makeStats();
    const obs = makeObservation("exact_usd", "api_key", { exact_cost_usd: 0.05 });
    const result = normalizeStats(raw, "api_key", "exact_usd", obs);
    expect(result.exact_cost_usd).toBe(0.05);
  });

  it("sets confidence to 'exact' when observation has exact_cost_usd", () => {
    const raw = makeStats();
    const obs = makeObservation("exact_usd", "api_key", { exact_cost_usd: 0.12 });
    const result = normalizeStats(raw, "api_key", "exact_usd", obs);
    expect(result.confidence).toBe("exact");
  });

  it("sets confidence to 'estimated' when no observation provided", () => {
    const raw = makeStats();
    const result = normalizeStats(raw, "api_key", "exact_usd");
    expect(result.confidence).toBe("estimated");
    expect(result.exact_cost_usd).toBeUndefined();
  });

  it("total_tokens equals input_tokens + output_tokens from raw stats", () => {
    const raw = makeStats({ input_tokens: 800, output_tokens: 200 });
    const obs = makeObservation("exact_usd", "api_key", { exact_cost_usd: 0.01 });
    const result = normalizeStats(raw, "api_key", "exact_usd", obs);
    expect(result.total_tokens).toBe(1000);
  });

  it("budget_warning is false", () => {
    const raw = makeStats();
    const obs = makeObservation("exact_usd", "api_key", { exact_cost_usd: 0.05 });
    const result = normalizeStats(raw, "api_key", "exact_usd", obs);
    expect(result.budget_warning).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// credits metering
// ---------------------------------------------------------------------------

describe("normalizeStats — credits metering", () => {
  it("populates credits_used and credits_remaining from observation", () => {
    const raw = makeStats();
    const obs = makeObservation("credits", "subscription", {
      credits_used: 150,
      credits_remaining: 850,
    });
    const result = normalizeStats(raw, "subscription", "credits", obs);
    expect(result.credits_used).toBe(150);
    expect(result.credits_remaining).toBe(850);
  });

  it("sets confidence to 'proxy' when credits metering", () => {
    const raw = makeStats();
    const obs = makeObservation("credits", "subscription", {
      credits_used: 100,
      credits_remaining: 900,
    });
    const result = normalizeStats(raw, "subscription", "credits", obs);
    expect(result.confidence).toBe("proxy");
  });

  it("sets confidence to 'proxy' even without observation", () => {
    const raw = makeStats();
    const result = normalizeStats(raw, "subscription", "credits");
    expect(result.confidence).toBe("proxy");
    expect(result.credits_used).toBeUndefined();
    expect(result.credits_remaining).toBeUndefined();
  });

  it("exact_cost_usd is not set — never fabricate dollar precision", () => {
    const raw = makeStats();
    const obs = makeObservation("credits", "subscription", {
      credits_used: 100,
      credits_remaining: 900,
    });
    const result = normalizeStats(raw, "subscription", "credits", obs);
    expect(result.exact_cost_usd).toBeUndefined();
  });

  it("budget_warning is false", () => {
    const raw = makeStats();
    const obs = makeObservation("credits", "subscription", {
      credits_used: 100,
      credits_remaining: 900,
    });
    const result = normalizeStats(raw, "subscription", "credits", obs);
    expect(result.budget_warning).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// stats_only metering
// ---------------------------------------------------------------------------

describe("normalizeStats — stats_only metering", () => {
  it("populates total_tokens, session_turns, wall_time_sec from raw stats", () => {
    const raw = makeStats({ input_tokens: 600, output_tokens: 400, session_turns: 7, wall_time_sec: 200 });
    const result = normalizeStats(raw, "local", "stats_only");
    expect(result.total_tokens).toBe(1000);
    expect(result.session_turns).toBe(7);
    expect(result.wall_time_sec).toBe(200);
  });

  it("sets confidence to 'estimated'", () => {
    const raw = makeStats();
    const result = normalizeStats(raw, "local", "stats_only");
    expect(result.confidence).toBe("estimated");
  });

  it("leaves exact_cost_usd, credits_used, and quota_used_pct undefined", () => {
    const raw = makeStats();
    const result = normalizeStats(raw, "local", "stats_only");
    expect(result.exact_cost_usd).toBeUndefined();
    expect(result.credits_used).toBeUndefined();
    expect(result.quota_used_pct).toBeUndefined();
  });

  it("budget_warning is false", () => {
    const raw = makeStats();
    const result = normalizeStats(raw, "local", "stats_only");
    expect(result.budget_warning).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// quota metering
// ---------------------------------------------------------------------------

describe("normalizeStats — quota metering", () => {
  it("populates quota_used_pct and quota_remaining_pct from observation", () => {
    const raw = makeStats();
    const obs = makeObservation("quota", "workspace_subscription", {
      quota_used_pct: 40,
      quota_remaining_pct: 60,
    });
    const result = normalizeStats(raw, "workspace_subscription", "quota", obs);
    expect(result.quota_used_pct).toBe(40);
    expect(result.quota_remaining_pct).toBe(60);
  });

  it("sets confidence to 'proxy'", () => {
    const raw = makeStats();
    const obs = makeObservation("quota", "workspace_subscription", {
      quota_used_pct: 40,
      quota_remaining_pct: 60,
    });
    const result = normalizeStats(raw, "workspace_subscription", "quota", obs);
    expect(result.confidence).toBe("proxy");
  });

  it("sets confidence to 'proxy' even without observation", () => {
    const raw = makeStats();
    const result = normalizeStats(raw, "workspace_subscription", "quota");
    expect(result.confidence).toBe("proxy");
    expect(result.quota_used_pct).toBeUndefined();
    expect(result.quota_remaining_pct).toBeUndefined();
  });

  it("budget_warning is false", () => {
    const raw = makeStats();
    const obs = makeObservation("quota", "workspace_subscription", {
      quota_used_pct: 40,
      quota_remaining_pct: 60,
    });
    const result = normalizeStats(raw, "workspace_subscription", "quota", obs);
    expect(result.budget_warning).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// unknown metering — conservative defaults
// ---------------------------------------------------------------------------

describe("normalizeStats — unknown metering", () => {
  it("sets confidence to 'proxy'", () => {
    const raw = makeStats();
    const result = normalizeStats(raw, "unknown", "unknown");
    expect(result.confidence).toBe("proxy");
  });

  it("sets budget_warning to true (conservative default)", () => {
    const raw = makeStats();
    const result = normalizeStats(raw, "unknown", "unknown");
    expect(result.budget_warning).toBe(true);
  });

  it("does not set exact_cost_usd, credits_used, or quota_used_pct", () => {
    const raw = makeStats();
    const result = normalizeStats(raw, "unknown", "unknown");
    expect(result.exact_cost_usd).toBeUndefined();
    expect(result.credits_used).toBeUndefined();
    expect(result.quota_used_pct).toBeUndefined();
  });

  it("still populates total_tokens, session_turns, and wall_time_sec from raw stats", () => {
    const raw = makeStats({ input_tokens: 300, output_tokens: 200, session_turns: 3, wall_time_sec: 60 });
    const result = normalizeStats(raw, "unknown", "unknown");
    expect(result.total_tokens).toBe(500);
    expect(result.session_turns).toBe(3);
    expect(result.wall_time_sec).toBe(60);
  });
});

// ---------------------------------------------------------------------------
// Cross-mode invariants
// ---------------------------------------------------------------------------

describe("normalizeStats — cross-mode invariants", () => {
  it("total_tokens = input_tokens + output_tokens for all metering modes", () => {
    const raw = makeStats({ input_tokens: 700, output_tokens: 300 });
    const modes: MeteringCapability[] = ["exact_usd", "credits", "quota", "stats_only", "unknown"];
    for (const mode of modes) {
      const result = normalizeStats(raw, "api_key", mode);
      expect(result.total_tokens, `mode=${mode}`).toBe(1000);
    }
  });

  it("session_turns and wall_time_sec preserved across all modes", () => {
    const raw = makeStats({ session_turns: 8, wall_time_sec: 250 });
    const modes: MeteringCapability[] = ["exact_usd", "credits", "quota", "stats_only", "unknown"];
    for (const mode of modes) {
      const result = normalizeStats(raw, "api_key", mode);
      expect(result.session_turns, `mode=${mode}`).toBe(8);
      expect(result.wall_time_sec, `mode=${mode}`).toBe(250);
    }
  });

  it("active_context_pct passed through when defined", () => {
    const raw = makeStats({ active_context_pct: 72.5 });
    const result = normalizeStats(raw, "api_key", "stats_only");
    expect(result.active_context_pct).toBe(72.5);
  });

  it("active_context_pct omitted when undefined in raw stats", () => {
    const raw = makeStats();
    // makeStats does not set active_context_pct
    const result = normalizeStats(raw, "api_key", "stats_only");
    expect(result.active_context_pct).toBeUndefined();
  });

  it("auth_mode preserved in output", () => {
    const modes: AuthMode[] = ["api_key", "subscription", "workspace_subscription", "local", "unknown"];
    for (const authMode of modes) {
      const raw = makeStats();
      const result = normalizeStats(raw, authMode, "stats_only");
      expect(result.auth_mode, `authMode=${authMode}`).toBe(authMode);
    }
  });

  it("metering preserved in output", () => {
    const modes: MeteringCapability[] = ["exact_usd", "credits", "quota", "stats_only", "unknown"];
    for (const mode of modes) {
      const raw = makeStats();
      const result = normalizeStats(raw, "api_key", mode);
      expect(result.metering, `mode=${mode}`).toBe(mode);
    }
  });
});

// ---------------------------------------------------------------------------
// isWithinBudget
// ---------------------------------------------------------------------------

describe("isWithinBudget — turn and token limits", () => {
  it("returns true when session_turns < limits.turns and total_tokens < limits.tokens", () => {
    const status: NormalizedBudgetStatus = {
      metering: "stats_only",
      auth_mode: "api_key",
      confidence: "estimated",
      total_tokens: 5000,
      session_turns: 10,
      wall_time_sec: 120,
      budget_warning: false,
    };
    const limits = makeBudgetLimit({ turns: 20, tokens: 10000 });
    expect(isWithinBudget(status, limits)).toBe(true);
  });

  it("returns false when session_turns >= limits.turns", () => {
    const status: NormalizedBudgetStatus = {
      metering: "stats_only",
      auth_mode: "api_key",
      confidence: "estimated",
      total_tokens: 5000,
      session_turns: 20,
      wall_time_sec: 120,
      budget_warning: false,
    };
    const limits = makeBudgetLimit({ turns: 20, tokens: 10000 });
    expect(isWithinBudget(status, limits)).toBe(false);
  });

  it("returns false when session_turns > limits.turns", () => {
    const status: NormalizedBudgetStatus = {
      metering: "stats_only",
      auth_mode: "api_key",
      confidence: "estimated",
      total_tokens: 5000,
      session_turns: 25,
      wall_time_sec: 120,
      budget_warning: false,
    };
    const limits = makeBudgetLimit({ turns: 20, tokens: 10000 });
    expect(isWithinBudget(status, limits)).toBe(false);
  });

  it("returns false when total_tokens >= limits.tokens", () => {
    const status: NormalizedBudgetStatus = {
      metering: "stats_only",
      auth_mode: "api_key",
      confidence: "estimated",
      total_tokens: 10000,
      session_turns: 5,
      wall_time_sec: 120,
      budget_warning: false,
    };
    const limits = makeBudgetLimit({ turns: 20, tokens: 10000 });
    expect(isWithinBudget(status, limits)).toBe(false);
  });

  it("returns false when both limits are exceeded", () => {
    const status: NormalizedBudgetStatus = {
      metering: "stats_only",
      auth_mode: "api_key",
      confidence: "estimated",
      total_tokens: 15000,
      session_turns: 25,
      wall_time_sec: 300,
      budget_warning: false,
    };
    const limits = makeBudgetLimit({ turns: 20, tokens: 10000 });
    expect(isWithinBudget(status, limits)).toBe(false);
  });
});

describe("isWithinBudget — unknown metering conservative behaviour", () => {
  it("returns false when metering is 'unknown' and budget_warning is true", () => {
    const status: NormalizedBudgetStatus = {
      metering: "unknown",
      auth_mode: "unknown",
      confidence: "proxy",
      total_tokens: 100,
      session_turns: 1,
      wall_time_sec: 10,
      budget_warning: true,
    };
    const limits = makeBudgetLimit({ turns: 20, tokens: 10000 });
    expect(isWithinBudget(status, limits)).toBe(false);
  });

  it("returns true when metering is 'unknown' and budget_warning is false and within limits", () => {
    const status: NormalizedBudgetStatus = {
      metering: "unknown",
      auth_mode: "unknown",
      confidence: "proxy",
      total_tokens: 100,
      session_turns: 1,
      wall_time_sec: 10,
      budget_warning: false,
    };
    const limits = makeBudgetLimit({ turns: 20, tokens: 10000 });
    expect(isWithinBudget(status, limits)).toBe(true);
  });

  it("budget_warning on non-unknown metering does not trigger false", () => {
    // budget_warning=true on a non-unknown metering mode should not affect isWithinBudget
    // (the monitor checks economics thresholds separately)
    const status: NormalizedBudgetStatus = {
      metering: "credits",
      auth_mode: "subscription",
      confidence: "proxy",
      total_tokens: 100,
      session_turns: 1,
      wall_time_sec: 10,
      budget_warning: true,
    };
    const limits = makeBudgetLimit({ turns: 20, tokens: 10000 });
    expect(isWithinBudget(status, limits)).toBe(true);
  });
});

describe("isWithinBudget — edge cases", () => {
  it("returns true when session_turns is one less than limit", () => {
    const status: NormalizedBudgetStatus = {
      metering: "stats_only",
      auth_mode: "api_key",
      confidence: "estimated",
      total_tokens: 100,
      session_turns: 19,
      wall_time_sec: 60,
      budget_warning: false,
    };
    const limits = makeBudgetLimit({ turns: 20, tokens: 10000 });
    expect(isWithinBudget(status, limits)).toBe(true);
  });

  it("returns false when session is at exactly the limit (boundary = over)", () => {
    const status: NormalizedBudgetStatus = {
      metering: "stats_only",
      auth_mode: "api_key",
      confidence: "estimated",
      total_tokens: 10000,
      session_turns: 20,
      wall_time_sec: 60,
      budget_warning: false,
    };
    const limits = makeBudgetLimit({ turns: 20, tokens: 10000 });
    expect(isWithinBudget(status, limits)).toBe(false);
  });

  it("handles zero-valued stats without throwing", () => {
    const status: NormalizedBudgetStatus = {
      metering: "stats_only",
      auth_mode: "local",
      confidence: "estimated",
      total_tokens: 0,
      session_turns: 0,
      wall_time_sec: 0,
      budget_warning: false,
    };
    const limits = makeBudgetLimit({ turns: 20, tokens: 10000 });
    expect(() => isWithinBudget(status, limits)).not.toThrow();
    expect(isWithinBudget(status, limits)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Function signature assertions (live — verify the stubs exist and throw the
// expected not-implemented error rather than disappearing at compile time)
// ---------------------------------------------------------------------------

// NOTE: These stub-throw tests are intentionally removed once Lane B is
// implemented. The implementation replaces throws with real logic.
