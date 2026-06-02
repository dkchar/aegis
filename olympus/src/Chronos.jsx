import {
  ActionIcon,
  Badge,
  Box,
  Group,
  Paper,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Timeline,
  Title,
  Tree,
  UnstyledButton,
  getTreeExpandedState,
  useTree,
} from "@mantine/core";
import {
  Activity,
  Box as ArtifactIcon,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Clock3,
  GitMerge,
  ListTree,
  Radio,
  ScrollText,
  TerminalSquare,
} from "lucide-react";
import { useMemo, useState } from "react";
import { buildChronosMergeTree, buildChronosTimeline } from "./state.js";
import { statusColor } from "./ui.jsx";

const laneMeta = {
  agora: { color: "cyan", icon: ListTree, label: "Ticket" },
  dispatch: { color: "green", icon: Radio, label: "Dispatch" },
  session: { color: "violet", icon: TerminalSquare, label: "Session" },
  artifact: { color: "orange", icon: ArtifactIcon, label: "Artifact" },
  merge: { color: "yellow", icon: GitMerge, label: "Merge" },
  phase: { color: "teal", icon: Activity, label: "Loop" },
  log: { color: "blue", icon: ScrollText, label: "Log" },
};

export default function Chronos({ state }) {
  const timeline = useMemo(() => buildChronosTimeline(state), [state]);
  const mergeTree = useMemo(() => buildChronosMergeTree(state), [state]);
  const [filter, setFilter] = useState("All");
  const [selectedEventId, setSelectedEventId] = useState("");
  const [selectedTreeId, setSelectedTreeId] = useState("");
  const laneOptions = useMemo(
    () => ["All", ...Array.from(new Set(timeline.map((event) => event.lane).filter(Boolean))).sort()],
    [timeline],
  );
  const visibleTimeline = useMemo(
    () => filter === "All"
      ? timeline
      : timeline.filter((event) => event.lane === filter || event.source === filter.toLowerCase()),
    [filter, timeline],
  );

  return (
    <SimpleGrid cols={{ base: 1, xl: 2 }} spacing="md">
      <ChronosTimeline
        events={visibleTimeline}
        lanes={laneOptions}
        filter={filter}
        selectedId={selectedEventId}
        onFilter={setFilter}
        onSelect={setSelectedEventId}
      />
      <MergeTree tree={mergeTree} selectedId={selectedTreeId} onSelect={setSelectedTreeId} />
    </SimpleGrid>
  );
}

function ChronosTimeline({ events, lanes, filter, selectedId, onFilter, onSelect }) {
  return (
    <GraphPanel
      icon={Clock3}
      title="Chronos Flight Recorder"
      aside={<Select aria-label="Lane" data={lanes} value={filter} onChange={(value) => onFilter(value ?? "All")} w={150} size="xs" />}
      subtitle={`${events.length} events. Choose any entry for its full source detail.`}
    >
      <Group gap="xs" px="md" py="xs" wrap="wrap">
        {Object.entries(laneMeta).map(([source, meta]) => (
          <Badge key={source} color={meta.color} variant="light" size="xs" leftSection={<meta.icon size={11} />}>
            {meta.label}
          </Badge>
        ))}
      </Group>
      <ScrollArea h="calc(100dvh - 18rem)" type="auto" offsetScrollbars scrollbarSize={8}>
        {events.length === 0 ? (
          <EmptyGraph title="No Chronos events" detail="Select an initialized Aegis workspace or start the daemon from terminal." />
        ) : (
          <Timeline active={events.length - 1} color="cyan" bulletSize={26} lineWidth={2} p="md">
            {events.map((event) => {
              const meta = laneMeta[event.source] ?? laneMeta.log;
              const Icon = meta.icon;
              const selected = selectedId === event.id;
              const detail = event.detail && event.detail !== event.title ? event.detail : event.lane;

              return (
                <Timeline.Item
                  key={event.id}
                  bullet={<ThemeIcon color={meta.color} variant={selected ? "filled" : "light"} radius="xl" size={22}><Icon size={12} /></ThemeIcon>}
                  title={(
                    <UnstyledButton
                      data-chronos-node="timeline"
                      data-node-id={event.id}
                      data-selected={selected || undefined}
                      onClick={() => onSelect(event.id)}
                      w="100%"
                      px="xs"
                      py={5}
                      style={(theme) => ({
                        borderRadius: theme.radius.sm,
                        background: selected ? "var(--mantine-color-cyan-light)" : undefined,
                      })}
                    >
                      <Group gap="xs" justify="space-between" wrap="nowrap">
                        <Text size="sm" fw={700} truncate>{event.title}</Text>
                        <Badge color={statusColor(event.status)} variant="light" size="xs">{event.status}</Badge>
                      </Group>
                    </UnstyledButton>
                  )}
                >
                  <Group gap="xs" px="xs" pb="xs" wrap="wrap">
                    <Badge color={meta.color} variant="dot" size="xs">{meta.label}</Badge>
                    {event.issue && <Text size="xs" c="dimmed" ff="monospace">{event.issue}</Text>}
                    {selected && <Text size="xs" c="dimmed">{detail}</Text>}
                  </Group>
                </Timeline.Item>
              );
            })}
          </Timeline>
        )}
      </ScrollArea>
    </GraphPanel>
  );
}

