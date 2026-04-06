/**
 * S10 contract seed — CooldownPolicy.
 *
 * Defines the cooldown rules for suppressing re-dispatch after repeated agent
 * failures.  SPECv2 §6.4 and §6.5:
 *   - three consecutive agent failures inside a ten-minute window trigger cooldown
 *   - cooldown suppresses immediate re-dispatch
 *   - cooldown state is persisted (in DispatchRecord.cooldownUntil)
 *   - manual restart by the user can override cooldown
 *
 * This module owns the decision logic only — no I/O.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Number of consecutive failures that trigger cooldown.
 * SPECv2 §6.4: "three consecutive agent failures"
 */
export const COOLDOWN_FAILURE_THRESHOLD = 3;

/**
 * Duration of the failure window in milliseconds.
 * SPECv2 §6.4: "inside a ten-minute window"
 */
export const COOLDOWN_WINDOW_MS = 10 * 60 * 1000;

/**
 * Default cooldown suppression duration in milliseconds.
 * Once triggered, re-dispatch is blocked for this period.
 * (30 minutes — long enough to avoid thrashing, short enough for manual recovery)
 */
export const COOLDOWN_SUPPRESSION_MS = 30 * 60 * 1000;

// ---------------------------------------------------------------------------
// Failure record
// ---------------------------------------------------------------------------

/**
 * A single failure event tracked within the cooldown window.
 */
export interface FailureRecord {
  /** ISO-8601 timestamp when the failure occurred. */
  timestamp: string;
  /** The caste that failed: oracle, titan, sentinel, or janus. */
  caste: string;
  /** Brief reason or error summary for diagnostics. */
  reason: string;
}

// ---------------------------------------------------------------------------
// CooldownPolicy — pure decision logic
// ---------------------------------------------------------------------------

/**
 * Evaluate whether a new failure should trigger cooldown.
 *
 * Checks if `consecutiveFailures` has reached the threshold and all failures
 * fall within the rolling window.
 *
 * @param consecutiveFailures - Current consecutive failure count.
 * @param failureWindowStartMs - Epoch ms of the first failure in the current window, or null if no window is active.
 * @param nowMs - Current epoch milliseconds (injected for testability).
 * @returns `true` if cooldown should be triggered.
 */
export function shouldTriggerCooldown(
  consecutiveFailures: number,
  failureWindowStartMs: number | null,
  nowMs: number = Date.now(),
): boolean {
  if (consecutiveFailures < COOLDOWN_FAILURE_THRESHOLD) {
    return false;
  }

  // If we have no window start, the counter alone triggers it.
  if (failureWindowStartMs === null) {
    return true;
  }

  // Check that the window has not expired.
  return (nowMs - failureWindowStartMs) <= COOLDOWN_WINDOW_MS;
}

/**
 * Compute the cooldown suppression deadline.
 *
 * @param nowMs - Current epoch milliseconds.
 * @returns ISO-8601 timestamp until which re-dispatch is suppressed.
 */
export function computeCooldownUntil(nowMs: number = Date.now()): string {
  return new Date(nowMs + COOLDOWN_SUPPRESSION_MS).toISOString();
}

/**
 * Check whether an issue is currently in cooldown.
 *
 * @param cooldownUntil - ISO-8601 timestamp from DispatchRecord.cooldownUntil, or null.
 * @param nowMs - Current epoch milliseconds (injected for testability).
 * @returns `true` if the issue is still within its cooldown window.
 */
export function isInCooldown(
  cooldownUntil: string | null,
  nowMs: number = Date.now(),
): boolean {
  if (cooldownUntil === null) {
    return false;
  }
  return nowMs < new Date(cooldownUntil).getTime();
}

/**
 * Check whether re-dispatch is allowed for an issue.
 *
 * Re-dispatch is allowed when:
 * - the issue is not in cooldown, OR
 * - the caller explicitly overrides cooldown (manual restart, SPECv2 §6.4)
 *
 * @param consecutiveFailures - Current consecutive failure count.
 * @param cooldownUntil - ISO-8601 timestamp or null.
 * @param overrideCooldown - If true, bypass cooldown check (manual restart).
 * @param nowMs - Current epoch milliseconds (injected for testability).
 * @returns `true` if re-dispatch may proceed.
 */
export function canRedispatch(
  consecutiveFailures: number,
  cooldownUntil: string | null,
  overrideCooldown: boolean = false,
  nowMs: number = Date.now(),
): boolean {
  if (overrideCooldown) {
    return true;
  }
  if (isInCooldown(cooldownUntil, nowMs)) {
    return false;
  }
  // If the failure count is at the threshold but cooldown expired, the window
  // should have been reset by the caller.  We still block here as a safety net
  // unless overrideCooldown is set.
  if (consecutiveFailures >= COOLDOWN_FAILURE_THRESHOLD) {
    return false;
  }
  return true;
}

/**
 * Record a failure and return the updated failure state.
 *
 * Returns a new state tuple (consecutiveFailures, failureWindowStartMs) —
 * never mutates inputs.
 *
 * @param consecutiveFailures - Current count.
 * @param failureWindowStartMs - Current window start epoch ms or null.
 * @param nowMs - Current epoch milliseconds.
 * @returns [newConsecutiveFailures, newFailureWindowStartMs]
 */
export function recordFailure(
  consecutiveFailures: number,
  failureWindowStartMs: number | null,
  nowMs: number = Date.now(),
): [number, number | null] {
  const newCount = consecutiveFailures + 1;
  const newWindowStart = failureWindowStartMs ?? nowMs;

  // If the window has expired, reset the counter.
  if (
    failureWindowStartMs !== null &&
    (nowMs - failureWindowStartMs) > COOLDOWN_WINDOW_MS
  ) {
    return [1, nowMs];
  }

  return [newCount, newWindowStart];
}

/**
 * Reset failure counters after a successful completion or manual reset.
 *
 * @returns [0, null] — fresh state.
 */
export function resetFailures(): [number, null] {
  return [0, null];
}
