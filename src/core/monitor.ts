/**
 * S10 Lane A — Monitor implementation.
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
 * Lane A responsibilities:
 *   - event-driven budget enforcement on AgentEvent stream boundaries
 *   - stuck detection (90s warning, 150s kill per contract)
 *   - repeated tool call detection (3+ same call → steering nudge)
 *   - turn budget exceeded → abort
 *   - token budget exceeded → abort
 *   - daily hard stop exceeded, quota floor crossed, credit floor crossed → refuse new autonomous dispatch
 *   - live stats updates via SSE events
 *   - budget enforcement works with different metering modes
 */

import type { AgentEvent } from "../runtime/agent-events.js";
import type { AgentHandle } from "../runtime/agent-runtime.js";
import type { BudgetLimit } from "../config/schema.js";
import type {
  AuthMode,
  MeteringCapability,
  NormalizedBudgetStatus,
  UsageObservation,
} from "../runtime/normalize-stats.js";
import { normalizeStats } from "../runtime/normalize-stats.js";

// ---------------------------------------------------------------------------
// Interfaces (from S10 contract seed)
// ---------------------------------------------------------------------------

/** Default thresholds for budget enforcement (SPECv2 §9.6). */
export interface MonitorThresholds {
  stuckWarningSec: number;
  stuckKillSec: number;
  repeatedToolThreshold: number;
  perIssueCostWarningUsd: number | null;
  dailyCostWarningUsd: number | null;
  dailyHardStopUsd: number | null;
  quotaWarningFloorPct: number | null;
  quotaHardStopFloorPct: number | null;
}

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

/** Real-time tracking state for a single active session. */
export interface SessionTracker {
  issueId: string;
  caste: string;
  handle: AgentHandle;
  latestStats: {
    input_tokens: number;
    output_tokens: number;
    session_turns: number;
    wall_time_sec: number;
    active_context_pct?: number;
  } | null;
  latestObservation: {
    auth_mode: AuthMode;
    metering: MeteringCapability;
    exact_cost_usd?: number;
    quota_remaining_pct?: number;
    credits_remaining?: number;
  } | null;
  lastToolProgressMs: number | null;
  sessionStartMs: number;
  recentToolCalls: string[];
  stuckNudgeSent: boolean;
  aborted: boolean;
}

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

export interface MonitorEvent {
  type: MonitorEventType;
  timestamp: string;
  issueId: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface BudgetGateResult {
  allowed: boolean;
  reason: string | null;
  status: NormalizedBudgetStatus | null;
}

export interface Monitor {
  startObserving(
    issueId: string,
    caste: string,
    handle: AgentHandle,
    budget: BudgetLimit,
    thresholds?: Partial<MonitorThresholds>,
  ): SessionTracker;
  stopObserving(issueId: string): void;
  checkBudgetGate(): BudgetGateResult;
  resetDailyBudget(): void;
  getActiveSessions(): ReadonlyMap<string, SessionTracker>;
  drainEvents(): MonitorEvent[];
}

// ---------------------------------------------------------------------------
// Pure helper functions (SPECv2 §9.6)
// ---------------------------------------------------------------------------

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

export function isDailyHardStopExceeded(
  dailySpendUsd: number | null,
  thresholds: MonitorThresholds = DEFAULT_MONITOR_THRESHOLDS,
): boolean {
  if (dailySpendUsd === null || thresholds.dailyHardStopUsd === null) {
    return false;
  }
  return dailySpendUsd >= thresholds.dailyHardStopUsd;
}

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

export function canAutoDispatchJanus(metering: MeteringCapability): boolean {
  return metering !== "unknown";
}

// ---------------------------------------------------------------------------
// MonitorImpl
// ---------------------------------------------------------------------------

interface MutableSessionTracker extends SessionTracker {
  _unsubscribe: (() => void) | null;
  _stuckTimer: ReturnType<typeof setInterval> | null;
  _budgetWarningEmitted: boolean;
  _repeatedToolNudgeEmitted: boolean;
}

interface DailyBudgetState {
  spendUsd: number | null;
  quotaRemainingPct: number | null;
  creditsRemaining: number | null;
  metering: MeteringCapability;
  hardStopTriggered: boolean;
}

export class MonitorImpl implements Monitor {
  private trackers: Map<string, MutableSessionTracker> = new Map();
  private events: MonitorEvent[] = [];
  private dailyBudget: DailyBudgetState;
  private nowMs: () => number;
  private _stuckCheckIntervalMs: number;

