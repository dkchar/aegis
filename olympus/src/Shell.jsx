import { ActionIcon, Alert, Badge, Button, Group, Paper, SimpleGrid, Stack, Text, ThemeIcon, Title, Tooltip } from "@mantine/core";
import { motion } from "motion/react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDollarSign,
  Clock,
  GitMerge,
  ListChecks,
  OctagonAlert,
  Play,
  RefreshCw,
  ShieldHalf,
  Square,
  TerminalSquare,
  Timer,
} from "lucide-react";
import { useState } from "react";
import { loadOlympusState, runOlympusControl } from "./api.js";
import { hydrateOlympusState, markApiError } from "./state.js";
import { formatUsd, LiveDot, StatCard } from "./ui.jsx";

export const tabs = [
  ["live", "Ops"],
  ["agents", "Sessions"],
  ["chronos", "Chronos"],
  ["records", "Records"],
  ["config", "Config"],
];

export const tabIds = new Set(tabs.map(([id]) => id));

function readHashParts() {
  if (typeof window === "undefined") return [];
  return window.location.hash.replace(/^#/, "").split("/");
}

export function resolveInitialTab() {
  const [tabId] = readHashParts();
  return tabIds.has(tabId) ? tabId : "live";
}

export function resolveCurrentTab(fallback) {
  if (typeof window === "undefined") return fallback;
  const [tabId] = readHashParts();
  return tabIds.has(tabId) ? tabId : fallback;
}

export function resolveSessionIdFromHash() {
  const [, sessionId = ""] = readHashParts();
  return decodeURIComponent(sessionId);
}

export function resolveInitialViewState() {
  if (typeof window === "undefined") return { activeTab: "live", selectedAgentId: "" };
  let storedSessionId = "";
  try {
    storedSessionId = window.localStorage.getItem("olympus.selectedSessionId") || "";
  } catch {
    storedSessionId = "";
  }
  return { activeTab: resolveInitialTab(), selectedAgentId: resolveSessionIdFromHash() || storedSessionId };
}

export function SuccessBanner({ summary }) {
  return (
    <Alert color="green" variant="light" title="Run complete" icon={<CheckCircle2 size={20} />}>
      All {summary.total} tracker records reached Done. Artifacts, transcripts, logs, and merge records remain available in Records.
    </Alert>
  );
}

function formatUptime(startedAt, status) {
  if (status !== "running" || !startedAt) return "";
  const elapsedMs = Date.now() - Date.parse(startedAt);
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return "";
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function Header({ state, mutate }) {
  const configIssues = state.configIssues ?? [];
  const [pendingAction, setPendingAction] = useState("");
  const running = state.daemon.status === "running";
  const startBlocked = configIssues.length > 0 || state.configDirty;
  const uptime = formatUptime(state.daemon.startedAt, state.daemon.status);
  const workspaceLabel = state.workspace?.root || "current project";

  function refreshState() {
    loadOlympusState()
      .then((payload) => mutate({ ...hydrateOlympusState(state, payload), toast: "State refreshed", toastKind: "success" }))
      .catch((error) => mutate(markApiError({ ...state, toast: error.message, toastKind: "error" }, error.message)));
  }

  function control(action) {
    setPendingAction(action);
    runOlympusControl(action, state.config)
      .then((payload) =>
        mutate({
          ...hydrateOlympusState(state, payload.state ?? payload),
          toast: payload.message ?? `${action} complete`,
          toastKind: "success",
        }),
      )
      .catch((error) => mutate({ ...state, toast: error.message, toastKind: "error" }))
      .finally(() => setPendingAction(""));
  }

  return (
    <Paper component="header" withBorder p="md" className="olympus-header">
      <Group justify="space-between" align="center" wrap="wrap" gap="md">
        <Group gap="md" wrap="nowrap" style={{ minWidth: 0 }}>
          <ThemeIcon size={44} radius="md" variant="gradient" gradient={{ from: "aegis.6", to: "indigo.6", deg: 135 }}>
            <ShieldHalf size={26} />
          </ThemeIcon>
          <Stack gap={2} style={{ minWidth: 0 }}>
            <Group gap="xs" wrap="nowrap">
              <Title order={1} size="h3">Olympus</Title>
              <Text size="sm" c="dimmed" visibleFrom="sm">Aegis swarm operations console</Text>
            </Group>
            <Text size="xs" ff="monospace" c="dimmed" truncate title={workspaceLabel}>
              {workspaceLabel} · {state.daemon.branch}
            </Text>
          </Stack>
        </Group>
        <Group gap="xs" justify="flex-end" wrap="wrap">
          <Button
            leftSection={<Play size={15} />}
            onClick={() => control("start")}
            disabled={Boolean(pendingAction) || startBlocked || running}
            loading={pendingAction === "start"}
          >
            Start
          </Button>
          <Button
            color="red"
            variant="light"
            leftSection={<Square size={14} />}
            onClick={() => control("stop")}
            disabled={Boolean(pendingAction) || !running}
            loading={pendingAction === "stop"}
          >
            Stop
          </Button>
          <Tooltip label="Refresh state">
            <ActionIcon color="gray" variant="default" size="lg" aria-label="Refresh state" onClick={refreshState}>
              <RefreshCw size={18} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>
      <Group gap="xs" mt="sm" wrap="wrap">
        <StatusPill status={state.daemon.status} />
        <Badge color="gray" variant="light">PID {state.daemon.pid}</Badge>
        {uptime && <Badge color="gray" variant="light" leftSection={<Timer size={12} />}>up {uptime}</Badge>}
        <Badge color="aegis" variant="light">adapter {state.daemon.adapter}</Badge>
        <Badge color={state.apiStatus === "connected" ? "green" : "yellow"} variant="light">
          Events {state.apiStatus}
        </Badge>
        {state.daemon.phase && state.daemon.phase !== "idle" && (
          <Badge color="gray" variant="outline">{state.daemon.activity}</Badge>
        )}
        {configIssues.length > 0 && <Badge color="red" variant="light">{configIssues.length} config gaps</Badge>}
        {state.configDirty && <Badge color="yellow" variant="light">Unsaved config</Badge>}
      </Group>
    </Paper>
  );
}

/** Run-level KPIs derived from tracker, dispatch, session, and merge state. */
export function KpiStrip({ state, flow }) {
  const summary = state.runSummary ?? {};
  const total = summary.total ?? state.tickets.length;
  const done = summary.done ?? flow.complete;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  const activeSessions = state.agents.filter((agent) => ["running", "streaming"].includes(agent.status)).length;
  const cost = formatUsd(summary.costUsd);

  return (
    <SimpleGrid cols={{ base: 2, sm: 3, lg: cost ? 7 : 6 }} spacing="sm">
      <StatCard label="Progress" value={`${done}/${total}`} hint={`${percent}% done`} progress={percent} icon={CheckCircle2} />
      <StatCard label="Ready" value={flow.executable} hint="executable tickets" icon={ListChecks} tone={flow.executable ? "aegis" : "gray"} />
      <StatCard label="Sessions" value={activeSessions} hint={`${state.agents.length} recorded`} icon={TerminalSquare} tone={activeSessions ? "green" : "gray"} />
      <StatCard label="Blocked" value={flow.blocked} hint="waiting on children" icon={Clock} tone={flow.blocked ? "yellow" : "gray"} />
      <StatCard label="Merge Queue" value={flow.queueDepth} hint={`${flow.merged} merged`} icon={GitMerge} tone={flow.queueDepth ? "aegis" : "gray"} />
      <StatCard label="Failures" value={flow.failures} hint="halted or exhausted" icon={OctagonAlert} tone={flow.failures ? "red" : "gray"} />
      {cost && <StatCard label="Spend" value={cost} hint="reported by adapters" icon={CircleDollarSign} />}
    </SimpleGrid>
  );
}

export function Screen({ className = "", children }) {
  return (
    <motion.main
      className={`grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 ${className}`}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.16 }}
    >
      {children}
    </motion.main>
  );
}

export function StatusPill({ status }) {
  const color = status === "running" ? "green" : status === "paused" ? "yellow" : "red";
  return (
    <Badge color={color} variant="light" leftSection={<LiveDot color={`var(--mantine-color-${color}-5)`} live={status === "running"} />}>
      Daemon {status}
    </Badge>
  );
}

export function MetricPill({ label, value, tone }) {
  const color = tone === "red" ? "red" : tone === "green" ? "green" : "yellow";
  return (
    <Badge color={color} variant="light">
      {label}: <Text component="span" inherit ff="monospace">{value}</Text>
    </Badge>
  );
}

export function HealthIcon({ status }) {
  if (status === "pass") return <CheckCircle2 color="var(--mantine-color-green-5)" size={20} />;
  if (status === "pending" || status === "idle") return <Clock color="var(--mantine-color-aegis-5)" size={20} />;
  return <AlertTriangle color="var(--mantine-color-red-5)" size={20} />;
}
