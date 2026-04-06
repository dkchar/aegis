/**
 * S10 contract seed — Monitor module.
 *
 * The Monitor observes running sessions in real time and enforces budgets.
 * SPECv2 §9.6:
 *   - subscribe to session events
 *   - track turns, tokens, elapsed time, tool activity, and last-progress timestamp
 *   - track per-issue exact cost when available, otherwise credits/quota/proxy budget usage
 *   - push events to Olympus via SSE
 *   - inject steering nudges when agents appear stuck
 *   - abort sessions when limits are exceeded
 *   - suppress optional escalations (Janus) when budget guardrails would be violated
 *
 * Canonical default thresholds (SPECv2 §9.6):
 *   - stuck warning: 90 seconds without tool progress
 *   - stuck kill: 150 seconds without tool progress
 *   - per-issue exact-cost warning: $3.00 when metering=exact_usd
 *   - daily exact-cost warning: $10.00 when metering=exact_usd
 *   - daily exact-cost hard stop: $20.00 when metering=exact_usd
 *   - subscription quota warning floor: 35% remaining when metering=quota
 *   - subscription quota hard-stop floor: 20% remaining when metering=quota
 *   - unknown-metering posture: no autonomous Janus, no autonomous complex-work dispatch
 *
 * Canonical stuck rules (SPECv2 §9.6):
 *   - no tool call for warning threshold → steering nudge
 *   - no tool call for kill threshold → abort
 *   - repeating the same tool call 3+ times → steering nudge
 *   - turn budget exceeded → abort
 *   - token budget exceeded → abort
 *   - daily hard stop exceeded / quota floor crossed / credit floor crossed → refuse new autonomous dispatch
 *
 * This module defines the interface and observable state.  Implementation
 * (event-loop wiring, SSE publishing, actual abort calls) belongs in the lanes.
 */

import type { AgentEvent } from "../runtime/agent-events.js";
import type { AgentHandle, AgentStats } from "../runtime/agent-runtime.js";
import type {
  AuthMode,
  MeteringCapability,
  NormalizedBudgetStatus,
} from "../runtime/normalize-stats.js";
import type { BudgetLimit } from "../config/schema.js";

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

/** Default thresholds for budget enforcement (SPECv2 §9.6). */
export interface MonitorThresholds {
  /** Seconds without tool progress before emitting a stuck warning. Default: 90 */
  stuckWarningSec: number;
  /** Seconds without tool progress before aborting the session. Default: 150 */
  stuckKillSec: number;
  /** Maximum repetitions of the same tool before nudging. Default: 3 */
  repeatedToolThreshold: number;
  /** Per-issue exact-cost warning in USD when metering=exact_usd. Default: 3.00 */
  perIssueCostWarningUsd: number | null;
  /** Daily exact-cost warning in USD when metering=exact_usd. Default: 10.00 */
  dailyCostWarningUsd: number | null;
  /** Daily exact-cost hard stop in USD when metering=exact_usd. Default: 20.00 */
  dailyHardStopUsd: number | null;
  /** Subscription quota warning floor percentage. Default: 35 */
  quotaWarningFloorPct: number | null;
  /** Subscription quota hard-stop floor percentage. Default: 20 */
  quotaHardStopFloorPct: number | null;
}

/** Default thresholds from SPECv2 §9.6. */
export const DEFAULT_MONITOR_THRESHOLDS: MonitorThresholds = {
  stuckWarningSec: 90,
  stuckKillSec: 150,
  repeatedToolThreshold: 3,
  perIssueCostWarningUsd: 3.0,
  dailyCostWarningUsd: 10.0,
  dailyHardStopUsd: 20.0,
  quotaWarningFloorPct: 35,
  quotaHardStopFloorPct: 20,
};

// ---------------------------------------------------------------------------
// Session tracking state
// ---------------------------------------------------------------------------

/**
 * Real-time tracking state for a single active session.
 * The monitor maintains one of these per running agent.
 */