  constructor(options?: { nowMs?: () => number; stuckCheckIntervalMs?: number }) {
    this.nowMs = options?.nowMs ?? (() => Date.now());
    this._stuckCheckIntervalMs = options?.stuckCheckIntervalMs ?? 1000;
    this.dailyBudget = {
      spendUsd: null,
      quotaRemainingPct: null,
      creditsRemaining: null,
      metering: "unknown",
      hardStopTriggered: false,
    };
  }

  // -----------------------------------------------------------------------
  // Public: Monitor interface
  // -----------------------------------------------------------------------

  startObserving(
    issueId: string,
    caste: string,
    handle: AgentHandle,
    budget: BudgetLimit,
    thresholds?: Partial<MonitorThresholds>,
  ): SessionTracker {
    const mergedThresholds = { ...DEFAULT_MONITOR_THRESHOLDS, ...thresholds };
    const now = this.nowMs();

    const tracker: MutableSessionTracker = {
      issueId,
      caste,
      handle,
      latestStats: null,
      latestObservation: null,
      lastToolProgressMs: null,
      sessionStartMs: now,
      recentToolCalls: [],
      stuckNudgeSent: false,
      aborted: false,
      _unsubscribe: null,
      _stuckTimer: null,
      _budgetWarningEmitted: false,
      _repeatedToolNudgeEmitted: false,
    };

    const unsubscribe = handle.subscribe((event: AgentEvent) => {
      this.handleEvent(tracker, event, budget, mergedThresholds);
    });
    tracker._unsubscribe = unsubscribe;

    const stuckTimer = setInterval(() => {
      this.checkStuck(tracker, mergedThresholds);
    }, this._stuckCheckIntervalMs);
    tracker._stuckTimer = stuckTimer;

    this.trackers.set(issueId, tracker);

    return tracker;
  }

  stopObserving(issueId: string): void {
    const tracker = this.trackers.get(issueId);
    if (!tracker) return;

    if (tracker._unsubscribe) {
      tracker._unsubscribe();
      tracker._unsubscribe = null;
    }
    if (tracker._stuckTimer) {
      clearInterval(tracker._stuckTimer);
      tracker._stuckTimer = null;
    }
    this.trackers.delete(issueId);
  }

  checkBudgetGate(): BudgetGateResult {
    const db = this.dailyBudget;

    // Quota floor crossed (checked before generic hard stop to give specific reason)
    if (
      db.quotaRemainingPct !== null &&
      DEFAULT_MONITOR_THRESHOLDS.quotaHardStopFloorPct !== null &&
      db.quotaRemainingPct <= DEFAULT_MONITOR_THRESHOLDS.quotaHardStopFloorPct
    ) {
      return {
        allowed: false,
        reason: "quota_floor_exceeded",
        status: this.buildGateStatus(),
      };
    }

    // Credits floor crossed
    if (db.creditsRemaining !== null && db.creditsRemaining <= 0) {
      return {
        allowed: false,
        reason: "credits_floor_exceeded",
        status: this.buildGateStatus(),
      };
    }

    // Daily hard stop exceeded
    if (db.hardStopTriggered || isDailyHardStopExceeded(db.spendUsd)) {
      return {
        allowed: false,
        reason: "daily_hard_stop_exceeded",
        status: this.buildGateStatus(),
      };
    }

    return { allowed: true, reason: null, status: null };
  }

