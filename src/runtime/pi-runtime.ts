/**
 * PiRuntime — AgentRuntime implementation wrapping the Pi coding-agent SDK.
 *
 * Implements the AgentRuntime interface for the Pi SDK.
 * All Pi SDK-specific imports are contained within this file (SPECv2 §8.3, §8.4).
 *
 * Lane A implementation: aegis-fjm.6.2
 *
 * Design:
 *   - PiRuntime.spawn() calls createAgentSession() with cwd + tool selection
 *     mapped from SpawnOptions (caste → readOnlyTools / codingTools, §8.4).
 *   - PiAgentHandle wraps AgentSession and maps Pi SDK AgentSessionEvents to
 *     the Aegis AgentEvent discriminated union.
 *   - Stats are derived from AgentSession.getSessionStats() on each call.
 *   - Budget warnings are emitted when turns or tokens approach configured limits.
 *   - abort() delegates to AgentSession.abort() and disposes the session.
 *   - Windows-safe: working directory is passed as cwd; no shell path munging.
 *
 * Adapter rules: SPECv2 §8.3 and §8.4.
 *   - Pi SDK session creation and subscription live here only.
 *   - Tool restrictions are enforced by the adapter, not by prompt wording.
 *   - Working directory is applied via the runtime from SpawnOptions.
 *   - Behaviour must be consistent across Windows and Unix-like environments.
 */

import type {
  AgentHandle,
  AgentRuntime,
  AgentStats,
  SpawnOptions,
} from "./agent-runtime.js";
import type { AgentEvent } from "./agent-events.js";
import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";
import {
  createAgentSession,
  codingTools,
  readOnlyTools,
  type AgentSession,
} from "@mariozechner/pi-coding-agent";

// ---------------------------------------------------------------------------
// Budget-warning threshold: warn when > 80% of a limit is consumed.
// ---------------------------------------------------------------------------

const BUDGET_WARNING_FRACTION = 0.8;

// ---------------------------------------------------------------------------
// PiAgentHandle
// ---------------------------------------------------------------------------

/**
 * Live handle to a Pi coding-agent session.
 *
 * Wraps an AgentSession from the Pi SDK and translates its event stream to the
 * Aegis AgentEvent discriminated union.
 */
export class PiAgentHandle implements AgentHandle {
  private readonly _session: AgentSession;
  private readonly _opts: SpawnOptions;
  private readonly _startTime: number;
  private readonly _listeners: Set<(event: AgentEvent) => void>;

  /** Set to true once abort() has been called — prevents double-disposal. */
  private _aborted = false;

  /** Unsubscribe function returned by AgentSession.subscribe(). */
  private _unsubscribeSession: (() => void) | null = null;

  constructor(session: AgentSession, opts: SpawnOptions) {
    this._session = session;
    this._opts = opts;
    this._startTime = Date.now();
    this._listeners = new Set();

    // Subscribe to the Pi SDK event stream immediately so no events are missed.
    this._unsubscribeSession = this._session.subscribe(
      (evt: AgentSessionEvent) => this._handlePiEvent(evt)
    );
  }

  // -------------------------------------------------------------------------
  // AgentHandle — public API
  // -------------------------------------------------------------------------

  /**
   * Send the initial task prompt.
   * Uses AgentSession.prompt() which validates model + API key before sending.
   */
  async prompt(msg: string): Promise<void> {
    await this._session.prompt(msg);
  }

  /**
   * Send an in-flight steering message.
   * Uses AgentSession.steer() which queues the message as a mid-session
   * interruption delivered after the current tool execution finishes.
   */
  async steer(msg: string): Promise<void> {
    await this._session.steer(msg);
  }