export interface SessionTracker {
  /** Beads issue ID this session is working on. */
  issueId: string;
  /** Caste of the running agent. */
  caste: string;
  /** Runtime agent handle — used for abort/steer/getStats. */
  handle: AgentHandle;
  /** Latest stats snapshot from the session. */
  latestStats: AgentStats | null;
  /** Latest usage observation from the runtime, if available. */
  latestObservation: {
    auth_mode: AuthMode;
    metering: MeteringCapability;
    exact_cost_usd?: number;
    quota_remaining_pct?: number;
  } | null;
  /** Epoch ms timestamp of the last tool-use event. */
  lastToolProgressMs: number | null;
  /** Epoch ms timestamp when the session started. */
  sessionStartMs: number;
  /** Rolling list of recent tool calls (for repeated-tool detection). */
  recentToolCalls: string[];
  /** Whether a steering nudge has already been sent for the current stuck episode. */
  stuckNudgeSent: boolean;
  /** Whether the session has been aborted by the monitor. */
  aborted: boolean;
}

// ---------------------------------------------------------------------------
// Monitor events (outbound to SSE bus)
// ---------------------------------------------------------------------------

/** Event types the monitor emits to the SSE bus. */
export type MonitorEventType =
  | "stuck_warning"
  | "stuck_abort"
  | "budget_warning"
  | "budget_abort"
  | "daily_hard_stop"
  | "quota_floor_warning"
  | "quota_floor_abort"
  | "repeated_tool_nudge"
  | "session_aborted_by_monitor";

/**
 * An outbound event from the monitor to the SSE bus.
 * The SSE stream pushes these to Olympus for visibility.
 */
export interface MonitorEvent {
  type: MonitorEventType;
  /** ISO-8601 timestamp. */
  timestamp: string;
  /** Issue ID the event relates to. */
  issueId: string;
  /** Human-readable description of what happened. */
  message: string;
  /** Additional context (e.g. current cost, remaining quota). */
  details?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Budget gate decisions
// ---------------------------------------------------------------------------

/**
 * Result of checking whether autonomous dispatch is allowed globally.
 * When any daily or quota hard-stop threshold is crossed, the monitor
 * refuses to start new autonomous sessions until a human reviews.
 */
export interface BudgetGateResult {
  /** Whether new autonomous dispatch is allowed. */
  allowed: boolean;
  /** If not allowed, the reason code. */
  reason: string | null;
  /** Current normalized budget status for diagnostics. */
  status: NormalizedBudgetStatus | null;
}

// ---------------------------------------------------------------------------
// Monitor interface
// ---------------------------------------------------------------------------

/**
 * The Monitor observes running sessions and enforces budget/stuck rules.
 *
 * Responsibilities (SPECv2 §9.6):
 *   - subscribe to session events via AgentHandle.subscribe()
 *   - track per-session progress and budget consumption
 *   - emit steering nudges when agents appear stuck
 *   - abort sessions that exceed budget or stuck thresholds
 *   - push MonitorEvents to the SSE bus for Olympus visibility
 *   - gate new autonomous dispatch when daily/quotas are exhausted
 *
 * Implementations must:
 *   - run enforcement on event boundaries, not only on outer poll ticks
 *   - never store telemetry in Mnemosyne
 *   - make all decisions visible to the user
 */
export interface Monitor {
  /**
   * Begin observing a session.  The caller passes the AgentHandle and the
   * monitor subscribes to events internally.
   *
   * @param issueId - Beads issue ID.
   * @param caste - Agent caste name.
   * @param handle - Live agent handle from the runtime.
   * @param budget - Budget hard limits for this caste.
   * @param thresholds - Monitor-specific thresholds (defaults applied if omitted).
   * @returns A SessionTracker that the caller can query for current state.
   */
  startObserving(
    issueId: string,
    caste: string,
    handle: AgentHandle,
    budget: BudgetLimit,
    thresholds?: Partial<MonitorThresholds>,
  ): SessionTracker;

  /**
   * Stop observing a session and clean up subscriptions.
   * Called by the Reaper after session termination.
   *
   * @param issueId - Beads issue ID to stop observing.
   */
  stopObserving(issueId: string): void;

  /**
   * Check the global budget gate — whether new autonomous dispatch is allowed.
   * This is called by the triage/dispatch loop before spawning new agents.
   *
   * @returns BudgetGateResult indicating if dispatch may proceed.
   */
  checkBudgetGate(): BudgetGateResult;

