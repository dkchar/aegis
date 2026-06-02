import { Button, Group, Paper, SimpleGrid, Stack, Text, TextInput } from "@mantine/core";
import { Boxes, FolderOpen, LayoutDashboard } from "lucide-react";
import { useEffect, useState } from "react";
import { browseOlympusWorkspace, openOlympusWorkspaceFolder, switchOlympusWorkspace } from "../api.js";
import { hydrateOlympusState } from "../state.js";
import { StatusBadge } from "../ui.jsx";

export default function WorkspacePanel({ state, mutate }) {
  const [workspaceRoot, setWorkspaceRoot] = useState(state.workspace.root || "");
  const [browsing, setBrowsing] = useState(false);
  const nextAction = resolveNextAction(state);

  useEffect(() => {
    setWorkspaceRoot(state.workspace.root || "");
  }, [state.workspace.root]);

  function selectWorkspace(root) {
    switchOlympusWorkspace(root)
      .then((payload) => mutate({
        ...hydrateOlympusState(state, payload.state ?? payload),
        toast: payload.message ?? "Workspace selected",
        toastKind: "success",
      }))
      .catch((error) => mutate({ ...state, toast: error.message, toastKind: "error" }));
  }

  function browseWorkspace() {
    setBrowsing(true);
    browseOlympusWorkspace()
      .then((payload) => {
        mutate({
          ...hydrateOlympusState(state, payload.state ?? payload),
          toast: payload.message ?? "Workspace selected",
          toastKind: payload.ok === false ? "error" : "success",
        });
      })
      .catch((error) => mutate({ ...state, toast: error.message, toastKind: "error" }))
      .finally(() => setBrowsing(false));
  }

  function openWorkspaceFolder() {
    openOlympusWorkspaceFolder()
      .then((payload) => mutate({
        ...hydrateOlympusState(state, payload.state ?? payload),
        toast: payload.message ?? "Workspace folder opened",
        toastKind: payload.ok === false ? "error" : "success",
      }))
      .catch((error) => mutate({ ...state, toast: error.message, toastKind: "error" }));
  }

  return (
    <Paper component="section" withBorder radius="sm" p="sm">
      <SimpleGrid cols={{ base: 1, xl: 2 }} spacing="sm" verticalSpacing="sm">
        <Stack gap="xs">
          <TextInput label="Workspace" value={workspaceRoot} onChange={(event) => setWorkspaceRoot(event.target.value)} placeholder="Absolute path to an initialized Aegis project" />
          <Group gap="xs" wrap="wrap">
            <Button variant="default" leftSection={<Boxes size={16} />} onClick={browseWorkspace} loading={browsing}>Browse Folder</Button>
            <Button variant="default" leftSection={<FolderOpen size={16} />} onClick={openWorkspaceFolder}>Open Folder</Button>
            <Button color="cyan" leftSection={<Boxes size={16} />} onClick={() => selectWorkspace(workspaceRoot)}>Select Workspace</Button>
            <Button variant="subtle" leftSection={<LayoutDashboard size={16} />} onClick={() => selectWorkspace("")}>Use Current Project</Button>
          </Group>
        </Stack>
        <Stack gap="xs" justify="flex-end">
          <Group gap="xs" wrap="wrap">
            <StatusBadge status={nextAction.status}>{nextAction.status}</StatusBadge>
            <Text size="sm" fw={700}>{nextAction.title}</Text>
            <Text size="xs" c="dimmed">{nextAction.detail}</Text>
          </Group>
          <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs">
            <SupervisionFact label="Workspace" value={state.workspace.root || "current project"} />
            <SupervisionFact label="Adapter" value={state.daemon.adapter} />
            <SupervisionFact label="Events" value={state.apiStatus === "connected" ? "connected" : state.daemon.stream} />
            <SupervisionFact label="Branch" value={state.daemon.branch} />
          </SimpleGrid>
        </Stack>
      </SimpleGrid>
    </Paper>
  );
}

function SupervisionFact({ label, value }) {
  return (
    <Stack gap={0} style={{ minWidth: 0 }}>
      <Text size="xs" fw={700} tt="uppercase" c="dimmed">{label}</Text>
      <Text size="xs" fw={700} ff="monospace" truncate>{value}</Text>
    </Stack>
  );
}

function resolveNextAction(state) {
  if ((state.configIssues ?? []).length > 0) {
    return {
      status: "blocked",
      title: "Finish runtime configuration",
      detail: "Start stays disabled until every required model and runtime setting is present.",
    };
  }
  if (state.configDirty) {
    return {
      status: "watch",
      title: "Save config changes",
      detail: "Persist the edited config before starting or supervising a run.",
    };
  }
  if ((state.runSummary?.running ?? false) || state.daemon.status === "running") {
    return {
      status: "running",
      title: "Watch live sessions",
      detail: "Use Sessions for terminals and Records for artifacts, merge state, and attention items.",
    };
  }
  if ((state.tickets ?? []).some((ticket) => ticket.column === "halted") || (state.runSummary?.halted ?? 0) > 0) {
    return {
      status: "failed",
      title: "Resolve halted work",
      detail: "Open Records, inspect the attention queue, then route fixes through terminal commands.",
    };
  }
  if ((state.tickets ?? []).length === 0) {
    return {
      status: "idle",
      title: "Load Agora work",
      detail: "Initialize the project and create tracker work from the terminal before starting Aegis.",
    };
  }
  return {
    status: "ready",
    title: "Start Aegis",
    detail: "Tracker work is loaded and the selected workspace is ready for daemon supervision.",
  };
}
