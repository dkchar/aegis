import { useEffect, useRef, useState, useCallback } from "react";
import type { SseEvent, OrchestratorStateEvent, CommandResultEvent, ServerLiveEventEnvelope } from "../types/sse-events";
import type { DashboardState, SpendObservation, ActiveAgentInfo } from "../types/dashboard-state";

/** Known control actions that map directly to server lifecycle actions. */
const CONTROL_ACTIONS = new Set(["start", "stop", "status", "auto_on", "auto_off", "pause", "resume"]);

/** Parsed response from a steer command. */
export interface SteerResult {
  ok: boolean;
  message: string;
  status?: string;
  mode?: string;
  serverState?: string;
  requestId?: string;
  /** Raw response for commands that return additional fields. */
  raw: Record<string, unknown>;
}

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
  /** Send a command to the control API. Returns parsed result. */
  sendCommand: (command: string, payload?: Record<string, unknown>) => Promise<SteerResult>;
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
          // Server sends the full LiveEventEnvelope: { id, type, timestamp, sequence, payload }
          const envelope: ServerLiveEventEnvelope<DashboardState> = JSON.parse(message);
          const payload = envelope.payload;
          // Cast SSE string fields to their constrained union types
          const agents: DashboardState["agents"] = (payload.agents ?? []).map((a) => ({
            ...a,
            caste: a.caste as ActiveAgentInfo["caste"],
          }));
          const spend: DashboardState["spend"] = {
            ...(payload.spend ?? {}),
            metering: (payload.spend?.metering ?? "unknown") as SpendObservation["metering"],
          };
          setState({
            status: payload.status,
            spend,
            agents,
            config: payload.config ?? null,
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
          const envelope: ServerLiveEventEnvelope = JSON.parse(message);
          onEvent?.({
            type: "control.command",
            data: envelope.payload,
            id: envelope.id,
          });
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

  /** Send a command to the control API. Wraps the command in a proper ControlApiRequest envelope. */
  const sendCommand = useCallback(
    async (command: string, payload?: Record<string, unknown>): Promise<SteerResult> => {
      const requestId = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const issuedAt = new Date().toISOString();

      // For commands that need additional parameters (like scout <issueId>),
      // concatenate payload values into the command string when appropriate
      let effectiveCommand = command;
      const argsForEnvelope: Record<string, unknown> = { ...(payload ?? {}) };

      // Commands that expect an issueId as part of the command text
      if (payload?.issueId && typeof payload.issueId === "string") {
        const commandsNeedingIssueId = new Set(["scout", "implement", "review", "focus"]);
        if (commandsNeedingIssueId.has(command)) {
          effectiveCommand = `${command} ${payload.issueId}`;
          delete argsForEnvelope.issueId;
        }
      }

      let body: Record<string, unknown>;
      if (CONTROL_ACTIONS.has(effectiveCommand)) {
        // Control action: { action, request_id, issued_at, source }
        body = {
          action: effectiveCommand,
          request_id: requestId,
          issued_at: issuedAt,
          source: "olympus",
          ...argsForEnvelope,
        };
      } else {
        // Generic command: { action: "command", args: { command, ... }, request_id, issued_at, source }
        body = {
          action: "command",
          request_id: requestId,
          issued_at: issuedAt,
          source: "olympus",
          args: { command: effectiveCommand, ...argsForEnvelope },
        };
      }

      const res = await fetch(STEER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        const err = new Error(`Command failed: ${res.status} ${text}`);
        setError(err.message);
        throw err;
      }
      const data: Record<string, unknown> = await res.json();
      const result: SteerResult = {
        ok: !!data.ok,
        status: typeof data.status === "string" ? data.status : undefined,
        message: (data.message as string) ?? "",
        mode: data.mode as string | undefined,
        serverState: data.server_state as string | undefined,
        requestId: data.request_id as string | undefined,
        raw: data,
      };

      if (!result.ok || result.status === "declined" || result.status === "unsupported") {
        const message = result.message || `Command ${command} was ${result.status ?? "rejected"}.`;
        const err = new Error(message);
        setError(err.message);
        throw err;
      }

      return result;
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