function MergeTree({ tree, selectedId, onSelect }) {
  const data = useMemo(() => tree.roots.map(toTreeNode), [tree.roots]);
  const nodes = useMemo(() => flattenNodes(tree.roots), [tree.roots]);
  const selected = nodes.find((node) => node.id === selectedId) ?? null;

  return (
    <GraphPanel
      icon={GitMerge}
      title="Merge Tree"
      aside={<Badge color="cyan" variant="light">{tree.stats.tickets} nodes</Badge>}
      subtitle="Expand the Agora parent graph. Choose a ticket for blockers, scope, and kind."
    >
      <Group gap="xs" px="md" py="xs">
        <Badge color="green" variant="dot" size="xs">Done</Badge>
        <Badge color="yellow" variant="dot" size="xs">Active</Badge>
        <Badge color="red" variant="dot" size="xs">Blocked</Badge>
      </Group>
      <ScrollArea h="calc(100dvh - 18rem)" type="auto" offsetScrollbars scrollbarSize={8}>
        {data.length === 0 ? (
          <EmptyGraph title="No graph records" detail="Agora tickets appear here once the workspace has work loaded." />
        ) : (
          <ExpandedMergeTree data={data} selectedId={selectedId} onSelect={onSelect} />
        )}
      </ScrollArea>
      {selected && (
        <Box px="md" pb="md">
          <Paper withBorder p="sm" radius="sm">
            <TreeDetail ticket={selected} />
          </Paper>
        </Box>
      )}
    </GraphPanel>
  );
}

function ExpandedMergeTree({ data, selectedId, onSelect }) {
  const controller = useTree({ initialExpandedState: getTreeExpandedState(data, "*") });

  return (
    <Tree
      data={data}
      tree={controller}
      withLines
      levelOffset={24}
      p="md"
      renderNode={({ node, expanded, hasChildren, elementProps }) => {
        const ticket = node.ticket;
        const selectedNode = selectedId === ticket.id;
        return (
          <UnstyledButton
            {...elementProps}
            data-chronos-node="tree"
            data-node-id={ticket.id}
            data-selected={selectedNode || undefined}
            onClick={(event) => {
              elementProps.onClick(event);
              onSelect(ticket.id);
            }}
            w="100%"
            px="xs"
            py={6}
            style={(theme) => ({
              borderRadius: theme.radius.sm,
              background: selectedNode ? "var(--mantine-color-cyan-light)" : undefined,
            })}
          >
            <Group gap="xs" wrap="nowrap">
              <ActionIcon component="span" color="gray" variant="subtle" size="xs" aria-hidden>
                {hasChildren ? expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} /> : <CircleDot size={12} />}
              </ActionIcon>
              <Text ff="monospace" size="xs" c="dimmed">{ticket.id.replace("AG-", "")}</Text>
              <Text size="sm" fw={700} truncate style={{ flex: 1 }}>{ticket.title}</Text>
              <Badge color={statusColor(ticket.column)} variant="light" size="xs">{ticket.column}</Badge>
            </Group>
            {selectedNode && <TreeDetail ticket={ticket} />}
          </UnstyledButton>
        );
      }}
    />
  );
}

function GraphPanel({ icon: Icon, title, aside, subtitle, children }) {
  return (
    <Paper withBorder radius="sm" bg="dark.9" style={{ minWidth: 0, overflow: "hidden" }}>
      <Stack gap={0}>
        <Group justify="space-between" px="md" py="sm" bg="dark.8" wrap="nowrap">
          <Group gap="xs" wrap="nowrap">
            <ThemeIcon color="cyan" variant="light" radius="xl" size="sm"><Icon size={14} /></ThemeIcon>
            <Title order={2} size="sm">{title}</Title>
          </Group>
          {aside}
        </Group>
        <Text size="xs" c="dimmed" px="md" py="xs">{subtitle}</Text>
        {children}
      </Stack>
    </Paper>
  );
}

function TreeDetail({ ticket }) {
  const detail = ticket.scope?.length
    ? `scope ${ticket.scope.join(", ")}`
    : ticket.blockedBy?.length
      ? `blocked by ${ticket.blockedBy.join(", ")}`
      : `kind ${ticket.kind}`;

  return <Text size="xs" c="dimmed" mt={4}>{detail}</Text>;
}

function EmptyGraph({ title, detail }) {
  return (
    <Stack align="center" justify="center" mih={260} gap={4} p="xl">
      <Title order={3} size="sm">{title}</Title>
      <Text size="sm" c="dimmed" ta="center">{detail}</Text>
    </Stack>
  );
}

function toTreeNode(ticket) {
  return {
    value: ticket.id,
    label: ticket.title,
    ticket,
    children: ticket.children.map(toTreeNode),
  };
}

function flattenNodes(roots) {
  const nodes = [];
  const visit = (node) => {
    nodes.push(node);
    node.children.forEach(visit);
  };
  roots.forEach(visit);
  return nodes;
}