  resetDailyBudget(): void {
    this.dailyBudget = {
      spendUsd: null,
      quotaRemainingPct: null,
      creditsRemaining: null,
      metering: this.dailyBudget.metering,
      hardStopTriggered: false,
    };
  }

  getActiveSessions(): ReadonlyMap<string, SessionTracker> {
    return this.trackers;
  }

  drainEvents(): MonitorEvent[] {
    const pending = this.events;
    this.events = [];
    return pending;
  }

  // -----------------------------------------------------------------------
  // Internal: event handling
  // -----------------------------------------------------------------------

  private handleEvent(
    tracker: MutableSessionTracker,
    event: AgentEvent,
    budget: BudgetLimit,
    thresholds: MonitorThresholds,
  ): void {
    if (tracker.aborted) return;

    switch (event.type) {
      case "tool_use":
        this.onToolUse(tracker, event, thresholds);
        break;
      case "stats_update":
        this.onStatsUpdate(tracker, event, budget, thresholds);
        break;
      case "budget_warning":
        this.onBudgetWarning(tracker, event);
        break;
      case "session_ended":
        this.onSessionEnded(tracker, event);
        break;
      case "error":
        this.onError(tracker, event);
        break;
      case "session_started":
      case "message":
        break;
    }
  }

  private onToolUse(
    tracker: MutableSessionTracker,
    event: Extract<AgentEvent, { type: "tool_use" }>,
    thresholds: MonitorThresholds,
  ): void {
    tracker.lastToolProgressMs = this.nowMs();
    tracker.recentToolCalls.push(event.tool);

    const maxHistory = thresholds.repeatedToolThreshold * 3;
    if (tracker.recentToolCalls.length > maxHistory) {
      tracker.recentToolCalls = tracker.recentToolCalls.slice(-maxHistory);
    }

    tracker.stuckNudgeSent = false;
    tracker._repeatedToolNudgeEmitted = false;
    this.checkRepeatedToolCalls(tracker, thresholds);
  }

  private onStatsUpdate(
    tracker: MutableSessionTracker,
    event: Extract<AgentEvent, { type: "stats_update" }>,
    budget: BudgetLimit,
    thresholds: MonitorThresholds,
  ): void {
    tracker.latestStats = event.stats;

    if (event.observation) {
      tracker.latestObservation = {
        auth_mode: event.observation.auth_mode,
        metering: event.observation.metering,
        exact_cost_usd: event.observation.exact_cost_usd,
        quota_remaining_pct: event.observation.quota_remaining_pct,
        credits_remaining: event.observation.credits_remaining,
      };
      this.updateDailyBudgetFromObservation(event.observation);
    }

    const normalized = this.normalizeForTracker(tracker);
    this.enforceBudget(tracker, normalized, budget, thresholds);
  }

  private onBudgetWarning(
    tracker: MutableSessionTracker,
    event: Extract<AgentEvent, { type: "budget_warning" }>,
  ): void {
    if (tracker._budgetWarningEmitted) return;
    tracker._budgetWarningEmitted = true;

    this.emitEvent({
      type: "budget_warning",
      timestamp: new Date(this.nowMs()).toISOString(),
      issueId: tracker.issueId,
      message: `Session approaching budget limit: ${event.limitKind} at ${event.current} / ${event.limit}`,
      details: {
        limitKind: event.limitKind,
        current: event.current,
        limit: event.limit,
        fraction: event.fraction,
      },
    });
  }

  private onSessionEnded(
    tracker: MutableSessionTracker,
    event: Extract<AgentEvent, { type: "session_ended" }>,
  ): void {
    tracker.latestStats = event.stats;
    this.stopObserving(tracker.issueId);
  }

