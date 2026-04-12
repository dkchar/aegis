import type {
  DashboardState,
  LoopPhase,
  ActiveSessionInfo,
  RecentSessionInfo,
} from "../types/dashboard-state";
import type { ServerLiveEventEnvelope, SseEventType } from "../types/sse-events";

const MAX_PHASE_LOG_LINES = 50;

/** Create a fresh, empty dashboard state with all optional sections initialized. */
export function createEmptyDashboardState(): DashboardState {
  return {
    status: {
      mode: "conversational",
      isRunning: false,
      uptimeSeconds: 0,
      activeAgents: 0,
      queueDepth: 0,
      paused: false,
      autoLoopEnabled: false,
    },
    spend: {
      metering: "unknown",
      totalInputTokens: 0,
      totalOutputTokens: 0,
    },
    agents: [],
    config: null,
    loop: {
      phaseLogs: {
        poll: [],
        dispatch: [],
        monitor: [],
        reap: [],
      },
    },
    sessions: {
      active: {},
      recent: [],
    },
    mergeQueue: {
      items: [],
      logs: [],
    },
    janus: {
      active: {},
      recent: [],
    },
  };
}

// ---------------------------------------------------------------------------
// Payload shapes (derived from server-side event payloads)
// ---------------------------------------------------------------------------

interface LoopPhaseLogPayload {
  phase: LoopPhase;
  line: string;
  level?: string;
  issueId?: string | null;
  agentId?: string | null;
}

interface SessionStartedPayload {
  sessionId: string;
  caste: ActiveSessionInfo["caste"];
  issueId: string;
  stage: string;
  model: string;
}

interface SessionLogPayload {
  sessionId: string;
  line: string;
}

interface SessionEndedPayload {
  sessionId: string;
  outcome: RecentSessionInfo["outcome"];
  caste: ActiveSessionInfo["caste"];
  issueId: string;
}

interface MergeQueueLogPayload {
  line: string;
}

interface JanusStartedPayload {
  sessionId: string;
  issueId: string;
}

interface JanusLogPayload {
  sessionId: string;
  line: string;
}

interface JanusEndedPayload {
  sessionId: string;
  outcome: "completed" | "failed" | "aborted";
  issueId: string;
}

// ---------------------------------------------------------------------------
// Immutable helpers
// ---------------------------------------------------------------------------

function appendPhaseLine(state: DashboardState, payload: LoopPhaseLogPayload): DashboardState {
  const phase = payload.phase;
  const existing = state.loop?.phaseLogs?.[phase] ?? [];
  const updated = [payload.line, ...existing].slice(0, MAX_PHASE_LOG_LINES);

  return {
    ...state,
    loop: {
      phaseLogs: {
        ...(state.loop?.phaseLogs ?? { poll: [], dispatch: [], monitor: [], reap: [] }),
        [phase]: updated,
      },
    },
  };
}

function upsertActiveSession(state: DashboardState, payload: SessionStartedPayload): DashboardState {
  const active = { ...(state.sessions?.active ?? {}) };
  active[payload.sessionId] = {
    id: payload.sessionId,
    caste: payload.caste,
    issueId: payload.issueId,
    stage: payload.stage,
    model: payload.model,
    lines: [],
  };

  return {
    ...state,
    sessions: {
      ...(state.sessions ?? { active: {}, recent: [] }),
      active,
    },
  };
}

function appendSessionLog(state: DashboardState, payload: SessionLogPayload): DashboardState {
  const active = { ...(state.sessions?.active ?? {}) };
  const session = active[payload.sessionId];
  if (!session) {
    return state;
  }
  active[payload.sessionId] = {
    ...session,
    lines: [...session.lines, payload.line],
  };

  return {
    ...state,
    sessions: {
      ...(state.sessions ?? { active: {}, recent: [] }),
      active,
    },
  };
}

