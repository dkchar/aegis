/**
 * Integration tests for PiRuntime — Lane A (aegis-fjm.6.2).
 *
 * Because the Pi SDK requires real API credentials to start a live session,
 * tests use a mock-based approach:
 *   - `@mariozechner/pi-coding-agent` is mocked via vi.mock() so
 *     createAgentSession() returns a fake AgentSession.
 *   - The fake AgentSession has all the methods used by PiAgentHandle,
 *     allowing us to test event mapping, tool restriction, abort cleanup,
 *     and stats without any real API calls.
 *
 * Tests that TRULY require a live Pi session (API key + model) are kept as
 * .todo() stubs.
 *
 * Canonical rules: SPECv2 §8.3, §8.4, and §8.6.
 */

import { describe, expect, it, vi, beforeEach, type MockedFunction } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks (must be defined before vi.mock factory runs)
// ---------------------------------------------------------------------------

// vi.hoisted() runs before module hoisting so these refs are available inside
// the vi.mock() factory even though vi.mock() is hoisted to the top.
const { mockReadOnlyTools, mockCodingTools, mockCreateAgentSession } = vi.hoisted(() => {
  const mockReadOnlyTools = [
    {
      name: "read",
      label: "Read",
      description: "Read a file",
      parameters: {},
      execute: vi.fn(),
    },
  ];
  const mockCodingTools = [
    {
      name: "read",
      label: "Read",
      description: "Read a file",
      parameters: {},
      execute: vi.fn(),
    },
    {
      name: "bash",
      label: "Bash",
      description: "Run bash",
      parameters: {},
      execute: vi.fn(),
    },
    {
      name: "edit",
      label: "Edit",
      description: "Edit a file",
      parameters: {},
      execute: vi.fn(),
    },
    {
      name: "write",
      label: "Write",
      description: "Write a file",
      parameters: {},
      execute: vi.fn(),
    },
  ];
  const mockCreateAgentSession = vi.fn();
  return { mockReadOnlyTools, mockCodingTools, mockCreateAgentSession };
});

// Mock the Pi SDK module.
vi.mock("@mariozechner/pi-coding-agent", () => ({
  createAgentSession: mockCreateAgentSession,
  codingTools: mockCodingTools,
  readOnlyTools: mockReadOnlyTools,
  // Passthrough mock for defineTool — custom-tools.ts imports this
  defineTool: vi.fn((_def: unknown) => _def),
}));

// ---------------------------------------------------------------------------
// Imports (after vi.mock so the hoisted mock is in place)
// ---------------------------------------------------------------------------

import { PiRuntime, PiAgentHandle } from "../../../src/runtime/pi-runtime.js";
import type { AgentRuntime, SpawnOptions } from "../../../src/runtime/agent-runtime.js";
import type { AgentEvent } from "../../../src/runtime/agent-events.js";
import { getModel } from "@mariozechner/pi-ai";

// ---------------------------------------------------------------------------
// Fake session factory
// ---------------------------------------------------------------------------

type SdkEventListener = (evt: Record<string, unknown>) => void;

/** Minimal fake AgentSession that records calls and provides test helpers. */
function makeFakeSession() {
  const subscribers: SdkEventListener[] = [];

  const session = {
    sessionId: "test-session-id",
    state: { errorMessage: undefined as string | undefined },
    subscribe: vi.fn((fn: SdkEventListener) => {
      subscribers.push(fn);
      return () => {
        const idx = subscribers.indexOf(fn);
        if (idx !== -1) subscribers.splice(idx, 1);
      };
    }),
    prompt: vi.fn(async (_msg: string) => {}),
    steer: vi.fn(async (_msg: string) => {}),
    abort: vi.fn(async () => {}),
    dispose: vi.fn(),
    getSessionStats: vi.fn(() => ({
      sessionFile: undefined,
      sessionId: "test-session-id",
      userMessages: 0,
      assistantMessages: 2,
      toolCalls: 1,
      toolResults: 1,
      totalMessages: 4,
      tokens: { input: 500, output: 300, cacheRead: 0, cacheWrite: 0, total: 800 },
      cost: 0,
    })),
    getContextUsage: vi.fn(() => ({
      tokens: 4000,
      contextWindow: 10000,
      percent: 40,
    })),
    /** Test helper: emit an event to all registered subscribers. */
    _emit(evt: Record<string, unknown>) {
      for (const sub of subscribers) sub(evt);
    },
  };

  return session;
}

type FakeSession = ReturnType<typeof makeFakeSession>;

