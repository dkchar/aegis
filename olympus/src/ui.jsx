import { Badge, Group, Paper, Progress, Stack, Text, ThemeIcon, Title, Tooltip } from "@mantine/core";

export function Panel({ icon, title, detail, actions = null, children, ...props }) {
  return (
    <Paper component="section" withBorder p="md" {...props}>
      <Stack gap="sm">
        {(title || actions) && (
          <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm">
            {title && <SectionHead icon={icon} title={title} detail={detail} />}
            {actions}
          </Group>
        )}
        {children}
      </Stack>
    </Paper>
  );
}

export function CompactSummary({ icon: Icon, title, items }) {
  return (
    <Paper component="section" withBorder p="sm">
      <Group gap="sm" wrap="wrap">
        <Group gap="xs">
          <ThemeIcon variant="light" size="md" radius="md"><Icon size={16} /></ThemeIcon>
          <Title order={2} size="sm">{title}</Title>
        </Group>
        <Group gap="xs" wrap="wrap">
          {items.map(([label, value]) => (
            <Badge key={label} color="gray" variant="light" size="lg">
              <Text component="span" inherit c="dimmed">{label}</Text>{" "}
              <Text component="span" inherit ff="monospace">{value}</Text>
            </Badge>
          ))}
        </Group>
      </Group>
    </Paper>
  );
}

/** KPI tile: label, large value, optional hint and progress. */
export function StatCard({ label, value, hint, tone = "gray", progress = null, icon: Icon = null }) {
  return (
    <Paper withBorder p="sm" className="olympus-stat" style={{ minWidth: 0 }}>
      <Group justify="space-between" align="flex-start" wrap="nowrap" gap="xs">
        <Stack gap={2} style={{ minWidth: 0 }}>
          <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: "0.04em" }}>{label}</Text>
          <Text size="xl" fw={800} ff="monospace" c={tone === "gray" ? undefined : tone} lh={1.1}>{value}</Text>
          {hint && <Text size="xs" c="dimmed" truncate>{hint}</Text>}
        </Stack>
        {Icon && <ThemeIcon variant="light" color={tone === "gray" ? "aegis" : tone} radius="md"><Icon size={16} /></ThemeIcon>}
      </Group>
      {progress !== null && <Progress mt="xs" size="sm" radius="xl" value={progress} color={tone === "gray" ? "aegis" : tone} />}
    </Paper>
  );
}

export function LiveDot({ color = "var(--mantine-color-green-5)", live = false, label }) {
  const dot = <span className="live-dot" data-live={live ? "true" : "false"} style={{ color }} aria-hidden="true" />;
  return label ? <Tooltip label={label}>{dot}</Tooltip> : dot;
}

export function EmptyState({ title, detail }) {
  return (
    <Paper withBorder p="xl" mih={128} style={{ display: "grid", placeItems: "center", borderStyle: "dashed" }}>
      <Stack maw={440} gap={4} ta="center">
        <Text size="sm" fw={700}>{title}</Text>
        <Text size="sm" c="dimmed">{detail}</Text>
      </Stack>
    </Paper>
  );
}

export function InfoRow({ label, value }) {
  return (
    <Paper withBorder p="sm">
      <Text size="xs" fw={700} tt="uppercase" c="dimmed">{label}</Text>
      <Text size="sm" fw={700} ff="monospace" style={{ overflowWrap: "anywhere" }}>{value}</Text>
    </Paper>
  );
}

export function SectionHead({ icon: Icon, title, detail }) {
  return (
    <Stack gap={2}>
      <Group gap="xs" wrap="nowrap">
        {Icon && <ThemeIcon variant="light" size="md" radius="md"><Icon size={16} /></ThemeIcon>}
        <Title order={2} size="md">{title}</Title>
      </Group>
      {detail && <Text size="sm" c="dimmed">{detail}</Text>}
    </Stack>
  );
}

export function StatusBadge({ status, children = status, ...props }) {
  return <Badge color={statusColor(status)} variant="light" {...props}>{children}</Badge>;
}

export function statusColor(status) {
  if (["pass", "done", "accepted", "running", "ready", "queued", "merging", "streaming", "verdict ready", "succeeded", "active", "merged"].includes(status)) return "green";
  if (["watch", "pending", "idle", "in_progress", "in_review", "ready_to_merge", "cooldown", "reworking", "paused"].includes(status)) return "yellow";
  if (["blocked", "blocked_on_child", "failed", "halted", "error", "failed_operational", "failure"].includes(status)) return "red";
  return "gray";
}

export function formatUsd(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return "";
  return amount < 0.01 ? "<$0.01" : `$${amount.toFixed(2)}`;
}

export function formatTokens(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return "";
  return amount >= 1_000_000 ? `${(amount / 1_000_000).toFixed(1)}M` : amount >= 1_000 ? `${(amount / 1_000).toFixed(1)}k` : String(amount);
}
