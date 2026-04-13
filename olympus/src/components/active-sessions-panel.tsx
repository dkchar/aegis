import type { JSX } from "react";
import { colors, radius, spacing, fontSizes } from "../theme/tokens";

export interface ActiveSession {
  id: string;
  caste: "oracle" | "titan" | "sentinel" | "janus";
  issueId: string;
  stage: string;
  model: string;
  lines: string[];
  /** Input tokens consumed so far. */
  inputTokens?: number;
  /** Output tokens consumed so far. */
  outputTokens?: number;
  /** Number of turns taken. */
  turns?: number;
  /** Elapsed wall-clock seconds. */
  elapsedSec?: number;
  /** Approximate USD spend for this session. */
  spendUsd?: number;
}

export interface ActiveSessionsPanelProps {
  sessions: Record<string, ActiveSession>;
}

const CASTE_COLORS: Record<ActiveSession["caste"], string> = {
  oracle: colors.casteOracle,
  titan: colors.casteTitan,
  sentinel: colors.casteSentinel,
  janus: colors.casteJanus,
};

function formatElapsed(sec?: number): string {
  if (sec == null) return "";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}m ${s}s`;
}

function SessionTerminal(props: { session: ActiveSession }): JSX.Element {
  const { session } = props;
  const casteColor = CASTE_COLORS[session.caste];
  const hasStats = session.inputTokens != null || session.turns != null || session.elapsedSec != null;

  return (
    <div
      className="session-terminal"
      data-testid={`session-terminal-${session.id}`}
      aria-label={`Session ${session.id}`}
      style={{
        background: "#0a0e14",
        border: `1px solid ${casteColor}44`,
        borderRadius: radius.md,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        height: "320px",
      }}
    >
      {/* Terminal title bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: `${spacing.xs} ${spacing.sm}`,
          background: "#111820",
          borderBottom: `1px solid ${colors.borderDefault}`,
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: spacing.xs }}>
          {/* Terminal dot indicator */}
          <span
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              backgroundColor: casteColor,
              display: "inline-block",
              boxShadow: `0 0 6px ${casteColor}66`,
            }}
          />
          <span style={{ fontSize: fontSizes.xs, fontWeight: 700, color: "#8b949e" }}>
            {session.id.length > 28 ? session.id.slice(0, 25) + "…" : session.id}
          </span>
        </div>
        <span
          style={{
            fontSize: fontSizes.xs,
            color: casteColor,
            fontWeight: 600,
          }}
        >
          {session.caste}
        </span>
      </div>

      {/* Session info bar with enhanced metadata */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: `${spacing.xs} ${spacing.sm}`,
          fontSize: fontSizes.xs,
          color: colors.textMuted,
          borderBottom: `1px solid ${colors.borderDefault}44`,
          flexShrink: 0,
        }}
      >
        <span style={{ fontFamily: "monospace", fontSize: "11px" }}>
          {session.issueId} <span style={{ color: "#484f58" }}>|</span> {session.caste} <span style={{ color: "#484f58" }}>|</span> {session.model}
        </span>
        {hasStats && (
          <span style={{ fontFamily: "monospace", fontSize: "10px", color: "#6e7681" }}>
            {session.turns != null ? `${session.turns}t ` : ""}
            {session.inputTokens != null ? `${(session.inputTokens / 1000).toFixed(1)}k in ` : ""}
            {session.outputTokens != null ? `${(session.outputTokens / 1000).toFixed(1)}k out ` : ""}
            {session.elapsedSec != null ? formatElapsed(session.elapsedSec) : ""}
            {session.spendUsd != null ? ` · $${session.spendUsd.toFixed(2)}` : ""}
          </span>
        )}
      </div>

      {/* Terminal output with fixed height and scrolling */}
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
        {session.lines.length > 0 ? (
          session.lines.map((line, index) => (
            <div key={`${session.id}-${index}`}>
              <span style={{ color: "#484f58" }}>{"› "}</span>
              <code style={{ color: "#7ee787" }}>{line.replace(/^>\s*/, "")}</code>
            </div>
          ))
        ) : (
          <div style={{ color: "#484f58", fontStyle: "italic" }}>Waiting for output...</div>
        )}
      </div>
    </div>
  );
}

export function ActiveSessionsPanel(props: ActiveSessionsPanelProps): JSX.Element {
  const { sessions } = props;
  const sessionList = Object.values(sessions);

  return (
    <section
      aria-label="Active Agent Sessions"
      data-testid="active-sessions-panel"
      style={{
        padding: spacing.md,
        background: colors.bgSecondary,
        border: `1px solid ${colors.borderDefault}`,
        borderRadius: radius.lg,
      }}
    >
      <h2 style={{ margin: "0 0 12px 0", fontSize: fontSizes.md }}>Active Agent Sessions</h2>

      {sessionList.length > 0 ? (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))",
          gap: spacing.md,
        }}>
          {sessionList.map((session) => (
            <SessionTerminal key={session.id} session={session} />
          ))}
        </div>
      ) : (
        <div style={{ color: colors.textMuted, fontSize: fontSizes.xs }}>No active sessions</div>
      )}
    </section>
  );
}
