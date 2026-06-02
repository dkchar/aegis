import { Badge, Group, Paper, Stack, Text } from "@mantine/core";
import { Handle, Position } from "@xyflow/react";
import { GitBranch, ScrollText } from "lucide-react";
import { memo } from "react";

const handleStyle = {
  background: "transparent",
  border: 0,
  height: 1,
  width: 1,
};

export const TimelineNode = memo(function TimelineNode({ data }) {
  const event = data.event;
  return (
    <Paper
      data-chronos-node="timeline"
      data-node-id={event.id}
      data-selected={data.selected || undefined}
      withBorder
      radius="sm"
      px="sm"
      py={7}
      bg={data.selected ? "dark.6" : "dark.8"}
      style={{ borderColor: data.selected ? data.color : "var(--mantine-color-dark-4)", boxShadow: data.selected ? `0 0 0 1px ${data.color}` : undefined }}
    >
      <FlowHandles color={data.color} orientation={data.orientation} />
      <Group gap="xs" wrap="nowrap">
        <ScrollText size={14} color={data.color} />
        <Text size="sm" fw={750} truncate style={{ flex: 1 }}>{event.title}</Text>
        <Badge color="gray" variant="light" size="xs">{event.lane}</Badge>
        <Badge color="green" variant="dot" size="xs">{event.status}</Badge>
      </Group>
      <NodeDetails selected={data.selected} color={data.color}>
        <DetailLine label={event.issue || data.lane} value={event.detail || event.source} />
      </NodeDetails>
    </Paper>
  );
});

export const MergeNode = memo(function MergeNode({ data }) {
  const ticket = data.ticket;
  return (
    <Paper
      data-chronos-node="tree"
      data-node-id={ticket.id}
      data-selected={data.selected || undefined}
      withBorder
      radius="sm"
      px="sm"
      py={8}
      bg={data.selected ? "dark.6" : "dark.8"}
      style={{ borderColor: data.selected ? data.color : "var(--mantine-color-dark-4)", boxShadow: data.selected ? `0 0 0 1px ${data.color}` : undefined }}
    >
      <FlowHandles color={data.color} orientation={data.orientation} />
      <Group gap="xs" wrap="nowrap">
        <GitBranch size={14} color={data.color} />
        <Text ff="monospace" size="xs" c="dimmed">{ticket.id}</Text>
        <Text size="sm" fw={750} truncate style={{ flex: 1 }}>{ticket.title}</Text>
        <Badge color="gray" variant="light" size="xs">{ticket.kind}</Badge>
        <Badge color={statusTone(ticket.column)} variant="dot" size="xs">{ticket.column}</Badge>
      </Group>
      <NodeDetails selected={data.selected} color={data.color}>
        <DetailLine label="scope" value={ticket.scope?.join(", ") || "none"} />
        <DetailLine label="blocked" value={ticket.blockedBy?.join(", ") || "none"} />
      </NodeDetails>
    </Paper>
  );
});

export const ArtifactNode = TimelineNode;

function FlowHandles({ color, orientation }) {
  const target = orientation === "horizontal" ? Position.Left : Position.Top;
  const source = orientation === "horizontal" ? Position.Right : Position.Bottom;
  return (
    <>
      <Handle type="target" position={target} style={{ ...handleStyle, background: color }} />
      <Handle type="source" position={source} style={{ ...handleStyle, background: color }} />
    </>
  );
}

function NodeDetails({ selected, color, children }) {
  if (!selected) return null;
  return (
    <Paper withBorder radius="sm" p={6} mt={6} bg="dark.7" style={{ borderColor: color }}>
      <Stack gap={3}>{children}</Stack>
    </Paper>
  );
}

function DetailLine({ label, value }) {
  return (
    <Group gap="xs" wrap="nowrap">
      <Badge color="gray" variant="light" size="xs">{label}</Badge>
      <Text size="xs" c="dimmed" lineClamp={2}>{value}</Text>
    </Group>
  );
}

function statusTone(status) {
  return {
    blocked: "red",
    done: "green",
    in_progress: "yellow",
    ready: "blue",
    ready_to_merge: "teal",
  }[status] ?? "gray";
}
