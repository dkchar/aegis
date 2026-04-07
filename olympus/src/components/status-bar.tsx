/**
 * Status bar component contract.
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

export function StatusBar(_props: StatusBarProps): JSX.Element {
  // Lane A: implement status bar
  return (
    <div data-testid="status-bar" role="status">
      {/* Lane A: implement status indicators */}
    </div>
  );
}
