/**
 * Top bar component contract.
 *
 * Lane A implements: status badge, active agent count, spend/quota display,
 * uptime, queue depth, and auto mode toggle.
 */

import type { JSX } from "react";
import type { DashboardState } from "../types/dashboard-state";

export interface TopBarProps {
  state: DashboardState | null;
  isConnected: boolean;
  onAutoToggle: (enabled: boolean) => void;
  onSettingsOpen: () => void;
}

export function TopBar(_props: TopBarProps): JSX.Element {
  // Lane A: implement status, spend/quota, uptime, queue depth, auto toggle
  return (
    <header data-testid="top-bar" role="banner">
      {/* Lane A: implement full top bar */}
    </header>
  );
}
