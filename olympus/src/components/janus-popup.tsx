import type { JSX } from "react";
import { colors, radius, spacing, fontSizes, shadows } from "../theme/tokens";

export interface JanusSession {
  id: string;
  issueId: string;
  lines: string[];
}

export interface JanusPopupProps {
  session: JanusSession;
  onDismiss?: () => void;
}

export function JanusPopup(props: JanusPopupProps): JSX.Element {
  const { session, onDismiss } = props;

  return (
    <div
      aria-label="Janus Escalation"
      data-testid="janus-popup"
      role="dialog"
      style={{
        position: "fixed",
        bottom: spacing.lg,
        right: spacing.lg,
        width: "420px",
        maxHeight: "50vh",
        background: colors.bgSecondary,
        border: `1px solid ${colors.casteJanus}66`,
        borderRadius: radius.lg,
        boxShadow: shadows.lg,
        display: "grid",
        gap: spacing.sm,
        padding: spacing.md,
        zIndex: 1000,
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: spacing.sm }}>
          <span
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              backgroundColor: colors.casteJanus,
              display: "inline-block",
            }}
          />
          <h3 style={{ margin: 0, fontSize: fontSizes.sm, color: colors.casteJanus }}>
            Janus Escalation
          </h3>
        </div>
        {onDismiss && (
          <button
            onClick={() => onDismiss()}
            style={{
              background: "transparent",
              border: "none",
              color: colors.textMuted,
              cursor: "pointer",
              fontSize: fontSizes.md,
              padding: spacing.xs,
            }}
            aria-label="Dismiss Janus"
          >
            ✕
          </button>
        )}
      </header>

      <div style={{ fontSize: fontSizes.xs, color: colors.textSecondary }}>
        Issue: {session.issueId}
      </div>

      <div
        style={{
          display: "grid",
          gap: spacing.xs,
          fontSize: fontSizes.xs,
          fontFamily: "monospace",
          color: colors.textSecondary,
          overflowY: "auto",
          maxHeight: "30vh",
        }}
      >
        {session.lines.map((line, index) => (
          <code key={`janus-${index}`}>{line}</code>
        ))}
      </div>
    </div>
  );
}
