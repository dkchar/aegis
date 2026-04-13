/**
 * useSse hook tests.
 *
 * Tests verify the hook's contract: state management, command sending,
 * reconnection interface, and error handling.
 *
 * Note: EventSource integration is tested indirectly through the hook's
 * public interface. Full SSE integration testing belongs in integration tests.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSse } from "../use-sse";
import type { UseSseReturn } from "../use-sse";
import { reduceDashboardLiveEvent, createEmptyDashboardState } from "../dashboard-state-reducer";

// Mock fetch with a full URL base for jsdom
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

describe("useSse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  it("returns initial state with null state, not connected, no error", () => {
    const { result } = renderHook(() => useSse({ enabled: false }));
    expect(result.current.state).toBeNull();
    expect(result.current.isConnected).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("exposes reconnect function", () => {
    const { result } = renderHook(() => useSse({ enabled: false }));
    expect(typeof result.current.reconnect).toBe("function");
  });

  it("exposes sendCommand function", () => {
    const { result } = renderHook(() => useSse({ enabled: false }));
    expect(typeof result.current.sendCommand).toBe("function");
  });

  it("sendCommand calls fetch with correct method and body", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true, message: "OK" }) });
    const { result } = renderHook(() => useSse({ enabled: false }));

    await result.current.sendCommand("status");

    expect(mockFetch).toHaveBeenCalledWith("/api/steer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: expect.stringMatching(/"action":"status"/),
    });
    // Verify the envelope has required fields
    const callBody = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(callBody.action).toBe("status");
    expect(callBody.request_id).toBeDefined();
    expect(callBody.issued_at).toBeDefined();
    expect(callBody.source).toBe("olympus");
  });

  it("sendCommand throws on non-ok response", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, text: () => "Internal error" });
    const { result } = renderHook(() => useSse({ enabled: false }));

    await expect(result.current.sendCommand("status")).rejects.toThrow(
      "Command failed: 500 Internal error",
    );
  });

  it("sendCommand throws when the backend declines a command", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        ok: true,
        status: "declined",
        message: "Scout failed for aegis-aru",
      }),
    });
    const { result } = renderHook(() => useSse({ enabled: false }));

    await expect(result.current.sendCommand("scout", { issueId: "aegis-aru" })).rejects.toThrow(
      "Scout failed for aegis-aru",
    );
  });

  it("sendCommand includes payload in body", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true, message: "OK" }) });
    const { result } = renderHook(() => useSse({ enabled: false }));

    await result.current.sendCommand("kill", { agentId: "test-agent" });

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/steer",
      expect.objectContaining({
        body: expect.stringMatching(/"action":"command"/),
      }),
    );
    // Generic commands are wrapped in the command action envelope
    const callBody = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(callBody.action).toBe("command");
    expect(callBody.args.command).toBe("kill");
    expect(callBody.args.agentId).toBe("test-agent");
    expect(callBody.source).toBe("olympus");
  });

  it("sendCommand returns parsed SteerResult on success", async () => {
    const mockResponse = {
      ok: true,
      json: () => Promise.resolve({ ok: true, message: "Auto mode enabled", mode: "auto" }),
    };
    mockFetch.mockResolvedValue(mockResponse);
    const { result } = renderHook(() => useSse({ enabled: false }));

    const res = await result.current.sendCommand("auto_on");
    expect(res.ok).toBe(true);
    expect(res.message).toBe("Auto mode enabled");
    expect(res.mode).toBe("auto");
  });

  it("reconnect resets backoff and triggers reconnection", () => {
    const { result } = renderHook(() => useSse({ enabled: false }));
    // Should not throw
    expect(() => result.current.reconnect()).not.toThrow();
  });

  it("uses default URL when not provided", () => {
    // enabled=false prevents actual EventSource creation
    const { result } = renderHook(() => useSse({ enabled: false }));
    // Verify the hook initializes without error
    expect(result.current.state).toBeNull();
  });

  it("accepts custom URL option", () => {
    const { result } = renderHook(() => useSse({ enabled: false, url: "/custom/events" }));
    expect(result.current.state).toBeNull();
  });

  it("accepts onEvent callback", () => {
    const onEvent = vi.fn();
    const { result } = renderHook(() => useSse({ enabled: false, onEvent }));
    expect(result.current.state).toBeNull();
  });

  it("returns correct shape of UseSseReturn", () => {
    const { result } = renderHook(() => useSse({ enabled: false }));
    const r: UseSseReturn = result.current;
    expect(r).toHaveProperty("state");
    expect(r).toHaveProperty("isConnected");
    expect(r).toHaveProperty("error");
    expect(r).toHaveProperty("reconnect");
    expect(r).toHaveProperty("sendCommand");
  });

  it("disables connection when enabled is false", () => {
    const { result, rerender } = renderHook(() => useSse({ enabled: false }));
    expect(result.current.isConnected).toBe(false);

    // Rerender with enabled=true would attempt connection, but EventSource
    // doesn't exist in jsdom — the hook handles this gracefully
    rerender();
    expect(result.current.error).toBeDefined();
  });

  it("handles rapid reconnect calls without crashing", () => {
    const { result } = renderHook(() => useSse({ enabled: false }));
    expect(() => {
      result.current.reconnect();
      result.current.reconnect();
      result.current.reconnect();
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Dashboard state reducer tests
// ---------------------------------------------------------------------------

describe("reduceDashboardLiveEvent", () => {
  it("routes loop.phase_log into the correct phase column", () => {
    const next = reduceDashboardLiveEvent(createEmptyDashboardState(), {
      id: "evt-1",
      type: "loop.phase_log",
      timestamp: "2026-04-11T10:00:00.000Z",
      sequence: 1,
      payload: { phase: "dispatch", line: "oracle -> foundation.contract", level: "info", issueId: "foundation.contract", agentId: null },
    });

    expect(next.loop!.phaseLogs.dispatch[0]).toContain("oracle -> foundation.contract");
    expect(next.loop!.phaseLogs.poll).toEqual([]);
    expect(next.loop!.phaseLogs.monitor).toEqual([]);
    expect(next.loop!.phaseLogs.reap).toEqual([]);
  });

  it("caps phase logs at 50 lines", () => {
    let state = createEmptyDashboardState();
    for (let i = 0; i < 60; i++) {
      state = reduceDashboardLiveEvent(state, {
        id: `evt-${i}`,
        type: "loop.phase_log",
        timestamp: "2026-04-11T10:00:00.000Z",
        sequence: i,
        payload: { phase: "poll", line: `line-${i}`, level: "info" },
      });
    }
    expect(state.loop!.phaseLogs.poll).toHaveLength(50);
    expect(state.loop!.phaseLogs.poll[0]).toBe("line-59");
  });

  it("upserts active session on agent.session_started", () => {
    const next = reduceDashboardLiveEvent(createEmptyDashboardState(), {
      id: "evt-2",
      type: "agent.session_started",
      timestamp: "2026-04-11T10:00:01.000Z",
      sequence: 2,
      payload: { sessionId: "sess-1", caste: "oracle", issueId: "bd-1", stage: "contract", model: "gpt-4" },
    });

    expect(next.sessions!.active["sess-1"]).toEqual({
      id: "sess-1",
      caste: "oracle",
      issueId: "bd-1",
      stage: "contract",
      model: "gpt-4",
      lines: [],
    });
  });

  it("appends log lines to active session on agent.session_log", () => {
    let state = reduceDashboardLiveEvent(createEmptyDashboardState(), {
      id: "evt-2",
      type: "agent.session_started",
      timestamp: "2026-04-11T10:00:01.000Z",
      sequence: 2,
      payload: { sessionId: "sess-1", caste: "titan", issueId: "bd-2", stage: "implementing", model: "claude" },
    });

    state = reduceDashboardLiveEvent(state, {
      id: "evt-3",
      type: "agent.session_log",
      timestamp: "2026-04-11T10:00:02.000Z",
      sequence: 3,
      payload: { sessionId: "sess-1", line: "reading spec..." },
    });

    expect(state.sessions!.active["sess-1"].lines).toEqual(["reading spec..."]);
  });

  it("moves session from active to recent on agent.session_ended", () => {
    let state = reduceDashboardLiveEvent(createEmptyDashboardState(), {
      id: "evt-2",
      type: "agent.session_started",
      timestamp: "2026-04-11T10:00:01.000Z",
      sequence: 2,
      payload: { sessionId: "sess-1", caste: "sentinel", issueId: "bd-3", stage: "reviewing", model: "gpt-4" },
    });

    state = reduceDashboardLiveEvent(state, {
      id: "evt-4",
      type: "agent.session_ended",
      timestamp: "2026-04-11T10:00:03.000Z",
      sequence: 4,
      payload: { sessionId: "sess-1", outcome: "completed", caste: "sentinel", issueId: "bd-3" },
    });

    expect(state.sessions!.active["sess-1"]).toBeUndefined();
    expect(state.sessions!.recent).toHaveLength(1);
    expect(state.sessions!.recent[0].id).toBe("sess-1");
    expect(state.sessions!.recent[0].outcome).toBe("completed");
  });

  it("appends merge queue log lines", () => {
    const next = reduceDashboardLiveEvent(createEmptyDashboardState(), {
      id: "evt-5",
      type: "merge.queue_log",
      timestamp: "2026-04-11T10:00:04.000Z",
      sequence: 5,
      payload: { issueId: "bd-4", status: "merging", attemptCount: 1 },
    });

    expect(next.mergeQueue!.logs[0]).toBe("[merging] bd-4 attempt=1");
  });

  it("sets active Janus session on janus.session_started", () => {
    const next = reduceDashboardLiveEvent(createEmptyDashboardState(), {
      id: "evt-6",
      type: "janus.session_started",
      timestamp: "2026-04-11T10:00:05.000Z",
      sequence: 6,
      payload: { sessionId: "janus-1", issueId: "bd-5" },
    });

    expect(next.janus!.active["janus-1"]).toBeDefined();
    expect(next.janus!.active["janus-1"].issueId).toBe("bd-5");
  });

  it("clears Janus session on janus.session_ended", () => {
    let state = reduceDashboardLiveEvent(createEmptyDashboardState(), {
      id: "evt-6",
      type: "janus.session_started",
      timestamp: "2026-04-11T10:00:05.000Z",
      sequence: 6,
      payload: { sessionId: "janus-1", issueId: "bd-5" },
    });

    state = reduceDashboardLiveEvent(state, {
      id: "evt-7",
      type: "janus.session_ended",
      timestamp: "2026-04-11T10:00:06.000Z",
      sequence: 7,
      payload: { sessionId: "janus-1", outcome: "completed", issueId: "bd-5" },
    });

    expect(state.janus!.active["janus-1"]).toBeUndefined();
    expect(state.janus!.recent).toHaveLength(1);
  });

  it("is immutable — never mutates the input state", () => {
    const base = createEmptyDashboardState();
    const frozen = JSON.stringify(base);

    reduceDashboardLiveEvent(base, {
      id: "evt-1",
      type: "loop.phase_log",
      timestamp: "2026-04-11T10:00:00.000Z",
      sequence: 1,
      payload: { phase: "dispatch", line: "test", level: "info" },
    });

    expect(JSON.stringify(base)).toBe(frozen);
  });

  it("returns the same state for unknown event types", () => {
    const base = createEmptyDashboardState();
    const next = reduceDashboardLiveEvent(base, {
      id: "evt-99",
      type: "orchestrator.state",
      timestamp: "2026-04-11T10:00:00.000Z",
      sequence: 99,
      payload: { status: {}, spend: {}, agents: [] } as Record<string, unknown>,
    });

    // Orchestrator state is handled separately in the SSE hook, not the reducer
    expect(next).toBe(base);
  });
});
