import { Braces, TerminalSquare } from "lucide-react";
import { Badge, Button, Grid, Group, Paper, ScrollArea, SegmentedControl, SimpleGrid, Stack, Text, UnstyledButton } from "@mantine/core";
import { Suspense, lazy } from "react";
import { selectAgent, setSessionFilter } from "./state.js";
import { deriveSessionView } from "./supervisionModel.js";
import { CompactSummary, EmptyState, InfoRow, SectionHead, formatTokens, formatUsd, statusColor } from "./ui.jsx";

const TerminalPane = lazy(() => import("./TerminalPane.jsx"));
const sessionFilters = ["All", "Oracle", "Titan", "Sentinel", "Janus"];

function persistSelectedSession(agentId) {
  try {
    window.localStorage.setItem("olympus.selectedSessionId", agentId);
  } catch {
    // Storage can be unavailable (private mode); the hash still carries the selection.
  }
}

export default function AgentSessions({ state, mutate }) {
  const { sortedAgents, filteredAgents, activeFilters, groupedAgents } = deriveSessionView(state, sessionFilters);
  const routeSessionId = resolveSessionIdFromHash();
  const selected = routeSessionId
    ? sortedAgents.find((agent) => agent.id === state.selectedAgentId) || sortedAgents.find((agent) => agent.id === routeSessionId) || filteredAgents[0] || sortedAgents[0] || null
    : filteredAgents[0] || sortedAgents[0] || null;
  const openSession = (agentId) => {
    if (typeof window !== "undefined") {
      persistSelectedSession(agentId);
      window.location.hash = `agents/${encodeURIComponent(agentId)}`;
    }
    mutate(selectAgent(state, agentId));
  };
  const totalCost = formatUsd(state.agents.reduce((sum, agent) => sum + (Number(agent.usage?.costUsd) || 0), 0));

  return (
    <Stack gap="sm">
      <CompactSummary
        icon={TerminalSquare}
        title="Agent Sessions"
        items={[
          ["Visible", filteredAgents.length],
          ["Total", state.agents.length],
          ["Selected", selected?.id ?? "none"],
          ["Status", selected?.status ?? "waiting"],
          ...(totalCost ? [["Spend", totalCost]] : []),
        ]}
      />
      <Paper withBorder p="xs">
        <SegmentedControl value={state.sessionFilter} data={activeFilters} onChange={(filter) => mutate(setSessionFilter(state, filter))} />
      </Paper>
      <Paper component="section" withBorder mih="68vh" style={{ overflow: "hidden" }}>
        {filteredAgents.length === 0 ? (
          <EmptyState title="No sessions yet" detail="Sessions appear here after Aegis dispatches adapter work." />
        ) : (
          <Grid gutter={0}>
            <Grid.Col span={{ base: 12, lg: 3 }}>
              <SessionList agents={filteredAgents} groupedAgents={groupedAgents} selected={selected} openSession={openSession} />
            </Grid.Col>
            <Grid.Col span={{ base: 12, lg: 9 }} className="grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_auto] border-t border-[var(--mantine-color-dark-4)] lg:border-l lg:border-t-0">
              <Suspense fallback={<Text p="md" size="sm" c="dimmed">Preparing terminal renderer.</Text>}>
                <TerminalPane
                  key={selected.id}
                  session={selected}
                  selected
                  title={`${selected.caste} ${selected.issue} ${selected.stage}`}
                  onSelect={() => openSession(selected.id)}
                  framed={false}
                />
              </Suspense>
              <SessionInspector agent={selected} />
            </Grid.Col>
          </Grid>
        )}
      </Paper>
    </Stack>
  );
}

function SessionList({ agents, groupedAgents, selected, openSession }) {
  return (
    <ScrollArea component="aside" h={{ base: "34vh", lg: "68vh" }} type="auto" offsetScrollbars scrollbarSize={8}>
      <Stack gap={3} p="xs">
        <Group justify="space-between" px={4} py={4}>
          <Text size="xs" fw={700} tt="uppercase" c="dimmed">Session Stream</Text>
          <Badge color="aegis" variant="light">{agents.length}</Badge>
        </Group>
        {groupedAgents.map(([caste, casteAgents]) => casteAgents.length > 0 && (
          <Stack key={caste} gap={2}>
            <Text mt="xs" px={4} size="xs" fw={700} tt="uppercase" c="dimmed">{caste}</Text>
            {casteAgents.map((agent) => (
              <UnstyledButton
                key={agent.id}
                onClick={() => openSession(agent.id)}
                px="xs"
                py={6}
                aria-current={agent.id === selected?.id ? "true" : undefined}
                style={{
                  borderRadius: "var(--mantine-radius-md)",
                  background: agent.id === selected?.id ? "var(--mantine-color-aegis-light)" : undefined,
                }}
              >
                <Group gap="xs" justify="space-between" wrap="nowrap">
                  <Stack gap={0} style={{ minWidth: 0 }}>
                    <Text size="sm" fw={700} truncate>{agent.issue}</Text>
                    <Text size="xs" ff="monospace" c="dimmed" truncate>{agent.model || agent.id}</Text>
                  </Stack>
                  <Badge color={statusColor(agent.status)} variant="light" size="xs">{agent.status}</Badge>
                </Group>
              </UnstyledButton>
            ))}
          </Stack>
        ))}
      </Stack>
    </ScrollArea>
  );
}

function formatUsage(usage) {
  if (!usage) return "not reported";
  const parts = [
    formatUsd(usage.costUsd),
    formatTokens(usage.inputTokens) && `${formatTokens(usage.inputTokens)} in`,
    formatTokens(usage.outputTokens) && `${formatTokens(usage.outputTokens)} out`,
    usage.turns ? `${usage.turns} turns` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "not reported";
}

function SessionInspector({ agent }) {
  const sessionHref = `#agents/${encodeURIComponent(agent.id)}`;
  return (
    <Paper component="section" radius={0} p="sm" withBorder>
      <Stack gap="sm">
        <Group justify="space-between" wrap="wrap">
          <SectionHead icon={Braces} title="Selected Session" detail="Transcript, status, issue, adapter, and usage." />
          <Button component="a" href={sessionHref} variant="default" leftSection={<TerminalSquare size={16} />}>Open View</Button>
        </Group>
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="xs">
          <InfoRow label="Session" value={agent.id} />
          <InfoRow label="Caste" value={agent.caste} />
          <InfoRow label="Issue" value={agent.issue} />
          <InfoRow label="Stage" value={agent.stage} />
          <InfoRow label="Status" value={agent.status} />
          <InfoRow label="Adapter" value={agent.model ? `${agent.adapter} · ${agent.model}` : agent.adapter} />
          <InfoRow label="Usage" value={formatUsage(agent.usage)} />
          <InfoRow label="CWD Jail" value={agent.cwd} />
          <InfoRow label="Transcript" value={agent.activity} />
        </SimpleGrid>
      </Stack>
    </Paper>
  );
}

function resolveSessionIdFromHash() {
  if (typeof window === "undefined") return "";
  const [, sessionId = ""] = window.location.hash.replace(/^#/, "").split("/");
  return decodeURIComponent(sessionId);
}
