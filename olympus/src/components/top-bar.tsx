/**
 * Top bar component.
 *
 * Lane A implements: Aegis branding, status badge, active agent count,
 * spend/quota display (all metering modes), uptime, queue depth,
 * auto mode toggle, and settings access button.
 */

import type { JSX } from "react";
import type { DashboardState } from "../types/dashboard-state";
import { MetricDisplay } from "./metric-display";
import { formatUptime } from "./status-bar";

export interface TopBarProps {
  state: DashboardState | null;
  isConnected: boolean;
  onAutoToggle: (enabled: boolean) => void;
  onSettingsOpen: () => void;
}

/** Format a spend observation into a human-readable display value. */
function formatSpend(state: DashboardState | null): { value: string; unit?: string; variant: string; tooltip?: string } {
  if (!state) return { value: "--", variant: "default", tooltip: "No spend data" };

  const spend = state.spend;
  switch (spend.metering) {
    case "exact_usd":
      return {
        value: spend.costUsd !== undefined ? `$${spend.costUsd.toFixed(2)}` : "$0.00",
        unit: "USD",
        variant: "default",
        tooltip: "Exact USD cost from provider billing",
      };
    case "credits": {
      const used = spend.creditsUsed !== undefined ? spend.creditsUsed.toLocaleString() : "?";
      const remaining = spend.creditsRemaining !== undefined ? spend.creditsRemaining.toLocaleString() : "?";
      return {
        value: used,
        unit: "credits",
        variant: spend.creditsRemaining !== undefined && spend.creditsRemaining < 100 ? "warning" : "default",
        tooltip: `${used} used, ${remaining} remaining`,
      };
    }
    case "quota": {
      const usedPct = spend.quotaUsedPct;
      const remainingPct = spend.quotaRemainingPct;
      return {
        value: usedPct !== undefined ? `${usedPct.toFixed(0)}%` : "--",
        unit: "quota",
        variant: usedPct !== undefined && usedPct > 80 ? "warning" : "default",
        tooltip: remainingPct !== undefined
          ? `${usedPct?.toFixed(0)}% used, ${remainingPct.toFixed(0)}% remaining`
          : "Quota usage percentage",
      };
    }
    case "stats_only":
      return {
        value: `${(spend.totalInputTokens + spend.totalOutputTokens).toLocaleString()}`,
        unit: "tokens",
        variant: "info",
        tooltip: "Token count only — no pricing available",
      };
    case "unknown":
    default:
      return {
        value: "N/A",
        variant: "default",
        tooltip: "No reliable budget signal available",
      };
  }
}

export function TopBar(props: TopBarProps): JSX.Element {
  const { state, isConnected, onAutoToggle, onSettingsOpen } = props;

  const isRunning = state?.status.isRunning ?? false;
  const mode = state?.status.mode ?? null;
  const activeAgents = state?.status.activeAgents ?? 0;
  const queueDepth = state?.status.queueDepth ?? 0;
  const uptimeSeconds = state?.status.uptimeSeconds ?? 0;
  const isAutoMode = mode === "auto";

  const spendInfo = formatSpend(state);

  return (
    <header data-testid="top-bar" role="banner" className="top-bar">
      {/* Left section: branding + status */}
      <div className="top-bar-section">
        <span className="top-bar-title">Olympus</span>

        <span className="status-indicator">
          <span
            className={`status-dot ${isRunning ? "running" : "stopped"} ${isRunning ? "pulse" : ""}`}
            aria-hidden="true"
          />
          {isRunning ? "Running" : "Stopped"}
        </span>

        {/* Connection status dot */}
        <span className="status-indicator">
          <span
            className={`status-dot ${isConnected ? "connected" : "disconnected"} ${!isConnected ? "pulse" : ""}`}
            aria-hidden="true"
          />
        </span>
      </div>

      {/* Center section: metrics */}
      <div className="top-bar-section metrics-row">
        {/* Active agents */}
        <MetricDisplay
          label="Agents"
          value={activeAgents}
          variant={activeAgents > 0 ? "success" : "default"}
          tooltip="Active agent count"
        />

        {/* Queue depth */}
        <MetricDisplay
          label="Queue"
          value={queueDepth}
          variant={queueDepth > 5 ? "warning" : "default"}
          tooltip="Pending issues in ready queue"
        />

        {/* Spend / Quota */}
        <MetricDisplay
          label="Spend"
          value={spendInfo.value}
          unit={spendInfo.unit}
          variant={spendInfo.variant as "default" | "success" | "warning" | "danger" | "info"}
          tooltip={spendInfo.tooltip}
        />

        {/* Uptime */}
        <MetricDisplay
          label="Uptime"
          value={formatUptime(uptimeSeconds)}
          variant="info"
          tooltip="Orchestrator uptime (HH:MM:SS)"
        />
      </div>

      {/* Right section: controls */}
      <div className="top-bar-section">
        {/* Auto mode toggle */}
        <div className="auto-toggle">
          <span className="auto-toggle-label">Auto</span>
          <button
            className={`auto-toggle-btn ${isAutoMode ? "on" : "off"}`}
            onClick={() => onAutoToggle(!isAutoMode)}
            aria-pressed={isAutoMode}
            aria-label={`Auto mode is currently ${isAutoMode ? "on" : "off"}. Click to turn ${isAutoMode ? "off" : "on"}.`}
          >
            {isAutoMode ? "ON" : "OFF"}
          </button>
        </div>

        {/* Settings button */}
        <button
          className="settings-btn"
          onClick={onSettingsOpen}
          aria-label="Open settings"
          title="Settings"
        >
          {"\u2699"}
        </button>
      </div>
    </header>
  );
}
