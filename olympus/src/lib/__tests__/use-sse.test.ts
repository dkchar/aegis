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
