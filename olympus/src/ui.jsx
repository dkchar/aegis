import { Badge, Group, Paper, Stack, Text, Title } from "@mantine/core";

export function CompactSummary({ icon: Icon, title, items }) {
  return (
    <Paper component="section" withBorder radius="sm" p="sm">
      <Group gap="sm" wrap="wrap">
        <Group gap="xs">
          <Icon color="var(--mantine-color-cyan-5)" size={18} />
          <Title order={2} size="sm">{title}</Title>
        </Group>
        <Group gap="xs" wrap="wrap">
          {items.map(([label, value]) => (
            <Badge key={label} color="gray" variant="light" tt="none">
              {label} <Text component="span" inherit ff="monospace">{value}</Text>
            </Badge>
          ))}
        </Group>
      </Group>
    </Paper>
  );
}

export function EmptyState({ title, detail }) {
  return (
    <Paper withBorder radius="sm" p="xl" mih={128} style={{ display: "grid", placeItems: "center", borderStyle: "dashed" }}>
      <Stack maw={440} gap={4} ta="center">
        <Text size="sm" fw={700}>{title}</Text>
        <Text size="sm" c="dimmed">{detail}</Text>
      </Stack>
    </Paper>
  );
}

export function InfoRow({ label, value }) {
  return (
    <Paper withBorder radius="sm" p="sm">
      <Text size="xs" fw={700} tt="uppercase" c="dimmed">{label}</Text>
      <Text size="sm" fw={700} ff="monospace" style={{ overflowWrap: "anywhere" }}>{value}</Text>
    </Paper>
  );
}

export function SectionHead({ icon: Icon, title, detail }) {
  return (
    <Stack gap={2}>
      <Group gap="xs" wrap="nowrap">
        <Icon color="var(--mantine-color-cyan-5)" size={18} />
        <Title order={2} size="md">{title}</Title>
      </Group>
      <Text size="sm" c="dimmed">{detail}</Text>
    </Stack>
  );
}

export function StatusBadge({ status, children = status, ...props }) {
  return <Badge color={statusColor(status)} variant="light" {...props}>{children}</Badge>;
}

export function statusColor(status) {
  if (["pass", "done", "accepted", "running", "ready", "queued", "merging", "streaming", "verdict ready", "succeeded", "active"].includes(status)) return "green";
  if (["watch", "pending", "idle", "in_progress", "in_review", "ready_to_merge", "cooldown", "reworking"].includes(status)) return "yellow";
  if (["blocked", "blocked_on_child", "failed", "halted", "error", "failed_operational", "failure"].includes(status)) return "red";
  return "gray";
}
