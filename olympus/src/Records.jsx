import { Accordion, Alert, Badge, Code, Group, Paper, SimpleGrid, Stack, Text, UnstyledButton } from "@mantine/core";
import { AlertTriangle, Boxes, FileJson, GitMerge } from "lucide-react";
import { Screen } from "./Shell.jsx";
import { LogDeck } from "./LogDeck.jsx";
import { CompactSummary, EmptyState, SectionHead, StatusBadge } from "./ui.jsx";
import { toggleArtifact } from "./state.js";

export default function Records({ state, mutate }) {
  const ticketsById = new Map(state.tickets.map((ticket) => [ticket.id, ticket]));
  const dispatchRows = state.dispatchRecords.map((record) => {
    const ticket = ticketsById.get(record.issueId);
    return {
      id: record.issueId,
      title: ticket?.title ?? record.issueId,
      stage: record.stage ?? "pending",
      status: dispatchStatus(record),
      agent: record.runningAgent?.sessionId ?? record.lastCompletedCaste ?? "none",
      caste: record.runningAgent?.caste ?? record.lastCompletedCaste ?? "unassigned",
      scope: record.fileScope?.files?.join(", ") || ticket?.scope?.join(", ") || "workspace",
      note: dispatchNote(record),
      refs: dispatchRefs(record).length,
    };
  });
  const attentionRows = dispatchRows.filter((row) => ["failed", "cooldown", "reworking"].includes(row.status));
  const attentionIssueIds = new Set(attentionRows.map((row) => row.id));
  const artifactAttention = state.artifacts.filter((artifact) =>
    ["failed", "blocked"].includes(artifact.status) && !attentionIssueIds.has(artifact.issue)
  );
  const dispatchIssueIds = new Set(dispatchRows.map((row) => row.id));
  const ticketAttention = state.tickets
    .filter((ticket) => !dispatchIssueIds.has(ticket.id) && ticket.column === "halted")
    .map((ticket) => ({
      id: ticket.id,
      status: ticket.column === "halted" ? "failed" : "blocked",
      stage: ticket.column,
      note: ticket.blockedBy.length ? `Waiting on ${ticket.blockedBy.join(", ")}` : ticket.body,
      agent: "tracker",
    }));
  const mergeFailures = state.mergeQueue
    .filter((item) => item.state === "failed" || item.state === "error")
    .map((item) => ({
      id: item.id,
      status: "failed",
      stage: "merge",
      note: item.note,
      agent: item.issue,
    }));
  const allAttentionRows = [...attentionRows, ...ticketAttention, ...mergeFailures];

  return (
    <Screen>
      <CompactSummary
        icon={FileJson}
        title="Records"
        items={[
          ["Dispatch", dispatchRows.length],
          ["Merge", state.mergeQueue.length],
          ["Artifacts", state.artifacts.length],
          ["Attention", allAttentionRows.length + artifactAttention.length],
        ]}
      />
      <AttentionCard rows={allAttentionRows} artifacts={artifactAttention} />
      <Accordion variant="separated">
        <Accordion.Item value="records">
          <Accordion.Control>Records detail</Accordion.Control>
          <Accordion.Panel>
            <Stack gap="sm">
              <SimpleGrid cols={{ base: 1, xl: 2 }}>
                <DispatchProgress rows={dispatchRows} />
                <MergeQueue items={state.mergeQueue} />
              </SimpleGrid>
              <SimpleGrid cols={{ base: 1, xl: 2 }}>
                <Artifacts state={state} mutate={mutate} />
                <LogDeck logs={state.logs} />
              </SimpleGrid>
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Screen>
  );
}

