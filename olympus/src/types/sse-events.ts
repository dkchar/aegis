/**
 * SSE event types that the Olympus client subscribes to.
 * These mirror the server-side event types defined in src/events/event-bus.ts.
 */

/** Canonical SSE event types from the server. */
export type SseEventType =
  | "orchestrator.state"
  | "launch.sequence"
  | "control.command"
  | "scope.suppression";

/** Server-side live event envelope — matches src/events/event-bus.ts LiveEventEnvelope. */
export interface ServerLiveEventEnvelope<TPayload = Record<string, unknown>> {
  id: string;
  type: SseEventType;
  timestamp: string;
  sequence: number;
  payload: TPayload;
}

/** Base SSE event envelope exposed to the UI. */
export interface SseEvent<T = unknown> {
  type: SseEventType;
  data: T;
  id?: string;
}

/** Orchestrator state update event. */
export interface OrchestratorStateEvent extends SseEvent {
  type: "orchestrator.state";
  data: {
    status: {
      mode: "conversational" | "auto";
      isRunning: boolean;
      uptimeSeconds: number;
      activeAgents: number;
      queueDepth: number;
      paused: boolean;
    };
    spend: {
      metering: string;
      costUsd?: number;
      quotaUsedPct?: number;
      quotaRemainingPct?: number;
      totalInputTokens: number;
      totalOutputTokens: number;
    };
    agents: Array<{
      agentId: string;
      caste: string;
      model: string;
      issueId: string;
      stage: string;
      turnCount: number;
      inputTokens: number;
      outputTokens: number;
      elapsedSeconds: number;
      spendUsd?: number;
    }>;
  };
}

/** Command result event — emitted when a control command completes. */
export interface CommandResultEvent extends SseEvent {
  type: "control.command";
  data: {
    command: string;
    success: boolean;
    result?: string;
    error?: string;
  };
}
