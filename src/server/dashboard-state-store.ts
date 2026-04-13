/**
 * In-memory dashboard state store for Olympus snapshot and SSE replay.
 *
 * Owns the expanded /api/state snapshot and consumes normalized live events
 * to derive loop phase logs, active sessions, merge queue state, and recent
 * completions.
 */

import type { AegisLiveEvent } from "../events/event-bus.js";

// ---------------------------------------------------------------------------
// Snapshot shape — mirrors the expanded DashboardState from Olympus types.
// ---------------------------------------------------------------------------

export type LoopPhase = "poll" | "dispatch" | "monitor" | "reap";

export interface DashboardStateSnapshot {
  status: {
    mode: string;
    isRunning: boolean;
    uptimeSeconds: number;
    activeAgents: number;
    queueDepth: number;
    paused: boolean;
  };
  spend: {
    metering: string;
    totalInputTokens: number;
    totalOutputTokens: number;
  };
  agents: Array<Record<string, unknown>>;
  loop: {
    phaseLogs: {
      [K in LoopPhase]: string[];
    };
  };
  sessions: {
    active: Record<string, {
      id: string;
      caste: string;
      issueId: string;
      stage: string;
      model: string;
      lines: string[];
    }>;
    recent: Array<{
      id: string;
      caste: string;
      issueId: string;
      outcome: string;
      endedAt: string;
      lines: string[];
    }>;
  };
  mergeQueue: {
    items: Array<{
      issueId: string;
      status: string;
      attemptCount: number;
      lastError?: string | null;
    }>;
    logs: string[];
  };
  janus: {
    active: Record<string, { id: string; issueId: string; lines: string[]; outcome?: string }>;
    recent: Array<{ id: string; issueId: string; outcome: string; endedAt: string }>;
  };
}

const MAX_PHASE_LOG_LINES = 50;