function AttentionCard({ rows, artifacts }) {
  const hasItems = rows.length > 0 || artifacts.length > 0;
  return (
    <Paper component="section" withBorder radius="sm" p="md">
      <Stack gap="sm">
        <SectionHead icon={AlertTriangle} title="Attention" detail="Provider failures, exhausted work, and rejected artifacts stay visible here until the run recovers." />
        {!hasItems && <EmptyState title="No attention items" detail="Provider failures, exhausted work, and rejected artifacts appear here." />}
        <div className="grid min-w-0 gap-2 [grid-template-columns:repeat(auto-fit,minmax(18rem,1fr))]">
          {rows.map((row) => (
            <Alert key={row.id} color="red" variant="light" title={row.id}>
              <Group gap="xs" mb="xs" wrap="wrap"><StatusBadge status={row.status}>{row.status}</StatusBadge><Badge color="gray" variant="light">{row.stage}</Badge></Group>
              <Text size="xs" c="dimmed">{row.note}</Text>
              <Text size="xs" ff="monospace" style={{ overflowWrap: "anywhere" }}>{row.agent}</Text>
            </Alert>
          ))}
          {artifacts.map((artifact) => (
            <Alert key={artifact.id} color="red" variant="light" title={artifact.issue || "artifact"}>
              <Group gap="xs" mb="xs" wrap="wrap"><StatusBadge status={artifact.status}>{artifact.status}</StatusBadge><Badge color="gray" variant="light">{artifact.kind}</Badge></Group>
              <Text size="xs" c="dimmed">{artifact.summary}</Text>
              <Code block>{artifact.path}</Code>
            </Alert>
          ))}
        </div>
      </Stack>
    </Paper>
  );
}

function DispatchProgress({ rows }) {
  return (
    <Paper component="section" withBorder radius="sm" p="md">
      <Stack gap="sm">
        <SectionHead icon={Boxes} title="Dispatch Progress" detail="Current durable state per issue, with session ownership and artifact references." />
        {rows.length === 0 && <EmptyState title="No dispatch records" detail="Dispatch state fills after tickets enter the Aegis loop." />}
        <div className="grid min-w-0 gap-2 [grid-template-columns:repeat(auto-fit,minmax(18rem,1fr))]">
          {rows.map((row) => (
            <Paper component="article" key={row.id} withBorder radius="sm" p="sm">
              <Stack gap="xs">
                <Group justify="space-between" align="flex-start" wrap="nowrap">
                  <Stack gap={2} style={{ minWidth: 0 }}>
                    <Text size="sm" fw={700} ff="monospace" style={{ overflowWrap: "anywhere" }}>{row.id}</Text>
                    <Text size="xs" c="dimmed" lineClamp={2}>{row.title}</Text>
                  </Stack>
                  <StatusBadge status={row.status}>{row.status}</StatusBadge>
                </Group>
                <Group gap="xs"><Badge color="gray" variant="light">{row.stage}</Badge><Badge color="cyan" variant="light">{row.refs} refs</Badge></Group>
                <Text size="xs" c="dimmed" lineClamp={2}>{row.note}</Text>
                <InfoLine label="agent" value={row.agent} />
                <InfoLine label="scope" value={row.scope} />
              </Stack>
            </Paper>
          ))}
        </div>
      </Stack>
    </Paper>
  );
}

function dispatchStatus(record) {
  if (record.stage === "failed_operational") return "failed";
  if (record.stage === "blocked_on_child" || record.blockedByIssueId) return "blocked";
  if (record.stage === "cooldown") return "cooldown";
  if (record.reviewFeedbackRef && record.runningAgent) return "reworking";
  if (record.reviewFeedbackRef) return "blocked";
  if (record.runningAgent) return "running";
  if (record.stage === "complete") return "succeeded";
  if (record.stage === "pending") return "pending";
  return "active";
}

function InfoLine({ label, value }) {
  return (
    <Group gap="xs" wrap="nowrap">
      <Text w={44} size="xs" fw={700} tt="uppercase" c="dimmed">{label}</Text>
      <Text size="xs" ff="monospace" c="dimmed" lineClamp={2} style={{ overflowWrap: "anywhere" }}>{value}</Text>
    </Group>
  );
}

