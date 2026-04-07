import { useState, useCallback } from "react";
import type { JSX } from "react";
import { useSse } from "./lib/use-sse";
import { injectGlobalStyles } from "./theme/global.css";
import { TopBar } from "./components/top-bar";
import { SettingsPanel } from "./components/settings-panel";
import { AgentGrid } from "./components/agent-grid";
import { CommandBar } from "./components/command-bar";
import { killAgent } from "./lib/api-client";

// Inject global styles on first render
injectGlobalStyles();

export function App(): JSX.Element {
  const { state, isConnected, error, sendCommand } = useSse();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [commandResults, setCommandResults] = useState<
    Array<{ command: string; success: boolean; result?: string; error?: string }>
  >([]);

  const handleAutoToggle = useCallback(
    (enabled: boolean) => {
      void sendCommand(enabled ? "auto_on" : "auto_off");
    },
    [sendCommand],
  );

  const handleKill = useCallback(
    async (agentId: string) => {
      try {
        const res = await killAgent(agentId);
        const data = await res.json().catch(() => ({}));
        setCommandResults((prev) => [
          ...prev,
          { command: `kill ${agentId}`, success: res.ok, result: JSON.stringify(data) },
        ]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        setCommandResults((prev) => [
          ...prev,
          { command: `kill ${agentId}`, success: false, error: msg },
        ]);
      }
    },
    [],
  );

  const handleCommand = useCallback(
    async (command: string, payload?: Record<string, unknown>) => {
      try {
        const res = await sendCommand(command, payload);
        const data = await res.json().catch(() => ({}));
        setCommandResults((prev) => [
          ...prev,
          { command, success: res.ok, result: JSON.stringify(data) },
        ]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        setCommandResults((prev) => [
          ...prev,
          { command, success: false, error: msg },
        ]);
      }
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
      />

      {settingsOpen && (
        <SettingsPanel isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
      )}

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
