import type { JSX } from "react";
import { colors, radius, spacing, fontSizes } from "../theme/tokens";

export type LoopState = "idle" | "running" | "paused" | "stopping";

export interface LoopPhaseLogs {
  poll: string[];
  dispatch: string[];
  monitor: string[];
  reap: string[];
}

export interface LoopPanelProps {
  loopState: LoopState;
  phaseLogs: LoopPhaseLogs;
  onStart: () => Promise<void>;
  onPause: () => Promise<void>;
  onResume: () => Promise<void>;
  onStop: () => Promise<void>;
  disabled?: boolean;
}

function PhaseColumn(props: { title: string; lines: string[] }): JSX.Element {
  const { title, lines } = props;

  const phaseColors: Record<string, string> = {
    Poll: "#60a5fa",
    Dispatch: "#a78bfa",
    Monitor: "#fbbf24",
    Reap: "#f87171",
  };

  const phaseColor = phaseColors[title] || "#8b949e";

  return (
    <section
      className="loop-panel-phase"
      style={{
        background: "#0a0e14",
        border: `1px solid ${phaseColor}44`,
        borderRadius: radius.md,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        height: "280px",
      }}
    >
      {/* Terminal header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: spacing.xs,
          padding: `${spacing.xs} ${spacing.sm}`,
          background: "#111820",
          borderBottom: `1px solid ${colors.borderDefault}`,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            backgroundColor: phaseColor,
            display: "inline-block",
            boxShadow: `0 0 6px ${phaseColor}66`,
          }}
        />
        <h3 style={{ margin: 0, fontSize: fontSizes.xs, fontWeight: 700, color: "#8b949e" }}>
          {title}
        </h3>
      </div>

      {/* Terminal output with scrolling */}
      <div
        style={{
          padding: spacing.sm,
          display: "grid",
          gap: spacing.xs,
          fontSize: fontSizes.xs,
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          color: "#7ee787",
          lineHeight: 1.6,
          overflow: "auto",
          flex: 1,
          minHeight: 0,
        }}
      >
        {lines.length > 0 ? (
          lines.map((line, index) => (
            <div key={`${title}-${index}`}>
              <span style={{ color: "#484f58" }}>{"› "}</span>
              <code style={{ color: "#7ee787" }}>{line}</code>
            </div>
          ))
        ) : (
          <div style={{ color: "#484f58", fontStyle: "italic" }}>No recent activity</div>
        )}
      </div>
    </section>
  );
}

export function LoopPanel(props: LoopPanelProps): JSX.Element {
  const {
    loopState,
    phaseLogs,
    onStart,
    onPause,
    onResume,
    onStop,
    disabled = false,
  } = props;

  return (
    <section
      aria-label="Aegis Loop"
      className="loop-panel"
      data-testid="loop-panel"
      role="region"
      style={{
        display: "grid",
        gap: spacing.md,
        padding: spacing.lg,
        background: colors.bgSecondary,
        border: `1px solid ${colors.borderDefault}`,
        borderRadius: radius.lg,
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: spacing.md,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h2 style={{ margin: 0 }}>Aegis Loop</h2>
          <div style={{ color: colors.textSecondary, marginTop: spacing.xs }}>
            {loopState === "idle" && "Loop idle"}
            {loopState === "running" && "Loop running"}
            {loopState === "paused" && "Loop paused"}
            {loopState === "stopping" && "Loop stopping"}
          </div>
        </div>

        <div style={{ display: "flex", gap: spacing.sm, flexWrap: "wrap" }}>
          {loopState === "idle" && (
            <button disabled={disabled} onClick={() => void onStart()} type="button">
              Start
            </button>
          )}
          {loopState === "running" && (
            <button disabled={disabled} onClick={() => void onPause()} type="button">
              Pause
            </button>
          )}
          {loopState === "paused" && (
            <button disabled={disabled} onClick={() => void onResume()} type="button">
              Resume
            </button>
          )}
          {loopState !== "idle" && (
            <button disabled={disabled || loopState === "stopping"} onClick={() => void onStop()} type="button">
              Stop
            </button>
          )}
        </div>
      </header>

      <div
        className="loop-panel-phase-table"
        style={{
          display: "grid",
          gap: spacing.md,
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
        }}
      >
        <PhaseColumn title="Poll" lines={phaseLogs.poll} />
        <PhaseColumn title="Dispatch" lines={phaseLogs.dispatch} />
        <PhaseColumn title="Monitor" lines={phaseLogs.monitor} />
        <PhaseColumn title="Reap" lines={phaseLogs.reap} />
      </div>
    </section>
  );
}