function moveSessionToRecent(state: DashboardState, payload: SessionEndedPayload): DashboardState {
  const active = { ...(state.sessions?.active ?? {}) };
  const session = active[payload.sessionId];
  delete active[payload.sessionId];

  const recentEntry: RecentSessionInfo = {
    id: payload.sessionId,
    caste: payload.caste,
    issueId: payload.issueId,
    outcome: payload.outcome,
    endedAt: new Date().toISOString(),
  };

  const existingRecent = state.sessions?.recent ?? [];
  const recent = [recentEntry, ...existingRecent];

  return {
    ...state,
    sessions: {
      ...(state.sessions ?? { active: {}, recent: [] }),
      active,
      recent,
    },
  };
}

function appendMergeQueueLog(state: DashboardState, payload: MergeQueueLogPayload): DashboardState {
  const existingLogs = state.mergeQueue?.logs ?? [];
  const updatedLogs = [payload.line, ...existingLogs].slice(0, MAX_PHASE_LOG_LINES);

  return {
    ...state,
    mergeQueue: {
      ...(state.mergeQueue ?? { items: [], logs: [] }),
      logs: updatedLogs,
    },
  };
}

function upsertJanusSession(state: DashboardState, payload: JanusStartedPayload): DashboardState {
  const active = { ...(state.janus?.active ?? {}) };
  active[payload.sessionId] = {
    id: payload.sessionId,
    issueId: payload.issueId,
    lines: [],
  };

  return {
    ...state,
    janus: {
      ...(state.janus ?? { active: {}, recent: [] }),
      active,
    },
  };
}

function appendJanusLog(state: DashboardState, payload: JanusLogPayload): DashboardState {
  const active = { ...(state.janus?.active ?? {}) };
  const session = active[payload.sessionId];
  if (!session) {
    return state;
  }
  active[payload.sessionId] = {
    ...session,
    lines: [...session.lines, payload.line],
  };

  return {
    ...state,
    janus: {
      ...(state.janus ?? { active: {}, recent: [] }),
      active,
    },
  };
}

function endJanusSession(state: DashboardState, payload: JanusEndedPayload): DashboardState {
  const active = { ...(state.janus?.active ?? {}) };
  const session = active[payload.sessionId];
  delete active[payload.sessionId];

  const existingRecent = state.janus?.recent ?? [];
  const recent = [
    {
      id: payload.sessionId,
      issueId: payload.issueId,
      outcome: payload.outcome,
      endedAt: new Date().toISOString(),
    },
    ...existingRecent,
  ];

  return {
    ...state,
    janus: {
      ...(state.janus ?? { active: {}, recent: [] }),
      active,
      recent,
    },
  };
}

// ---------------------------------------------------------------------------
// Main reducer
// ---------------------------------------------------------------------------

/**
 * Route a single live SSE event into an immutable DashboardState update.
 * Returns a new state object — never mutates the input.
 */
export function reduceDashboardLiveEvent(
  state: DashboardState,
  event: ServerLiveEventEnvelope,
): DashboardState {
  switch (event.type) {
    case "loop.phase_log":
      return appendPhaseLine(state, event.payload as unknown as LoopPhaseLogPayload);

    case "agent.session_started":
      return upsertActiveSession(state, event.payload as unknown as SessionStartedPayload);

    case "agent.session_log":
      return appendSessionLog(state, event.payload as unknown as SessionLogPayload);

    case "agent.session_ended":
      return moveSessionToRecent(state, event.payload as unknown as SessionEndedPayload);

    case "merge.queue_log":
      return appendMergeQueueLog(state, event.payload as unknown as MergeQueueLogPayload);

    case "janus.session_started":
      return upsertJanusSession(state, event.payload as unknown as JanusStartedPayload);

    case "janus.session_log":
      return appendJanusLog(state, event.payload as unknown as JanusLogPayload);

    case "janus.session_ended":
      return endJanusSession(state, event.payload as unknown as JanusEndedPayload);

    default:
      return state;
  }
}
