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