  private onError(
    tracker: MutableSessionTracker,
    event: Extract<AgentEvent, { type: "error" }>,
  ): void {
    if (event.fatal) {
      this.emitEvent({
        type: "session_aborted_by_monitor",
        timestamp: new Date(this.nowMs()).toISOString(),
        issueId: tracker.issueId,
        message: `Session error (fatal): ${event.message}`,
      });
    }
  }

  // -----------------------------------------------------------------------
  // Internal: stuck detection
  // -----------------------------------------------------------------------

  private checkStuck(
    tracker: MutableSessionTracker,
    thresholds: MonitorThresholds,
  ): void {
    if (tracker.aborted) return;

    const stuckState = assessStuckState(tracker.lastToolProgressMs, this.nowMs(), thresholds);

    if (stuckState === "kill") {
      this.emitEvent({
        type: "stuck_abort",
        timestamp: new Date(this.nowMs()).toISOString(),
        issueId: tracker.issueId,
        message: `Session stuck for >= ${thresholds.stuckKillSec}s — aborting`,
        details: {
          lastToolProgressMs: tracker.lastToolProgressMs,
          elapsedSec: tracker.lastToolProgressMs
            ? (this.nowMs() - tracker.lastToolProgressMs) / 1000
            : null,
        },
      });
      this.abortSession(tracker);
    } else if (stuckState === "warning" && !tracker.stuckNudgeSent) {
      this.emitEvent({
        type: "stuck_warning",
        timestamp: new Date(this.nowMs()).toISOString(),
        issueId: tracker.issueId,
        message: `Session appears stuck — no tool progress for >= ${thresholds.stuckWarningSec}s`,
        details: {
          lastToolProgressMs: tracker.lastToolProgressMs,
          elapsedSec: tracker.lastToolProgressMs
            ? (this.nowMs() - tracker.lastToolProgressMs) / 1000
            : null,
        },
      });
      tracker.stuckNudgeSent = true;
      tracker.handle
        .steer(
          "You appear to be stuck. Please provide a progress update or try a different approach.",
        )
        .catch(() => {});
    }
  }

  // -----------------------------------------------------------------------
  // Internal: repeated tool call detection
  // -----------------------------------------------------------------------

  private checkRepeatedToolCalls(
    tracker: MutableSessionTracker,
    thresholds: MonitorThresholds,
  ): void {
    if (tracker._repeatedToolNudgeEmitted) return;
    if (!hasRepeatedToolCalls(tracker.recentToolCalls, thresholds)) return;

    tracker._repeatedToolNudgeEmitted = true;

    const repeatedTool = tracker.recentToolCalls[tracker.recentToolCalls.length - 1];
    this.emitEvent({
      type: "repeated_tool_nudge",
      timestamp: new Date(this.nowMs()).toISOString(),
      issueId: tracker.issueId,
      message: `Agent called "${repeatedTool}" ${thresholds.repeatedToolThreshold}+ times in a row — sending steering nudge`,
      details: { tool: repeatedTool, count: thresholds.repeatedToolThreshold },
    });

    tracker.handle
      .steer(
        `You have called the "${repeatedTool}" tool ${thresholds.repeatedToolThreshold} times in a row. If this is intentional, explain why. Otherwise, try a different approach.`,
      )
      .catch(() => {});
  }

  // -----------------------------------------------------------------------
  // Internal: budget enforcement
  // -----------------------------------------------------------------------

