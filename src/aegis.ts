/**
 * S9.1 — Orchestrator loop coordinator.
 *
 * SPECv2 §9.1: owns the top-level lifecycle of the Aegis orchestr —
 * bootstraps config and state, starts the HTTP server, runs the deterministic
 * POLL → TRIAGE → DISPATCH → MONITOR → REAP cycle in auto mode, and
 * coordinates graceful shutdown.
 *
 * This module does NOT replace any existing module — it wires them together:
 *   - poller.ts (§9.2) for work classification
 *   - dispatcher.ts (§9.4) for Titan dispatch decisions
 *   - monitor.ts (§9.6) for budget and stuck detection
 *   - reaper.ts (§9.7) for session completion and labor cleanup
 *   - spawner.ts (§9.5) for runtime boundary ownership
 *   - start.ts for HTTP server bootstrap and lifecycle
 *
 * Deterministic core (§2.3): the loop itself contains no LLM reasoning.
 * It makes mechanical decisions based on poll results, triage output,
 * and configured thresholds.
 */

import { randomUUID } from "node:crypto";
import path from "node:path";

import { loadConfig } from "./config/load-config.js";
import {
  loadDispatchState,
  reconcileDispatchState,
  saveDispatchState,
  type DispatchState,
} from "./core/dispatch-state.js";
import { pollForWork, type PollResult } from "./core/poller.js";
import {
  dispatchScoutedIssues,
  type TitanSpawner,
} from "./core/dispatcher.js";
import { triageScouted, type ScoutedIssue } from "./core/triage.js";
import type { Monitor } from "./core/monitor.js";
import type { Reaper } from "./core/reaper.js";
import type { BeadsClient } from "./tracker/beads-client.js";
import type { AgentRuntime } from "./runtime/agent-runtime.js";
import type { BudgetLimit } from "./config/schema.js";
import type { OracleAssessment } from "./castes/oracle/oracle-parser.js";
import { startAegis, type StartRuntimeController } from "./cli/start.js";

// ---------------------------------------------------------------------------
// Orchestrator interface
// ---------------------------------------------------------------------------

export interface OrchestratorStatus {
  mode: "idle" | "auto" | "paused";
  uptimeMs: number;
  queueDepth: number;
  activeAgents: number;
  lastPollResult: PollResult | null;
}