function dispatchNote(record) {
  if (record.stage === "failed_operational") {
    const failureKind = record.operationalFailureKind === "provider_usage_limit"
      ? "Provider usage limit reached"
      : record.operationalFailureKind ?? "Operational failure";
    return [
      failureKind,
      record.failureCount ? `${record.failureCount} failures` : "",
      record.failureTranscriptRef ?? "",
    ].filter(Boolean).join(" - ");
  }
  if (record.reviewFeedbackRef && record.runningAgent) return `${record.runningAgent.caste ?? "agent"} reworking review feedback from ${record.reviewFeedbackRef}`;
  if (record.reviewFeedbackRef) return `Review feedback requires rework: ${record.reviewFeedbackRef}`;
  if (record.blockedByIssueId) return `Waiting on ${record.blockedByIssueId}`;
  if (record.runningAgent?.sessionId) return `${record.runningAgent.caste ?? "agent"} running in ${record.runningAgent.sessionId}`;
  if (record.lastCompletedCaste) return `Last completed: ${record.lastCompletedCaste}`;
  return "Awaiting loop activity";
}

function dispatchRefs(record) {
  return [
    record.oracleAssessmentRef,
    record.titanHandoffRef,
    record.sentinelVerdictRef,
    record.reviewFeedbackRef,
    record.janusArtifactRef,
    record.failureTranscriptRef,
  ].filter(Boolean);
}

function MergeQueue({ items }) {
  return (
    <Paper component="section" withBorder radius="sm" p="md">
      <Stack gap="sm">
        <SectionHead icon={GitMerge} title="Merge Queue" detail="Integration queue records and failure reasons." />
        {items.length === 0 && <EmptyState title="Merge queue empty" detail="Completed implementation work appears here when it is ready for integration." />}
        {items.map((item) => (
          <Paper key={item.id} withBorder radius="sm" p="sm">
            <Stack gap="xs">
              <Group gap="xs" wrap="wrap"><Text size="sm" fw={700} ff="monospace">{item.id}</Text><StatusBadge status={item.state}>{item.state}</StatusBadge><Badge color="gray" variant="light">{item.priority}</Badge></Group>
              <Text size="xs" c="dimmed">{item.issue} - {item.note}</Text>
            </Stack>
          </Paper>
        ))}
      </Stack>
    </Paper>
  );
}

function Artifacts({ state, mutate }) {
  return (
    <Paper component="section" withBorder radius="sm" p="md">
      <Stack gap="sm">
        <SectionHead icon={FileJson} title="Artifacts" detail="Recent caste, policy, and transcript records with outcome summaries." />
        {state.artifacts.length === 0 && <EmptyState title="No artifacts yet" detail="Aegis writes caste output here as sessions complete." />}
        {state.artifacts.map((artifact) => (
          <Stack key={artifact.id} gap="xs">
            <UnstyledButton
              onClick={() => mutate(toggleArtifact(state, artifact.id))}
              p="sm"
              style={(theme) => ({ border: `1px solid ${theme.colors.dark[4]}`, borderRadius: theme.radius.sm })}
            >
              <Group justify="space-between" wrap="nowrap" align="flex-start">
                <Stack gap={2} style={{ minWidth: 0 }}>
                  <Text truncate size="sm" fw={700}>{artifact.issue ? `${artifact.issue} ${artifact.kind}` : artifact.kind}</Text>
                  <Text truncate size="xs" ff="monospace" c="cyan">{artifact.path}</Text>
                  <Text size="xs" c="dimmed">{artifact.summary ?? "Structured artifact available"}</Text>
                </Stack>
                <StatusBadge status={artifact.status}>{artifact.status}</StatusBadge>
              </Group>
            </UnstyledButton>
            {state.expandedArtifactIds.includes(artifact.id) && (
              <Code block className="terminal-scroll max-h-96 overflow-auto whitespace-pre-wrap break-words">{artifact.body}</Code>
            )}
          </Stack>
        ))}
      </Stack>
    </Paper>
  );
}
