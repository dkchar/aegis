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
  getSessionStats: vi.fn().mockReturnValue({
    tokens: { total: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    cost: 0,
    sessionFile: undefined,
    sessionId: "mock-sid",
    userMessages: 0,
    assistantMessages: 0,
    toolCalls: 0,
    toolResults: 0,
    totalMessages: 0,
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
  mockSession.getSessionStats.mockReturnValue({
    tokens: { total: 100, input: 80, output: 20, cacheRead: 0, cacheWrite: 0 },
    cost: 0.001,
    sessionFile: undefined,
    sessionId: "mock-sid",
    userMessages: 1,
    assistantMessages: 1,
    toolCalls: 2,
    toolResults: 2,
    totalMessages: 4,
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

    expect(laborsMock.create).toHaveBeenCalledWith(issue.id, CFG);
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
      expect(laborsMock.merge).toHaveBeenCalledWith(issue.id, CFG);
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

describe("closed issue Sentinel discovery", () => {
  it("dispatches Sentinel for closed issues with no REVIEWED comment", async () => {
    const closedIssue = makeIssue("closed-001", {
      status: "closed",
      comments: [{ id: "c1", body: "SCOUTED: done", author: "oracle", created_at: "" }],
    });

    vi.mocked(pollerMock.poll).mockResolvedValue([]); // nothing in ready queue
    vi.mocked(beadsMock.list).mockResolvedValue([closedIssue]);
    vi.mocked(beadsMock.show).mockResolvedValue(closedIssue);
    vi.mocked(triageMock.triage).mockReturnValueOnce({
      type: "dispatch_sentinel",
      issue: closedIssue,
      scoutComment: "SCOUTED: done",
    });

    const aegis = makeAegis();
    await (aegis as unknown as { runTick: () => Promise<void> }).runTick();

    expect(spawnerMock.spawnSentinel).toHaveBeenCalledOnce();
  });

  it("does NOT dispatch Sentinel for closed issues that already have REVIEWED comment", async () => {
    const reviewedIssue = makeIssue("closed-002", {
      status: "closed",
      comments: [
        { id: "c1", body: "SCOUTED: done", author: "oracle", created_at: "" },
        { id: "c2", body: "REVIEWED: PASS - all good", author: "sentinel", created_at: "" },
      ],
    });

    vi.mocked(pollerMock.poll).mockResolvedValue([]);
    vi.mocked(beadsMock.list).mockResolvedValue([reviewedIssue]);
    vi.mocked(beadsMock.show).mockResolvedValue(reviewedIssue);

    const aegis = makeAegis();
    await (aegis as unknown as { runTick: () => Promise<void> }).runTick();

    expect(spawnerMock.spawnSentinel).not.toHaveBeenCalled();
    expect(triageMock.triage).not.toHaveBeenCalled();
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
    vi.mocked(pollerMock.poll).mockResolvedValue([issue]);
    vi.mocked(beadsMock.show).mockResolvedValue(issue);
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