// Helper to register the fake session with the mock.
function setupFakeSession(fakeSession: FakeSession) {
  (mockCreateAgentSession as MockedFunction<typeof mockCreateAgentSession>).mockResolvedValue({
    session: fakeSession,
    extensionsResult: { extensions: [], errors: [] },
  });
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

function makeOpts(overrides: Partial<SpawnOptions> = {}): SpawnOptions {
  return {
    caste: "titan",
    issueId: "aegis-test.1",
    workingDirectory: "C:/dev/aegis",
    toolRestrictions: [],
    budget: { turns: 20, tokens: 10000 },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Structural assertion (live)
// ---------------------------------------------------------------------------

describe("PiRuntime module structure", () => {
  it("exports a PiRuntime class that satisfies the AgentRuntime interface at the type level", () => {
    const runtime: AgentRuntime = new PiRuntime();
    expect(runtime).toBeDefined();
    expect(typeof runtime.spawn).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// Session spawn
// ---------------------------------------------------------------------------

describe("PiRuntime — session spawn", () => {
  let fakeSession: FakeSession;

  beforeEach(() => {
    vi.clearAllMocks();
    fakeSession = makeFakeSession();
    setupFakeSession(fakeSession);
  });

  it("spawn() resolves to a PiAgentHandle without error", async () => {
    const runtime = new PiRuntime();
    const handle = await runtime.spawn(makeOpts());
    expect(handle).toBeDefined();
    expect(handle).toBeInstanceOf(PiAgentHandle);
  });

  it("spawn() passes the correct working directory to createAgentSession", async () => {
    const runtime = new PiRuntime();
    await runtime.spawn(makeOpts({ workingDirectory: "C:/dev/my-project" }));
    expect(mockCreateAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: "C:/dev/my-project" })
    );
  });

  it("spawn() resolves a Gemma model reference before creating the session", async () => {
    const runtime = new PiRuntime();
    await runtime.spawn(makeOpts({ model: "pi:gemma-4-31b-it" }));

    expect(mockCreateAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        model: expect.objectContaining({
          provider: "google",
          id: "gemma-4-31b-it",
        }),
      }),
    );
  });

  it("spawn() disables Pi reasoning metadata for Google Gemma models", async () => {
    const runtime = new PiRuntime();
    await runtime.spawn(makeOpts({ model: "pi:gemma-4-31b-it" }));

    expect(mockCreateAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        model: expect.objectContaining({
          provider: "google",
          id: "gemma-4-31b-it",
          reasoning: false,
        }),
      }),
    );
  });

  it("spawn() omits the explicit model when the reference is pi:default", async () => {
    const runtime = new PiRuntime();
    await runtime.spawn(makeOpts({ model: "pi:default" }));

    expect(mockCreateAgentSession).toHaveBeenCalledWith(
      expect.not.objectContaining({ model: expect.anything() }),
    );
  });

  it("spawn() rejects unknown model references instead of silently falling back", async () => {
    const runtime = new PiRuntime();

    await expect(runtime.spawn(makeOpts({ model: "anthropic:claude-sonnet" }))).rejects.toThrow(
      'Unknown Pi model "anthropic:claude-sonnet"',
    );
    expect(mockCreateAgentSession).not.toHaveBeenCalled();
  });

  it("titan caste receives codingTools (read + write access)", async () => {
    const runtime = new PiRuntime();
    await runtime.spawn(makeOpts({ caste: "titan" }));
    expect(mockCreateAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({ tools: mockCodingTools })
    );
  });

  it("oracle caste receives readOnlyTools", async () => {
    const runtime = new PiRuntime();
    await runtime.spawn(makeOpts({ caste: "oracle" }));
    expect(mockCreateAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({ tools: mockReadOnlyTools })
    );
  });

  it("sentinel caste receives readOnlyTools", async () => {
    const runtime = new PiRuntime();
    await runtime.spawn(makeOpts({ caste: "sentinel" }));
    expect(mockCreateAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({ tools: mockReadOnlyTools })
    );
  });

  it("janus caste receives readOnlyTools", async () => {
    const runtime = new PiRuntime();
    await runtime.spawn(makeOpts({ caste: "janus" }));
    expect(mockCreateAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({ tools: mockReadOnlyTools })
    );
  });

  it("toolRestrictions filters the base tool list — only allowed tools are passed", async () => {
    const runtime = new PiRuntime();
    // titan gets codingTools (read, bash, edit, write); restrict to read + bash only
    await runtime.spawn(makeOpts({ caste: "titan", toolRestrictions: ["read", "bash"] }));
    const call = (mockCreateAgentSession as MockedFunction<typeof mockCreateAgentSession>).mock
      .calls[0][0];
    const names = (call?.tools ?? []).map((t: { name: string }) => t.name);
    expect(names).toEqual(["read", "bash"]);
    expect(names).not.toContain("edit");
    expect(names).not.toContain("write");
  });

  it("empty toolRestrictions passes all base tools unchanged", async () => {
    const runtime = new PiRuntime();
    await runtime.spawn(makeOpts({ caste: "titan", toolRestrictions: [] }));
    expect(mockCreateAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({ tools: mockCodingTools })
    );
  });

  it.todo("spawn() is Windows-safe — path separators do not break process launch (live test)");
  it.todo("spawned session emits session_started event before prompt is accepted (live test)");
});

// ---------------------------------------------------------------------------
// Prompt delivery
// ---------------------------------------------------------------------------

describe("PiRuntime — prompt delivery", () => {
  let fakeSession: FakeSession;
  let handle: PiAgentHandle;

  beforeEach(async () => {
    fakeSession = makeFakeSession();
    setupFakeSession(fakeSession);
    handle = (await new PiRuntime().spawn(makeOpts())) as PiAgentHandle;
  });

  it("prompt() delegates to AgentSession.prompt()", async () => {
    await handle.prompt("Do the thing");
    expect(fakeSession.prompt).toHaveBeenCalledWith("Do the thing");
  });

  it("steer() delegates to AgentSession.steer()", async () => {
    await handle.steer("Actually, stop and reconsider");
    expect(fakeSession.steer).toHaveBeenCalledWith("Actually, stop and reconsider");
  });

  it.todo("prompt() rejects if called before session is started (live test)");
  it.todo("steer() rejects if the session has already ended (live test)");
});

// ---------------------------------------------------------------------------
// Abort and cleanup
// ---------------------------------------------------------------------------

describe("PiRuntime — abort cleanup", () => {
  let fakeSession: FakeSession;
  let handle: PiAgentHandle;

  beforeEach(async () => {
    fakeSession = makeFakeSession();
    setupFakeSession(fakeSession);
    handle = (await new PiRuntime().spawn(makeOpts())) as PiAgentHandle;
  });

  it("abort() calls AgentSession.abort()", async () => {
    await handle.abort();
    expect(fakeSession.abort).toHaveBeenCalledOnce();
  });

  it("abort() triggers a session_ended event with reason = 'aborted'", async () => {
    const events: AgentEvent[] = [];
    handle.subscribe((e) => events.push(e));
    await handle.abort();

    const ended = events.find((e) => e.type === "session_ended");
    expect(ended).toBeDefined();
    expect(ended).toMatchObject({
      type: "session_ended",
      reason: "aborted",
      sessionId: "test-session-id",
    });
  });

  it("abort() calls AgentSession.dispose() for cleanup", async () => {
    await handle.abort();
    expect(fakeSession.dispose).toHaveBeenCalledOnce();
  });

  it("abort() is idempotent — calling it twice does not throw", async () => {
    await expect(handle.abort()).resolves.toBeUndefined();
    await expect(handle.abort()).resolves.toBeUndefined();
    // abort() on the underlying session should only be called once
    expect(fakeSession.abort).toHaveBeenCalledOnce();
  });

  it.todo("abort() preserves the labor worktree directory for post-mortem (live test)");
});

// ---------------------------------------------------------------------------
// Event subscription
// ---------------------------------------------------------------------------

describe("PiRuntime — event subscription", () => {
  let fakeSession: FakeSession;
  let handle: PiAgentHandle;

  beforeEach(async () => {
    fakeSession = makeFakeSession();
    setupFakeSession(fakeSession);
    handle = (await new PiRuntime().spawn(makeOpts())) as PiAgentHandle;
  });

  it("subscribe() returns an unsubscribe function", () => {
    const unsub = handle.subscribe(vi.fn());
    expect(typeof unsub).toBe("function");
  });

  it("unsubscribe function removes the listener — no further events received", () => {
    const listener = vi.fn();
    const unsub = handle.subscribe(listener);
    unsub();

    // Emitting a Pi SDK event after unsubscribe should not call the listener.
    fakeSession._emit({ type: "agent_start" });
    expect(listener).not.toHaveBeenCalled();
  });

  it("multiple listeners can be registered for the same session", () => {
    const l1 = vi.fn();
    const l2 = vi.fn();
    handle.subscribe(l1);
    handle.subscribe(l2);

    fakeSession._emit({ type: "agent_start" });

    expect(l1).toHaveBeenCalled();
    expect(l2).toHaveBeenCalled();
  });

  it("agent_start Pi event → session_started Aegis event", () => {
    const events: AgentEvent[] = [];
    handle.subscribe((e) => events.push(e));

    fakeSession._emit({ type: "agent_start" });

    const ev = events.find((e) => e.type === "session_started");
    expect(ev).toBeDefined();
    expect(ev).toMatchObject({
      type: "session_started",
      issueId: "aegis-test.1",
      caste: "titan",
    });
  });

  it("message_end Pi event (assistant role) → message Aegis event with full text", () => {
    const events: AgentEvent[] = [];
    handle.subscribe((e) => events.push(e));

    fakeSession._emit({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Hello from the agent" }],
      },
    });

    const ev = events.find((e) => e.type === "message");
    expect(ev).toBeDefined();
    expect(ev).toMatchObject({ type: "message", text: "Hello from the agent" });
  });

  it("message_end Pi event (user role) → no message Aegis event emitted", () => {
    const events: AgentEvent[] = [];
    handle.subscribe((e) => events.push(e));

    fakeSession._emit({
      type: "message_end",
      message: { role: "user", content: "hi" },
    });

    const msgEvents = events.filter((e) => e.type === "message");
    expect(msgEvents).toHaveLength(0);
  });

  it("tool_execution_start Pi event → tool_use Aegis event with canonical tool name", () => {
    const events: AgentEvent[] = [];
    handle.subscribe((e) => events.push(e));

    fakeSession._emit({ type: "tool_execution_start", toolCallId: "abc", toolName: "bash", args: {} });

    const ev = events.find((e) => e.type === "tool_use");
    expect(ev).toBeDefined();
    expect(ev).toMatchObject({ type: "tool_use", tool: "bash" });
  });

  it("turn_end Pi event → stats_update Aegis event", () => {
    const events: AgentEvent[] = [];
    handle.subscribe((e) => events.push(e));

    fakeSession._emit({ type: "turn_end", message: {}, toolResults: [] });

    const ev = events.find((e) => e.type === "stats_update");
    expect(ev).toBeDefined();
    expect(ev).toMatchObject({
      type: "stats_update",
      stats: expect.objectContaining({
        input_tokens: expect.any(Number),
        output_tokens: expect.any(Number),
        session_turns: expect.any(Number),
        wall_time_sec: expect.any(Number),
      }),
    });
  });

  it("agent_end Pi event (no error) → session_ended with reason = 'completed'", () => {
    const events: AgentEvent[] = [];
    handle.subscribe((e) => events.push(e));

    fakeSession._emit({ type: "agent_end", messages: [] });

    const ev = events.find((e) => e.type === "session_ended");
    expect(ev).toBeDefined();
    expect(ev).toMatchObject({
      type: "session_ended",
      reason: "completed",
      sessionId: "test-session-id",
    });
  });

  it("agent_end Pi event with state.errorMessage → error event (fatal=true) then session_ended", () => {
    fakeSession.state.errorMessage = "Something went wrong";

    const events: AgentEvent[] = [];
    handle.subscribe((e) => events.push(e));

    fakeSession._emit({ type: "agent_end", messages: [] });

    const errEv = events.find((e) => e.type === "error");
    expect(errEv).toBeDefined();
    expect(errEv).toMatchObject({ type: "error", fatal: true });

    const endEv = events.find((e) => e.type === "session_ended");
    expect(endEv).toBeDefined();
    expect(endEv).toMatchObject({
      type: "session_ended",
      reason: "error",
      sessionId: "test-session-id",
    });
  });

  it("error events with fatal=true are followed by session_ended", () => {
    fakeSession.state.errorMessage = "Fatal error";
    const events: AgentEvent[] = [];
    handle.subscribe((e) => events.push(e));

    fakeSession._emit({ type: "agent_end", messages: [] });

    const types = events.map((e) => e.type);
    const errorIdx = types.indexOf("error");
    const endedIdx = types.indexOf("session_ended");
    expect(errorIdx).toBeGreaterThanOrEqual(0);
    expect(endedIdx).toBeGreaterThan(errorIdx);
  });
});

