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
        await sendCommand("kill", { agentId });
        setCommandResults((prev) => [
          ...prev,
          { command: `kill ${agentId}`, success: true, result: "Agent killed", timestamp: Date.now() },
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
        setCommandResults((prev) => [
          ...prev,
          { command, success: true, result: result.message || "OK", timestamp: Date.now() },
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
        return {
          ok: result.ok,
          message: result.message,
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
      await sendCommand("implement", { issueId });
      setCommandResults((prev) => [
        ...prev,
        { command: `implement ${issueId}`, success: true, result: "Implementation started", timestamp: Date.now() },
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
