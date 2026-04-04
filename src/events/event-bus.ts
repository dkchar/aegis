import type {
  ControlApiAction,
  OrchestrationMode,
  ServerLifecycleState,
} from "../server/routes.js";

export const LIVE_EVENT_ENVELOPE_FIELDS = [
  "id",
  "type",
  "timestamp",
  "sequence",
  "payload",
] as const;

export const LIVE_EVENT_TYPES = [
  "orchestrator.state",
  "launch.sequence",
  "control.command",
] as const;

export type LiveEventType = (typeof LIVE_EVENT_TYPES)[number];

export interface OrchestratorStateEventPayload {
  server_state: ServerLifecycleState;
  mode: OrchestrationMode;
  uptime_ms: number;
  queue_depth: number;
}

export interface LaunchSequenceEventPayload {
  phase: "launch" | "shutdown";
  step: string;
  status: "started" | "completed" | "failed";
  detail: string;
}

export interface ControlCommandEventPayload {
  action: ControlApiAction;
  request_id: string;
  status: "accepted" | "completed" | "failed";
  detail: string;
}

export interface LiveEventPayloadMap {
  "orchestrator.state": OrchestratorStateEventPayload;
  "launch.sequence": LaunchSequenceEventPayload;
  "control.command": ControlCommandEventPayload;
}

export type LiveEventPayload<TType extends LiveEventType> = LiveEventPayloadMap[TType];

export interface LiveEventEnvelope<TType extends LiveEventType = LiveEventType> {
  id: string;
  type: TType;
  timestamp: string;
  sequence: number;
  payload: LiveEventPayload<TType>;
}

export type AegisLiveEvent = {
  [K in LiveEventType]: LiveEventEnvelope<K>;
}[LiveEventType];

const LIVE_EVENT_PAYLOAD_FIELDS: {
  [K in LiveEventType]: readonly (keyof LiveEventPayloadMap[K])[];
} = {
  "orchestrator.state": ["server_state", "mode", "uptime_ms", "queue_depth"],
  "launch.sequence": ["phase", "step", "status", "detail"],
  "control.command": ["action", "request_id", "status", "detail"],
};

export function isLiveEventType(value: string): value is LiveEventType {
  return LIVE_EVENT_TYPES.includes(value as LiveEventType);
}

export function getLiveEventPayloadFields(eventType: string): readonly string[] {
  if (!isLiveEventType(eventType)) {
    throw new Error(`Unknown live event type: ${eventType}`);
  }

  return LIVE_EVENT_PAYLOAD_FIELDS[eventType];
}

export function createLiveEvent<TType extends LiveEventType>(
  event: LiveEventEnvelope<TType>,
): LiveEventEnvelope<TType> {
  return event;
}

export interface LiveEventPublisher {
  publish(event: AegisLiveEvent): void;
  subscribe(listener: (event: AegisLiveEvent) => void): () => void;
}

export interface ReplayableLiveEventPublisher extends LiveEventPublisher {
  replay(afterEventId?: string | null): AegisLiveEvent[];
  snapshot(): AegisLiveEvent[];
}

export interface InMemoryLiveEventBusOptions {
  replayLimit?: number;
}

export const DEFAULT_LIVE_EVENT_REPLAY_LIMIT = 250;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertLiveEvent(event: AegisLiveEvent) {
  if (event.id.trim().length === 0) {
    throw new Error("Live event id must be a non-empty string.");
  }

  if (!isLiveEventType(event.type)) {
    throw new Error(`Unknown live event type: ${event.type}`);
  }

  if (!Number.isInteger(event.sequence) || event.sequence < 1) {
    throw new Error("Live event sequence must be a positive integer.");
  }

  if (Number.isNaN(Date.parse(event.timestamp))) {
    throw new Error("Live event timestamp must be a valid ISO-8601 string.");
  }

  if (!isRecord(event.payload)) {
    throw new Error("Live event payload must be an object.");
  }

  const requiredFields = getLiveEventPayloadFields(event.type);

  for (const field of requiredFields) {
    if (!Object.hasOwn(event.payload, field)) {
      throw new Error(`Missing required payload field "${field}" for ${event.type}.`);
    }
  }
}

function normalizeReplayLimit(value: number | undefined) {
  if (!Number.isInteger(value) || value === undefined || value < 1) {
    return DEFAULT_LIVE_EVENT_REPLAY_LIMIT;
  }

  return value;
}

export function createInMemoryLiveEventBus(
  options: InMemoryLiveEventBusOptions = {},
): ReplayableLiveEventPublisher {
  const replayLimit = normalizeReplayLimit(options.replayLimit);
  const listeners = new Set<(event: AegisLiveEvent) => void>();
  let history: AegisLiveEvent[] = [];

  return {
    publish(event) {
      assertLiveEvent(event);
      history.push(event);

      if (history.length > replayLimit) {
        history = history.slice(history.length - replayLimit);
      }

      for (const listener of listeners) {
        listener(event);
      }
    },
    subscribe(listener) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    replay(afterEventId) {
      if (!afterEventId) {
        return [...history];
      }

      const index = history.findIndex((event) => event.id === afterEventId);

      if (index < 0) {
        return [...history];
      }

      return history.slice(index + 1);
    },
    snapshot() {
      return [...history];
    },
  };
}
