/**
 * StatusBar component.
 *
 * Displays orchestrator running state, mode indicator,
 * connection status, and uptime display.
 * Kept for future dedicated status section expansion.
 */

import type { JSX } from "react";
import { formatUptime } from "./top-bar";

export interface StatusBarProps {
  isRunning: boolean;
  mode: "conversational" | "auto" | null;
  isConnected: boolean;
  uptimeSeconds: number;
}

export function StatusBar(props: StatusBarProps): JSX.Element {
  const { isRunning, mode, isConnected, uptimeSeconds } = props;

  return (
    <div data-testid="status-bar" role="status" className="status-bar">
      <div className="status-indicator">
        <span className={`status-dot ${isRunning ? "running" : "stopped"} ${isRunning ? "pulse" : ""}`} />
        {isRunning ? "Running" : "Stopped"}
      </div>
      {mode && (
        <div className="status-indicator">
          Mode: <strong>{mode === "auto" ? "Auto" : "Conversational"}</strong>
        </div>
      )}
      <div className="status-indicator">
        <span className={`status-dot ${isConnected ? "connected" : "disconnected"} ${!isConnected ? "pulse" : ""}`} />
        {isConnected ? "Connected" : "Disconnected"}
      </div>
      <div className="status-indicator">
        Uptime: <strong>{formatUptime(uptimeSeconds)}</strong>
      </div>
    </div>
  );
}
