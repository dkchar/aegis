import { motion } from "motion/react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDollarSign,
  Clock,
  GitMerge,
  ListChecks,
  Monitor,
  Moon,
  OctagonAlert,
  Play,
  RefreshCw,
  ShieldHalf,
  Square,
  Sun,
  TerminalSquare,
} from "lucide-react";
import { useState } from "react";
import { loadOlympusState, runOlympusControl } from "./api.js";
import { hydrateOlympusState, markApiError } from "./state.js";
import { LiveDot, Stat, StatBar, formatUsd } from "./components/aegis.jsx";
import { Alert, Badge, Button, Separator, Tooltip } from "./components/ui/index.js";
import { themePreferences } from "./theme.js";

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
    <Alert tone="success" title="Run complete">
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

function workspaceName(root) {
  if (!root) return "current project";
  return root.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || root;
}

/** Sticky top bar: brand and workspace, view navigation, daemon status, and controls. */
export function Header({ state, mutate, nav, theme }) {
  const configIssues = state.configIssues ?? [];
  const [pendingAction, setPendingAction] = useState("");
  const running = state.daemon.status === "running";
  const startBlocked = configIssues.length > 0 || state.configDirty;

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
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1880px] flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5">
        <Brand root={state.workspace?.root} branch={state.daemon.branch} />
        <div className="order-last w-full min-w-0 lg:order-none lg:w-auto">{nav}</div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <DaemonStatus state={state} />
          {configIssues.length > 0 && <Badge tone="danger">{configIssues.length} config gaps</Badge>}
          {state.configDirty && <Badge tone="warning">Unsaved config</Badge>}
          <Separator orientation="vertical" className="mx-1 hidden h-5 sm:block" />
          <Tooltip content={startBlocked ? "Complete and save Config first" : running ? "Daemon is running" : "Start the Aegis daemon"}>
            <span>
              <Button
                variant="primary"
                size="sm"
                onClick={() => control("start")}
                disabled={Boolean(pendingAction) || startBlocked || running}
                loading={pendingAction === "start"}
              >
                {pendingAction !== "start" && <Play />}
                Start
              </Button>
            </span>
          </Tooltip>
          <Button
            variant="danger-soft"
            size="sm"
            onClick={() => control("stop")}
            disabled={Boolean(pendingAction) || !running}
            loading={pendingAction === "stop"}
          >
            {pendingAction !== "stop" && <Square />}
            Stop
          </Button>
          <Tooltip content="Refresh state">
            <Button variant="ghost" size="icon-sm" aria-label="Refresh state" onClick={refreshState}>
              <RefreshCw />
            </Button>
          </Tooltip>
          <ThemeToggle {...theme} />
        </div>
      </div>
    </header>
  );
}

function Brand({ root, branch }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-primary to-violet text-primary-foreground shadow-sm">
        <ShieldHalf className="size-[18px]" aria-hidden="true" />
      </div>
      <div className="grid min-w-0 leading-tight">
        <h1 className="text-[15px] font-semibold tracking-tight">Olympus</h1>
        <Tooltip content={root || "Current project"}>
          <span className="truncate font-mono text-[11px] text-muted-foreground">
            {workspaceName(root)} <span className="text-subtle-foreground">·</span> {branch}
          </span>
        </Tooltip>
      </div>
    </div>
  );
}

/** Daemon lifecycle, uptime, pid, adapter, and event-stream health in one cluster. */
function DaemonStatus({ state }) {
  const status = state.daemon.status;
  const tone = status === "running" ? "success" : status === "paused" ? "warning" : "danger";
  const uptime = formatUptime(state.daemon.startedAt, status);
  const eventsLive = state.apiStatus === "connected";
  const activity = state.daemon.phase && state.daemon.phase !== "idle" ? `Latest loop event: ${state.daemon.activity}` : "No loop events yet";

  return (
    <div className="flex items-center gap-2">
      <Tooltip content={activity}>
        <span className="inline-flex h-7 items-center gap-2 rounded-full border border-border bg-surface px-2.5 text-xs">
          <LiveDot tone={tone} live={status === "running"} />
          <span className="font-medium capitalize text-foreground">Daemon {status}</span>
          {uptime && <span className="font-mono text-muted-foreground">{uptime}</span>}
          {status === "running" && <span className="hidden font-mono text-subtle-foreground xl:inline">pid {state.daemon.pid}</span>}
        </span>
      </Tooltip>
      <Badge tone="accent" size="md" className="font-mono">{state.daemon.adapter}</Badge>
      <Tooltip content={state.apiMessage}>
        <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border px-2.5 text-xs text-muted-foreground">
          <LiveDot tone={eventsLive ? "success" : "warning"} />
          Events {eventsLive ? "live" : state.apiStatus}
        </span>
      </Tooltip>
    </div>
  );
}

const themeIcons = { system: Monitor, light: Sun, dark: Moon };

function ThemeToggle({ preference, setPreference }) {
  if (!setPreference) return null;
  const Icon = themeIcons[preference] ?? Monitor;
  const next = themePreferences[(themePreferences.indexOf(preference) + 1) % themePreferences.length];
  return (
    <Tooltip content={`Theme: ${preference} (switch to ${next})`}>
      <Button variant="ghost" size="icon-sm" aria-label={`Theme: ${preference}`} onClick={() => setPreference(next)}>
        <Icon />
      </Button>
    </Tooltip>
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
    <StatBar>
      <Stat label="Progress" value={`${done}/${total}`} hint={`${percent}% of executable tickets done`} progress={percent} icon={CheckCircle2} tone={percent === 100 ? "success" : "neutral"} />
      <Stat label="Ready" value={flow.executable} hint="executable tickets" icon={ListChecks} tone={flow.executable ? "accent" : "neutral"} />
      <Stat label="Sessions" value={activeSessions} hint={`${state.agents.length} recorded`} icon={TerminalSquare} tone={activeSessions ? "success" : "neutral"} />
      <Stat label="Blocked" value={flow.blocked} hint="waiting on dependencies" icon={Clock} tone={flow.blocked ? "warning" : "neutral"} />
      <Stat label="Merge queue" value={flow.queueDepth} hint={`${flow.merged} merged`} icon={GitMerge} tone={flow.queueDepth ? "accent" : "neutral"} />
      <Stat label="Failures" value={flow.failures} hint="halted or exhausted" icon={OctagonAlert} tone={flow.failures ? "danger" : "neutral"} />
      {cost && <Stat label="Spend" value={cost} hint="reported by adapters" icon={CircleDollarSign} />}
    </StatBar>
  );
}

export function Screen({ className = "", children }) {
  return (
    <motion.main
      className={`grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 ${className}`}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.14 }}
    >
      {children}
    </motion.main>
  );
}

export function HealthIcon({ status }) {
  if (status === "pass") return <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden="true" />;
  if (status === "pending" || status === "idle") return <Clock className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />;
  return <AlertTriangle className="size-4 shrink-0 text-warning" aria-hidden="true" />;
}
