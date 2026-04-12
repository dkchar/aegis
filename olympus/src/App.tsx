import { useState, useCallback, useEffect } from "react";
import type { JSX } from "react";
import { useSse } from "./lib/use-sse";
import type { SteerResult } from "./lib/use-sse";
import { injectGlobalStyles } from "./theme/global.css";
import { TopBar } from "./components/top-bar";
import { SettingsPanel } from "./components/settings-panel";
import { AgentGrid } from "./components/agent-grid";
import { CommandBar } from "./components/command-bar";
import { LoopPanel } from "./components/loop-panel";
import { OperatorSidebar } from "./components/operator-sidebar";
import { MergeQueuePanel } from "./components/merge-queue-panel";
import { ActiveSessionsPanel } from "./components/active-sessions-panel";
import { RecentSessionsTray } from "./components/recent-sessions-tray";
import { JanusPopup } from "./components/janus-popup";
import { fetchReadyIssues } from "./lib/api-client";
import type { CommandResult } from "./components/command-bar";
import type { DashboardState, ReadyIssueSummary } from "./types/dashboard-state";
import type { LoopPhaseLogs } from "./components/loop-panel";
import type { SelectedIssue } from "./components/operator-sidebar";

injectGlobalStyles();

const ERROR_DISMISS_MS = 5000;

