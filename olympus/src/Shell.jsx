import { ActionIcon, Alert, Badge, Button, Group, Paper, Stack, Text, Title } from "@mantine/core";
import { motion } from "motion/react";
import { AlertTriangle, CheckCircle2, Clock, Play, RefreshCw, Square } from "lucide-react";
import { useState } from "react";
import { loadOlympusState, runOlympusControl } from "./api.js";
import { hydrateOlympusState, markApiError } from "./state.js";

export const tabs = [
  ["live", "Ops"],
  ["agents", "Sessions"],
  ["chronos", "Chronos"],
  ["records", "Records"],
  ["config", "Config"],
];

export const tabIds = new Set(tabs.map(([id]) => id));

export function resolveInitialTab() {
  if (typeof window === "undefined") return "live";
  const tabId = window.location.hash.replace(/^#/, "").split("/")[0];
  return tabIds.has(tabId) ? tabId : "live";
}

export function resolveCurrentTab(fallback) {
  if (typeof window === "undefined") return fallback;
  const tabId = window.location.hash.replace(/^#/, "").split("/")[0];
  return tabIds.has(tabId) ? tabId : fallback;
}

export function resolveSessionIdFromHash() {
  if (typeof window === "undefined") return "";
  const [, sessionId = ""] = window.location.hash.replace(/^#/, "").split("/");
  return decodeURIComponent(sessionId);
}

export function resolveInitialViewState() {
  if (typeof window === "undefined") return { activeTab: "live", selectedAgentId: "" };
  const sessionId = resolveSessionIdFromHash() || window.localStorage.getItem("olympus.selectedSessionId") || "";
  return { activeTab: resolveInitialTab(), selectedAgentId: sessionId };
}

export function SuccessBanner({ summary }) {
  return (
    <Alert color="green" variant="light" title="Run complete" icon={<CheckCircle2 size={20} />}>
      All {summary.total} tracker records reached Done. Artifacts, transcripts, logs, and merge records remain available in Records.
    </Alert>
  );
}

export function Header({ state, flow, mutate }) {
  const configIssues = state.configIssues ?? [];
  const agents = state.agents ?? [];
  const [pendingAction, setPendingAction] = useState("");
  const controlDisabled = Boolean(pendingAction);

  function refreshState() {
    loadOlympusState()
      .then((payload) =>
        mutate({ ...hydrateOlympusState(state, payload), activeTab: resolveInitialTab(), toast: "State refreshed", toastKind: "success" }),
      )
      .catch((error) => mutate(markApiError({ ...state, toast: error.message, toastKind: "error" }, error.message)));
  }

  function control(action) {
    setPendingAction(action);
    runOlympusControl(action, state.config)
      .then((payload) =>
        mutate({
          ...hydrateOlympusState(state, payload.state ?? payload),
          activeTab: resolveInitialTab(),
          toast: payload.message ?? `${action} complete`,
          toastKind: "success",
        }),
      )
      .catch((error) => mutate({ ...state, toast: error.message, toastKind: "error" }))
      .finally(() => setPendingAction(""));
  }

  return (
    <Paper component="header" withBorder radius="sm" p="md">
      <Group justify="space-between" align="center" wrap="wrap">
        <Stack gap={4}>
          <Group gap="xs" wrap="wrap">
            <Badge color="cyan" variant="light">Aegis Olympus</Badge>
            <StatusPill status={state.daemon.status} />
            <Badge color="cyan" variant="light">PID {state.daemon.pid}</Badge>
            <Badge color={state.apiStatus === "connected" ? "green" : "yellow"} variant="light">
              Events {state.apiStatus}
            </Badge>
            {configIssues.length > 0 && <Badge color="red" variant="light">{configIssues.length} config gaps</Badge>}
            {state.configDirty && <Badge color="yellow" variant="light">Unsaved config</Badge>}
          </Group>
          <Title order={1} size="h3">Swarm operations console</Title>
          <Text maw={1040} size="sm" c="dimmed">
            Control and observe Aegis across tracker work, session output, merge activity, artifacts, logs, and runtime settings.
          </Text>
        </Stack>
        <Group gap="xs" justify="flex-end" wrap="wrap">
          <MetricPill label="Ready" value={flow.executable} tone="amber" />
          <MetricPill label="Blocked" value={flow.blocked} tone={flow.blocked ? "amber" : "green"} />
          <MetricPill label="Sessions" value={agents.length} tone="green" />
          <MetricPill label="Failures" value={flow.failures} tone={flow.failures ? "red" : "green"} />
          <Button color="cyan" leftSection={<Play size={15} />} onClick={() => control("start")} disabled={controlDisabled || configIssues.length > 0 || state.configDirty}>
            {pendingAction === "start" ? "Starting" : "Start"}
          </Button>
          <Button color="red" variant="outline" leftSection={<Square size={14} />} onClick={() => control("stop")} disabled={controlDisabled}>
            {pendingAction === "stop" ? "Stopping" : "Stop"}
          </Button>
          <ActionIcon color="gray" variant="default" size="lg" title="Refresh state" aria-label="Refresh state" onClick={refreshState}>
            <RefreshCw size={18} />
          </ActionIcon>
        </Group>
      </Group>
    </Paper>
  );
}

export function Screen({ className = "", children }) {
  return (
    <motion.main
      className={`grid min-w-0 gap-3 ${className}`}
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
  return <Badge color={color} variant="light">Daemon {status}</Badge>;
}

export function MetricPill({ label, value, tone }) {
  const color = tone === "red" ? "red" : tone === "green" ? "green" : "yellow";
  return (
    <Badge color={color} variant="light" tt="none">
      {label}: <Text component="span" inherit ff="monospace">{value}</Text>
    </Badge>
  );
}

export function HealthIcon({ status }) {
  if (status === "pass") return <CheckCircle2 color="var(--mantine-color-green-5)" size={20} />;
  if (status === "pending" || status === "idle") return <Clock color="var(--mantine-color-cyan-5)" size={20} />;
  return <AlertTriangle color="var(--mantine-color-red-5)" size={20} />;
}
