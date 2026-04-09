/**
 * Settings panel component.
 *
 * Lane A implements: settings access, configuration display,
 * and preference management.
 *
 * Slide-in panel from the right side with overlay backdrop.
 */

import type { JSX } from "react";
import type { OlympusConfig } from "../types/dashboard-state";

export interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  /** Config values from the server. Falls back to defaults if absent. */
  config?: OlympusConfig | null;
}

/** Default config values used when the server hasn't supplied any. */
const FALLBACK_CONFIG: OlympusConfig = {
  runtime: "pi",
  maxConcurrency: 2,
  pollIntervalSec: 10,
  budgetLimitUsd: 10,
  coerceReview: true,
  meteringFallback: "unknown",
};

/** Resolve effective config: server values first, then fallback defaults. */
function effectiveConfig(server?: OlympusConfig | null): OlympusConfig {
  if (server) return server;
  return FALLBACK_CONFIG;
}

export function SettingsPanel(props: SettingsPanelProps): JSX.Element {
  const { isOpen, onClose, config: serverConfig } = props;
  const cfg = effectiveConfig(serverConfig);
  const fromServer = !!serverConfig;

  if (!isOpen) return <div data-testid="settings-panel" />;

  return (
    <div
      data-testid="settings-panel"
      role="dialog"
      aria-label="Settings"
      aria-modal="true"
    >
      {/* Overlay backdrop — click to close */}
      <div className="settings-overlay" onClick={onClose} style={{ animation: "fadeIn 250ms ease forwards" }}>
        {/* Panel content — stop propagation so clicking inside doesn't close */}
        <div
          className="settings-panel"
          onClick={(e) => e.stopPropagation()}
          style={{ animation: "slideIn 400ms ease forwards" }}
        >
          {/* Header */}
          <div className="settings-header">
            <h2>Settings</h2>
            <button
              className="settings-close-btn"
              onClick={onClose}
              aria-label="Close settings"
            >
              {"\u2715"}
            </button>
          </div>

          {/* Source indicator */}
          <div style={{
            fontSize: "11px",
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            color: fromServer ? "#2ec4b6" : "#f4a261",
            marginBottom: "16px",
            padding: "4px 8px",
            borderRadius: "4px",
            backgroundColor: fromServer ? "rgba(46,196,182,0.1)" : "rgba(244,162,97,0.1)",
            display: "inline-block",
          }}>
            {fromServer ? "Live from server" : "Default values (server not connected)"}
          </div>

          {/* Runtime section */}
          <section style={{ marginBottom: "24px" }}>
            <h3 style={{
              fontSize: "14px",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              color: "#7a8a9e",
              marginBottom: "12px",
            }}>
              Runtime
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <ConfigRow label="Adapter" value={cfg.runtime} />
              <ConfigRow label="Poll Interval" value={`${cfg.pollIntervalSec}s`} />
              <ConfigRow label="Metering Fallback" value={cfg.meteringFallback} />
            </div>
          </section>

          {/* Concurrency section */}
          <section style={{ marginBottom: "24px" }}>
            <h3 style={{
              fontSize: "14px",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              color: "#7a8a9e",
              marginBottom: "12px",
            }}>
              Concurrency
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <ConfigRow label="Max Concurrent Agents" value={String(cfg.maxConcurrency)} />
            </div>
          </section>

          {/* Budget section */}
          <section style={{ marginBottom: "24px" }}>
            <h3 style={{
              fontSize: "14px",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              color: "#7a8a9e",
              marginBottom: "12px",
            }}>
              Budget
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <ConfigRow
                label="Daily Hard Stop"
                value={cfg.budgetLimitUsd != null ? `$${cfg.budgetLimitUsd}` : "Not set"}
              />
              <ConfigRow label="Coerce Review" value={cfg.coerceReview ? "Yes" : "No"} />
            </div>
          </section>

          {/* Info footer */}
          <div style={{
            marginTop: "32px",
            paddingTop: "16px",
            borderTop: "1px solid #2d4055",
            fontSize: "12px",
            color: "#7a8a9e",
          }}>
            <p>Olympus v0.1.0</p>
            <p style={{ marginTop: "4px" }}>Aegis MVP — Phase 1</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Single configuration key-value row. */
function ConfigRow({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div style={{
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "8px 12px",
      backgroundColor: "#253546",
      borderRadius: "8px",
    }}>
      <span style={{ fontSize: "14px", color: "#b0b0b0" }}>{label}</span>
      <span style={{
        fontSize: "14px",
        fontWeight: 600,
        color: "#e0e0e0",
        fontFamily: "'Fira Code', 'Cascadia Code', 'Consolas', monospace",
      }}>
        {value}
      </span>
    </div>
  );
}