  private enforceBudget(
    tracker: MutableSessionTracker,
    normalized: NormalizedBudgetStatus,
    budget: BudgetLimit,
    thresholds: MonitorThresholds,
  ): void {
    if (tracker.aborted) return;

    // Turn budget exceeded
    if (normalized.session_turns >= budget.turns) {
      this.emitEvent({
        type: "budget_abort",
        timestamp: new Date(this.nowMs()).toISOString(),
        issueId: tracker.issueId,
        message: `Turn budget exceeded: ${normalized.session_turns} / ${budget.turns}`,
        details: { turns: normalized.session_turns, limit: budget.turns },
      });
      this.abortSession(tracker);
      return;
    }

    // Token budget exceeded
    if (normalized.total_tokens >= budget.tokens) {
      this.emitEvent({
        type: "budget_abort",
        timestamp: new Date(this.nowMs()).toISOString(),
        issueId: tracker.issueId,
        message: `Token budget exceeded: ${normalized.total_tokens} / ${budget.tokens}`,
        details: { tokens: normalized.total_tokens, limit: budget.tokens },
      });
      this.abortSession(tracker);
      return;
    }

    // Per-issue cost warning (exact_usd)
    if (
      normalized.exact_cost_usd !== undefined &&
      thresholds.perIssueCostWarningUsd !== null &&
      normalized.exact_cost_usd >= thresholds.perIssueCostWarningUsd &&
      !tracker._budgetWarningEmitted
    ) {
      tracker._budgetWarningEmitted = true;
      this.emitEvent({
        type: "budget_warning",
        timestamp: new Date(this.nowMs()).toISOString(),
        issueId: tracker.issueId,
        message: `Per-issue cost warning: $${normalized.exact_cost_usd.toFixed(2)} >= $${thresholds.perIssueCostWarningUsd.toFixed(2)}`,
        details: {
          costUsd: normalized.exact_cost_usd,
          limitUsd: thresholds.perIssueCostWarningUsd,
          metering: "exact_usd",
        },
      });
    }

    // Daily cost warning (exact_usd)
    if (
      normalized.exact_cost_usd !== undefined &&
      thresholds.dailyCostWarningUsd !== null &&
      normalized.exact_cost_usd >= thresholds.dailyCostWarningUsd &&
      !tracker._budgetWarningEmitted
    ) {
      tracker._budgetWarningEmitted = true;
      this.emitEvent({
        type: "budget_warning",
        timestamp: new Date(this.nowMs()).toISOString(),
        issueId: tracker.issueId,
        message: `Daily cost warning: $${normalized.exact_cost_usd.toFixed(2)} >= $${thresholds.dailyCostWarningUsd.toFixed(2)}`,
        details: {
          costUsd: normalized.exact_cost_usd,
          dailyLimitUsd: thresholds.dailyCostWarningUsd,
          metering: "exact_usd",
        },
      });
    }

    // Daily hard stop (exact_usd)
    if (
      normalized.exact_cost_usd !== undefined &&
      thresholds.dailyHardStopUsd !== null &&
      normalized.exact_cost_usd >= thresholds.dailyHardStopUsd
    ) {
      this.dailyBudget.hardStopTriggered = true;
      this.emitEvent({
        type: "daily_hard_stop",
        timestamp: new Date(this.nowMs()).toISOString(),
        issueId: tracker.issueId,
        message: `Daily hard stop reached: $${normalized.exact_cost_usd.toFixed(2)} >= $${thresholds.dailyHardStopUsd.toFixed(2)}`,
        details: {
          costUsd: normalized.exact_cost_usd,
          dailyHardStopUsd: thresholds.dailyHardStopUsd,
        },
      });
      this.abortSession(tracker);
      return;
    }

    // Quota floor checks
    if (normalized.quota_remaining_pct !== undefined) {
      const quotaState = assessQuotaFloor(normalized.quota_remaining_pct, thresholds);
      if (quotaState === "abort") {
        this.dailyBudget.hardStopTriggered = true;
        this.emitEvent({
          type: "quota_floor_abort",
          timestamp: new Date(this.nowMs()).toISOString(),
          issueId: tracker.issueId,
          message: `Quota floor crossed: ${normalized.quota_remaining_pct}% remaining <= ${thresholds.quotaHardStopFloorPct}%`,
          details: {
            quotaRemainingPct: normalized.quota_remaining_pct,
            hardStopFloorPct: thresholds.quotaHardStopFloorPct,
          },
        });
        this.abortSession(tracker);
        return;
      }
      if (quotaState === "warning" && !tracker._budgetWarningEmitted) {
        tracker._budgetWarningEmitted = true;
        this.emitEvent({
          type: "quota_floor_warning",
          timestamp: new Date(this.nowMs()).toISOString(),
          issueId: tracker.issueId,
          message: `Quota floor warning: ${normalized.quota_remaining_pct}% remaining <= ${thresholds.quotaWarningFloorPct}%`,
          details: {
            quotaRemainingPct: normalized.quota_remaining_pct,
            warningFloorPct: thresholds.quotaWarningFloorPct,
          },
        });
      }
    }
  }

