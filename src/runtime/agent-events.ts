/**
 * S05 contract seed — AgentEvent discriminated union.
 *
 * All events emitted by a runtime adapter flow through AgentHandle.subscribe().
 * The orchestrator core (monitor, reaper, SSE bus) consumes these events to
 * drive state transitions and real-time visibility.
 *
 * Canonical contract: SPECv2 §8.2.1 and §8.4.
 */

import type { AgentStats } from "./agent-runtime.js";
import type { UsageObservation } from "./normalize-stats.js";

// ---------------------------------------------------------------------------
// Base
// ---------------------------------------------------------------------------

interface BaseEvent {
  /** ISO-8601 timestamp of when the adapter emitted the event. */
  timestamp: string;

  /** Beads issue ID this session is working on. */
  issueId: string;

  /** Agent caste that produced the event. */
  caste: "oracle" | "titan" | "sentinel" | "janus" | "metis" | "prometheus";
}

// ---------------------------------------------------------------------------
// Variant payloads
// ---------------------------------------------------------------------------

/** Emitted once when the session process is fully initialised and ready. */
export interface SessionStartedEvent extends BaseEvent {
  type: "session_started";
  /** PID or other adapter-specific session identifier, for diagnostics only. */
  sessionId?: string;
}

/** Emitted once when the session terminates, cleanly or via abort. */
export interface SessionEndedEvent extends BaseEvent {
  type: "session_ended";
  /** Adapter-specific session identifier, mirrored from session_started when available. */
  sessionId?: string;
  reason: "completed" | "aborted" | "error" | "budget_exceeded";
  /** Final stats snapshot at termination. */
  stats: AgentStats;
}

/** Emitted each time the agent invokes a tool. */
export interface ToolUseEvent extends BaseEvent {
  type: "tool_use";
  /** Canonical tool name, e.g. "bash", "read_file", "write_file". */
  tool: string;
  /** Unique invocation ID from the runtime adapter. */
  toolCallId: string;
  /** Tool arguments as parsed/validated by the runtime. */
  args?: Record<string, unknown>;
  /** Optional human-readable summary of what was invoked. */
  summary?: string;
}

/** Emitted when a tool execution completes with a result. */
export interface ToolResultEvent extends BaseEvent {
  type: "tool_result";
  /** Matches the toolCallId from the corresponding tool_use event. */
  toolCallId: string;
  /** Tool name. */
  tool: string;
  /** Tool output content (text or structured result). */
  result: unknown;
  /** Whether the tool invocation resulted in an error. */
  isError: boolean;
}

/** Emitted when the agent produces a text message (assistant turn). */
export interface MessageEvent extends BaseEvent {
  type: "message";
  /** Full text of the assistant message. */
  text: string;
}

/** Emitted when the adapter encounters a non-fatal or fatal error. */
export interface ErrorEvent extends BaseEvent {
  type: "error";
  /** Human-readable error description. */
  message: string;
  /** Whether the session is still alive after this error. */
  fatal: boolean;
  /** Original error object for diagnostics; may not be serialisable. */
  cause?: unknown;
}

/** Periodic stats snapshot; frequency is adapter-controlled. */
export interface StatsUpdateEvent extends BaseEvent {
  type: "stats_update";
  stats: AgentStats;
  /** Latest usage observation from the runtime, if available. */
  observation?: UsageObservation;
}

/**
 * Emitted when the session is approaching a budget limit.
 * The monitor uses this to decide whether to abort early.
 */
export interface BudgetWarningEvent extends BaseEvent {
  type: "budget_warning";
  /** Which limit triggered the warning. */
  limitKind: "turns" | "tokens" | "cost_usd" | "credits" | "quota_pct";
  /** Current value at the time of the warning. */
  current: number;
  /** Configured limit that was approached. */
  limit: number;
  /** Fraction consumed: current / limit, in [0, 1]. */
  fraction: number;
}

// ---------------------------------------------------------------------------
// Discriminated union
// ---------------------------------------------------------------------------

/**
 * All event types that can flow through AgentHandle.subscribe().
 */
export type AgentEvent =
  | SessionStartedEvent
  | SessionEndedEvent
  | ToolUseEvent
  | ToolResultEvent
  | MessageEvent
  | ErrorEvent
  | StatsUpdateEvent
  | BudgetWarningEvent;
