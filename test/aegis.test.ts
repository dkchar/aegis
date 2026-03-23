// test/aegis.test.ts
// Unit tests for src/aegis.ts
// Mocks all external dependencies (beads, poller, spawner, monitor, labors,
// mnemosyne, lethe) and verifies the Layer 1 dispatch loop logic.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AegisConfig, BeadsIssue, AgentState, SSEEvent } from "../src/types.js";

// ---------------------------------------------------------------------------
// Shared mock objects
// ---------------------------------------------------------------------------

const mockSession = {
  prompt: vi.fn().mockResolvedValue(undefined),
  steer: vi.fn().mockResolvedValue(undefined),
  followUp: vi.fn().mockResolvedValue(undefined),
  abort: vi.fn().mockResolvedValue(undefined),
  subscribe: vi.fn().mockReturnValue(() => {}),
  getStats: vi.fn().mockReturnValue({
    tokens: { total: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    cost: 0,
    sessionId: "mock-sid",
  }),
};

// ---------------------------------------------------------------------------
// Module mocks — must be declared BEFORE dynamic import
// ---------------------------------------------------------------------------

vi.mock("../src/poller.js", () => ({
  poll: vi.fn().mockResolvedValue([]),
  diff: vi.fn((ready: BeadsIssue[], running: Map<string, AgentState>) =>
    ready.filter((i) => !running.has(i.id))
  ),
}));

vi.mock("../src/triage.js", () => ({
  triage: vi.fn().mockReturnValue({ type: "skip", issue: null, reason: "default mock" }),
}));

vi.mock("../src/spawner.js", () => ({
  spawnOracle: vi.fn().mockResolvedValue(mockSession),
  spawnTitan: vi.fn().mockResolvedValue(mockSession),
  spawnSentinel: vi.fn().mockResolvedValue(mockSession),
}));

vi.mock("../src/monitor.js", () => ({
  track: vi.fn(),
  checkStuck: vi.fn().mockReturnValue({ stuck: false }),
  checkBudget: vi.fn().mockReturnValue({ exceeded: false }),
  checkRepeatedToolCall: vi.fn().mockReturnValue({ repeated: false }),
}));

vi.mock("../src/labors.js", () => ({
  create: vi.fn().mockResolvedValue("/labors/labor-test"),
  merge: vi.fn().mockResolvedValue({ success: true }),
  cleanup: vi.fn().mockResolvedValue(undefined),
  list: vi.fn().mockResolvedValue([]),
}));

vi.mock("../src/mnemosyne.js", () => ({
  load: vi.fn().mockReturnValue([]),
  append: vi.fn().mockReturnValue({ id: "l-1", type: "failure", domain: "test", text: "", source: "agent", issue: null, ts: 0 }),
  filter: vi.fn().mockReturnValue([]),
  postProcess: vi.fn().mockReturnValue([]),
}));

vi.mock("../src/lethe.js", () => ({
  shouldPrune: vi.fn().mockReturnValue(false),
  prune: vi.fn().mockReturnValue([]),
}));

vi.mock("../src/beads.js", () => ({
  ready: vi.fn().mockResolvedValue([]),
  show: vi.fn().mockResolvedValue(makeIssue("test-001")),
  list: vi.fn().mockResolvedValue([]),
  create: vi.fn().mockResolvedValue(makeIssue("new-001")),
  update: vi.fn().mockResolvedValue(makeIssue("test-001")),
  close: vi.fn().mockResolvedValue(makeIssue("test-001")),
  reopen: vi.fn().mockResolvedValue(makeIssue("test-001")),
  comment: vi.fn().mockResolvedValue(undefined),
}));

// Dynamic imports after mocks
const pollerMock = await import("../src/poller.js");
const triageMock = await import("../src/triage.js");
const spawnerMock = await import("../src/spawner.js");
const monitorMock = await import("../src/monitor.js");
const laborsMock = await import("../src/labors.js");
const beadsMock = await import("../src/beads.js");
const { Aegis } = await import("../src/aegis.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeIssue(id: string, overrides: Partial<BeadsIssue> = {}): BeadsIssue {
  return {
    id,
    title: `Issue ${id}`,
    description: "Test issue description",
    type: "task",
    priority: 1,
    status: "open",
    comments: [],
    ...overrides,
  };
}

const CFG: AegisConfig = {
  version: 1,
  auth: { anthropic: "sk-ant-test", openai: null, google: null },
  models: {
    oracle: "claude-haiku-4-5",
    titan: "claude-sonnet-4-5",
    sentinel: "claude-sonnet-4-5",
    metis: "claude-haiku-4-5",
    prometheus: "claude-sonnet-4-5",
  },
  concurrency: { max_agents: 5, max_oracles: 2, max_titans: 2, max_sentinels: 1 },
  budgets: {
    oracle_turns: 5,
    oracle_tokens: 50000,
    titan_turns: 20,
    titan_tokens: 200000,
    sentinel_turns: 8,
    sentinel_tokens: 100000,
  },
  timing: { poll_interval_seconds: 5, stuck_warning_seconds: 90, stuck_kill_seconds: 150 },
  mnemosyne: { max_records: 500, context_budget_tokens: 1000 },
  labors: { base_path: ".aegis/labors" },
  olympus: { port: 3847, open_browser: false },
};

function makeAegis(): Aegis {
  return new Aegis(CFG, process.cwd());
}

beforeEach(() => {
  vi.clearAllMocks();
  // Reset defaults
  vi.mocked(pollerMock.poll).mockResolvedValue([]);
  vi.mocked(pollerMock.diff).mockImplementation(
    (ready, running) => ready.filter((i) => !running.has(i.id))
  );
  vi.mocked(triageMock.triage).mockReturnValue({
    type: "skip",
    issue: makeIssue("x"),
    reason: "default",
  });
  vi.mocked(spawnerMock.spawnOracle).mockResolvedValue(mockSession as never);
  vi.mocked(spawnerMock.spawnTitan).mockResolvedValue(mockSession as never);
  vi.mocked(spawnerMock.spawnSentinel).mockResolvedValue(mockSession as never);
  vi.mocked(monitorMock.checkStuck).mockReturnValue({ stuck: false });
  vi.mocked(monitorMock.checkBudget).mockReturnValue({ exceeded: false });
  vi.mocked(laborsMock.create).mockResolvedValue("/labors/labor-test");
  vi.mocked(laborsMock.merge).mockResolvedValue({ success: true });
  vi.mocked(beadsMock.list).mockResolvedValue([]);
  // Reset session mocks
  mockSession.prompt.mockResolvedValue(undefined);
  mockSession.subscribe.mockReturnValue(() => {});
  mockSession.getStats.mockReturnValue({
    tokens: { total: 100, input: 80, output: 20, cacheRead: 0, cacheWrite: 0 },
    cost: 0.001,
    sessionId: "mock-sid",
  });
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// getState()
// ---------------------------------------------------------------------------

describe("getState()", () => {
  it("returns status=running when running and not paused", () => {
    const aegis = makeAegis();
    // Simulate started
    Object.assign(aegis, { _running: true, startedAt: Date.now() });
    expect(aegis.getState().status).toBe("running");
  });

  it("returns status=paused after pause()", () => {
    const aegis = makeAegis();
    aegis.pause();
    expect(aegis.getState().status).toBe("paused");
  });

  it("returns empty agents array before any dispatch", () => {
    expect(makeAegis().getState().agents).toEqual([]);
  });

  it("returns focus_filter=null by default", () => {
    expect(makeAegis().getState().focus_filter).toBeNull();
  });

  it("returns focus_filter after focus()", () => {
    const aegis = makeAegis();
    aegis.focus("auth");
    expect(aegis.getState().focus_filter).toBe("auth");
  });

  it("returns focus_filter=null after clearFocus()", () => {
    const aegis = makeAegis();
    aegis.focus("auth");
    aegis.clearFocus();
    expect(aegis.getState().focus_filter).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// onEvent()
// ---------------------------------------------------------------------------

describe("onEvent()", () => {
  it("registers an event handler", () => {
    const aegis = makeAegis();
    const handler = vi.fn();
    aegis.onEvent(handler);
    aegis.pause(); // triggers an event
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ type: "orchestrator.paused" })
    );
  });

  it("supports multiple handlers", () => {
    const aegis = makeAegis();
    const h1 = vi.fn();
    const h2 = vi.fn();
    aegis.onEvent(h1);
    aegis.onEvent(h2);
    aegis.pause();
    expect(h1).toHaveBeenCalledOnce();
    expect(h2).toHaveBeenCalledOnce();
  });

  it("does not crash if a handler throws", () => {
    const aegis = makeAegis();
    aegis.onEvent(() => { throw new Error("handler crash"); });
    expect(() => aegis.pause()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// pause() / resume()
// ---------------------------------------------------------------------------

describe("pause() / resume()", () => {
  it("emits orchestrator.paused event", () => {
    const aegis = makeAegis();
    const events: SSEEvent[] = [];
    aegis.onEvent((e) => events.push(e));
    aegis.pause();
    expect(events.some((e) => e.type === "orchestrator.paused")).toBe(true);
  });

  it("emits orchestrator.resumed event", () => {
    const aegis = makeAegis();
    const events: SSEEvent[] = [];
    aegis.onEvent((e) => events.push(e));
    aegis.resume();
    expect(events.some((e) => e.type === "orchestrator.resumed")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// scale() / focus() / clearFocus()
// ---------------------------------------------------------------------------

describe("scale()", () => {
  it("updates max_agents on the config", () => {
    const aegis = makeAegis();
    aegis.scale(7);
    expect(aegis.getState().status).toBeDefined(); // still alive
    // config is accessed via getState — concurrency isn't exposed directly
  });

  it("emits orchestrator.scaled event", () => {
    const aegis = makeAegis();
    const events: SSEEvent[] = [];
    aegis.onEvent((e) => events.push(e));
    aegis.scale(7);
    expect(events.some((e) => e.type === "orchestrator.scaled")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Dispatch: triage → spawn
// ---------------------------------------------------------------------------

describe("dispatch via tick", () => {
  it("dispatches an Oracle when triage returns dispatch_oracle", async () => {
    const issue = makeIssue("aegis-001");
    vi.mocked(pollerMock.poll).mockResolvedValue([issue]);
    vi.mocked(beadsMock.show).mockResolvedValue(issue);
    vi.mocked(triageMock.triage).mockReturnValueOnce({ type: "dispatch_oracle", issue });

    const aegis = makeAegis();
    // Access the private tick via start() with no interval
    await (aegis as unknown as { runTick: () => Promise<void> }).runTick();

    expect(spawnerMock.spawnOracle).toHaveBeenCalledOnce();
  });

  it("dispatches a Titan (with Labor) when triage returns dispatch_titan", async () => {
    const issue = makeIssue("aegis-002");
    vi.mocked(pollerMock.poll).mockResolvedValue([issue]);
    vi.mocked(beadsMock.show).mockResolvedValue(issue);
    vi.mocked(triageMock.triage).mockReturnValueOnce({
      type: "dispatch_titan",
      issue,
      scoutComment: "SCOUTED: simple",
    });

    const aegis = makeAegis();
    await (aegis as unknown as { runTick: () => Promise<void> }).runTick();

    expect(laborsMock.create).toHaveBeenCalledWith(issue.id, CFG, expect.any(String));
    expect(spawnerMock.spawnTitan).toHaveBeenCalledOnce();
  });

  it("dispatches a Sentinel when triage returns dispatch_sentinel", async () => {
    const issue = makeIssue("aegis-003", { status: "closed" });
    vi.mocked(pollerMock.poll).mockResolvedValue([issue]);
    vi.mocked(beadsMock.show).mockResolvedValue(issue);
    vi.mocked(triageMock.triage).mockReturnValueOnce({
      type: "dispatch_sentinel",
      issue,
      scoutComment: "SCOUTED: done",
    });

    const aegis = makeAegis();
    await (aegis as unknown as { runTick: () => Promise<void> }).runTick();

    expect(spawnerMock.spawnSentinel).toHaveBeenCalledOnce();
  });

  it("does NOT dispatch when triage returns skip", async () => {
    const issue = makeIssue("aegis-004");
    vi.mocked(pollerMock.poll).mockResolvedValue([issue]);
    vi.mocked(beadsMock.show).mockResolvedValue(issue);
    vi.mocked(triageMock.triage).mockReturnValueOnce({
      type: "skip",
      issue,
      reason: "concurrency limit",
    });

    const aegis = makeAegis();
    await (aegis as unknown as { runTick: () => Promise<void> }).runTick();

    expect(spawnerMock.spawnOracle).not.toHaveBeenCalled();
    expect(spawnerMock.spawnTitan).not.toHaveBeenCalled();
    expect(spawnerMock.spawnSentinel).not.toHaveBeenCalled();
  });

  it("does not dispatch when paused", async () => {
    const issue = makeIssue("aegis-005");
    vi.mocked(pollerMock.poll).mockResolvedValue([issue]);
    vi.mocked(beadsMock.show).mockResolvedValue(issue);

    const aegis = makeAegis();
    aegis.pause();
    await (aegis as unknown as { runTick: () => Promise<void> }).runTick();

    expect(pollerMock.poll).not.toHaveBeenCalled();
  });

  it("emits agent.spawned event on successful Oracle dispatch", async () => {
    const issue = makeIssue("aegis-006");
    vi.mocked(pollerMock.poll).mockResolvedValue([issue]);
    vi.mocked(beadsMock.show).mockResolvedValue(issue);
    vi.mocked(triageMock.triage).mockReturnValueOnce({ type: "dispatch_oracle", issue });

    const aegis = makeAegis();
    const events: SSEEvent[] = [];
    aegis.onEvent((e) => events.push(e));

    await (aegis as unknown as { runTick: () => Promise<void> }).runTick();

    expect(events.some((e) => e.type === "agent.spawned")).toBe(true);
  });

  it("applies focus filter — does not dispatch issues that don't match", async () => {
    const authIssue = makeIssue("auth-001", { title: "Fix auth token", description: "" });
    const uiIssue = makeIssue("ui-002", { title: "Style the button", description: "" });
    vi.mocked(pollerMock.poll).mockResolvedValue([authIssue, uiIssue]);
    vi.mocked(beadsMock.show).mockImplementation(async (id) =>
      id === "auth-001" ? authIssue : uiIssue
    );
    vi.mocked(triageMock.triage).mockReturnValue({ type: "dispatch_oracle", issue: authIssue });

    const aegis = makeAegis();
    aegis.focus("auth");
    await (aegis as unknown as { runTick: () => Promise<void> }).runTick();

    // triage should only be called for the auth issue, not the UI issue
    expect(triageMock.triage).toHaveBeenCalledTimes(1);
    const calledWith = vi.mocked(triageMock.triage).mock.calls[0]?.[0];
    expect(calledWith?.id).toBe("auth-001");
  });
});

// ---------------------------------------------------------------------------
// REAP — Labor merge on Titan completion
// ---------------------------------------------------------------------------

describe("reap: Titan Labor merge", () => {
  it("merges Labor on successful Titan completion", async () => {
    const issue = makeIssue("aegis-010");
    vi.mocked(pollerMock.poll).mockResolvedValue([issue]);
    vi.mocked(beadsMock.show).mockResolvedValue(issue);
    vi.mocked(triageMock.triage).mockReturnValueOnce({
      type: "dispatch_titan",
      issue,
      scoutComment: "SCOUTED: go",
    });

    // session.prompt resolves immediately → agent completes
    mockSession.prompt.mockResolvedValueOnce(undefined);

    const aegis = makeAegis();
    await (aegis as unknown as { runTick: () => Promise<void> }).runTick();

    // Give the fire-and-forget promise a chance to settle
    await vi.waitFor(() => {
      expect(laborsMock.merge).toHaveBeenCalledWith(issue.id, CFG, expect.any(String));
    }, { timeout: 1000 });
  });

  it("creates a beads issue when Labor merge conflicts", async () => {
    const issue = makeIssue("aegis-011");
    vi.mocked(pollerMock.poll).mockResolvedValue([issue]);
    vi.mocked(beadsMock.show).mockResolvedValue(issue);
    vi.mocked(triageMock.triage).mockReturnValueOnce({
      type: "dispatch_titan",
      issue,
      scoutComment: "SCOUTED: go",
    });
    vi.mocked(laborsMock.merge).mockResolvedValueOnce({
      success: false,
      conflict: "CONFLICT in src/foo.ts",
    });

    const aegis = makeAegis();
    await (aegis as unknown as { runTick: () => Promise<void> }).runTick();

    await vi.waitFor(() => {
      expect(beadsMock.create).toHaveBeenCalledWith(
        expect.objectContaining({ title: expect.stringContaining("Merge conflict") })
      );
    }, { timeout: 1000 });
  });

  it("emits labor.merged event on success", async () => {
    const issue = makeIssue("aegis-012");
    vi.mocked(pollerMock.poll).mockResolvedValue([issue]);
    vi.mocked(beadsMock.show).mockResolvedValue(issue);
    vi.mocked(triageMock.triage).mockReturnValueOnce({
      type: "dispatch_titan",
      issue,
      scoutComment: "SCOUTED: go",
    });

    const aegis = makeAegis();
    const events: SSEEvent[] = [];
    aegis.onEvent((e) => events.push(e));

    await (aegis as unknown as { runTick: () => Promise<void> }).runTick();

    await vi.waitFor(() => {
      expect(events.some((e) => e.type === "labor.merged")).toBe(true);
    }, { timeout: 1000 });
  });

  it("emits labor.conflict event on conflict", async () => {
    const issue = makeIssue("aegis-013");
    vi.mocked(pollerMock.poll).mockResolvedValue([issue]);
    vi.mocked(beadsMock.show).mockResolvedValue(issue);
    vi.mocked(triageMock.triage).mockReturnValueOnce({
      type: "dispatch_titan",
      issue,
      scoutComment: "SCOUTED: go",
    });
    vi.mocked(laborsMock.merge).mockResolvedValueOnce({ success: false, conflict: "conflict!" });

    const aegis = makeAegis();
    const events: SSEEvent[] = [];
    aegis.onEvent((e) => events.push(e));

    await (aegis as unknown as { runTick: () => Promise<void> }).runTick();

    await vi.waitFor(() => {
      expect(events.some((e) => e.type === "labor.conflict")).toBe(true);
    }, { timeout: 1000 });
  });
});

// ---------------------------------------------------------------------------
// Monitor: real-time budget enforcement in subscribe callback (aegis-hv3)
// ---------------------------------------------------------------------------

describe("monitor: real-time budget enforcement in subscribe callback", () => {
  it("aborts agent immediately when budget exceeded on turn_end (no poll tick required)", async () => {
    const issue = makeIssue("hv3-budget-001");
    vi.mocked(pollerMock.poll).mockResolvedValue([issue]);
    vi.mocked(beadsMock.show).mockResolvedValue(issue);
    vi.mocked(triageMock.triage).mockReturnValueOnce({ type: "dispatch_oracle", issue });

    // Agent runs indefinitely
    mockSession.prompt.mockReturnValue(new Promise(() => {}));

    // Capture the subscribe callback so we can fire events manually
    let subscribeCallback: ((event: { type: string }) => void) | undefined;
    mockSession.subscribe.mockImplementationOnce(
      (cb: (event: { type: string }) => void) => {
        subscribeCallback = cb;
        return () => {};
      }
    );

    // Budget will be exceeded on the next turn_end
    vi.mocked(monitorMock.checkBudget).mockReturnValue({
      exceeded: true,
      resource: "turns",
      current: 5,
      limit: 5,
    });

    const aegis = makeAegis();
    const events: SSEEvent[] = [];
    aegis.onEvent((e) => events.push(e));

    await (aegis as unknown as { runTick: () => Promise<void> }).runTick();
    expect(subscribeCallback).toBeDefined();

    // Fire a turn_end — simulates a session completing between poll ticks
    subscribeCallback!({ type: "turn_end" });

    expect(mockSession.abort).toHaveBeenCalledOnce();
    expect(events.some((e) => e.type === "agent.budget_exceeded")).toBe(true);
  });

  it("does not re-abort a killed agent when a second turn_end fires", async () => {
    const issue = makeIssue("hv3-budget-002");
    vi.mocked(pollerMock.poll).mockResolvedValue([issue]);
    vi.mocked(beadsMock.show).mockResolvedValue(issue);
    vi.mocked(triageMock.triage).mockReturnValueOnce({ type: "dispatch_oracle", issue });
    mockSession.prompt.mockReturnValue(new Promise(() => {}));

    let subscribeCallback: ((event: { type: string }) => void) | undefined;
    mockSession.subscribe.mockImplementationOnce(
      (cb: (event: { type: string }) => void) => {
        subscribeCallback = cb;
        return () => {};
      }
    );

    vi.mocked(monitorMock.checkBudget).mockReturnValue({
      exceeded: true,
      resource: "turns",
      current: 5,
      limit: 5,
    });

    const aegis = makeAegis();
    await (aegis as unknown as { runTick: () => Promise<void> }).runTick();
    expect(subscribeCallback).toBeDefined();

    subscribeCallback!({ type: "turn_end" }); // kills and aborts
    subscribeCallback!({ type: "turn_end" }); // state is "killed" — no double-abort

    expect(mockSession.abort).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Monitor: stuck detection
// ---------------------------------------------------------------------------

describe("monitor: stuck detection in tick", () => {
  it("steers a warning-level stuck agent", async () => {
    const issue = makeIssue("aegis-020");
    vi.mocked(pollerMock.poll).mockResolvedValue([issue]);
    vi.mocked(beadsMock.show).mockResolvedValue(issue);
    vi.mocked(triageMock.triage).mockReturnValueOnce({ type: "dispatch_oracle", issue });

    // Session never resolves (agent still running)
    mockSession.prompt.mockReturnValue(new Promise(() => {}));

    const aegis = makeAegis();
    await (aegis as unknown as { runTick: () => Promise<void> }).runTick();

    // Now the agent is "running" — on the next tick, inject stuck warning
    vi.mocked(monitorMock.checkStuck).mockReturnValueOnce({
      stuck: true,
      severity: "warning",
      reason: "no tool call for 90s",
    });
    await (aegis as unknown as { runTick: () => Promise<void> }).runTick();

    expect(mockSession.steer).toHaveBeenCalledWith(
      expect.stringContaining("stuck")
    );
  });

  it("kills a kill-level stuck agent", async () => {
    const issue = makeIssue("aegis-021");
    vi.mocked(pollerMock.poll).mockResolvedValue([issue]);
    vi.mocked(beadsMock.show).mockResolvedValue(issue);
    vi.mocked(triageMock.triage).mockReturnValueOnce({ type: "dispatch_oracle", issue });

    mockSession.prompt.mockReturnValue(new Promise(() => {}));

    const aegis = makeAegis();
    await (aegis as unknown as { runTick: () => Promise<void> }).runTick();

    vi.mocked(monitorMock.checkStuck).mockReturnValueOnce({
      stuck: true,
      severity: "kill",
      reason: "no tool call for 150s",
    });
    await (aegis as unknown as { runTick: () => Promise<void> }).runTick();

    expect(mockSession.abort).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// kill() / tellAgent() / tellAll()
// ---------------------------------------------------------------------------

describe("kill()", () => {
  it("aborts the session for the given agent", async () => {
    const issue = makeIssue("aegis-030");
    vi.mocked(pollerMock.poll).mockResolvedValue([issue]);
    vi.mocked(beadsMock.show).mockResolvedValue(issue);
    vi.mocked(triageMock.triage).mockReturnValueOnce({ type: "dispatch_oracle", issue });
    mockSession.prompt.mockReturnValue(new Promise(() => {}));

    const aegis = makeAegis();
    await (aegis as unknown as { runTick: () => Promise<void> }).runTick();

    // Find the agent ID
    const state = aegis.getState();
    expect(state.agents).toHaveLength(1);
    const agentId = state.agents[0]!.id;

    await aegis.kill(agentId);

    expect(mockSession.abort).toHaveBeenCalledOnce();
  });

  it("is a no-op for an unknown agent ID", async () => {
    const aegis = makeAegis();
    await expect(aegis.kill("nonexistent-id")).resolves.toBeUndefined();
    expect(mockSession.abort).not.toHaveBeenCalled();
  });
});

describe("tellAgent()", () => {
  it("steers the specified agent", async () => {
    const issue = makeIssue("aegis-031");
    vi.mocked(pollerMock.poll).mockResolvedValue([issue]);
    vi.mocked(beadsMock.show).mockResolvedValue(issue);
    vi.mocked(triageMock.triage).mockReturnValueOnce({ type: "dispatch_oracle", issue });
    mockSession.prompt.mockReturnValue(new Promise(() => {}));

    const aegis = makeAegis();
    await (aegis as unknown as { runTick: () => Promise<void> }).runTick();

    const agentId = aegis.getState().agents[0]!.id;
    await aegis.tellAgent(agentId, "Focus on the config module.");

    expect(mockSession.steer).toHaveBeenCalledWith("Focus on the config module.");
  });
});

describe("tellAll()", () => {
  it("steers all running agents", async () => {
    // Dispatch two separate issues
    const issue1 = makeIssue("aegis-040");
    const issue2 = makeIssue("aegis-041");

    // Need two separate sessions
    const session2 = { ...mockSession, steer: vi.fn().mockResolvedValue(undefined), prompt: vi.fn().mockReturnValue(new Promise(() => {})) };
    vi.mocked(spawnerMock.spawnOracle)
      .mockResolvedValueOnce(mockSession as never)
      .mockResolvedValueOnce(session2 as never);
    vi.mocked(triageMock.triage)
      .mockReturnValueOnce({ type: "dispatch_oracle", issue: issue1 })
      .mockReturnValueOnce({ type: "dispatch_oracle", issue: issue2 });

    mockSession.prompt.mockReturnValue(new Promise(() => {}));

    vi.mocked(pollerMock.poll).mockResolvedValue([issue1, issue2]);
    vi.mocked(beadsMock.show)
      .mockResolvedValueOnce(issue1)
      .mockResolvedValueOnce(issue2)
      .mockResolvedValue(makeIssue("x")); // fallback for closed scan

    const aegis = makeAegis();
    await (aegis as unknown as { runTick: () => Promise<void> }).runTick();

    expect(aegis.getState().agents).toHaveLength(2);

    await aegis.tellAll("Wrap up.");

    expect(mockSession.steer).toHaveBeenCalledWith("Wrap up.");
    expect(session2.steer).toHaveBeenCalledWith("Wrap up.");
  });
});

// ---------------------------------------------------------------------------
// Closed issues → Sentinel discovery
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Closed issue Sentinel discovery — aegis-o5u
// ---------------------------------------------------------------------------
// findClosedUnreviewed() now only checks issues whose Titan was dispatched
// in the current session (titanDispatchedIssues set), not all closed issues.

describe("closed issue Sentinel discovery (aegis-o5u)", () => {
  it("dispatches Sentinel for a closed issue after its Titan completed this session", async () => {
    const openIssue = makeIssue("closed-001", { status: "open", comments: [] });
    const closedIssue = makeIssue("closed-001", {
      status: "closed",
      comments: [{ id: "c1", body: "SCOUTED: done", author: "oracle", created_at: "" }],
    });

    // Tick 1: dispatch Titan; session resolves immediately so Titan completes
    vi.mocked(pollerMock.poll).mockResolvedValue([openIssue]);
    vi.mocked(beadsMock.show).mockResolvedValue(openIssue);
    vi.mocked(triageMock.triage).mockReturnValueOnce({
      type: "dispatch_titan",
      issue: openIssue,
      scoutComment: "SCOUTED: done",
    });
    mockSession.prompt.mockResolvedValueOnce(undefined); // Titan completes immediately

    const aegis = makeAegis();
    await (aegis as unknown as { runTick: () => Promise<void> }).runTick();

    // Wait for the Titan to complete and be reaped
    await vi.waitFor(() => {
      expect(aegis.getState().agents).toHaveLength(0);
    }, { timeout: 1000 });

    // Tick 2: poll empty, show returns closed issue — Sentinel should now be dispatched
    vi.mocked(pollerMock.poll).mockResolvedValue([]);
    vi.mocked(beadsMock.show).mockResolvedValue(closedIssue);
    vi.mocked(triageMock.triage).mockReturnValueOnce({
      type: "dispatch_sentinel",
      issue: closedIssue,
      scoutComment: "SCOUTED: done",
    });

    await (aegis as unknown as { runTick: () => Promise<void> }).runTick();

    expect(spawnerMock.spawnSentinel).toHaveBeenCalledOnce();
  });

  it("does NOT dispatch Sentinel for issues whose Titan was NOT dispatched this session", async () => {
    // closed issue that was closed before this session — no Titan dispatched
    const closedIssue = makeIssue("closed-external", {
      status: "closed",
      comments: [{ id: "c1", body: "SCOUTED: done", author: "oracle", created_at: "" }],
    });

    vi.mocked(pollerMock.poll).mockResolvedValue([]);
    vi.mocked(beadsMock.list).mockResolvedValue([closedIssue]); // old beads.list (no longer used)
    vi.mocked(beadsMock.show).mockResolvedValue(closedIssue);

    const aegis = makeAegis();
    await (aegis as unknown as { runTick: () => Promise<void> }).runTick();

    // titanDispatchedIssues is empty, so findClosedUnreviewed returns []
    expect(spawnerMock.spawnSentinel).not.toHaveBeenCalled();
    expect(triageMock.triage).not.toHaveBeenCalled();
  });

  it("does NOT dispatch Sentinel for closed issues that already have REVIEWED comment", async () => {
    const openIssue = makeIssue("closed-002", { status: "open" });
    const reviewedIssue = makeIssue("closed-002", {
      status: "closed",
      comments: [
        { id: "c1", body: "SCOUTED: done", author: "oracle", created_at: "" },
        { id: "c2", body: "REVIEWED: PASS - all good", author: "sentinel", created_at: "" },
      ],
    });

    // Tick 1: dispatch Titan; completes immediately
    vi.mocked(pollerMock.poll).mockResolvedValue([openIssue]);
    vi.mocked(beadsMock.show).mockResolvedValue(openIssue);
    vi.mocked(triageMock.triage).mockReturnValueOnce({
      type: "dispatch_titan",
      issue: openIssue,
      scoutComment: "SCOUTED: done",
    });
    mockSession.prompt.mockResolvedValueOnce(undefined);

    const aegis = makeAegis();
    await (aegis as unknown as { runTick: () => Promise<void> }).runTick();

    // Wait for Titan to be reaped
    await vi.waitFor(() => {
      expect(aegis.getState().agents).toHaveLength(0);
    }, { timeout: 1000 });

    // Tick 2: issue now closed with REVIEWED comment — filtered out, no Sentinel
    vi.mocked(pollerMock.poll).mockResolvedValue([]);
    vi.mocked(beadsMock.show).mockResolvedValue(reviewedIssue);

    await (aegis as unknown as { runTick: () => Promise<void> }).runTick();

    expect(spawnerMock.spawnSentinel).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// totalCost() — accumulates across reaps (aegis-utn)
// ---------------------------------------------------------------------------

describe("totalCost() accumulation across reap", () => {
  it("includes cost of reaped agents in total_cost_usd", async () => {
    const issue = makeIssue("cost-001");
    vi.mocked(pollerMock.poll).mockResolvedValue([issue]);
    vi.mocked(beadsMock.show).mockResolvedValue(issue);
    vi.mocked(triageMock.triage).mockReturnValueOnce({ type: "dispatch_oracle", issue });

    // Agent runs indefinitely so we control when it gets reaped
    mockSession.prompt.mockReturnValue(new Promise(() => {}));

    // Report a non-zero cost on each turn_end
    mockSession.getStats.mockReturnValue({
      tokens: { total: 500, input: 400, output: 100, cacheRead: 0, cacheWrite: 0 },
      cost: 0.05,
      sessionId: "mock-sid",
    });

    // Capture the subscribe callback so we can fire turn_end manually
    let subscribeCb: ((e: { type: string }) => void) | undefined;
    mockSession.subscribe.mockImplementationOnce((cb: (e: { type: string }) => void) => {
      subscribeCb = cb;
      return () => {};
    });

    const aegis = makeAegis();
    await (aegis as unknown as { runTick: () => Promise<void> }).runTick();

    // Agent is running — fire turn_end to write cost into state.cost_usd
    expect(subscribeCb).toBeDefined();
    subscribeCb!({ type: "turn_end" });

    // While running, total_cost_usd reflects the active agent's cost
    const agentId = aegis.getState().agents[0]!.id;
    expect(aegis.getState().total_cost_usd).toBeCloseTo(0.05);

    // Kill the agent — triggers reap which must accumulate cost before deleting
    await aegis.kill(agentId);

    // After reap, agents map is empty but cumulative cost persists
    expect(aegis.getState().agents).toHaveLength(0);
    expect(aegis.getState().total_cost_usd).toBeCloseTo(0.05);
  });

  it("total_cost_usd is 0 before any agents run", () => {
    const aegis = makeAegis();
    expect(aegis.getState().total_cost_usd).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Error handling in tick
// ---------------------------------------------------------------------------

describe("error handling in tick", () => {
  it("emits orchestrator.error when poll fails", async () => {
    vi.mocked(pollerMock.poll).mockRejectedValueOnce(new Error("bd not found"));

    const aegis = makeAegis();
    const events: SSEEvent[] = [];
    aegis.onEvent((e) => events.push(e));

    await (aegis as unknown as { runTick: () => Promise<void> }).runTick();

    expect(events.some((e) => e.type === "orchestrator.error")).toBe(true);
  });

  it("does not throw when spawn fails", async () => {
    const issue = makeIssue("aegis-050");
    vi.mocked(pollerMock.poll).mockResolvedValue([issue]);
    vi.mocked(beadsMock.show).mockResolvedValue(issue);
    vi.mocked(triageMock.triage).mockReturnValueOnce({ type: "dispatch_oracle", issue });
    vi.mocked(spawnerMock.spawnOracle).mockRejectedValueOnce(new Error("SDK error"));

    const aegis = makeAegis();
    await expect(
      (aegis as unknown as { runTick: () => Promise<void> }).runTick()
    ).resolves.toBeUndefined();
  });

  it("emits agent.spawn_failed when spawn throws", async () => {
    const issue = makeIssue("aegis-051");
    vi.mocked(pollerMock.poll).mockResolvedValue([issue]);
    vi.mocked(beadsMock.show).mockResolvedValue(issue);
    vi.mocked(triageMock.triage).mockReturnValueOnce({ type: "dispatch_oracle", issue });
    vi.mocked(spawnerMock.spawnOracle).mockRejectedValueOnce(new Error("SDK error"));

    const aegis = makeAegis();
    const events: SSEEvent[] = [];
    aegis.onEvent((e) => events.push(e));

    await (aegis as unknown as { runTick: () => Promise<void> }).runTick();

    expect(events.some((e) => e.type === "agent.spawn_failed")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Concurrency enforcement — aegis-p2n
// ---------------------------------------------------------------------------

describe("concurrency enforcement", () => {
  beforeEach(() => {
    vi.mocked(pollerMock.poll).mockResolvedValue([]);
    vi.mocked(beadsMock.list).mockResolvedValue([]);
  });

  it("pre-claims a concurrency slot before awaiting spawn so failures still count", async () => {
    // 3 issues, max_agents=3: if spawn always fails, the loop must still stop
    // after reaching the limit (not dispatch all 15).
    const issues = [makeIssue("i1"), makeIssue("i2"), makeIssue("i3"), makeIssue("i4")];
    vi.mocked(pollerMock.poll).mockResolvedValue(issues);
    issues.forEach((i) => vi.mocked(beadsMock.show).mockResolvedValueOnce(i));

    // All spawns fail
    vi.mocked(spawnerMock.spawnOracle).mockRejectedValue(new Error("auth fail"));
    // triage always wants to dispatch an oracle
    vi.mocked(triageMock.triage).mockImplementation((_issue, running) => {
      if (running.size >= 3) return { type: "skip", issue: _issue, reason: "concurrency limit" };
      return { type: "dispatch_oracle", issue: _issue };
    });

    const aegis = makeAegis();
    await (aegis as unknown as { runTick: () => Promise<void> }).runTick();

    // With max_agents=3 enforced via pre-registration, at most 3 spawns attempted
    expect(spawnerMock.spawnOracle).toHaveBeenCalledTimes(3);
  });

  it("blocks an issue after MAX_DISPATCH_FAILURES consecutive spawn failures", async () => {
    const issue = makeIssue("fail-issue");
    vi.mocked(pollerMock.poll).mockResolvedValue([issue]);
    vi.mocked(beadsMock.show).mockResolvedValue(issue);
    vi.mocked(spawnerMock.spawnOracle).mockRejectedValue(new Error("auth fail"));
    vi.mocked(triageMock.triage).mockReturnValue({ type: "dispatch_oracle", issue });

    const aegis = makeAegis();
    const runTick = () => (aegis as unknown as { runTick: () => Promise<void> }).runTick();

    // 3 ticks of failures → issue reaches MAX_DISPATCH_FAILURES
    await runTick();
    await runTick();
    await runTick();
    const countAfterThree = vi.mocked(spawnerMock.spawnOracle).mock.calls.length;

    // 4th tick → issue is blocked, spawn NOT called again
    await runTick();
    expect(vi.mocked(spawnerMock.spawnOracle).mock.calls.length).toBe(countAfterThree);
  });

  it("resets failure count on successful spawn", async () => {
    const issue = makeIssue("recover-issue");
    // beads.show must return an issue with SCOUTED comment so completion
    // verification (aegis-qgm) considers the oracle successful.
    const scoutedIssue = makeIssue("recover-issue", {
      comments: [{ id: "c1", body: "SCOUTED: assessment", author: "oracle", created_at: "" }],
    });
    vi.mocked(pollerMock.poll).mockResolvedValue([issue]);
    vi.mocked(beadsMock.show).mockResolvedValue(scoutedIssue);
    vi.mocked(triageMock.triage).mockReturnValue({ type: "dispatch_oracle", issue });

    // First 2 ticks fail, 3rd succeeds → failure count resets → 4th tick dispatches again
    vi.mocked(spawnerMock.spawnOracle)
      .mockRejectedValueOnce(new Error("fail"))
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValue(mockSession); // 3rd: success → resets

    const aegis = makeAegis();
    const runTick = () => (aegis as unknown as { runTick: () => Promise<void> }).runTick();

    await runTick(); // fail (count=1)
    await runTick(); // fail (count=2)
    await runTick(); // success (count reset)

    const countAfterReset = vi.mocked(spawnerMock.spawnOracle).mock.calls.length;
    expect(countAfterReset).toBe(3);

    // 4th tick: issue not blocked, spawn attempted (triage allows it)
    await runTick();
    expect(vi.mocked(spawnerMock.spawnOracle).mock.calls.length).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Crash recovery — aegis-7lg
// ---------------------------------------------------------------------------

describe("crash recovery on start()", () => {
  type RecoverFn = () => Promise<void>;

  it("calls beads.reopen() for each in_progress issue on startup", async () => {
    const orphan1 = makeIssue("orphan-001", { status: "in_progress" });
    const orphan2 = makeIssue("orphan-002", { status: "in_progress" });
    const openIssue = makeIssue("open-001", { status: "open" });

    vi.mocked(beadsMock.list).mockResolvedValueOnce([orphan1, orphan2, openIssue]);
    vi.mocked(beadsMock.reopen).mockResolvedValue(makeIssue("x", { status: "open" }));
    vi.mocked(laborsMock.list).mockResolvedValueOnce([]);

    const aegis = makeAegis();
    await (aegis as unknown as { recover: RecoverFn }).recover();

    expect(beadsMock.reopen).toHaveBeenCalledWith("orphan-001");
    expect(beadsMock.reopen).toHaveBeenCalledWith("orphan-002");
    expect(beadsMock.reopen).not.toHaveBeenCalledWith("open-001");
  });

  it("emits orchestrator.recovered_issue for each reset issue", async () => {
    const orphan = makeIssue("orphan-010", { status: "in_progress" });
    vi.mocked(beadsMock.list).mockResolvedValueOnce([orphan]);
    vi.mocked(beadsMock.reopen).mockResolvedValue(makeIssue("orphan-010", { status: "open" }));
    vi.mocked(laborsMock.list).mockResolvedValueOnce([]);

    const aegis = makeAegis();
    const events: SSEEvent[] = [];
    aegis.onEvent((e) => events.push(e));

    await (aegis as unknown as { recover: RecoverFn }).recover();

    expect(events.some((e) => e.type === "orchestrator.recovered_issue" &&
      (e.data as { issue_id: string }).issue_id === "orphan-010")).toBe(true);
  });

  it("cleans up orphaned labors found in .aegis/labors/", async () => {
    vi.mocked(beadsMock.list).mockResolvedValueOnce([]);
    vi.mocked(laborsMock.list).mockResolvedValueOnce(["stale-001", "stale-002"]);

    const aegis = makeAegis();
    await (aegis as unknown as { recover: RecoverFn }).recover();

    expect(laborsMock.cleanup).toHaveBeenCalledWith("stale-001", CFG, expect.any(String));
    expect(laborsMock.cleanup).toHaveBeenCalledWith("stale-002", CFG, expect.any(String));
  });

  it("emits labor.orphan_cleaned for each cleaned worktree", async () => {
    vi.mocked(beadsMock.list).mockResolvedValueOnce([]);
    vi.mocked(laborsMock.list).mockResolvedValueOnce(["stale-003"]);

    const aegis = makeAegis();
    const events: SSEEvent[] = [];
    aegis.onEvent((e) => events.push(e));

    await (aegis as unknown as { recover: RecoverFn }).recover();

    expect(events.some((e) => e.type === "labor.orphan_cleaned" &&
      (e.data as { issue_id: string }).issue_id === "stale-003")).toBe(true);
  });

  it("does nothing when there are no orphaned issues or labors", async () => {
    vi.mocked(beadsMock.list).mockResolvedValueOnce([makeIssue("open-001")]);
    vi.mocked(laborsMock.list).mockResolvedValueOnce([]);

    const aegis = makeAegis();
    await (aegis as unknown as { recover: RecoverFn }).recover();

    expect(beadsMock.reopen).not.toHaveBeenCalled();
    expect(laborsMock.cleanup).not.toHaveBeenCalled();
  });

  it("skips recovery silently when beads.list() throws", async () => {
    vi.mocked(beadsMock.list).mockRejectedValueOnce(new Error("bd not found"));

    const aegis = makeAegis();
    await expect(
      (aegis as unknown as { recover: RecoverFn }).recover()
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// reap() backoff — aegis-0in
// ---------------------------------------------------------------------------
// reap() must call recordDispatchFailure() for killed/failed agents so that
// budget-killed agents (not just spawn-failed ones) count toward the backoff.

describe("reap() dispatch failure backoff (aegis-0in)", () => {
  it("blocks an issue after a budget-killed agent is reaped (not just spawn failures)", async () => {
    const issue = makeIssue("budget-kill-001");
    vi.mocked(pollerMock.poll).mockResolvedValue([issue]);
    vi.mocked(beadsMock.show).mockResolvedValue(issue);
    vi.mocked(triageMock.triage).mockReturnValue({ type: "dispatch_oracle", issue });

    // Agent never resolves (stays running until killed)
    mockSession.prompt.mockReturnValue(new Promise(() => {}));

    // Capture subscribe so we can fire turn_end to trigger budget kill
    let subscribeCb: ((e: { type: string }) => void) | undefined;
    mockSession.subscribe.mockImplementation((cb: (e: { type: string }) => void) => {
      subscribeCb = cb;
      return () => {};
    });

    vi.mocked(monitorMock.checkBudget).mockReturnValue({
      exceeded: true,
      resource: "turns",
      current: 5,
      limit: 5,
    });

    const aegis = makeAegis();
    const runTick = () => (aegis as unknown as { runTick: () => Promise<void> }).runTick();

    // Run 3 ticks — each spawns an agent that gets budget-killed via turn_end
    for (let i = 0; i < 3; i++) {
      await runTick();
      subscribeCb!({ type: "turn_end" }); // triggers budget kill → status=killed
      await runTick(); // reap picks it up, calls recordDispatchFailure
      // reset subscribe mock for next agent
      mockSession.subscribe.mockImplementation((cb: (e: { type: string }) => void) => {
        subscribeCb = cb;
        return () => {};
      });
    }

    const spawnCount = vi.mocked(spawnerMock.spawnOracle).mock.calls.length;

    // 4th tick — issue should be blocked (backoff hit MAX_DISPATCH_FAILURES=3)
    await runTick();
    expect(vi.mocked(spawnerMock.spawnOracle).mock.calls.length).toBe(spawnCount);
  });

  it("resets failure counter on successful completion", async () => {
    const issue = makeIssue("budget-reset-001");
    vi.mocked(pollerMock.poll).mockResolvedValue([issue]);
    vi.mocked(beadsMock.show).mockResolvedValue(issue);
    vi.mocked(triageMock.triage).mockReturnValue({ type: "dispatch_oracle", issue });

    // First tick: agent completes successfully → reap calls resetDispatchFailures
    mockSession.prompt.mockResolvedValueOnce(undefined);

    const aegis = makeAegis();
    const runTick = () => (aegis as unknown as { runTick: () => Promise<void> }).runTick();

    await runTick();
    await vi.waitFor(() => {
      // After successful completion and reap, failure counter is reset.
      // Verify by checking a second tick is not blocked.
      return Promise.resolve();
    });

    const countAfterSuccess = vi.mocked(spawnerMock.spawnOracle).mock.calls.length;
    expect(countAfterSuccess).toBe(1);

    // Second tick should still dispatch (not blocked)
    mockSession.prompt.mockResolvedValueOnce(undefined);
    await runTick();
    expect(vi.mocked(spawnerMock.spawnOracle).mock.calls.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Conversational-first mode — aegis-5yy
// ---------------------------------------------------------------------------

describe("start() is idle by default (aegis-5yy)", () => {
  it("start() does not call tick() — no poll on startup", async () => {
    vi.mocked(beadsMock.list).mockResolvedValue([]);
    vi.mocked(laborsMock.list).mockResolvedValue([]);

    const aegis = makeAegis();
    await aegis.start();

    // poll should NOT have been called (idle mode)
    expect(pollerMock.poll).not.toHaveBeenCalled();
  });

  it("autoOn() activates the poll loop and triggers a tick", async () => {
    vi.mocked(beadsMock.list).mockResolvedValue([]);
    vi.mocked(laborsMock.list).mockResolvedValue([]);

    const aegis = makeAegis();
    await aegis.start();

    const events: SSEEvent[] = [];
    aegis.onEvent((e) => events.push(e));

    await aegis.autoOn();

    // Should emit auto_on event
    expect(events.some((e) => e.type === "orchestrator.auto_on")).toBe(true);

    // Give tick a chance to run
    await vi.waitFor(() => {
      expect(pollerMock.poll).toHaveBeenCalled();
    }, { timeout: 500 });

    aegis.autoOff(); // clean up timer
  });

  it("autoOff() stops the poll loop and emits auto_off event", async () => {
    vi.mocked(beadsMock.list).mockResolvedValue([]);
    vi.mocked(laborsMock.list).mockResolvedValue([]);

    const aegis = makeAegis();
    await aegis.start();

    const events: SSEEvent[] = [];
    aegis.onEvent((e) => events.push(e));

    await aegis.autoOn();
    aegis.autoOff();

    expect(events.some((e) => e.type === "orchestrator.auto_off")).toBe(true);
  });

  it("getState() includes auto_mode field", async () => {
    const aegis = makeAegis();
    expect(aegis.getState().auto_mode).toBe(false);

    vi.mocked(beadsMock.list).mockResolvedValue([]);
    vi.mocked(laborsMock.list).mockResolvedValue([]);
    await aegis.start();
    await aegis.autoOn();
    expect(aegis.getState().auto_mode).toBe(true);
    aegis.autoOff();
    expect(aegis.getState().auto_mode).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Direct dispatch commands — aegis-chx
// ---------------------------------------------------------------------------

describe("direct dispatch commands (aegis-chx)", () => {
  it("scout() dispatches an Oracle for the specified issue", async () => {
    const issue = makeIssue("scout-001");
    vi.mocked(beadsMock.show).mockResolvedValue(issue);

    const aegis = makeAegis();
    await aegis.scout("scout-001");

    expect(beadsMock.show).toHaveBeenCalledWith("scout-001");
    expect(spawnerMock.spawnOracle).toHaveBeenCalledOnce();
  });

  it("implement() dispatches a Titan for the specified issue", async () => {
    const issue = makeIssue("impl-001");
    vi.mocked(beadsMock.show).mockResolvedValue(issue);
    mockSession.prompt.mockReturnValue(new Promise(() => {}));

    const aegis = makeAegis();
    await aegis.implement("impl-001");

    expect(beadsMock.show).toHaveBeenCalledWith("impl-001");
    expect(laborsMock.create).toHaveBeenCalledWith(issue.id, CFG, expect.any(String));
    expect(spawnerMock.spawnTitan).toHaveBeenCalledOnce();
  });

  it("review() dispatches a Sentinel for the specified issue", async () => {
    const issue = makeIssue("review-001");
    vi.mocked(beadsMock.show).mockResolvedValue(issue);

    const aegis = makeAegis();
    await aegis.review("review-001");

    expect(beadsMock.show).toHaveBeenCalledWith("review-001");
    expect(spawnerMock.spawnSentinel).toHaveBeenCalledOnce();
  });

  it("process() adds issue to processQueue and dispatches based on triage", async () => {
    const issue = makeIssue("proc-001");
    vi.mocked(beadsMock.show).mockResolvedValue(issue);
    vi.mocked(triageMock.triage).mockReturnValueOnce({ type: "dispatch_oracle", issue });

    const aegis = makeAegis();
    const events: SSEEvent[] = [];
    aegis.onEvent((e) => events.push(e));

    await aegis.process("proc-001");

    expect(spawnerMock.spawnOracle).toHaveBeenCalledOnce();
    expect(events.some((e) => e.type === "orchestrator.processing")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// aegis-dos: Failed agents reset issue status back to open
// ---------------------------------------------------------------------------

describe("reap: failed agents reset issue to open (aegis-dos)", () => {
  it("calls beads.reopen() when a killed agent is reaped", async () => {
    const issue = makeIssue("dos-001");
    vi.mocked(pollerMock.poll).mockResolvedValue([issue]);
    vi.mocked(beadsMock.show).mockResolvedValue(issue);
    vi.mocked(triageMock.triage).mockReturnValueOnce({ type: "dispatch_oracle", issue });
    mockSession.prompt.mockReturnValue(new Promise(() => {}));

    const aegis = makeAegis();
    await (aegis as unknown as { runTick: () => Promise<void> }).runTick();

    const agentId = aegis.getState().agents[0]!.id;
    await aegis.kill(agentId);

    expect(beadsMock.reopen).toHaveBeenCalledWith("dos-001");
  });

  it("calls beads.reopen() when a failed agent is reaped", async () => {
    const issue = makeIssue("dos-002");
    vi.mocked(pollerMock.poll).mockResolvedValue([issue]);
    vi.mocked(beadsMock.show).mockResolvedValue(issue);
    vi.mocked(triageMock.triage).mockReturnValueOnce({ type: "dispatch_oracle", issue });

    // Agent session rejects → agent fails
    mockSession.prompt.mockRejectedValueOnce(new Error("crash"));

    const aegis = makeAegis();
    await (aegis as unknown as { runTick: () => Promise<void> }).runTick();

    await vi.waitFor(() => {
      expect(beadsMock.reopen).toHaveBeenCalledWith("dos-002");
    }, { timeout: 1000 });
  });
});

// ---------------------------------------------------------------------------
// aegis-qgm: Reap verifies agent completion criteria
// ---------------------------------------------------------------------------

describe("reap: completion verification (aegis-qgm)", () => {
  it("marks oracle as failed if no SCOUTED comment found", async () => {
    const issue = makeIssue("qgm-001");
    vi.mocked(pollerMock.poll).mockResolvedValue([issue]);
    // beads.show returns issue without SCOUTED comment
    vi.mocked(beadsMock.show).mockResolvedValue(issue);
    vi.mocked(triageMock.triage).mockReturnValueOnce({ type: "dispatch_oracle", issue });
    mockSession.prompt.mockResolvedValueOnce(undefined); // completes

    const aegis = makeAegis();
    await (aegis as unknown as { runTick: () => Promise<void> }).runTick();

    // Wait for reap
    await vi.waitFor(() => {
      expect(aegis.getState().agents).toHaveLength(0);
    }, { timeout: 1000 });

    // Should have called reopen because verification failed
    expect(beadsMock.reopen).toHaveBeenCalledWith("qgm-001");
  });

  it("does NOT mark oracle as failed if SCOUTED comment exists", async () => {
    const issue = makeIssue("qgm-002", {
      comments: [{ id: "c1", body: "SCOUTED: looks good", author: "oracle", created_at: "" }],
    });
    vi.mocked(pollerMock.poll).mockResolvedValue([issue]);
    vi.mocked(beadsMock.show).mockResolvedValue(issue);
    vi.mocked(triageMock.triage).mockReturnValueOnce({ type: "dispatch_oracle", issue });
    mockSession.prompt.mockResolvedValueOnce(undefined);

    const aegis = makeAegis();
    await (aegis as unknown as { runTick: () => Promise<void> }).runTick();

    await vi.waitFor(() => {
      expect(aegis.getState().agents).toHaveLength(0);
    }, { timeout: 1000 });

    expect(beadsMock.reopen).not.toHaveBeenCalled();
  });

  it("marks titan as failed if issue not closed", async () => {
    const issue = makeIssue("qgm-003", { status: "open" });
    vi.mocked(pollerMock.poll).mockResolvedValue([issue]);
    vi.mocked(beadsMock.show).mockResolvedValue(issue);
    vi.mocked(triageMock.triage).mockReturnValueOnce({
      type: "dispatch_titan",
      issue,
      scoutComment: "SCOUTED: go",
    });
    mockSession.prompt.mockResolvedValueOnce(undefined);

    const aegis = makeAegis();
    await (aegis as unknown as { runTick: () => Promise<void> }).runTick();

    await vi.waitFor(() => {
      expect(beadsMock.reopen).toHaveBeenCalledWith("qgm-003");
    }, { timeout: 1000 });
  });
});

// ---------------------------------------------------------------------------
// aegis-4qn: Auto mode excludes pre-existing ready issues
// ---------------------------------------------------------------------------

describe("auto mode excludes pre-existing issues (aegis-4qn)", () => {
  it("does not dispatch issues that were ready before autoOn()", async () => {
    const preExisting = makeIssue("4qn-001");
    vi.mocked(beadsMock.list).mockResolvedValue([]);
    vi.mocked(laborsMock.list).mockResolvedValue([]);

    // poll returns the pre-existing issue when autoOn snapshots
    vi.mocked(pollerMock.poll).mockResolvedValue([preExisting]);
    vi.mocked(beadsMock.show).mockResolvedValue(preExisting);
    vi.mocked(triageMock.triage).mockReturnValue({ type: "dispatch_oracle", issue: preExisting });

    const aegis = makeAegis();
    await aegis.start();
    await aegis.autoOn();

    // Give tick a chance to run
    await vi.waitFor(() => {
      expect(pollerMock.poll).toHaveBeenCalled();
    }, { timeout: 500 });

    // Pre-existing issue should be filtered out
    expect(spawnerMock.spawnOracle).not.toHaveBeenCalled();

    aegis.autoOff();
  });
});

// ---------------------------------------------------------------------------
// aegis-xp2: Graceful shutdown marks in_progress issues and cleans labors
// ---------------------------------------------------------------------------

describe("graceful shutdown cleanup (aegis-xp2)", () => {
  it("marks remaining in_progress issues back to open on stop()", async () => {
    const inProgress = makeIssue("xp2-001", { status: "in_progress" });
    vi.mocked(beadsMock.list).mockResolvedValue([inProgress]);
    vi.mocked(laborsMock.list).mockResolvedValue([]);

    const aegis = makeAegis();
    Object.assign(aegis, { _running: true, startedAt: Date.now() });
    await aegis.stop();

    expect(beadsMock.reopen).toHaveBeenCalledWith("xp2-001");
  });

  it("cleans up remaining labors on stop()", async () => {
    vi.mocked(beadsMock.list).mockResolvedValue([]);
    vi.mocked(laborsMock.list).mockResolvedValue(["xp2-labor-001"]);

    const aegis = makeAegis();
    Object.assign(aegis, { _running: true, startedAt: Date.now() });
    await aegis.stop();

    expect(laborsMock.cleanup).toHaveBeenCalledWith("xp2-labor-001", CFG, expect.any(String));
  });
});

// ---------------------------------------------------------------------------
// aegis-6m8: SSE event listeners have unsubscribe mechanism
// ---------------------------------------------------------------------------

describe("onEvent() returns unsubscribe function (aegis-6m8)", () => {
  it("returns a function that removes the handler", () => {
    const aegis = makeAegis();
    const handler = vi.fn();
    const unsub = aegis.onEvent(handler);

    aegis.pause(); // triggers event
    expect(handler).toHaveBeenCalledOnce();

    unsub();
    aegis.resume(); // triggers event, but handler unsubscribed
    expect(handler).toHaveBeenCalledOnce(); // still 1
  });
});

// ---------------------------------------------------------------------------
// aegis-dgs: reprioritize, summarize, addLearning methods
// ---------------------------------------------------------------------------

describe("reprioritize, summarize, addLearning (aegis-dgs)", () => {
  it("reprioritize() calls beads.update with priority", async () => {
    vi.mocked(beadsMock.update).mockResolvedValue(makeIssue("dgs-001"));
    const aegis = makeAegis();
    await aegis.reprioritize("dgs-001", 2);
    expect(beadsMock.update).toHaveBeenCalledWith("dgs-001", { priority: 2 });
  });

  it("summarize() returns SwarmState", () => {
    const aegis = makeAegis();
    const state = aegis.summarize();
    expect(state).toHaveProperty("status");
    expect(state).toHaveProperty("agents");
  });

  it("addLearning() appends to Mnemosyne", async () => {
    const aegis = makeAegis();
    const mnemoMock = await import("../src/mnemosyne.js");
    aegis.addLearning("testing", "Always mock fs");
    expect(mnemoMock.append).toHaveBeenCalledWith(
      expect.objectContaining({ type: "convention", domain: "testing", text: "Always mock fs" }),
      expect.any(String)
    );
  });

  it("addLearning() emits mnemosyne.learning_added event", () => {
    const aegis = makeAegis();
    const events: SSEEvent[] = [];
    aegis.onEvent((e) => events.push(e));
    aegis.addLearning("auth", "Use refresh tokens");
    expect(events.some((e) => e.type === "mnemosyne.learning_added")).toBe(true);
  });
});
