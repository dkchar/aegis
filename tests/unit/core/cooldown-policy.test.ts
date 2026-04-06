/**
 * S10 — CooldownPolicy unit tests.
 *
 * Validates the cooldown decision logic from SPECv2 §6.4 and §6.5:
 *   - three consecutive failures in a 10-minute window trigger cooldown
 *   - cooldown suppresses re-dispatch for 30 minutes
 *   - isInCooldown returns correct boolean for expired / active windows
 *   - canRedispatch respects cooldown and override flags
 *   - recordFailure updates counters correctly and resets on window expiry
 *   - resetFailures clears all state
 */

import { describe, it, expect } from "vitest";

import {
  COOLDOWN_FAILURE_THRESHOLD,
  COOLDOWN_WINDOW_MS,
  COOLDOWN_SUPPRESSION_MS,
  shouldTriggerCooldown,
  computeCooldownUntil,
  isInCooldown,
  canRedispatch,
  recordFailure,
  resetFailures,
} from "../../../src/core/cooldown-policy.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("CooldownPolicy constants", () => {
  it("COOLDOWN_FAILURE_THRESHOLD is 3 (SPECv2 §6.4)", () => {
    expect(COOLDOWN_FAILURE_THRESHOLD).toBe(3);
  });

  it("COOLDOWN_WINDOW_MS is 10 minutes", () => {
    expect(COOLDOWN_WINDOW_MS).toBe(10 * 60 * 1000);
  });

  it("COOLDOWN_SUPPRESSION_MS is 30 minutes", () => {
    expect(COOLDOWN_SUPPRESSION_MS).toBe(30 * 60 * 1000);
  });
});

// ---------------------------------------------------------------------------
// shouldTriggerCooldown
// ---------------------------------------------------------------------------

describe("shouldTriggerCooldown", () => {
  const now = Date.now();

  it("returns false when below threshold", () => {
    expect(shouldTriggerCooldown(0, null, now)).toBe(false);
    expect(shouldTriggerCooldown(1, null, now)).toBe(false);
    expect(shouldTriggerCooldown(2, null, now)).toBe(false);
  });

  it("returns true when at threshold with no window", () => {
    expect(shouldTriggerCooldown(3, null, now)).toBe(true);
    expect(shouldTriggerCooldown(5, null, now)).toBe(true);
  });

  it("returns true when at threshold and window is still active", () => {
    const windowStart = now - 5 * 60 * 1000; // 5 minutes ago
    expect(shouldTriggerCooldown(3, windowStart, now)).toBe(true);
  });

  it("returns false when at threshold but window has expired", () => {
    const windowStart = now - 15 * 60 * 1000; // 15 minutes ago (past 10-min window)
    expect(shouldTriggerCooldown(3, windowStart, now)).toBe(false);
  });

  it("returns true at exactly the window boundary", () => {
    const windowStart = now - COOLDOWN_WINDOW_MS;
    expect(shouldTriggerCooldown(3, windowStart, now)).toBe(true);
  });

  it("returns false one millisecond past the window", () => {
    const windowStart = now - COOLDOWN_WINDOW_MS - 1;
    expect(shouldTriggerCooldown(3, windowStart, now)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computeCooldownUntil
// ---------------------------------------------------------------------------

describe("computeCooldownUntil", () => {
  it("returns an ISO-8601 timestamp 30 minutes in the future", () => {
    const now = Date.now();
    const result = computeCooldownUntil(now);
    const expected = new Date(now + COOLDOWN_SUPPRESSION_MS).toISOString();
    expect(result).toBe(expected);
  });

  it("uses Date.now() when no argument provided", () => {
    const before = Date.now();
    const result = computeCooldownUntil();
    const after = Date.now();
    const resultMs = new Date(result).getTime();
    expect(resultMs).toBeGreaterThanOrEqual(before + COOLDOWN_SUPPRESSION_MS);
    expect(resultMs).toBeLessThanOrEqual(after + COOLDOWN_SUPPRESSION_MS);
  });
});

// ---------------------------------------------------------------------------
// isInCooldown
// ---------------------------------------------------------------------------

describe("isInCooldown", () => {
  it("returns false when cooldownUntil is null", () => {
    expect(isInCooldown(null, Date.now())).toBe(false);
  });

  it("returns true when current time is before cooldown deadline", () => {
    const now = Date.now();
    const deadline = new Date(now + 10 * 60 * 1000).toISOString(); // 10 min in future
    expect(isInCooldown(deadline, now)).toBe(true);
  });

  it("returns false when current time is past cooldown deadline", () => {
    const now = Date.now();
    const deadline = new Date(now - 1000).toISOString(); // 1 second in the past
    expect(isInCooldown(deadline, now)).toBe(false);
  });

  it("returns false at exactly the deadline", () => {
    const now = Date.now();
    const deadline = new Date(now).toISOString();
    expect(isInCooldown(deadline, now)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// canRedispatch
// ---------------------------------------------------------------------------

describe("canRedispatch", () => {
  it("returns true when overrideCooldown is set", () => {
    expect(canRedispatch(5, "2099-01-01T00:00:00.000Z", true, Date.now())).toBe(true);
  });

  it("returns false when in active cooldown", () => {
    const now = Date.now();
    const deadline = new Date(now + 10 * 60 * 1000).toISOString();
    expect(canRedispatch(3, deadline, false, now)).toBe(false);
  });

  it("returns true when cooldown has expired and failure count is below threshold", () => {
    const now = Date.now();
    const deadline = new Date(now - 1000).toISOString();
    expect(canRedispatch(2, deadline, false, now)).toBe(true);
  });

  it("returns false when cooldown expired but failure count is at threshold", () => {
    const now = Date.now();
    const deadline = new Date(now - 1000).toISOString();
    expect(canRedispatch(3, deadline, false, now)).toBe(false);
  });

  it("returns true with zero failures and no cooldown", () => {
    expect(canRedispatch(0, null, false, Date.now())).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// recordFailure
// ---------------------------------------------------------------------------

describe("recordFailure", () => {
  const now = Date.now();

  it("increments counter when no window exists", () => {
    const [count, windowStart] = recordFailure(0, null, now);
    expect(count).toBe(1);
    expect(windowStart).toBe(now);
  });

  it("increments counter within active window", () => {
    const windowStart = now - 5 * 60 * 1000;
    const [count, newWindowStart] = recordFailure(1, windowStart, now);
    expect(count).toBe(2);
    expect(newWindowStart).toBe(windowStart);
  });

  it("resets counter when window has expired", () => {
    const oldWindowStart = now - 15 * 60 * 1000; // 15 min ago
    const [count, newWindowStart] = recordFailure(5, oldWindowStart, now);
    expect(count).toBe(1);
    expect(newWindowStart).toBe(now);
  });

  it("preserves window start on first failure", () => {
    const [count, windowStart] = recordFailure(0, null, now);
    expect(windowStart).toBe(now);
    expect(count).toBe(1);
  });

  it("reaches threshold after three failures in window", () => {
    const windowStart = now;
    const [c1] = recordFailure(0, null, now);
    const [c2] = recordFailure(c1, windowStart, now);
    const [c3] = recordFailure(c2, windowStart, now);
    expect(c3).toBe(3);
    expect(shouldTriggerCooldown(c3, windowStart, now)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resetFailures
// ---------------------------------------------------------------------------

describe("resetFailures", () => {
  it("returns zero count and null window", () => {
    const [count, windowStart] = resetFailures();
    expect(count).toBe(0);
    expect(windowStart).toBeNull();
  });
});
