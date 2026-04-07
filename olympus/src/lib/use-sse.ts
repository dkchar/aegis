import { useEffect, useRef, useState, useCallback } from "react";
import type { SseEvent, OrchestratorStateEvent, CommandResultEvent } from "../types/sse-events";
import type { DashboardState, SpendObservation, ActiveAgentInfo } from "../types/dashboard-state";

/** Options for the useSse hook. */
export interface UseSseOptions {
  /** Base URL for the SSE endpoint. Defaults to "/api/events". */
  url?: string;
  /** Whether to automatically connect. Defaults to true. */
  enabled?: boolean;
  /** Called when a non-state SSE event arrives. */
  onEvent?: (event: SseEvent) => void;
}

/** Return value of the useSse hook. */
export interface UseSseReturn {
  /** Latest dashboard state from the server. */
  state: DashboardState | null;
  /** Whether an SSE connection is currently active. */
  isConnected: boolean;
  /** The last error encountered, if any. */
  error: string | null;
  /** Manually reconnect. */
  reconnect: () => void;
  /** Send a command to the control API. */
  sendCommand: (command: string, payload?: Record<string, unknown>) => Promise<Response>;
}

const DEFAULT_SSE_URL = "/api/events";
const STATE_URL = "/api/state";
const STEER_URL = "/api/steer";

// Exponential backoff configuration
const INITIAL_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 30000;
const RECONNECT_MULTIPLIER = 2;
const RECONNECT_JITTER_MS = 500;

/** Calculate reconnect delay with exponential backoff and jitter. */
function calculateBackoff(attempt: number): number {
  const exponential = Math.min(
    INITIAL_RECONNECT_DELAY_MS * Math.pow(RECONNECT_MULTIPLIER, attempt),
    MAX_RECONNECT_DELAY_MS,
  );
  const jitter = Math.random() * RECONNECT_JITTER_MS;
  return exponential + jitter;
}

/**
 * SSE client hook for Olympus.
 *
 * Connects to the server's SSE endpoint, maintains the latest dashboard state,
 * and provides a command-sending helper for the control API.
 *
 * Features:
 * - Automatic reconnection with exponential backoff on disconnect
 * - Initial state fetch on connect
 * - Parse orchestrator.state and control.command events
 * - Exposes sendCommand for the control API
 */
export function useSse(options: UseSseOptions = {}): UseSseReturn {
  const { url = DEFAULT_SSE_URL, enabled = true, onEvent } = options;

  const [state, setState] = useState<DashboardState | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isManualCloseRef = useRef(false);

  /** Clear any pending reconnect timer. */
  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  /** Close the current SSE connection cleanly. */
  const closeConnection = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    clearReconnectTimer();
    setIsConnected(false);
  }, [clearReconnectTimer]);

  /** Fetch the full dashboard state via REST. */
  const fetchState = useCallback(async () => {
    try {
      const res = await fetch(STATE_URL);
      if (!res.ok) {
        throw new Error(`Failed to fetch state: ${res.status} ${res.statusText}`);
      }
      const data: DashboardState = await res.json();
      setState(data);
      setError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown state fetch error";
      setError(msg);
    }
  }, []);

  /** Schedule a reconnect with exponential backoff. */
  const scheduleReconnect = useCallback(() => {
    if (isManualCloseRef.current) return;

    const delay = calculateBackoff(reconnectAttemptRef.current);
    reconnectAttemptRef.current += 1;

    reconnectTimerRef.current = setTimeout(() => {
      connect();
    }, delay);
  }, []);

  /** Establish SSE connection. */
  const connect = useCallback(() => {
    if (!enabled) return;

    // Close any existing connection first
    closeConnection();
    isManualCloseRef.current = false;

    try {
      const es = new EventSource(url);
      eventSourceRef.current = es;

      es.onopen = () => {
        reconnectAttemptRef.current = 0; // Reset backoff on successful connect
        setIsConnected(true);
        setError(null);
        // Fetch initial state on connect
        void fetchState();
      };

      es.onerror = () => {
        setIsConnected(false);
        // Don't set error here — EventSource handles reconnect automatically
        // Schedule reconnection with exponential backoff
        scheduleReconnect();
      };

      // Listen for orchestrator state updates
      es.addEventListener("orchestrator.state", (rawEvent) => {
        const message = (rawEvent as MessageEvent).data;
        try {
          const parsed: OrchestratorStateEvent = JSON.parse(message);
          // Cast SSE string fields to their constrained union types
          const agents: DashboardState["agents"] = parsed.data.agents.map((a) => ({
            ...a,
            caste: a.caste as ActiveAgentInfo["caste"],
          }));
          const spend: DashboardState["spend"] = {
            ...parsed.data.spend,
            metering: parsed.data.spend.metering as SpendObservation["metering"],
          };
          setState({
            status: parsed.data.status,
            spend,
            agents,
          });
          setError(null);
        } catch {
          // Malformed event — skip silently
        }
      });

      // Listen for command results
      es.addEventListener("control.command", (rawEvent) => {
        const message = (rawEvent as MessageEvent).data;
        try {
          const parsed: CommandResultEvent = JSON.parse(message);
          onEvent?.(parsed);
        } catch {
          // Malformed event — skip silently
        }
      });

      // Generic message handler for other event types
      es.onmessage = (rawEvent) => {
        const message = rawEvent.data;
        try {
          const parsed: SseEvent = JSON.parse(message);
          if (parsed.type !== "orchestrator.state") {
            onEvent?.(parsed);
          }
        } catch {
          // Not JSON — skip
        }
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown SSE connection error";
      setError(msg);
      setIsConnected(false);
      scheduleReconnect();
    }
  }, [enabled, url, fetchState, onEvent, closeConnection, scheduleReconnect]);

  /** Manually reconnect — resets backoff and forces a fresh connection. */
  const reconnect = useCallback(() => {
    isManualCloseRef.current = false;
    reconnectAttemptRef.current = 0;
    closeConnection();
    // Small delay to ensure the old connection is fully cleaned up
    reconnectTimerRef.current = setTimeout(() => {
      connect();
    }, 200);
  }, [closeConnection, connect]);

  /** Send a command to the control API. */
  const sendCommand = useCallback(
    async (command: string, payload?: Record<string, unknown>): Promise<Response> => {
      const res = await fetch(STEER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command, ...payload }),
      });
      if (!res.ok) {
        const text = await res.text();
        const err = new Error(`Command failed: ${res.status} ${text}`);
        setError(err.message);
        throw err;
      }
      return res;
    },
    [],
  );

  useEffect(() => {
    if (enabled) {
      connect();
    }

    return () => {
      isManualCloseRef.current = true;
      closeConnection();
    };
  }, [enabled, connect, closeConnection]);

  return { state, isConnected, error, reconnect, sendCommand };
}
