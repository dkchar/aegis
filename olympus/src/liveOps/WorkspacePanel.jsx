import { ArrowRightCircle, Boxes, FolderOpen, FolderSearch, LayoutDashboard } from "lucide-react";
import { useEffect, useState } from "react";
import { browseOlympusWorkspace, openOlympusWorkspaceFolder, switchOlympusWorkspace } from "../api.js";
import { hydrateOlympusState } from "../state.js";
import { StatusBadge } from "../components/aegis.jsx";
import { Button, Card, Field, Input } from "../components/ui/index.js";

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
    <Card className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] xl:items-end">
      <div className="grid min-w-0 gap-2">
        <Field label="Workspace">
          <Input value={workspaceRoot} onChange={(event) => setWorkspaceRoot(event.target.value)} placeholder="Absolute path to an initialized Aegis project" className="font-mono text-xs" />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" size="sm" onClick={() => selectWorkspace(workspaceRoot)}><Boxes />Select Workspace</Button>
          <Button size="sm" onClick={browseWorkspace} loading={browsing}>{!browsing && <FolderSearch />}Browse Folder</Button>
          <Button size="sm" onClick={openWorkspaceFolder}><FolderOpen />Open Folder</Button>
          <Button variant="ghost" size="sm" onClick={() => selectWorkspace("")}><LayoutDashboard />Use Current Project</Button>
        </div>
      </div>
      <div className="flex min-w-0 items-start gap-3 rounded-md border border-border bg-surface-sunken px-3 py-2.5">
        <ArrowRightCircle className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
        <div className="grid min-w-0 gap-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-medium">{nextAction.title}</span>
            <StatusBadge status={nextAction.status} />
          </div>
          <span className="text-xs leading-snug text-muted-foreground">{nextAction.detail}</span>
        </div>
      </div>
    </Card>
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
