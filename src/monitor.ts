// src/monitor.ts
// Monitor — agent lifecycle tracking, stuck detection, and budget enforcement.
// Tracks AgentState snapshots; emits SSEEvents for the Olympus dashboard.

import type { AgentState, AegisConfig, SSEEvent } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MonitoredAgent {
  state: AgentState;
}

export type StuckStatus =
  | { stuck: false }
  | { stuck: true; severity: "warning" | "kill"; reason: string };

export type BudgetStatus =
  | { exceeded: false }
  | { exceeded: true; resource: "turns" | "tokens"; current: number; limit: number };

export type RepeatedToolStatus =
  | { repeated: false }
  | { repeated: true; toolName: string; count: number };

// ---------------------------------------------------------------------------
// Pricing tables — USD per 1 million tokens
// ---------------------------------------------------------------------------

interface ModelPricing {
  input: number;
  output: number;
  cacheRead: number;
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  // Claude Haiku 4.5
  "claude-haiku-4-5":             { input: 0.25, output: 1.25,  cacheRead: 0.03 },
  "claude-haiku-4-5-20251001":    { input: 0.25, output: 1.25,  cacheRead: 0.03 },
  // Claude Sonnet 4.5 / 4.6
  "claude-sonnet-4-5":            { input: 3.0,  output: 15.0,  cacheRead: 0.3  },
  "claude-sonnet-4-6":            { input: 3.0,  output: 15.0,  cacheRead: 0.3  },
  // Claude Opus 4.5 / 4.6
  "claude-opus-4-5":              { input: 15.0, output: 75.0,  cacheRead: 1.5  },
  "claude-opus-4-6":              { input: 15.0, output: 75.0,  cacheRead: 1.5  },
  // Legacy model names (in case config uses them)
  "claude-3-haiku-20240307":      { input: 0.25, output: 1.25,  cacheRead: 0.03 },
  "claude-3-5-sonnet-20241022":   { input: 3.0,  output: 15.0,  cacheRead: 0.3  },
  "claude-3-opus-20240229":       { input: 15.0, output: 75.0,  cacheRead: 1.5  },
};

const DEFAULT_PRICING: ModelPricing = { input: 3.0, output: 15.0, cacheRead: 0.3 };

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Estimates the USD cost of an LLM call using embedded per-model pricing.
 * Falls back to Sonnet-level pricing for unknown models.
 */
export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number
): number {
  const pricing = MODEL_PRICING[model] ?? DEFAULT_PRICING;
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  const cacheReadCost = (cacheReadTokens / 1_000_000) * pricing.cacheRead;
  return inputCost + outputCost + cacheReadCost;
}

/**
 * Registers tracking for an agent and emits a tracking_started SSEEvent.
 *
 * In a full implementation this subscribes to the Pi SDK session event stream
 * to update agent.state (turns, tokens, cost, last_tool_call_at) on each event.
 * The onEvent callback forwards events to the Olympus dashboard via SSE.
 */
export function track(
  agent: MonitoredAgent,
  _config: AegisConfig,
  onEvent: (event: SSEEvent) => void
): void {
  const event: SSEEvent = {
    type: "agent.tracking_started",
    data: {
      agent_id: agent.state.id,
      issue_id: agent.state.issue_id,
      caste: agent.state.caste,
      model: agent.state.model,
    },
    timestamp: Date.now(),
  };
  onEvent(event);
}

/**
 * Checks whether an agent appears stuck based on time since last tool call.
 *
 * Returns:
 * - { stuck: false } if within warning threshold
 * - { stuck: true, severity: "warning" } if idle >= stuck_warning_seconds
 * - { stuck: true, severity: "kill" }    if idle >= stuck_kill_seconds
 */
export function checkStuck(agent: MonitoredAgent, config: AegisConfig): StuckStatus {
  const now = Date.now();
  const idleMs = now - agent.state.last_tool_call_at;
  const idleSec = idleMs / 1000;

  if (idleSec >= config.timing.stuck_kill_seconds) {
    return {
      stuck: true,
      severity: "kill",
      reason: `No tool call for ${Math.round(idleSec)}s (kill threshold: ${config.timing.stuck_kill_seconds}s)`,
    };
  }

  if (idleSec >= config.timing.stuck_warning_seconds) {
    return {
      stuck: true,
      severity: "warning",
      reason: `No tool call for ${Math.round(idleSec)}s (warning threshold: ${config.timing.stuck_warning_seconds}s)`,
    };
  }

  return { stuck: false };
}

/**
 * Checks whether an agent has repeated the same tool call too many times in a row.
 *
 * Inspects the tail of `recentToolCalls` (a ring-buffer fingerprint of the form
 * "toolName:argsJson" maintained by the caller) and returns `repeated: true` when
 * the last `threshold` entries are all identical.  The default threshold of 3
 * matches SPEC §10.2.
 */
export function checkRepeatedToolCall(
  recentToolCalls: string[],
  threshold = 3
): RepeatedToolStatus {
  if (recentToolCalls.length < threshold) return { repeated: false };

  const tail = recentToolCalls.slice(-threshold);
  const first = tail[0]!;
  if (!tail.every((call) => call === first)) return { repeated: false };

  // Extract just the tool name from the "toolName:argsJson" fingerprint.
  const colonIdx = first.indexOf(":");
  const toolName = colonIdx === -1 ? first : first.slice(0, colonIdx);
  return { repeated: true, toolName, count: threshold };
}

/**
 * Checks whether an agent has exceeded its turn or token budget.
 * Limits are read from agent.state.max_turns / max_tokens (set at spawn time).
 */
export function checkBudget(agent: MonitoredAgent, _config: AegisConfig): BudgetStatus {
  const { state } = agent;

  if (state.turns >= state.max_turns) {
    return {
      exceeded: true,
      resource: "turns",
      current: state.turns,
      limit: state.max_turns,
    };
  }

  if (state.tokens >= state.max_tokens) {
    return {
      exceeded: true,
      resource: "tokens",
      current: state.tokens,
      limit: state.max_tokens,
    };
  }

  return { exceeded: false };
}