function timeAgo(isoString: string): string {
  const then = new Date(isoString).getTime();
  const now = Date.now();
  const diffMs = Math.max(0, now - then);
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

function readCommandStatus(result: SteerResult): string | undefined {
  if (typeof result.status === "string") {
    return result.status;
  }

  const rawStatus = result.raw?.status;
  return typeof rawStatus === "string" ? rawStatus : undefined;
}

function isHandledResult(result: SteerResult): boolean {
  const status = readCommandStatus(result);
  return result.ok && (status === undefined || status === "handled");
}

function resultMessageOrFallback(result: SteerResult, fallback: string): string {
  return result.message?.trim() ? result.message : fallback;
}

function deriveLoopState(state: DashboardState | null): "idle" | "paused" | "running" {
  const autoEnabled = state?.status.autoLoopEnabled ?? false;

  if (!autoEnabled) {
    return "idle";
  }

  if (state?.status.paused) {
    return "paused";
  }

  return "running";
}

function deriveSidebarIssueGraph(
  readyIssues: ReadyIssueSummary[],
  state: DashboardState | null,
): string[] {
  const entries = [
    ...Object.values(state?.sessions?.active ?? {}).map(
      (session) => `${session.issueId} - active: ${session.stage}`,
    ),
    ...(state?.mergeQueue?.items ?? []).map(
      (item) => `${item.issueId} - merge: ${item.status}`,
    ),
    ...(state?.sessions?.recent ?? []).map(
      (session) => `${session.issueId} - recent: ${session.outcome}`,
    ),
    ...readyIssues.map((issue) => `${issue.id} - ready`),
  ];

  return Array.from(new Set(entries));
}

function deriveSelectedIssue(
  readyIssues: ReadyIssueSummary[],
  state: DashboardState | null,
): SelectedIssue | null {
  const activeSession = Object.values(state?.sessions?.active ?? {})[0];
  if (activeSession) {
    return {
      id: activeSession.issueId,
      stage: activeSession.stage,
      summary: `${activeSession.caste} session ${activeSession.id}`,
    };
  }

  const readyIssue = readyIssues[0];
  if (!readyIssue) {
    return null;
  }

  return {
    id: readyIssue.id,
    stage: "ready",
    summary: readyIssue.title || "Ready for dispatch",
  };
}

function deriveLiveActiveAgents(state: DashboardState | null): number {
  const sessionCount = Object.keys(state?.sessions?.active ?? {}).length;
  return Math.max(state?.status.activeAgents ?? 0, sessionCount);
}

function deriveLiveQueueDepth(
  readyIssues: ReadyIssueSummary[],
  state: DashboardState | null,
): number {
  return Math.max(
    state?.status.queueDepth ?? 0,
    readyIssues.length,
    state?.mergeQueue?.items?.length ?? 0,
  );
}

const EMPTY_PHASE_LOGS: LoopPhaseLogs = {
  poll: [],
  dispatch: [],
  monitor: [],
  reap: [],
};

const STEER_REFERENCE = [
  "status",
  "pause",
  "resume",
  "focus <issue-id>",
  "kill <agent-id>",
];

export function App(): JSX.Element {
  const { state, isConnected, error, sendCommand } = useSse();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [commandResults, setCommandResults] = useState<CommandResult[]>([]);
  const [readyIssues, setReadyIssues] = useState<ReadyIssueSummary[]>([]);
  const janusSession = state?.janus && Object.keys(state.janus.active).length > 0
    ? Object.values(state.janus.active)[0]
    : null;

  useEffect(() => {
    if (!isConnected) {
      setReadyIssues([]);
      return;
    }

    let cancelled = false;
    const fetch = async () => {
      try {
        const issues = await fetchReadyIssues();
        if (!cancelled) {
          setReadyIssues(issues);
        }
      } catch {
        // Ready-queue rendering is advisory; fail closed.
      }
    };

    void fetch();
    const interval = setInterval(fetch, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isConnected]);

  useEffect(() => {
    const hasError = commandResults.some((result) => !result.success);
    if (!hasError) {
      return undefined;
    }

    const timer = setTimeout(() => {
      setCommandResults((previous) => previous.filter((result) => result.success));
    }, ERROR_DISMISS_MS);

    return () => clearTimeout(timer);
  }, [commandResults]);

  const recordCommandResult = useCallback((result: CommandResult) => {
    setCommandResults((previous) => [...previous, result]);
  }, []);

  const handleKill = useCallback(
    async (agentId: string) => {
      try {
        const result = await sendCommand("kill", { agentId });
        recordCommandResult({
          command: `kill ${agentId}`,
          success: true,
          result: resultMessageOrFallback(result, `Agent ${agentId} kill signal sent`),
          timestamp: Date.now(),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        recordCommandResult({
          command: `kill ${agentId}`,
          success: false,
          error: msg,
          timestamp: Date.now(),
        });
      }
    },
    [recordCommandResult, sendCommand],
  );

  const handleCommand = useCallback(
    async (command: string, payload?: Record<string, unknown>) => {
      try {
        const result = await sendCommand(command, payload);
        if (!isHandledResult(result)) {
          throw new Error(resultMessageOrFallback(result, `Command "${command}" was not accepted.`));
        }

        recordCommandResult({
          command,
          success: true,
          result: resultMessageOrFallback(result, "OK"),
          timestamp: Date.now(),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        recordCommandResult({
          command,
          success: false,
          error: msg,
          timestamp: Date.now(),
        });
      }
    },
    [recordCommandResult, sendCommand],
  );

  const runLoopCommand = useCallback(
    async (command: string, successFallback: string) => {
      try {
        const result = await sendCommand(command);
        if (!isHandledResult(result)) {
          throw new Error(resultMessageOrFallback(result, successFallback));
        }

        recordCommandResult({
          command,
          success: true,
          result: resultMessageOrFallback(result, successFallback),
          timestamp: Date.now(),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        recordCommandResult({
          command,
          success: false,
          error: msg,
          timestamp: Date.now(),
        });
      }
    },
    [recordCommandResult, sendCommand],
  );

  const handleSteerCommand = useCallback(
    async (command: string) => {
      try {
        const result = await sendCommand(command);
        if (!isHandledResult(result)) {
          throw new Error(resultMessageOrFallback(result, `Command "${command}" was not accepted.`));
        }

        recordCommandResult({
          command,
          success: true,
          result: resultMessageOrFallback(result, "OK"),
          timestamp: Date.now(),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        recordCommandResult({
          command,
          success: false,
          error: msg,
          timestamp: Date.now(),
        });
      }
    },
    [recordCommandResult, sendCommand],
  );

  const readyQueue = readyIssues.map((issue) => issue.id);
  const sidebarIssueGraph = deriveSidebarIssueGraph(readyIssues, state);
  const selectedIssue = deriveSelectedIssue(readyIssues, state);
  const liveActiveAgents = deriveLiveActiveAgents(state);
  const liveQueueDepth = deriveLiveQueueDepth(readyIssues, state);

  return (
    <div className="app">
      <TopBar
        state={state}
        isConnected={isConnected}
        liveActiveAgents={liveActiveAgents}
        liveQueueDepth={liveQueueDepth}
        onSettingsOpen={() => setSettingsOpen(true)}
      />

      {settingsOpen && (
        <SettingsPanel
          isOpen={settingsOpen}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {error && (
        <div data-testid="error-banner" role="alert" className="error-banner">
          {error}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "flex-start" }}>
        <OperatorSidebar
          readyQueue={readyQueue}
          issueGraph={sidebarIssueGraph}
          selectedIssue={selectedIssue}
          steerReference={STEER_REFERENCE}
          onCommand={handleSteerCommand}
        />

        <main data-testid="app-main" className="app-main" style={{ flex: 1, minWidth: 0 }}>
          <LoopPanel
            loopState={deriveLoopState(state)}
            phaseLogs={state?.loop?.phaseLogs ?? EMPTY_PHASE_LOGS}
            onStart={() => runLoopCommand("auto_on", "Aegis loop started")}
            onPause={() => runLoopCommand("pause", "Aegis loop paused")}
            onResume={() => runLoopCommand("resume", "Aegis loop resumed")}
            onStop={() => runLoopCommand("stop", "Aegis loop stopped")}
            disabled={!isConnected}
          />

          <MergeQueuePanel
            queueLength={state?.mergeQueue?.items?.length ?? 0}
            currentItem={state?.mergeQueue?.items?.[0]?.issueId ?? null}
            lines={state?.mergeQueue?.logs ?? []}
          />

          <ActiveSessionsPanel
            sessions={state?.sessions?.active ?? {}}
          />

          <RecentSessionsTray
            sessions={(state?.sessions?.recent ?? []).map((session) => ({
              id: session.id,
              closedAgo: timeAgo(session.endedAt),
              outcome: session.outcome === "completed"
                ? "success"
                : session.outcome === "failed"
                  ? "failed"
                  : "rejected",
            }))}
          />

          <AgentGrid
            agents={state?.agents ?? []}
            onKill={handleKill}
          />

          <CommandBar
            onCommand={handleCommand}
            onKill={handleKill}
            disabled={!isConnected}
          />

          {commandResults.length > 0 && (
            <section data-testid="command-results" aria-label="Command Results">
              {commandResults.map((result, index) => (
                <div key={index} className={`command-result ${result.success ? "success" : "error"}`}>
                  <code>{result.command}</code>
                  {result.success ? (
                    <span className="success">{result.result}</span>
                  ) : (
                    <span className="error">{result.error}</span>
                  )}
                </div>
              ))}
            </section>
          )}
        </main>
      </div>

      {janusSession && (
        <JanusPopup
          session={{
            id: janusSession.id,
            issueId: janusSession.issueId,
            lines: janusSession.lines,
          }}
          onDismiss={() => {
            // Janus sessions are driven by server state; dismiss is visual only.
          }}
        />
      )}
    </div>
  );
}
