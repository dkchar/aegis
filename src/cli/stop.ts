export const STOP_COMMAND_NAME = "stop";
export const STOP_COMMAND_REASONS = [
  "manual",
  "signal",
  "shutdown",
] as const;

export type StopCommandReason = (typeof STOP_COMMAND_REASONS)[number];

export interface StopCommandContract {
  command: typeof STOP_COMMAND_NAME;
  graceful_timeout_ms: number;
  reasons: readonly StopCommandReason[];
}

export function createStopCommandContract(
  gracefulTimeoutMs = 60_000,
): StopCommandContract {
  return {
    command: STOP_COMMAND_NAME,
    graceful_timeout_ms: gracefulTimeoutMs,
    reasons: STOP_COMMAND_REASONS,
  };
}
