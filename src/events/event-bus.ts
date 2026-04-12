import type {
  ControlApiAction,
  OrchestrationMode,
  ServerLifecycleState,
} from "../server/routes.js";
import type { SuppressionEntry } from "../core/scope-allocator.js";
import type {
  MergeQueueStateEventPayload,
  MergeOutcomeEventPayload,
  MergeJanusEscalationEventPayload,
} from "./merge-events.js";

// ---------------------------------------------------------------------------
// Loop phase log
// ---------------------------------------------------------------------------

export interface LoopPhaseLogEventPayload {
  phase: "poll" | "dispatch" | "monitor" | "reap";
  line: string;
  level: "info" | "warn" | "error";
  issueId: string | null;
  agentId: string | null;
}

// ---------------------------------------------------------------------------
// Agent session lifecycle
// ---------------------------------------------------------------------------

export interface AgentSessionStartedEventPayload {
  sessionId: string;
  caste: "oracle" | "titan" | "sentinel" | "janus";
  issueId: string;
  stage: string;
  model: string;
}

export interface AgentSessionLogEventPayload {
  sessionId: string;
  caste: "oracle" | "titan" | "sentinel" | "janus";
  issueId: string;
  line: string;
  level: "info" | "warn" | "error";
}

export interface AgentSessionStatsEventPayload {
  sessionId: string;
  caste: "oracle" | "titan" | "sentinel" | "janus";
  issueId: string;
  inputTokens: number;
  outputTokens: number;
  turns: number;
  elapsedSec: number;
}

export interface AgentSessionEndedEventPayload {
  sessionId: string;
  caste: "oracle" | "titan" | "sentinel" | "janus";
  issueId: string;
  outcome: "completed" | "failed" | "aborted";
}

// ---------------------------------------------------------------------------
// Merge queue log
// ---------------------------------------------------------------------------

export interface MergeQueueLogEventPayload {
  issueId: string;
  status: string;
  attemptCount: number;
}

// ---------------------------------------------------------------------------
// Janus session lifecycle
// ---------------------------------------------------------------------------

export interface JanusSessionStartedEventPayload {
  sessionId: string;
  issueId: string;
}

export interface JanusSessionLogEventPayload {
  sessionId: string;
  issueId: string;
  line: string;
  level: "info" | "warn" | "error";
}

export interface JanusSessionEndedEventPayload {
  sessionId: string;
  issueId: string;
  outcome: "completed" | "failed" | "aborted";
}

// ---------------------------------------------------------------------------
// Issue stage change
// ---------------------------------------------------------------------------

export interface IssueStageChangedEventPayload {
  issueId: string;
  fromStage: string | null;
  toStage: string;
}

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
  "scope.suppression",
  "merge.queue_state",
  "merge.outcome",
  "merge.janus_escalation",
  "loop.phase_log",
  "agent.session_started",
  "agent.session_log",
  "agent.session_stats",
  "agent.session_ended",
  "merge.queue_log",
  "janus.session_started",
  "janus.session_log",
  "janus.session_ended",
  "issue.stage_changed",
] as const;

export type LiveEventType = (typeof LIVE_EVENT_TYPES)[number];

export interface OrchestratorStateEventPayload {
  status: {
    mode: OrchestrationMode;
    isRunning: boolean;
    uptimeSeconds: number;
    activeAgents: number;
    queueDepth: number;
    paused: boolean;
    autoLoopEnabled: boolean;
  };
  spend: {
    metering: string;
    costUsd?: number;
    totalInputTokens: number;
    totalOutputTokens: number;
  };
  agents: Array<Record<string, unknown>>;
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

export interface ScopeSuppressionEventPayload {
  dispatchable: string[];
  suppressed: SuppressionEntry[];
  hasOverlap: boolean;
  evaluatedAt: string;
}

export interface LiveEventPayloadMap {
  "orchestrator.state": OrchestratorStateEventPayload;
  "launch.sequence": LaunchSequenceEventPayload;
  "control.command": ControlCommandEventPayload;
  "scope.suppression": ScopeSuppressionEventPayload;
  "merge.queue_state": MergeQueueStateEventPayload;
  "merge.outcome": MergeOutcomeEventPayload;
  "merge.janus_escalation": MergeJanusEscalationEventPayload;
  "loop.phase_log": LoopPhaseLogEventPayload;
  "agent.session_started": AgentSessionStartedEventPayload;
  "agent.session_log": AgentSessionLogEventPayload;
  "agent.session_stats": AgentSessionStatsEventPayload;
  "agent.session_ended": AgentSessionEndedEventPayload;
  "merge.queue_log": MergeQueueLogEventPayload;
  "janus.session_started": JanusSessionStartedEventPayload;
  "janus.session_log": JanusSessionLogEventPayload;
  "janus.session_ended": JanusSessionEndedEventPayload;
  "issue.stage_changed": IssueStageChangedEventPayload;
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
  "orchestrator.state": ["status", "spend", "agents"],
  "launch.sequence": ["phase", "step", "status", "detail"],
  "control.command": ["action", "request_id", "status", "detail"],
  "scope.suppression": ["dispatchable", "suppressed", "hasOverlap", "evaluatedAt"],
  "merge.queue_state": ["issueId", "status", "attemptCount", "errorDetail"],
  "merge.outcome": ["issueId", "outcome", "candidateBranch", "targetBranch", "detail"],
  "merge.janus_escalation": ["issueId", "reason", "attemptCount", "janusEnabled"],
  "loop.phase_log": ["phase", "line", "level", "issueId", "agentId"],
  "agent.session_started": ["sessionId", "caste", "issueId", "stage", "model"],
  "agent.session_log": ["sessionId", "caste", "issueId", "line", "level"],
  "agent.session_stats": ["sessionId", "caste", "issueId", "inputTokens", "outputTokens", "turns", "elapsedSec"],
  "agent.session_ended": ["sessionId", "caste", "issueId", "outcome"],
  "merge.queue_log": ["issueId", "status", "attemptCount"],
  "janus.session_started": ["sessionId", "issueId"],
  "janus.session_log": ["sessionId", "issueId", "line", "level"],
  "janus.session_ended": ["sessionId", "issueId", "outcome"],
  "issue.stage_changed": ["issueId", "fromStage", "toStage"],
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
  if (value === undefined || !Number.isInteger(value) || value < 1) {
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
