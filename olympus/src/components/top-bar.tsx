/**
 * Top bar component.
 *
 * Lane A implements: Aegis branding, status badge, active agent count,
 * spend/quota display (all metering modes), uptime, queue depth,
 * auto mode toggle, and settings access button.
 */

import { useEffect, useState } from "react";
import type { JSX } from "react";
import type { DashboardState } from "../types/dashboard-state";
import { MetricDisplay } from "./metric-display";
import { colors } from "../theme/tokens";

/** Format seconds into HH:MM:SS string. */
export function formatUptime(seconds: number): string {
  if (seconds < 0) seconds = 0;
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

/**
 * Hook that provides a live-updating uptime value.
 * Takes the last-known uptimeSeconds from SSE and increments it locally
 * every second so the display stays fresh between SSE events.
 */
export function useLiveUptime(uptimeSeconds: number, isRunning: boolean): number {
  const [liveUptime, setLiveUptime] = useState(uptimeSeconds);

  useEffect(() => {
    // Reset to the server-provided value whenever it changes
    setLiveUptime(uptimeSeconds);
  }, [uptimeSeconds]);

  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(() => {
      setLiveUptime((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [isRunning]);

  return liveUptime;
}

export interface TopBarProps {
  state: DashboardState | null;
  isConnected: boolean;
  liveActiveAgents?: number | null;
  liveQueueDepth?: number | null;
  onSettingsOpen: () => void;
}

type SpendVariant = "default" | "success" | "warning" | "danger" | "info";

/** Format a spend observation into a human-readable display value. */
function formatSpend(state: DashboardState | null): { value: string; unit?: string; variant: SpendVariant; tooltip?: string } {
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
  const { state, isConnected, liveActiveAgents, liveQueueDepth, onSettingsOpen } = props;

  const isRunning = state?.status.isRunning ?? false;
  const mode = state?.status.mode ?? null;
  const activeAgents = liveActiveAgents ?? state?.status.activeAgents ?? 0;
  const queueDepth = liveQueueDepth ?? state?.status.queueDepth ?? 0;
  const uptimeSeconds = state?.status.uptimeSeconds ?? 0;
  const isAutoMode = mode === "auto";

  // Live uptime counter that ticks every second between SSE updates
  const liveUptime = useLiveUptime(uptimeSeconds, isRunning);

  const spendInfo = formatSpend(state);

  return (
    <header data-testid="top-bar" role="banner" className="top-bar">
      {/* Left section: branding + consolidated status + mode badge */}
      <div className="top-bar-section">
        <span className="top-bar-title">Olympus</span>

        {/* Single consolidated status indicator */}
        <span className="status-indicator">
          <span
            className={`status-dot ${isRunning ? "running" : "stopped"} ${isRunning ? "pulse" : ""}`}
            aria-hidden="true"
          />
          {isRunning ? "Running" : "Stopped"}
        </span>

        {/* SSE connection status dot (small, unobtrusive) */}
        <span
          className="connection-dot"
          title={isConnected ? "Connected to server" : "Disconnected"}
          aria-label={isConnected ? "Connected" : "Disconnected"}
        >
          <span
            className={`status-dot ${isConnected ? "connected" : "disconnected"}`}
            aria-hidden="true"
          />
        </span>

        {/* Explicit mode badge */}
        <span
          className="mode-badge"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
            padding: "2px 10px",
            borderRadius: "12px",
            fontSize: "12px",
            fontWeight: 700,
            letterSpacing: "0.5px",
            textTransform: "uppercase",
            backgroundColor: isAutoMode ? colors.success + "22" : "#3a4a5e",
            color: isAutoMode ? colors.success : "#a0b4cc",
            border: `1px solid ${isAutoMode ? colors.success + "44" : "#4a5a6e"}`,
          }}
        >
          <span
            className="status-dot"
            style={{
              width: "6px",
              height: "6px",
              borderRadius: "50%",
              backgroundColor: isAutoMode ? colors.success : "#a0b4cc",
              display: "inline-block",
            }}
            aria-hidden="true"
          />
          {isAutoMode ? "Auto" : "Conversational"}
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
          variant={spendInfo.variant}
          tooltip={spendInfo.tooltip}
        />

        {/* Uptime — uses live ticking value */}
        <MetricDisplay
          label="Uptime"
          value={formatUptime(liveUptime)}
          variant="info"
          tooltip="Orchestrator uptime (HH:MM:SS)"
        />
      </div>

      {/* Right section: controls */}
      <div className="top-bar-section">
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