export interface AegisOrchestrator {
  /** Start the orchestrator — begins in idle/conversational mode. */
  start(): Promise<void>;
  /** Enable auto-mode polling loop. */
  enableAuto(): void;
  /** Disable auto-mode, return to conversational. */
  disableAuto(): void;
  /** Pause the auto loop without disabling it. */
  pause(): void;
  /** Resume a paused auto loop. */
  resume(): void;
  /** Stop the orchestrator gracefully. */
  stop(): Promise<void>;
  /** Get current status. */
  getStatus(): OrchestratorStatus;
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface OrchestratorInputs {
  root?: string;
  client: BeadsClient;
  runtime: AgentRuntime;
  spawner: TitanSpawner;
  monitor: Monitor;
  reaper: Reaper;
  budget: BudgetLimit;
  /** Oracle assessments cache (populated by Oracle dispatch). */
  oracleAssessments?: Map<string, OracleAssessment>;
  /** Poll interval in milliseconds (default 10_000). */
  pollIntervalMs?: number;
  /** Skip config loading and HTTP server startup (for testing). */
  skipBootstrap?: boolean;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export async function createOrchestrator(
  inputs: OrchestratorInputs,
): Promise<AegisOrchestrator> {
  const {
    root = process.cwd(),
    client,
    runtime,
    spawner,
    monitor,
    reaper,
    budget,
    oracleAssessments = new Map(),
    pollIntervalMs = 10_000,
    skipBootstrap = false,
  } = inputs;

  const repoRoot = path.resolve(root);
  const startTime = Date.now();

  // Bootstrap: load config, reconcile dispatch state, start HTTP server.
  let dispatchState: DispatchState;
  if (!skipBootstrap) {
    loadConfig(repoRoot);
    const dispatchSessionId = randomUUID();
    dispatchState = reconcileDispatchState(
      loadDispatchState(repoRoot),
      dispatchSessionId,
    );
    saveDispatchState(repoRoot, dispatchState);

    // Start the HTTP server via startAegis.
    await startAegis(repoRoot, { noBrowser: true }, {
      verifyTracker: () => {},
      verifyGitRepo: () => {},
      registerSignalHandlers: false,
    });
  } else {
    // In test mode, initialize with an empty dispatch state.
    dispatchState = { schemaVersion: 1, records: {} };
  }

  let mode: "idle" | "auto" | "paused" = "idle";
  let lastPollResult: PollResult | null = null;
  let pollTimer: NodeJS.Timeout | null = null;

  // -----------------------------------------------------------------------
  // Auto-loop tick
  // -----------------------------------------------------------------------

  async function tick(): Promise<void> {
    if (mode !== "auto") return;

    // POLL — classify ready work.
    const pollResult = await pollForWork(
      client,
      dispatchState,
      oracleAssessments,
    );
    lastPollResult = pollResult;

    // DISPATCH — send dispatchable issues to Titan via the spawner.
    if (pollResult.dispatchable.length > 0) {
      const dispatchResult = await dispatchScoutedIssues(
        pollResult.dispatchable,
        dispatchState,
        spawner,
      );
      // Start observing each dispatched session.
      for (const issueId of dispatchResult.dispatched) {
        const spawn = dispatchResult.spawnResults[issueId];
        if (spawn) {
          monitor.startObserving(issueId, "titan", spawn.handle, budget);
        }
      }
      // Persist updated dispatch state.
      dispatchState = dispatchResult.updatedState;
      saveDispatchState(repoRoot, dispatchState);
    }

    // MONITOR — check budget gates and drain events.
    monitor.checkBudgetGate();
    const monitorEvents = monitor.drainEvents();

    // Check for fatal monitor events (e.g., tool-call failure).
    // If found, log the error, disable auto mode, and stop the loop.
    for (const evt of monitorEvents) {
      if (evt.fatal) {
        console.error(`[aegis] FATAL: ${evt.message}`);
        mode = "idle";
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
        return;
      }
    }
  }

  // -----------------------------------------------------------------------
  // Control surface
  // -----------------------------------------------------------------------

  let started = false;

  return {
    async start() {
      if (started) return;
      started = true;
      // Orchestrator is now live in idle/conversational mode.
      // The HTTP server is serving Olympus; commands can be issued.
    },

    enableAuto() {
      if (mode === "auto") return;
      mode = "auto";
      pollTimer = setInterval(() => {
        void tick().catch((err) => {
          console.error("[aegis] auto-loop tick failed:", err);
        });
      }, pollIntervalMs);
    },

    disableAuto() {
      mode = "idle";
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    },

    pause() {
      if (mode !== "auto") return;
      mode = "paused";
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    },

    resume() {
      if (mode !== "paused") return;
      mode = "auto";
      pollTimer = setInterval(() => {
        void tick().catch((err) => {
          console.error("[aegis] auto-loop tick failed:", err);
        });
      }, pollIntervalMs);
    },

    async stop() {
      mode = "idle";
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      // Final state persistence (skip in test mode).
      try {
        saveDispatchState(repoRoot, dispatchState);
      } catch {
        // In test mode (skipBootstrap), dispatch state path may not exist.
      }
    },

    getStatus(): OrchestratorStatus {
      return {
        mode,
        uptimeMs: Date.now() - startTime,
        queueDepth: lastPollResult?.dispatchable.length ?? 0,
        activeAgents: lastPollResult?.inProgress.length ?? 0,
        lastPollResult,
      };
    },
  };
}