  /**
   * Abort the session unconditionally.
   * Calls AgentSession.abort(), waits for idle, then disposes.
   * Emits a session_ended event with reason = "aborted".
   * Idempotent — safe to call multiple times.
   */
  async abort(): Promise<void> {
    if (this._aborted) return;
    this._aborted = true;

    try {
      await this._session.abort();
    } finally {
      // Emit the terminal event so listeners know the session is over.
      this._emit({
        type: "session_ended",
        timestamp: new Date().toISOString(),
        issueId: this._opts.issueId,
        caste: this._opts.caste,
        sessionId: this._session.sessionId,
        reason: "aborted",
        stats: this.getStats(),
      });

      this._cleanup();
    }
  }

  /**
   * Register a listener for all events emitted by this session.
   * Returns an unsubscribe function; calling it removes only that listener.
   */
  subscribe(listener: (event: AgentEvent) => void): () => void {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  }

  /**
   * Return a snapshot of session-local stats.
   * Safe to call at any time, including after abort.
   */
  getStats(): AgentStats {
    const sessionStats = this._session.getSessionStats();
    const contextUsage = this._session.getContextUsage();
    const wallTimeSec = (Date.now() - this._startTime) / 1000;

    return {
      input_tokens: sessionStats.tokens.input,
      output_tokens: sessionStats.tokens.output,
      session_turns: sessionStats.assistantMessages,
      wall_time_sec: wallTimeSec,
      ...(contextUsage?.percent !== null && contextUsage?.percent !== undefined
        ? { active_context_pct: contextUsage.percent }
        : {}),
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /** Broadcast an AgentEvent to all registered listeners. */
  private _emit(event: AgentEvent): void {
    for (const listener of this._listeners) {
      try {
        listener(event);
      } catch {
        // Listener errors must not crash the handle.
      }
    }
  }

  /** Remove all subscriptions and clean up resources. */
  private _cleanup(): void {
    if (this._unsubscribeSession) {
      this._unsubscribeSession();
      this._unsubscribeSession = null;
    }
    this._session.dispose();
    this._listeners.clear();
  }

  /**
   * Map a Pi SDK AgentSessionEvent to Aegis AgentEvents.
   *
   * Pi SDK → Aegis event mapping:
   *   agent_start             → session_started
   *   agent_end               → session_ended (reason = "completed")
   *   message_end (assistant) → message
   *   tool_execution_start    → tool_use
   *   turn_end                → stats_update (+ optional budget_warning)
   *
   * Error handling: the Pi SDK surfaces errors via agent_end with a failed
   * state; we detect this by checking session state after agent_end.
   */
  private _handlePiEvent(evt: AgentSessionEvent): void {
    const base = {
      timestamp: new Date().toISOString(),
      issueId: this._opts.issueId,
      caste: this._opts.caste,
    } as const;

    switch (evt.type) {
      case "agent_start": {
        this._emit({
          ...base,
          type: "session_started",
          sessionId: this._session.sessionId,
        });
        break;
      }

      case "agent_end": {
        // Skip if we already emitted session_ended via abort().
        if (this._aborted) break;

        const state = this._session.state;
        const hasError = Boolean(state.errorMessage);

        if (hasError) {
          this._emit({
            ...base,
            type: "error",
            message: state.errorMessage ?? "Agent ended with unknown error",
            fatal: true,
          });
        }

        const finalStats = this.getStats();

        this._emit({
          ...base,
          type: "session_ended",
          sessionId: this._session.sessionId,
          reason: hasError ? "error" : "completed",
          stats: finalStats,
        });

        this._cleanup();
        break;
      }

      case "message_end": {
        // Only emit for assistant messages that have text content.
        const msg = evt.message;
        if (
          msg &&
          "role" in msg &&
          msg.role === "assistant" &&
          "content" in msg
        ) {
          const content = msg.content;
          const text = Array.isArray(content)
            ? content
                .filter((c: unknown) => {
                  return (
                    c !== null &&
                    typeof c === "object" &&
                    "type" in (c as object) &&
                    (c as { type: string }).type === "text"
                  );
                })
                .map((c: unknown) => (c as { text: string }).text)
                .join("")
            : typeof content === "string"
              ? content
              : "";

          if (text) {
            this._emit({
              ...base,
              type: "message",
              text,
            });
          }
        }
        break;
      }

      case "tool_execution_start": {
        this._emit({
          ...base,
          type: "tool_use",
          tool: evt.toolName,
          summary: `Invoking ${evt.toolName}`,
        });
        break;
      }

      case "turn_end": {
        // Emit a stats_update after each turn.
        const stats = this.getStats();
        this._emit({
          ...base,
          type: "stats_update",
          stats,
        });

        // Emit budget_warning events when approaching configured limits.
        const budget = this._opts.budget;

        if (budget.turns !== undefined) {
          const fraction = stats.session_turns / budget.turns;
          if (fraction >= BUDGET_WARNING_FRACTION) {
            this._emit({
              ...base,
              type: "budget_warning",
              limitKind: "turns",
              current: stats.session_turns,
              limit: budget.turns,
              fraction,
            });
          }
        }

        if (budget.tokens !== undefined) {
          const totalTokens = stats.input_tokens + stats.output_tokens;
          const fraction = totalTokens / budget.tokens;
          if (fraction >= BUDGET_WARNING_FRACTION) {
            this._emit({
              ...base,
              type: "budget_warning",
              limitKind: "tokens",
              current: totalTokens,
              limit: budget.tokens,
              fraction,
            });
          }
        }

        break;
      }

      // All other Pi SDK events (compaction, retry, etc.) are intentionally
      // not forwarded to avoid leaking Pi-specific detail through the contract.
      default:
        break;
    }
  }
}

// ---------------------------------------------------------------------------
// Tool selection helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the appropriate Pi SDK tool list for a given caste.
 * SPECv2 §8.4: tool restrictions are enforced by the adapter.
 *
 *   titan    → codingTools  (full read/write access)
 *   oracle   → readOnlyTools
 *   sentinel → readOnlyTools
 *   janus    → readOnlyTools
 *   metis    → readOnlyTools  (no write access for analysis/memory caste)
 *   prometheus → readOnlyTools  (no write access for planning caste)
 */
type PiTool = (typeof codingTools)[number];

function resolveBaseTools(caste: SpawnOptions["caste"]): PiTool[] {
  switch (caste) {
    case "titan":
      return codingTools;
    case "oracle":
    case "sentinel":
    case "janus":
    case "metis":
    case "prometheus":
      return readOnlyTools;
  }
}

/**
 * Filter a tool list by name against a restriction list.
 * If restrictions is empty, all tools in the base list are returned.
 * If restrictions is non-empty, only tools whose name is in the list are kept.
 */
function applyToolRestrictions(tools: PiTool[], restrictions: string[]): PiTool[] {
  if (restrictions.length === 0) return tools;
  const allowed = new Set(restrictions);
  return tools.filter((t) => allowed.has(t.name));
}

// ---------------------------------------------------------------------------
// PiRuntime
// ---------------------------------------------------------------------------

/**
 * AgentRuntime implementation that wraps the Pi coding-agent SDK.
 *
 * Creates a Pi AgentSession per spawn() call.  All Pi SDK specifics are
 * contained here; the orchestration core sees only the AgentHandle contract.
 */
export class PiRuntime implements AgentRuntime {
  /**
   * Spawn a new Pi session wrapped in a PiAgentHandle.
   *
   * Steps:
   *  1. Resolve the base tool list from caste (§8.4).
   *  2. Apply any explicit toolRestrictions from SpawnOptions.
   *  3. Call createAgentSession() with cwd and filtered tools.
   *  4. Wrap the session in a PiAgentHandle and return it.
   */
  async spawn(opts: SpawnOptions): Promise<AgentHandle> {
    const baseTools = resolveBaseTools(opts.caste);
    const filteredTools = applyToolRestrictions(baseTools, opts.toolRestrictions);

    const { session } = await createAgentSession({
      cwd: opts.workingDirectory,
      tools: filteredTools,
    });

    return new PiAgentHandle(session, opts);
  }
}
