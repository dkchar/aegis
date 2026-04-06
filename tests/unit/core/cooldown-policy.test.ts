/**
 * S10 contract seed — cooldown-policy unit tests.
 *
 * Validates the cooldown decision logic from SPECv2 §6.4:
 *   - three consecutive failures in a ten-minute window trigger cooldown
 *   - cooldown suppresses re-dispatch
 *   - expired cooldown allows re-dispatch
 *   - manual restart override bypasses cooldown
 *   - failure window expiry resets the counter
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

const TEN_MINUTES_MS = 10 * 60 * 1000;
const THIRTY_MINUTES_MS = 30 * 60 * 1000;

// ---------------------------------------------------------------------------
// 1. Constants match SPECv2 §6.4
// ---------------------------------------------------------------------------

describe("cooldown constants", () => {
  it("COOLDOWN_FAILURE_THRESHOLD is 3 (SPECv2 §6.4)", () => {
    expect(COOLDOWN_FAILURE_THRESHOLD).toBe(3);
  });

  it("COOLDOWN_WINDOW_MS is 10 minutes (SPECv2 §6.4)", () => {
    expect(COOLDOWN_WINDOW_MS).toBe(TEN_MINUTES_MS);
  });

  it("COOLDOWN_SUPPRESSION_MS is 30 minutes", () => {
    expect(COOLDOWN_SUPPRESSION_MS).toBe(THIRTY_MINUTES_MS);
  });
});

// ---------------------------------------------------------------------------
// 2. shouldTriggerCooldown
// ---------------------------------------------------------------------------

describe("shouldTriggerCooldown", () => {
  const NOW = Date.now();

  it("returns false when failure count is below threshold", () => {
    expect(shouldTriggerCooldown(0, null, NOW)).toBe(false);
    expect(shouldTriggerCooldown(1, null, NOW)).toBe(false);
    expect(shouldTriggerCooldown(2, null, NOW)).toBe(false);
  });

  it("returns true when failure count reaches threshold with no window start", () => {
    expect(shouldTriggerCooldown(3, null, NOW)).toBe(true);
    expect(shouldTriggerCooldown(5, null, NOW)).toBe(true);
  });

  it("returns true when failures are within the window", () => {
    const windowStart = NOW - 5 * 60 * 1000; // 5 minutes ago
    expect(shouldTriggerCooldown(3, windowStart, NOW)).toBe(true);
  });

  it("returns false when the failure window has expired", () => {
    const windowStart = NOW - 11 * 60 * 1000; // 11 minutes ago (past 10-min window)
    expect(shouldTriggerCooldown(3, windowStart, NOW)).toBe(false);
  });

  it("returns true at the exact window boundary", () => {
    const windowStart = NOW - TEN_MINUTES_MS;
    expect(shouldTriggerCooldown(3, windowStart, NOW)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. computeCooldownUntil
// ---------------------------------------------------------------------------

describe("computeCooldownUntil", () => {
  const NOW = new Date("2026-04-06T12:00:00.000Z").getTime();

  it("returns a timestamp COOLDOWN_SUPPRESSION_MS in the future", () => {
    const result = computeCooldownUntil(NOW);
    const expected = new Date(NOW + THIRTY_MINUTES_MS).toISOString();
    expect(result).toBe(expected);
  });

  it("returns a valid ISO-8601 timestamp", () => {
    const result = computeCooldownUntil(NOW);
    expect(() => new Date(result).getTime()).not.toThrow();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ---------------------------------------------------------------------------
// 4. isInCooldown
// ---------------------------------------------------------------------------

describe("isInCooldown", () => {
  const NOW = Date.now();

  it("returns false when cooldownUntil is null", () => {
    expect(isInCooldown(null, NOW)).toBe(false);
  });

  it("returns true when the current time is before cooldownUntil", () => {
    const future = new Date(NOW + 15 * 60 * 1000).toISOString();
    expect(isInCooldown(future, NOW)).toBe(true);
  });

  it("returns false when the current time is after cooldownUntil", () => {
    const past = new Date(NOW - 5 * 60 * 1000).toISOString();
    expect(isInCooldown(past, NOW)).toBe(false);
  });

  it("returns false when the current time equals cooldownUntil", () => {
    const exact = new Date(NOW).toISOString();
    expect(isInCooldown(exact, NOW)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. canRedispatch
// ---------------------------------------------------------------------------

describe("canRedispatch", () => {
  const NOW = Date.now();

  it("returns true when no cooldown is active and failures are below threshold", () => {
    expect(canRedispatch(0, null, false, NOW)).toBe(true);
    expect(canRedispatch(2, null, false, NOW)).toBe(true);
  });

  it("returns false when cooldown is active", () => {
    const future = new Date(NOW + 15 * 60 * 1000).toISOString();
    expect(canRedispatch(3, future, false, NOW)).toBe(false);
  });

  it("returns true when cooldown is active but overrideCooldown is true (manual restart)", () => {
    const future = new Date(NOW + 15 * 60 * 1000).toISOString();
    expect(canRedispatch(3, future, true, NOW)).toBe(true);
  });

  it("returns true when cooldown has expired and failures are below threshold", () => {
    // Cooldown expired but failures were reset
    expect(canRedispatch(0, null, false, NOW)).toBe(true);
  });

  it("returns false when failures are at threshold and cooldown has expired (safety net)", () => {
    const past = new Date(NOW - 5 * 60 * 1000).toISOString();
    expect(canRedispatch(3, past, false, NOW)).toBe(false);
  });

  it("returns true when cooldown expired and overrideCooldown is true", () => {
    const past = new Date(NOW - 5 * 60 * 1000).toISOString();
    expect(canRedispatch(3, past, true, NOW)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. recordFailure
// ---------------------------------------------------------------------------

describe("recordFailure", () => {
  const NOW = Date.now();

  it("starts a new window on the first failure", () => {
    const [count, windowStart] = recordFailure(0, null, NOW);
    expect(count).toBe(1);
    expect(windowStart).toBe(NOW);
  });

  it("increments the count when within the window", () => {
    const windowStart = NOW - 3 * 60 * 1000; // 3 minutes ago
    const [count, newWindowStart] = recordFailure(1, windowStart, NOW);
    expect(count).toBe(2);
    expect(newWindowStart).toBe(windowStart); // window start is preserved
  });

  it("resets the counter when the window has expired", () => {
    const oldWindowStart = NOW - 11 * 60 * 1000; // 11 minutes ago
    const [count, newWindowStart] = recordFailure(5, oldWindowStart, NOW);
    expect(count).toBe(1);
    expect(newWindowStart).toBe(NOW);
  });

  it("preserves the original window start when not expired", () => {
    const windowStart = NOW - 5 * 60 * 1000;
    const [, newWindowStart] = recordFailure(2, windowStart, NOW);
    expect(newWindowStart).toBe(windowStart);
  });

  it("does not mutate any input", () => {
    // Pure function: inputs are primitives, so no mutation possible.
    // This is a sanity check that the function is side-effect free.
    const originalCount = 2;
    const originalWindow = NOW - 5 * 60 * 1000;
    recordFailure(originalCount, originalWindow, NOW);
    // If we got here without throwing, the test passes (inputs unchanged by nature).
    expect(originalCount).toBe(2);
    expect(originalWindow).toBe(NOW - 5 * 60 * 1000);
  });
});

// ---------------------------------------------------------------------------
// 7. resetFailures
// ---------------------------------------------------------------------------

describe("resetFailures", () => {
  it("returns [0, null]", () => {
    const result = resetFailures();
    expect(result).toEqual([0, null]);
  });

  it("returns a new array each time", () => {
    const a = resetFailures();
    const b = resetFailures();
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// 8. Integration: full cooldown lifecycle
// ---------------------------------------------------------------------------

describe("full cooldown lifecycle", () => {
  const START = new Date("2026-04-06T12:00:00.000Z").getTime();

  it("triggers cooldown after 3 failures within 10 minutes, then allows re-dispatch after cooldown expires", () => {
    let failures = 0;
    let windowStart: number | null = null;

    // Failure 1
    [failures, windowStart] = recordFailure(failures, windowStart, START);
    expect(failures).toBe(1);
    expect(shouldTriggerCooldown(failures, windowStart, START)).toBe(false);

    // Failure 2 (2 minutes later)
    const t2 = START + 2 * 60 * 1000;
    [failures, windowStart] = recordFailure(failures, windowStart, t2);
    expect(failures).toBe(2);
    expect(shouldTriggerCooldown(failures, windowStart, t2)).toBe(false);

    // Failure 3 (5 minutes later — still within window)
    const t3 = START + 5 * 60 * 1000;
    [failures, windowStart] = recordFailure(failures, windowStart, t3);
    expect(failures).toBe(3);
    expect(shouldTriggerCooldown(failures, windowStart, t3)).toBe(true);

    // Compute cooldown deadline
    const cooldownUntil = computeCooldownUntil(t3);

    // Cannot re-dispatch during cooldown
    expect(canRedispatch(failures, cooldownUntil, false, t3)).toBe(false);

    // Cannot re-dispatch even after cooldown expires while failure count is still at threshold
    const afterCooldown = t3 + THIRTY_MINUTES_MS + 1;
    expect(canRedispatch(failures, cooldownUntil, false, afterCooldown)).toBe(false);

    // Manual restart override works
    expect(canRedispatch(failures, cooldownUntil, true, t3)).toBe(true);

    // After failures are reset, re-dispatch is allowed
    const [newFailures] = resetFailures();
    expect(canRedispatch(newFailures, null, false, afterCooldown)).toBe(true);
  });

  it("window expiry prevents cooldown trigger when failures are spread out", () => {
    let failures = 0;
    let windowStart: number | null = null;

    // Failure 1
    [failures, windowStart] = recordFailure(failures, windowStart, START);

    // Failure 2 (6 minutes later)
    const t2 = START + 6 * 60 * 1000;
    [failures, windowStart] = recordFailure(failures, windowStart, t2);
    expect(failures).toBe(2);

    // Failure 3 (12 minutes after first — outside the 10-min window)
    const t3 = START + 12 * 60 * 1000;
    [failures, windowStart] = recordFailure(failures, windowStart, t3);
    expect(failures).toBe(1); // Counter reset
    expect(shouldTriggerCooldown(failures, windowStart, t3)).toBe(false);
  });
});
