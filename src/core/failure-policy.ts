import type { DispatchRecord, DispatchStage } from "./dispatch-state.js";

const FAILURE_COOLDOWN_MS = 30_000;
const MAX_RETRYABLE_OPERATIONAL_FAILURES = 3;
const MAX_RETRYABLE_SENTINEL_OPERATIONAL_FAILURES = 1;

export type OperationalFailureKind =
  | "provider_usage_limit"
  | "runtime_failure";

function parseTimestampMs(timestamp: string) {
  const timestampMs = Date.parse(timestamp);
  return Number.isFinite(timestampMs) ? timestampMs : Date.now();
}

export function calculateFailureCooldown(timestamp: string) {
  return new Date(parseTimestampMs(timestamp) + FAILURE_COOLDOWN_MS).toISOString();
}

export function resolveFailureWindowStartMs(timestamp: string) {
  return parseTimestampMs(timestamp);
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

/** Provider quota errors exhaust retries immediately instead of burning more quota. */
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

export interface OperationalFailureOptions {
  timestamp: string;
  /** Stage after the failure; defaults to `failed_operational`. */
  stage?: DispatchStage;
  errorMessage?: string | null;
  /** Apply the retry cooldown; defaults to true. */
  cooldown?: boolean;
  failureTranscriptRef?: string | null;
}

/** Returns a new record with failure counters, classification, and cooldown applied. */
export function applyOperationalFailure(
  record: DispatchRecord,
  options: OperationalFailureOptions,
): DispatchRecord {
  return {
    ...record,
    stage: options.stage ?? "failed_operational",
    runningAgent: null,
    failureCount: record.failureCount + 1,
    consecutiveFailures: resolveNextOperationalFailureCount(record.consecutiveFailures, options.errorMessage),
    operationalFailureKind: classifyOperationalFailure(options.errorMessage),
    failureWindowStartMs: record.failureWindowStartMs ?? resolveFailureWindowStartMs(options.timestamp),
    cooldownUntil: options.cooldown === false ? null : calculateFailureCooldown(options.timestamp),
    ...(options.failureTranscriptRef !== undefined
      ? { failureTranscriptRef: options.failureTranscriptRef }
      : {}),
    updatedAt: options.timestamp,
  };
}

/**
 * Sentinel failures retry at the review layer (`implemented` + cooldown) once;
 * repeated failures escalate to `failed_operational` so triage routes Titan.
 */
export function applySentinelOperationalFailure(
  record: DispatchRecord,
  options: Omit<OperationalFailureOptions, "stage" | "cooldown">,
): DispatchRecord {
  const nextConsecutiveFailures = resolveNextOperationalFailureCount(
    record.consecutiveFailures,
    options.errorMessage,
  );
  return applyOperationalFailure(record, {
    ...options,
    stage: shouldEscalateSentinelOperationalFailure(nextConsecutiveFailures)
      ? "failed_operational"
      : "implemented",
  });
}