// ---------------------------------------------------------------------------
// Budget warnings
// ---------------------------------------------------------------------------

describe("PiRuntime — budget warnings", () => {
  it("turn_end emits budget_warning when turn count >= 80% of limit", async () => {
    const fakeSession = makeFakeSession();
    // 17/20 = 0.85 >= 0.8 threshold
    fakeSession.getSessionStats.mockReturnValue({
      sessionFile: undefined,
      sessionId: "test-session-id",
      userMessages: 0,
      assistantMessages: 17,
      toolCalls: 0,
      toolResults: 0,
      totalMessages: 17,
      tokens: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, total: 150 },
      cost: 0,
    });
    setupFakeSession(fakeSession);

    const handle = (await new PiRuntime().spawn(
      makeOpts({ budget: { turns: 20, tokens: 10000 } })
    )) as PiAgentHandle;

    const events: AgentEvent[] = [];
    handle.subscribe((e) => events.push(e));

    fakeSession._emit({ type: "turn_end", message: {}, toolResults: [] });

    const warn = events.find((e) => e.type === "budget_warning");
    expect(warn).toBeDefined();
    expect(warn).toMatchObject({
      type: "budget_warning",
      limitKind: "turns",
      current: 17,
      limit: 20,
    });
    if (warn?.type === "budget_warning") {
      expect(warn.fraction).toBeGreaterThanOrEqual(0.8);
    }
  });

  it("turn_end does NOT emit budget_warning when under 80% of limit", async () => {
    const fakeSession = makeFakeSession();
    // 5/20 = 0.25 < 0.8
    fakeSession.getSessionStats.mockReturnValue({
      sessionFile: undefined,
      sessionId: "test-session-id",
      userMessages: 0,
      assistantMessages: 5,
      toolCalls: 0,
      toolResults: 0,
      totalMessages: 5,
      tokens: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, total: 150 },
      cost: 0,
    });
    setupFakeSession(fakeSession);

    const handle = (await new PiRuntime().spawn(
      makeOpts({ budget: { turns: 20, tokens: 10000 } })
    )) as PiAgentHandle;

    const events: AgentEvent[] = [];
    handle.subscribe((e) => events.push(e));

    fakeSession._emit({ type: "turn_end", message: {}, toolResults: [] });

    const warnings = events.filter((e) => e.type === "budget_warning");
    expect(warnings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Stats reporting
// ---------------------------------------------------------------------------

describe("PiRuntime — stats reporting", () => {
  let fakeSession: FakeSession;
  let handle: PiAgentHandle;

  beforeEach(async () => {
    fakeSession = makeFakeSession();
    setupFakeSession(fakeSession);
    handle = (await new PiRuntime().spawn(makeOpts())) as PiAgentHandle;
  });

  it("getStats() returns a valid AgentStats snapshot at any point during a session", () => {
    const stats = handle.getStats();
    expect(stats).toMatchObject({
      input_tokens: expect.any(Number),
      output_tokens: expect.any(Number),
      session_turns: expect.any(Number),
      wall_time_sec: expect.any(Number),
    });
    expect(stats.input_tokens).toBeGreaterThanOrEqual(0);
    expect(stats.output_tokens).toBeGreaterThanOrEqual(0);
    expect(stats.wall_time_sec).toBeGreaterThanOrEqual(0);
  });

  it("getStats() maps tokens.input and tokens.output from AgentSession.getSessionStats()", () => {
    const stats = handle.getStats();
    // fakeSession default: input=500, output=300
    expect(stats.input_tokens).toBe(500);
    expect(stats.output_tokens).toBe(300);
  });

  it("getStats() maps session_turns from assistantMessages count", () => {
    const stats = handle.getStats();
    // fakeSession default: assistantMessages=2
    expect(stats.session_turns).toBe(2);
  });

  it("getStats() includes active_context_pct when Pi exposes context usage", () => {
    const stats = handle.getStats();
    expect(stats.active_context_pct).toBe(40);
  });

  it("getStats() does not throw after abort()", async () => {
    await handle.abort();
    // After abort+cleanup, getStats() invokes getSessionStats() which the mock still answers.
    expect(() => handle.getStats()).not.toThrow();
  });

  it("final stats in session_ended match getStats() at termination time", async () => {
    const events: AgentEvent[] = [];
    handle.subscribe((e) => events.push(e));
    await handle.abort();

    const ended = events.find((e) => e.type === "session_ended");
    expect(ended).toBeDefined();
    if (ended?.type === "session_ended") {
      expect(ended.stats).toMatchObject({
        input_tokens: 500,
        output_tokens: 300,
        session_turns: 2,
      });
    }
  });

  it.todo("getStats() reflects incremental token usage after each turn (live test)");
  it.todo("stats_update events are emitted periodically with current stats (live test)");
});
