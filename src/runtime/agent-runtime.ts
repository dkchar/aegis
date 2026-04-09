/**
 * S05 contract seed — AgentRuntime interface and core types.
 *
 * Defines the minimal boundary between the Aegis orchestration core and any
 * runtime adapter.  The core only imports from this module; runtime-specific
 * packages stay inside adapter modules (e.g. pi-runtime.ts).
 *
 * Canonical contract: SPECv2 §8.2.1 and §8.2.2.
 */

import type { BudgetLimit } from "../config/schema.js";
import type { AgentEvent } from "./agent-events.js";

// ---------------------------------------------------------------------------
// SpawnOptions
// ---------------------------------------------------------------------------

/**
 * Options passed to AgentRuntime.spawn().
 * The orchestrator controls every session-level parameter through this object.
 */
export interface SpawnOptions {
  /** The agent caste to run: oracle, titan, sentinel, janus, etc. */
  caste: "oracle" | "titan" | "sentinel" | "janus" | "metis" | "prometheus";

  /** Beads issue ID being worked on, e.g. "aegis-fjm.6.1" */
  issueId: string;

  /**
   * Absolute working directory for the session.
   * On Titan this is the Labor worktree path; on Oracle it is the project root.
   * The adapter must apply this; the orchestrator must not rely on CWD defaults.
   */
  workingDirectory: string;

  /**
   * Tool restriction list.  The adapter enforces this — not prompt wording.
   * Empty array means no restrictions beyond the runtime's defaults.
   */
  toolRestrictions: string[];

  /** Optional explicit model reference for the session, e.g. pi:gemma-4-31b-it. */
  model?: string;

  /** Budget hard limits for this session. */
  budget: BudgetLimit;
}

// ---------------------------------------------------------------------------
// AgentStats
// ---------------------------------------------------------------------------

/**
 * Snapshot of resource usage for a live or completed session.
 * Reported by AgentHandle.getStats().
 */
export interface AgentStats {
  /** Total input tokens consumed in this session. */
  input_tokens: number;

  /** Total output tokens produced in this session. */
  output_tokens: number;

  /** Number of prompt/response turns completed. */
  session_turns: number;

  /** Elapsed wall-clock time in seconds since session start. */
  wall_time_sec: number;

  /**
   * Approximate percentage of the model's context window currently occupied.
   * Undefined when the runtime does not expose this signal.
   */
  active_context_pct?: number;
}

// ---------------------------------------------------------------------------
// AgentHandle
// ---------------------------------------------------------------------------

/**
 * Live handle to a running agent session.
 * Returned by AgentRuntime.spawn().
 */
export interface AgentHandle {
  /**
   * Send the initial task prompt.  Must be called once after spawn; the
   * runtime should not start work before the first prompt arrives.
   */
  prompt(msg: string): Promise<void>;

  /**
   * Send an in-flight steering message to a running session.
   * The runtime should deliver this as a mid-session instruction.
   */
  steer(msg: string): Promise<void>;

  /**
   * Abort the session unconditionally.
   * The adapter is responsible for cleanup (process termination, worktree
   * preservation, and stage transition signalling via an error event).
   */
  abort(): Promise<void>;

  /**
   * Register a listener for all events emitted by this session.
   * Returns an unsubscribe function; calling it removes the listener.
   */
  subscribe(listener: (event: AgentEvent) => void): () => void;

  /**
   * Return a snapshot of session-local stats.
   * Safe to call at any time, including after abort.
   */
  getStats(): AgentStats;
}

// ---------------------------------------------------------------------------
// AgentRuntime
// ---------------------------------------------------------------------------

/**
 * Top-level runtime factory.
 * The orchestration core instantiates one runtime per adapter (e.g. PiRuntime)
 * and calls spawn() for each session.
 */
export interface AgentRuntime {
  spawn(opts: SpawnOptions): Promise<AgentHandle>;
}

// ---------------------------------------------------------------------------
// Re-export AgentEvent for consumers that only import from agent-runtime.ts
// ---------------------------------------------------------------------------

export type { AgentEvent } from "./agent-events.js";
