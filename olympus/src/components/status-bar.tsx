/**
 * Status bar component.
 *
 * Lane A implements: orchestrator running state, mode indicator,
 * connection status, and uptime display.
 */

import type { JSX } from "react";

export interface StatusBarProps {
  isRunning: boolean;
  mode: "conversational" | "auto" | null;
  isConnected: boolean;
  uptimeSeconds: number;
}

/** Format seconds into HH:MM:SS. */
export function formatUptime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}

export function StatusBar(props: StatusBarProps): JSX.Element {
  const { isRunning, mode, isConnected, uptimeSeconds } = props;

  return (
    <div data-testid="status-bar" role="status" className="status-bar" style={{
      display: "flex",
      alignItems: "center",
      gap: "16px",
      padding: "8px 16px",
      fontSize: "14px",
      flexWrap: "wrap",
    }}>
      {/* Running / Stopped indicator */}
      <span className="status-indicator">
        <span
          className={`status-dot ${isRunning ? "running" : "stopped"} ${isRunning ? "pulse" : ""}`}
          aria-hidden="true"
        />
        {isRunning ? "Running" : "Stopped"}
      </span>

      {/* Mode indicator */}
      {mode && (
        <span className="status-indicator">
          Mode:{" "}
          <strong style={{ textTransform: "capitalize" }}>
            {mode === "auto" ? "Auto" : "Conversational"}
          </strong>
        </span>
      )}

      {/* Connection status */}
      <span className="status-indicator">
        <span
          className={`status-dot ${isConnected ? "connected" : "disconnected"} ${!isConnected ? "pulse" : ""}`}
          aria-hidden="true"
        />
        {isConnected ? "Connected" : "Disconnected"}
      </span>

      {/* Uptime */}
      <span className="status-indicator">
        Uptime:{" "}
        <strong style={{ fontVariantNumeric: "tabular-nums" }}>
          {formatUptime(uptimeSeconds)}
        </strong>
      </span>
    </div>
  );
}