  // -----------------------------------------------------------------------
  // Internal: helpers
  // -----------------------------------------------------------------------

  private normalizeForTracker(tracker: MutableSessionTracker): NormalizedBudgetStatus {
    const stats = tracker.latestStats ?? {
      input_tokens: 0,
      output_tokens: 0,
      session_turns: 0,
      wall_time_sec: 0,
    };
    const authMode: AuthMode = tracker.latestObservation?.auth_mode ?? "unknown";
    const metering: MeteringCapability = tracker.latestObservation?.metering ?? "unknown";
    const obs: UsageObservation | undefined = tracker.latestObservation
      ? {
          provider: "unknown",
          auth_mode: tracker.latestObservation.auth_mode,
          metering: tracker.latestObservation.metering,
          exact_cost_usd: tracker.latestObservation.exact_cost_usd,
          quota_remaining_pct: tracker.latestObservation.quota_remaining_pct,
          credits_remaining: tracker.latestObservation.credits_remaining,
          confidence: "proxy",
          source: "session_stats",
        }
      : undefined;
    return normalizeStats(stats, authMode, metering, obs);
  }

  private updateDailyBudgetFromObservation(obs: {
    auth_mode: AuthMode;
    metering: MeteringCapability;
    exact_cost_usd?: number;
    quota_remaining_pct?: number;
    credits_remaining?: number;
  }): void {
    this.dailyBudget.metering = obs.metering;

    if (obs.exact_cost_usd !== undefined) {
      if (this.dailyBudget.spendUsd === null || obs.exact_cost_usd > this.dailyBudget.spendUsd) {
        this.dailyBudget.spendUsd = obs.exact_cost_usd;
      }
    }

    if (obs.quota_remaining_pct !== undefined) {
      if (
        this.dailyBudget.quotaRemainingPct === null ||
        obs.quota_remaining_pct < this.dailyBudget.quotaRemainingPct
      ) {
        this.dailyBudget.quotaRemainingPct = obs.quota_remaining_pct;
      }
    }

    if (obs.credits_remaining !== undefined) {
      if (
        this.dailyBudget.creditsRemaining === null ||
        obs.credits_remaining < this.dailyBudget.creditsRemaining
      ) {
        this.dailyBudget.creditsRemaining = obs.credits_remaining;
      }
    }
  }

  private abortSession(tracker: MutableSessionTracker): void {
    if (tracker.aborted) return;
    tracker.aborted = true;
    tracker.handle.abort().catch(() => {});
  }

  private emitEvent(event: MonitorEvent): void {
    this.events.push(event);
  }

  private buildGateStatus(): NormalizedBudgetStatus | null {
    const db = this.dailyBudget;
    if (db.spendUsd === null && db.quotaRemainingPct === null && db.creditsRemaining === null) {
      return null;
    }
    return {
      metering: db.metering,
      auth_mode: "unknown",
      total_tokens: 0,
      session_turns: 0,
      wall_time_sec: 0,
      ...(db.spendUsd !== null ? { exact_cost_usd: db.spendUsd } : {}),
      ...(db.quotaRemainingPct !== null ? { quota_remaining_pct: db.quotaRemainingPct } : {}),
      ...(db.creditsRemaining !== null ? { credits_remaining: db.creditsRemaining } : {}),
      confidence: db.spendUsd !== null ? "exact" : "proxy",
      budget_warning: true,
    };
  }
}
