import { useState, useCallback, useEffect } from "react";
import type { JSX } from "react";
import { useSse } from "./lib/use-sse";
import type { SteerResult } from "./lib/use-sse";
import { injectGlobalStyles } from "./theme/global.css";
import { TopBar } from "./components/top-bar";
import { SettingsPanel } from "./components/settings-panel";
import { AgentGrid } from "./components/agent-grid";
import { CommandBar } from "./components/command-bar";
import { StartRunDialog } from "./components/start-run-dialog";
import type { CommandResult } from "./components/command-bar";
import type { ScoutResult } from "./components/start-run-dialog";

// Inject global styles on first render
injectGlobalStyles();

/** Auto-dismiss delay for error result cards (ms). */
const ERROR_DISMISS_MS = 5000;

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

export function App(): JSX.Element {
  const { state, isConnected, error, sendCommand } = useSse();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [startRunOpen, setStartRunOpen] = useState(false);
  const [commandResults, setCommandResults] = useState<CommandResult[]>([]);

  /** Auto-dismiss the oldest error card after a timeout. */
  useEffect(() => {
    const hasError = commandResults.some((r) => !r.success);
    if (!hasError) return;
    const timer = setTimeout(() => {
      setCommandResults((prev) => prev.filter((r) => r.success));
    }, ERROR_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [commandResults]);

  const handleAutoToggle = useCallback(
    async (enabled: boolean) => {
      try {
        const result = await sendCommand(enabled ? "auto_on" : "auto_off");
        setCommandResults((prev) => [
          ...prev,
          { command: enabled ? "auto_on" : "auto_off", success: true, result: result.message, timestamp: Date.now() },
        ]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        setCommandResults((prev) => [
          ...prev,
          { command: enabled ? "auto_on" : "auto_off", success: false, error: msg, timestamp: Date.now() },
        ]);
      }
    },
    [sendCommand],
  );

  const handleKill = useCallback(
    async (agentId: string) => {
      try {
        const result = await sendCommand("kill", { agentId });
        setCommandResults((prev) => [
          ...prev,
          {
            command: `kill ${agentId}`,
            success: true,
            result: resultMessageOrFallback(result, `Agent ${agentId} kill signal sent`),
            timestamp: Date.now(),
          },
        ]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        setCommandResults((prev) => [
          ...prev,
          { command: `kill ${agentId}`, success: false, error: msg, timestamp: Date.now() },
        ]);
      }
    },
    [sendCommand],
  );

  const handleCommand = useCallback(
    async (command: string, payload?: Record<string, unknown>) => {
      try {
        const result: SteerResult = await sendCommand(command, payload);
        if (!isHandledResult(result)) {
          throw new Error(resultMessageOrFallback(result, `Command "${command}" was not accepted.`));
        }
        setCommandResults((prev) => [
          ...prev,
          {
            command,
            success: true,
            result: resultMessageOrFallback(result, "OK"),
            timestamp: Date.now(),
          },
        ]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        setCommandResults((prev) => [
          ...prev,
          { command, success: false, error: msg, timestamp: Date.now() },
        ]);
      }
    },
    [sendCommand],
  );

  const handleScout = useCallback(
    async (issueId: string): Promise<ScoutResult> => {
      try {
        const result: SteerResult = await sendCommand("scout", { issueId });
        if (!isHandledResult(result)) {
          return {
            ok: false,
            message: resultMessageOrFallback(result, `Scout failed for ${issueId}.`),
            raw: result.raw,
          };
        }
        return {
          ok: true,
          message: resultMessageOrFallback(result, `Scouted ${issueId}.`),
          assessment: (result.raw?.assessment as string) ?? undefined,
          raw: result.raw,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        return { ok: false, message: msg };
      }
    },
    [sendCommand],
  );

  const handleImplement = useCallback(
    async (issueId: string): Promise<void> => {
      const result = await sendCommand("implement", { issueId });
      if (!isHandledResult(result)) {
        throw new Error(resultMessageOrFallback(result, `Implementation failed for ${issueId}.`));
      }
      setCommandResults((prev) => [
        ...prev,
        {
          command: `implement ${issueId}`,
          success: true,
          result: resultMessageOrFallback(result, `Implementation started for ${issueId}`),
          timestamp: Date.now(),
        },
      ]);
    },
    [sendCommand],
  );

  return (
    <div className="app">
      <TopBar
        state={state}
        isConnected={isConnected}
        onAutoToggle={handleAutoToggle}
        onSettingsOpen={() => setSettingsOpen(true)}
        onStartRun={() => setStartRunOpen(true)}
      />

      {settingsOpen && (
        <SettingsPanel
          isOpen={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          config={state?.config ?? null}
        />
      )}

      <StartRunDialog
        isOpen={startRunOpen}
        onClose={() => setStartRunOpen(false)}
        onScout={handleScout}
        onImplement={handleImplement}
      />

      {error && (
        <div data-testid="error-banner" role="alert" className="error-banner">
          {error}
        </div>
      )}

      <main data-testid="app-main" className="app-main">
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
            {commandResults.map((r, i) => (
              <div key={i} className={`command-result ${r.success ? "success" : "error"}`}>
                <code>{r.command}</code>
                {r.success ? (
                  <span className="success">{r.result}</span>
                ) : (
                  <span className="error">{r.error}</span>
                )}
              </div>
            ))}
          </section>
        )}
      </main>
    </div>
  );
}
