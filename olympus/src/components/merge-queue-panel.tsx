import type { JSX } from "react";
import { colors, radius, spacing, fontSizes } from "../theme/tokens";

export interface MergeQueuePanelProps {
  queueLength: number;
  currentItem: string | null;
  lines: string[];
}

export function MergeQueuePanel(props: MergeQueuePanelProps): JSX.Element {
  const { queueLength, currentItem, lines } = props;

  return (
    <section
      aria-label="Merge Queue"
      data-testid="merge-queue-panel"
      style={{
        display: "grid",
        gap: spacing.sm,
        padding: spacing.md,
        background: colors.bgSecondary,
        border: `1px solid ${colors.borderDefault}`,
        borderRadius: radius.lg,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <h2 style={{ margin: 0, fontSize: fontSizes.md }}>Merge Queue</h2>
        {queueLength > 0 && (
          <span
            style={{
              fontSize: fontSizes.xs,
              color: colors.textSecondary,
              background: colors.bgTertiary,
              padding: `${spacing.xs} ${spacing.sm}`,
              borderRadius: radius.full,
            }}
          >
            {queueLength} items in queue
          </span>
        )}
      </div>

      {currentItem && (
        <div
          style={{
            fontSize: fontSizes.sm,
            color: colors.textPrimary,
            fontWeight: 600,
          }}
        >
          Current: {currentItem}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gap: spacing.xs,
          fontSize: fontSizes.xs,
          fontFamily: "monospace",
          color: colors.textSecondary,
        }}
      >
        {lines.length > 0 ? (
          lines.map((line, index) => (
            <code key={`mq-${index}`}>{line}</code>
          ))
        ) : (
          <div style={{ color: colors.textMuted }}>Queue empty</div>
        )}
      </div>
    </section>
  );
}
