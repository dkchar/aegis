import { useEffect, useRef, useState, useCallback } from "react";
import type { SseEvent, OrchestratorStateEvent, CommandResultEvent } from "../types/sse-events";
import type { DashboardState, ActiveAgentInfo } from "../types/dashboard-state";

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
  sendCommand: (command: string, payload?: Record<string, unknown>) => Promise<void>;
}

const DEFAULT_SSE_URL = "/api/events";
const STATE_URL = "/api/state";
const STEER_URL = "/api/steer";
const RECONNECT_DELAY_MS = 3000;

/**
 * SSE client hook for Olympus.
 *
 * Connects to the server's SSE endpoint, maintains the latest dashboard state,
 * and provides a command-sending helper for the control API.
 */
export function useSse(options: UseSseOptions = {}): UseSseReturn {
  const { url = DEFAULT_SSE_URL, enabled = true, onEvent } = options;

  const [state, setState] = useState<DashboardState | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  /** Fetch the full dashboard state via REST. */
  const fetchState = useCallback(async () => {
    try {
      const res = await fetch(STATE_URL);
      if (!res.ok) {
        throw new Error(`Failed to fetch state: ${res.status} ${res.statusText}`);
      }
      const data: DashboardState = await res.json();
      setState(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown state fetch error";
      setError(msg);
    }
  }, []);

  /** Establish SSE connection. */
  const connect = useCallback(() => {
    if (!enabled) return;

    // Close any existing connection first
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    try {
      const es = new EventSource(url);
      eventSourceRef.current = es;

      es.onopen = () => {
        setIsConnected(true);
        setError(null);
        // Fetch initial state on connect
        void fetchState();
      };

      es.onerror = () => {
        setIsConnected(false);
        // Don't set error here — EventSource handles reconnect automatically
      };

      // Listen for orchestrator state updates
      es.addEventListener("orchestrator.state", (rawEvent) => {
        const message = (rawEvent as MessageEvent).data;
        try {
          const parsed: OrchestratorStateEvent = JSON.parse(message);
          setState({
            status: {
              mode: parsed.data.status.mode as "conversational" | "auto",
              isRunning: parsed.data.status.isRunning,
              uptimeSeconds: parsed.data.status.uptimeSeconds,
              activeAgents: parsed.data.status.activeAgents,
              queueDepth: parsed.data.status.queueDepth,
            },
            spend: {
              metering: parsed.data.spend.metering as DashboardState["spend"]["metering"],
              costUsd: parsed.data.spend.costUsd,
              quotaUsedPct: parsed.data.spend.quotaUsedPct,
              quotaRemainingPct: parsed.data.spend.quotaRemainingPct,
              totalInputTokens: parsed.data.spend.totalInputTokens,
              totalOutputTokens: parsed.data.spend.totalOutputTokens,
            },
            agents: parsed.data.agents.map((a) => ({
              agentId: a.agentId,
              caste: a.caste as ActiveAgentInfo["caste"],
              model: a.model,
              issueId: a.issueId,
              stage: a.stage,
              turnCount: a.turnCount,
              inputTokens: a.inputTokens,
              outputTokens: a.outputTokens,
              elapsedSeconds: a.elapsedSeconds,
              spendUsd: a.spendUsd,
            })),
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
    }
  }, [enabled, url, fetchState, onEvent]);

  /** Reconnect helper with optional delay. */
  const reconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setTimeout(() => {
      connect();
    }, RECONNECT_DELAY_MS);
  }, [connect]);

  /** Send a command to the control API. */
  const sendCommand = useCallback(
    async (command: string, payload?: Record<string, unknown>) => {
      try {
        const res = await fetch(STEER_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command, ...payload }),
          signal: abortControllerRef.current?.signal,
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Command failed: ${res.status} ${text}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown command error";
        setError(msg);
        throw err;
      }
    },
    [],
  );

  useEffect(() => {
    if (enabled) {
      connect();
    }

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      abortControllerRef.current?.abort();
      setIsConnected(false);
    };
  }, [enabled, connect]);

  return { state, isConnected, error, reconnect, sendCommand };
}
