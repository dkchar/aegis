const PHASE_D_FAILURE_COOLDOWN_MS = 30_000;
const MAX_RETRYABLE_OPERATIONAL_FAILURES = 3;
const MAX_RETRYABLE_SENTINEL_OPERATIONAL_FAILURES = 1;

export type OperationalFailureKind =
  | "provider_usage_limit"
  | "runtime_failure";

export function calculateFailureCooldown(timestamp: string) {
  const timestampMs = Date.parse(timestamp);
  const baseMs = Number.isFinite(timestampMs) ? timestampMs : Date.now();
  return new Date(baseMs + PHASE_D_FAILURE_COOLDOWN_MS).toISOString();
}

export function resolveFailureWindowStartMs(timestamp: string) {
  const timestampMs = Date.parse(timestamp);
  return Number.isFinite(timestampMs) ? timestampMs : Date.now();
}

export function shouldEscalateSentinelOperationalFailure(nextConsecutiveFailures: number) {
  return nextConsecutiveFailures > MAX_RETRYABLE_SENTINEL_OPERATIONAL_FAILURES;
}

export function hasExhaustedOperationalRetries(consecutiveFailures: number) {
  return consecutiveFailures >= MAX_RETRYABLE_OPERATIONAL_FAILURES;
}

export function isProviderUsageLimitError(message: string | undefined | null) {
  if (!message) {
    return false;
  }

  const normalized = message.toLowerCase();
  return normalized.includes("usage limit")
    || normalized.includes("rate limit")
    || normalized.includes("quota")
    || normalized.includes("try again at");
}

export function resolveNextOperationalFailureCount(
  currentConsecutiveFailures: number,
  errorMessage?: string | null,
) {
  const next = currentConsecutiveFailures + 1;
  return isProviderUsageLimitError(errorMessage)
    ? Math.max(next, MAX_RETRYABLE_OPERATIONAL_FAILURES)
    : next;
}

export function classifyOperationalFailure(errorMessage?: string | null): OperationalFailureKind {
  return isProviderUsageLimitError(errorMessage)
    ? "provider_usage_limit"
    : "runtime_failure";
}