  /**
   * Record that the daily cost bucket has been reset (e.g. at UTC midnight).
   * This clears any daily hard-stop suppression.
   */
  resetDailyBudget(): void;

  /**
   * Return the current list of active session trackers (for diagnostics/Olympus).
   */
  getActiveSessions(): ReadonlyMap<string, SessionTracker>;

  /**
   * Return any monitor events that have been emitted since the last call.
   * The SSE stream consumes these to push live updates to Olympus.
   */
  drainEvents(): MonitorEvent[];
}

// ---------------------------------------------------------------------------
// Pure helper functions (used by implementations)
// ---------------------------------------------------------------------------

/**
 * Check whether a session appears stuck based on elapsed time since last tool progress.
 *
 * @param lastToolProgressMs - Epoch ms of the last tool-use event, or null.
 * @param nowMs - Current epoch milliseconds.
 * @param thresholds - Monitor thresholds.
 * @returns "ok" | "warning" | "kill"
 */
export function assessStuckState(
  lastToolProgressMs: number | null,
  nowMs: number = Date.now(),
  thresholds: MonitorThresholds = DEFAULT_MONITOR_THRESHOLDS,
): "ok" | "warning" | "kill" {
  if (lastToolProgressMs === null) {
    return "ok";
  }
  const elapsedSec = (nowMs - lastToolProgressMs) / 1000;
  if (elapsedSec >= thresholds.stuckKillSec) {
    return "kill";
  }
  if (elapsedSec >= thresholds.stuckWarningSec) {
    return "warning";
  }
  return "ok";
}

/**
 * Check whether the same tool has been called repeatedly beyond the threshold.
 *
 * @param recentToolCalls - Rolling list of recent tool names.
 * @param thresholds - Monitor thresholds.
 * @returns `true` if the same tool was called 3+ times in a row.
 */
export function hasRepeatedToolCalls(
  recentToolCalls: string[],
  thresholds: MonitorThresholds = DEFAULT_MONITOR_THRESHOLDS,
): boolean {
  if (recentToolCalls.length < thresholds.repeatedToolThreshold) {
    return false;
  }
  const last = recentToolCalls[recentToolCalls.length - 1];
  const window = recentToolCalls.slice(-thresholds.repeatedToolThreshold);
  return window.every((t) => t === last);
}

/**
 * Check whether daily exact-cost hard stop has been reached.
 *
 * @param dailySpendUsd - Cumulative daily spend in USD.
 * @param thresholds - Monitor thresholds.
 * @returns `true` if the daily hard stop is exceeded.
 */
export function isDailyHardStopExceeded(
  dailySpendUsd: number | null,
  thresholds: MonitorThresholds = DEFAULT_MONITOR_THRESHOLDS,
): boolean {
  if (dailySpendUsd === null || thresholds.dailyHardStopUsd === null) {
    return false;
  }
  return dailySpendUsd >= thresholds.dailyHardStopUsd;
}

/**
 * Check whether quota floor has been crossed (subscription metering).
 *
 * @param quotaRemainingPct - Remaining quota percentage.
 * @param thresholds - Monitor thresholds.
 * @returns "ok" | "warning" | "abort"
 */
export function assessQuotaFloor(
  quotaRemainingPct: number | undefined,
  thresholds: MonitorThresholds = DEFAULT_MONITOR_THRESHOLDS,
): "ok" | "warning" | "abort" {
  if (quotaRemainingPct === undefined) {
    return "ok";
  }
  if (
    thresholds.quotaHardStopFloorPct !== null &&
    quotaRemainingPct <= thresholds.quotaHardStopFloorPct
  ) {
    return "abort";
  }
  if (
    thresholds.quotaWarningFloorPct !== null &&
    quotaRemainingPct <= thresholds.quotaWarningFloorPct
  ) {
    return "warning";
  }
  return "ok";
}

/**
 * Whether autonomous Janus dispatch is allowed under current budget posture.
 * SPECv2 §9.6: unknown-metering posture → no autonomous Janus.
 *
 * @param metering - Current metering capability.
 * @returns `true` if autonomous Janus is permitted.
 */
export function canAutoDispatchJanus(metering: MeteringCapability): boolean {
  return metering !== "unknown";
}
