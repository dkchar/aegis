import type { JSX } from "react";
import { colors, radius, spacing, fontSizes } from "../theme/tokens";

export interface RecentSession {
  id: string;
  closedAgo: string;
  outcome: "success" | "failed" | "rejected";
}

export interface RecentSessionsTrayProps {
  sessions: RecentSession[];
}

const OUTCOME_COLORS: Record<RecentSession["outcome"], string> = {
  success: colors.success,
  failed: colors.danger,
  rejected: colors.warning,
};

export function RecentSessionsTray(props: RecentSessionsTrayProps): JSX.Element {
  const { sessions } = props;

  return (
    <section
      aria-label="Completed Sessions"
      data-testid="recent-sessions-tray"
      style={{
        display: "grid",
        gap: spacing.sm,
        padding: spacing.md,
        background: colors.bgSecondary,
        border: `1px solid ${colors.borderDefault}`,
        borderRadius: radius.lg,
      }}
    >
      <h2 style={{ margin: 0, fontSize: fontSizes.md }}>Completed Sessions</h2>

      {sessions.length > 0 ? (
        <div style={{ display: "flex", gap: spacing.sm, flexWrap: "wrap" }}>
          {sessions.map((session) => (
            <button
              key={session.id}
              className="recent-session-pill"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: spacing.xs,
                padding: `${spacing.xs} ${spacing.sm}`,
                background: colors.bgTertiary,
                border: `1px solid ${OUTCOME_COLORS[session.outcome]}44`,
                borderRadius: radius.full,
                fontSize: fontSizes.xs,
                color: colors.textSecondary,
                cursor: "pointer",
              }}
            >
              <span
                style={{
                  width: "6px",
                  height: "6px",
                  borderRadius: "50%",
                  backgroundColor: OUTCOME_COLORS[session.outcome],
                  display: "inline-block",
                }}
              />
              {session.id} completed {session.closedAgo}
            </button>
          ))}
        </div>
      ) : (
        <div style={{ color: colors.textMuted, fontSize: fontSizes.xs }}>No recent completions</div>
      )}
    </section>
  );
}
