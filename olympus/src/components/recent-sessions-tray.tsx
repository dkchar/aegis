import type { JSX } from "react";
import { useState } from "react";
import { colors, radius, spacing, fontSizes } from "../theme/tokens";

export interface RecentSession {
  id: string;
  caste: "oracle" | "titan" | "sentinel" | "janus";
  issueId: string;
  outcome: "completed" | "failed" | "aborted";
  endedAt: string;
  lines: string[];
}

export interface RecentSessionsTrayProps {
  sessions: RecentSession[];
}

const OUTCOME_COLORS: Record<RecentSession["outcome"], string> = {
  completed: colors.success,
  failed: colors.danger,
  aborted: colors.warning,
};

const CASTE_COLORS: Record<RecentSession["caste"], string> = {
  oracle: colors.casteOracle,
  titan: colors.casteTitan,
  sentinel: colors.casteSentinel,
  janus: colors.casteJanus,
};

function formatTimeAgo(endedAt: string): string {
  const now = Date.now();
  const ended = new Date(endedAt).getTime();
  const diffSec = Math.floor((now - ended) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  return `${diffHr}h ago`;
}

function ExpandedSessionDetail(props: { session: RecentSession }): JSX.Element {
  const { session } = props;
  const casteColor = CASTE_COLORS[session.caste];

  return (
    <div
      style={{
        marginTop: spacing.xs,
        background: "#0a0e14",
        border: `1px solid ${casteColor}44`,
        borderRadius: radius.md,
        overflow: "hidden",
      }}
    >
      {/* Metadata header */}
      <div
        style={{
          padding: `${spacing.xs} ${spacing.sm}`,
          background: "#111820",
          borderBottom: `1px solid ${colors.borderDefault}`,
          fontSize: fontSizes.xs,
          fontFamily: "monospace",
          color: "#8b949e",
        }}
      >
        <span>{session.issueId}</span>
        <span style={{ color: "#484f58" }}> | </span>
        <span style={{ color: casteColor }}>{session.caste}</span>
        <span style={{ color: "#484f58" }}> | </span>
        <span>{session.outcome}</span>
        <span style={{ color: "#484f58" }}> | </span>
        <span>{formatTimeAgo(session.endedAt)}</span>
      </div>

      {/* Session log output */}
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
          maxHeight: "240px",
          minHeight: "48px",
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
          <div style={{ color: "#484f58", fontStyle: "italic" }}>No logs captured</div>
        )}
      </div>
    </div>
  );
}

function SessionChip(props: { session: RecentSession }): JSX.Element {
  const { session } = props;
  const [expanded, setExpanded] = useState(false);
  const outcomeColor = OUTCOME_COLORS[session.outcome];

  return (
    <div style={{ marginBottom: spacing.xs }}>
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-label={`Session ${session.id}, ${session.outcome}, ${formatTimeAgo(session.endedAt)}`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: spacing.xs,
          padding: `${spacing.xs} ${spacing.sm}`,
          background: colors.bgTertiary,
          border: `1px solid ${outcomeColor}44`,
          borderRadius: radius.full,
          fontSize: fontSizes.xs,
          color: colors.textSecondary,
          cursor: "pointer",
          width: "100%",
          textAlign: "left",
        }}
      >
        <span
          style={{
            width: "6px",
            height: "6px",
            borderRadius: "50%",
            backgroundColor: outcomeColor,
            display: "inline-block",
            flexShrink: 0,
          }}
        />
        <span style={{ fontFamily: "monospace", fontSize: "11px" }}>
          {session.issueId} <span style={{ color: "#484f58" }}>|</span> {session.caste}
        </span>
        <span style={{ marginLeft: "auto", color: "#6e7681", fontSize: "10px" }}>
          {formatTimeAgo(session.endedAt)}
        </span>
      </button>
      {expanded && <ExpandedSessionDetail session={session} />}
    </div>
  );
}

export function RecentSessionsTray(props: RecentSessionsTrayProps): JSX.Element {
  const { sessions } = props;

  return (
    <section
      aria-label="Completed Sessions"
      data-testid="recent-sessions-tray"
      style={{
        padding: spacing.md,
        background: colors.bgSecondary,
        border: `1px solid ${colors.borderDefault}`,
        borderRadius: radius.lg,
      }}
    >
      <h2 style={{ margin: "0 0 12px 0", fontSize: fontSizes.md }}>Completed Sessions</h2>

      {sessions.length > 0 ? (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))",
          gap: spacing.md,
        }}>
          {sessions.map((session) => (
            <SessionChip key={session.id} session={session} />
          ))}
        </div>
      ) : (
        <div style={{ color: colors.textMuted, fontSize: fontSizes.xs }}>No recent completions</div>
      )}
    </section>
  );
}
