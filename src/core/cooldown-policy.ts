/**
 * S10 — CooldownPolicy.
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

export const COOLDOWN_FAILURE_THRESHOLD = 3;
export const COOLDOWN_WINDOW_MS = 10 * 60 * 1000;
export const COOLDOWN_SUPPRESSION_MS = 30 * 60 * 1000;

export function shouldTriggerCooldown(
  consecutiveFailures: number,
  failureWindowStartMs: number | null,
  nowMs: number = Date.now(),
): boolean {
  if (consecutiveFailures < COOLDOWN_FAILURE_THRESHOLD) {
    return false;
  }
  if (failureWindowStartMs === null) {
    return true;
  }
  return (nowMs - failureWindowStartMs) <= COOLDOWN_WINDOW_MS;
}

export function computeCooldownUntil(nowMs: number = Date.now()): string {
  return new Date(nowMs + COOLDOWN_SUPPRESSION_MS).toISOString();
}

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
 * - the issue is not in cooldown, AND
 * - the consecutive failure count is below the threshold, OR
 * - the caller explicitly overrides cooldown (manual restart, SPECv2 §6.4)
 *
 * Note: After cooldown expires, re-dispatch is still blocked if
 * consecutiveFailures >= COOLDOWN_FAILURE_THRESHOLD (3). This is a safety
 * net — the caller must explicitly reset failures (via a successful run or
 * manual intervention) before re-dispatch is allowed. SPECv2 §6.4 says
 * "cooldown suppresses immediate re-dispatch" but does not specify
 * post-cooldown behavior; this implementation errs on the side of caution.
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
  if (consecutiveFailures >= COOLDOWN_FAILURE_THRESHOLD) {
    return false;
  }
  return true;
}

export function recordFailure(
  consecutiveFailures: number,
  failureWindowStartMs: number | null,
  nowMs: number = Date.now(),
): [number, number | null] {
  const newCount = consecutiveFailures + 1;
  const newWindowStart = failureWindowStartMs ?? nowMs;

  if (
    failureWindowStartMs !== null &&
    (nowMs - failureWindowStartMs) > COOLDOWN_WINDOW_MS
  ) {
    return [1, nowMs];
  }

  return [newCount, newWindowStart];
}

export function resetFailures(): [number, null] {
  return [0, null];
}