function createEmptyDashboardState(): DashboardStateSnapshot {
  return {
    status: {
      mode: "conversational",
      isRunning: false,
      uptimeSeconds: 0,
      activeAgents: 0,
      queueDepth: 0,
      paused: false,
    },
    spend: {
      metering: "unknown",
      totalInputTokens: 0,
      totalOutputTokens: 0,
    },
    agents: [],
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
// Public API
// ---------------------------------------------------------------------------

export interface DashboardStateStore {
  /** Returns a deep clone of the current derived snapshot. */
  snapshot(): DashboardStateSnapshot;
  /** Apply a single live event to the derived state. Idempotent on replay. */
  apply(event: AegisLiveEvent): void;
}

function moveSessionToRecent(
  state: DashboardStateSnapshot,
  sessionId: string,
  caste: string,
  issueId: string,
  outcome: string,
) {
  const session = state.sessions.active[sessionId];
  if (session) {
    state.sessions.recent.unshift({
      id: sessionId,
      caste,
      issueId,
      outcome,
      endedAt: new Date().toISOString(),
      lines: [...session.lines], // Preserve session logs for later viewing
    });
    // Cap recent sessions at 20
    state.sessions.recent = state.sessions.recent.slice(0, 20);
    delete state.sessions.active[sessionId];
  }
}

export function createDashboardStateStore(): DashboardStateStore {
  const state: DashboardStateSnapshot = createEmptyDashboardState();

  return {
    snapshot() {
      return structuredClone(state);
    },
    apply(event) {
      switch (event.type) {
        case "loop.phase_log": {
          const { phase, line } = event.payload;
          state.loop.phaseLogs[phase].unshift(line);
          state.loop.phaseLogs[phase] = state.loop.phaseLogs[phase].slice(0, MAX_PHASE_LOG_LINES);
          break;
        }
        case "agent.session_started": {
          const { sessionId, caste, issueId, stage, model } = event.payload;
          state.sessions.active[sessionId] = {
            id: sessionId,
            caste,
            issueId,
            stage,
            model,
            lines: [],
          };
          break;
        }
        case "agent.session_log": {
          const { sessionId, line } = event.payload;
          const session = state.sessions.active[sessionId];
          if (session) {
            session.lines.push(line);
          }
          break;
        }
        case "agent.session_ended": {
          const { sessionId, caste, issueId, outcome } = event.payload;
          moveSessionToRecent(state, sessionId, caste, issueId, outcome);
          break;
        }
        case "merge.queue_log": {
          const { issueId, status, attemptCount } = event.payload;
          const existingIndex = state.mergeQueue.items.findIndex((item) => item.issueId === issueId);
          if (existingIndex >= 0) {
            state.mergeQueue.items[existingIndex] = {
              ...state.mergeQueue.items[existingIndex],
              status,
              attemptCount,
            };
          } else {
            state.mergeQueue.items.push({ issueId, status, attemptCount });
          }
          state.mergeQueue.logs.unshift(
            `[${status}] ${issueId} attempt=${attemptCount}`,
          );
          state.mergeQueue.logs = state.mergeQueue.logs.slice(0, MAX_PHASE_LOG_LINES);
          break;
        }
        case "merge.queue_state": {
          const { issueId, status, attemptCount, errorDetail } = event.payload;
          const existingIndex = state.mergeQueue.items.findIndex((item) => item.issueId === issueId);
          if (existingIndex >= 0) {
            state.mergeQueue.items[existingIndex] = {
              ...state.mergeQueue.items[existingIndex],
              status,
              attemptCount,
              lastError: errorDetail ?? null,
            };
          } else {
            state.mergeQueue.items.push({ issueId, status, attemptCount, lastError: errorDetail ?? null });
          }
          break;
        }
        case "merge.outcome": {
          const { issueId, outcome, candidateBranch } = event.payload;
          state.mergeQueue.logs.unshift(
            `[${outcome}] ${issueId} branch=${candidateBranch}`,
          );
          state.mergeQueue.logs = state.mergeQueue.logs.slice(0, MAX_PHASE_LOG_LINES);
          // Remove from active items on terminal outcomes
          const terminalOutcomes = new Set([
            "MERGED", "JANUS_RESOLVED", "MANUAL_DECISION_REQUIRED",
          ]);
          if (terminalOutcomes.has(outcome)) {
            state.mergeQueue.items = state.mergeQueue.items.filter(
              (item) => item.issueId !== issueId,
            );
          }
          break;
        }
        case "janus.session_started": {
          const { sessionId, issueId: janusIssueId } = event.payload;
          state.janus.active[sessionId] = {
            id: sessionId,
            issueId: janusIssueId,
            lines: [],
          };
          break;
        }
        case "janus.session_log": {
          const { sessionId: janusSessionId, line: janusLine } = event.payload;
          const janusSession = state.janus.active[janusSessionId];
          if (janusSession) {
            janusSession.lines.push(janusLine);
          }
          break;
        }
        case "janus.session_ended": {
          const { sessionId: janusEndSessionId, issueId: janusEndIssueId, outcome: janusOutcome } = event.payload;
          const janusSession = state.janus.active[janusEndSessionId];
          if (janusSession) {
            state.janus.recent.unshift({
              id: janusEndSessionId,
              issueId: janusEndIssueId,
              outcome: janusOutcome,
              endedAt: new Date().toISOString(),
            });
            state.janus.recent = state.janus.recent.slice(0, 20);
            delete state.janus.active[janusEndSessionId];
          }
          break;
        }
        case "issue.stage_changed": {
          // Stage changes are tracked via merge queue and session state;
          // this event is available for downstream consumers.
          break;
        }
        case "orchestrator.state": {
          state.status = { ...event.payload.status };
          state.spend = {
            metering: event.payload.spend.metering,
            totalInputTokens: event.payload.spend.totalInputTokens,
            totalOutputTokens: event.payload.spend.totalOutputTokens,
          };
          state.agents = [...event.payload.agents];
          break;
        }
        case "launch.sequence":
        case "control.command":
        case "scope.suppression":
        case "merge.janus_escalation":
        case "agent.session_stats":
          // These events are consumed by other subsystems; ignore for snapshot.
          break;
        default: {
          const _exhaustiveCheck: never = event;
          void _exhaustiveCheck;
          break;
        }
      }
    },
  };
}
