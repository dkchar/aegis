import type { JSX } from "react";
import { colors, radius, spacing, fontSizes } from "../theme/tokens";

export interface ActiveSession {
  id: string;
  caste: "oracle" | "titan" | "sentinel" | "janus";
  issueId: string;
  stage: string;
  model: string;
  lines: string[];
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

function SessionTerminal(props: { session: ActiveSession }): JSX.Element {
  const { session } = props;
  const casteColor = CASTE_COLORS[session.caste];

  return (
    <div
      style={{
        background: colors.bgPrimary,
        border: `1px solid ${colors.borderDefault}`,
        borderRadius: radius.md,
        padding: spacing.sm,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: spacing.xs,
        }}
      >
        <span style={{ fontSize: fontSizes.xs, fontWeight: 700, color: colors.textPrimary }}>
          {session.id}
        </span>
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
      <div style={{ fontSize: fontSizes.xs, color: colors.textMuted, marginBottom: spacing.xs }}>
        {session.issueId} — {session.stage}
      </div>
      <div
        style={{
          display: "grid",
          gap: spacing.xs,
          fontSize: fontSizes.xs,
          fontFamily: "monospace",
          color: colors.textSecondary,
        }}
      >
        {session.lines.map((line, index) => (
          <code key={`${session.id}-${index}`}>{line}</code>
        ))}
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
        display: "grid",
        gap: spacing.sm,
        padding: spacing.md,
        background: colors.bgSecondary,
        border: `1px solid ${colors.borderDefault}`,
        borderRadius: radius.lg,
      }}
    >
      <h2 style={{ margin: 0, fontSize: fontSizes.md }}>Active Agent Sessions</h2>

      {sessionList.length > 0 ? (
        <div style={{ display: "grid", gap: spacing.sm }}>
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
