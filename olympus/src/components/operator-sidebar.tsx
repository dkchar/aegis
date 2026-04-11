import type { JSX } from "react";
import { colors, radius, spacing, fontSizes } from "../theme/tokens";
import { SteerPanel } from "./steer-panel";

export interface ReadyIssue {
  id: string;
  title?: string;
  priority?: number;
}

export interface SelectedIssue {
  id: string;
  stage: string;
  summary: string;
}

export interface OperatorSidebarProps {
  readyQueue: string[];
  issueGraph: string[];
  selectedIssue: SelectedIssue | null;
  steerReference: string[];
  onCommand: (command: string) => Promise<void>;
}

function SectionHeader(props: { title: string }): JSX.Element {
  return (
    <h3
      style={{
        margin: 0,
        marginBottom: spacing.sm,
        fontSize: fontSizes.xs,
        fontWeight: 700,
        letterSpacing: "0.5px",
        textTransform: "uppercase",
        color: colors.textMuted,
      }}
    >
      {props.title}
    </h3>
  );
}

function ReadyQueueList(props: { items: string[] }): JSX.Element {
  const { items } = props;

  if (items.length === 0) {
    return <div style={{ color: colors.textMuted, fontSize: fontSizes.xs }}>No ready items</div>;
  }

  return (
    <ul style={{ margin: 0, paddingLeft: spacing.md, fontSize: fontSizes.xs, color: colors.textSecondary }}>
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function IssueGraphList(props: { items: string[] }): JSX.Element {
  const { items } = props;

  if (items.length === 0) {
    return <div style={{ color: colors.textMuted, fontSize: fontSizes.xs }}>No graph data</div>;
  }

  return (
    <ul style={{ margin: 0, paddingLeft: spacing.md, fontSize: fontSizes.xs, color: colors.textSecondary }}>
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function SelectedIssueCard(props: { issue: SelectedIssue }): JSX.Element {
  const { issue } = props;

  return (
    <div
      style={{
        background: colors.bgTertiary,
        border: `1px solid ${colors.borderDefault}`,
        borderRadius: radius.md,
        padding: spacing.sm,
      }}
    >
      <div style={{ fontSize: fontSizes.sm, color: colors.textPrimary, fontWeight: 600 }}>
        {issue.id}
      </div>
      <div style={{ fontSize: fontSizes.xs, color: colors.textSecondary, marginTop: spacing.xs }}>
        Stage: {issue.stage}
      </div>
      <div style={{ fontSize: fontSizes.xs, color: colors.textMuted, marginTop: spacing.xs }}>
        {issue.summary}
      </div>
    </div>
  );
}

export function OperatorSidebar(props: OperatorSidebarProps): JSX.Element {
  const { readyQueue, issueGraph, selectedIssue, steerReference, onCommand } = props;

  return (
    <aside
      aria-label="Operator Sidebar"
      data-testid="operator-sidebar"
      style={{
        display: "grid",
        gap: spacing.md,
        padding: spacing.md,
        background: colors.bgSecondary,
        borderRight: `1px solid ${colors.borderDefault}`,
        minWidth: "220px",
        maxWidth: "280px",
        overflowY: "auto",
      }}
    >
      <section>
        <SectionHeader title="Ready Queue" />
        <ReadyQueueList items={readyQueue} />
      </section>

      <section>
        <SectionHeader title="Issue Graph" />
        <IssueGraphList items={issueGraph} />
      </section>

      {selectedIssue && (
        <section>
          <SectionHeader title="Selected Issue" />
          <SelectedIssueCard issue={selectedIssue} />
        </section>
      )}

      <section>
        <SteerPanel
          reference={steerReference}
          onCommand={onCommand}
        />
      </section>
    </aside>
  );
}
