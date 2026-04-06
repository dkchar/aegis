/**
 * S9.1 — Orchestrator loop integration tests.
 *
 * Validates:
 *   a) Orchestrator creates and starts in idle mode
 *   b) enableAuto/pause/resume/disable control mode transitions
 *   c) Status reflects current state
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import { createOrchestrator, type OrchestratorInputs } from "../../../src/aegis.js";
import type { BeadsClient } from "../../../src/tracker/beads-client.js";
import type { AgentRuntime } from "../../../src/runtime/agent-runtime.js";
import type { TitanSpawner } from "../../../src/core/dispatcher.js";
import type { Monitor } from "../../../src/core/monitor.js";
import type { Reaper } from "../../../src/core/reaper.js";
import type { BudgetLimit } from "../../../src/config/schema.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBudget(): BudgetLimit {
  return {
    max_turns: 50,
    max_input_tokens: 100_000,
    max_output_tokens: 50_000,
    max_cost_usd: 5,
    max_quota_pct: 80,
    max_credits: 100,
  };
}

function makeMockInputs(): {
  client: BeadsClient;
  runtime: AgentRuntime;
  spawner: TitanSpawner;
  monitor: Monitor;
  reaper: Reaper;
  budget: BudgetLimit;
} {
  return {
    client: {
      getReadyQueue: vi.fn().mockResolvedValue([]),
    } as unknown as BeadsClient,
    runtime: {} as AgentRuntime,
    spawner: {
      spawnForTitan: vi.fn(),
    },
    monitor: {
      startObserving: vi.fn(),
      stopObserving: vi.fn(),
      checkBudgetGate: vi.fn(),
      resetDailyBudget: vi.fn(),
      getActiveSessions: vi.fn().mockReturnValue(new Map()),
      drainEvents: vi.fn().mockReturnValue([]),
    } as unknown as Monitor,
    reaper: {
      reap: vi.fn(),
    } as unknown as Reaper,
    budget: makeBudget(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("S9.1 — Aegis orchestrator", () => {
  let inputs: ReturnType<typeof makeMockInputs>;

  beforeEach(() => {
    inputs = makeMockInputs();
  });

  it("creates an orchestrator in idle mode", async () => {
    const orch = await createOrchestrator({ ...inputs, skipBootstrap: true });
    await orch.start();

    const status = orch.getStatus();
    expect(status.mode).toBe("idle");
    expect(status.uptimeMs).toBeGreaterThanOrEqual(0);
    expect(status.queueDepth).toBe(0);
    expect(status.activeAgents).toBe(0);
  });

  it("enableAuto switches to auto mode", async () => {
    const orch = await createOrchestrator({ ...inputs, skipBootstrap: true });
    await orch.start();

    orch.enableAuto();
    expect(orch.getStatus().mode).toBe("auto");
  });

  it("disableAuto returns to idle mode", async () => {
    const orch = await createOrchestrator({ ...inputs, skipBootstrap: true });
    await orch.start();

    orch.enableAuto();
    orch.disableAuto();
    expect(orch.getStatus().mode).toBe("idle");
  });

  it("pause and resume control the mode", async () => {
    const orch = await createOrchestrator({ ...inputs, skipBootstrap: true });
    await orch.start();

    orch.enableAuto();
    orch.pause();
    expect(orch.getStatus().mode).toBe("paused");

    orch.resume();
    expect(orch.getStatus().mode).toBe("auto");
  });

  it("stop shuts down gracefully", async () => {
    const orch = await createOrchestrator({ ...inputs, skipBootstrap: true });
    await orch.start();
    orch.enableAuto();

    await orch.stop();
    expect(orch.getStatus().mode).toBe("idle");
  });

  it("status shows empty poll result initially", async () => {
    const orch = await createOrchestrator({ ...inputs, skipBootstrap: true });
    await orch.start();

    const status = orch.getStatus();
    expect(status.lastPollResult).toBeNull();
  });
});
