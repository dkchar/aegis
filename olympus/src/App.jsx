import { AnimatePresence } from "motion/react";
import { FileJson, LayoutDashboard, Orbit, Settings2, TerminalSquare } from "lucide-react";
import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import { createOlympusTicket, loadOlympusState } from "./api.js";
import { CountBadge, Kbd, Skeleton, Toast, Tooltip, cn } from "./components/ui/index.js";
import { useNumberKeyNavigation, useToastingSetter } from "./hooks.js";
import SetupDialog from "./SetupDialog.jsx";
import {
  Header,
  KpiStrip,
  SuccessBanner,
  resolveCurrentTab,
  resolveInitialTab,
  resolveInitialViewState,
  resolveSessionIdFromHash,
  tabIds,
  tabs,
} from "./Shell.jsx";
import {
  appendLiveEvents,
  columns,
  createOlympusState,
  emptyTicketDraft,
  hydrateOlympusState,
  markApiError,
  markApiConnected,
  validateTicketDraft,
} from "./state.js";
import { deriveBoardCounts, deriveDisplayTickets, deriveFlowSummary } from "./supervisionModel.js";
import { useTheme } from "./theme.js";

const AgentSessions = lazy(() => import("./AgentSessions.jsx"));
const Aether = lazy(() => import("./Aether.jsx"));
const Config = lazy(() => import("./ConfigView.jsx"));
const LiveOps = lazy(() => import("./LiveOps.jsx"));
const Records = lazy(() => import("./Records.jsx"));

const tabIcons = {
  live: LayoutDashboard,
  agents: TerminalSquare,
  aether: Orbit,
  records: FileJson,
  config: Settings2,
};

const tabIdList = tabs.map(([id]) => id);

export default function App() {
  const [state, setState] = useState(() => ({ ...createOlympusState(), ...resolveInitialViewState() }));
  const mutate = useToastingSetter(setState);
  const theme = useTheme();
  const [draft, setDraft] = useState(emptyTicketDraft);
  const [showDialog, setShowDialog] = useState(false);
  const boardTickets = useMemo(() => deriveDisplayTickets(state.tickets, state.dispatchRecords), [state.tickets, state.dispatchRecords]);
  const counts = useMemo(() => deriveBoardCounts(columns, boardTickets), [boardTickets]);
  const flow = useMemo(() => deriveFlowSummary(boardTickets, state.mergeQueue), [boardTickets, state.mergeQueue]);
  const activeTab = resolveCurrentTab(state.activeTab);
  const tabBadges = useMemo(() => ({
    agents: [state.agents.filter((agent) => ["running", "streaming"].includes(agent.status)).length, "success"],
    records: [flow.failures + state.mergeQueue.filter((item) => item.state === "failed").length, "danger"],
    config: [state.configIssues.length, "danger"],
  }), [state.agents, state.mergeQueue, state.configIssues, flow.failures]);

  const changeTab = useCallback((id) => {
    if (!tabIds.has(id)) return;
    window.location.hash = id;
    setState((current) => ({ ...current, activeTab: id }));
  }, []);
  useNumberKeyNavigation(tabIdList, changeTab);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [activeTab]);

  useEffect(() => {
    const syncTabFromHash = () => {
      const tabId = resolveInitialTab();
      const sessionId = resolveSessionIdFromHash();
      setState((current) => ({
        ...current,
        activeTab: tabId,
        ...(sessionId ? { selectedAgentId: sessionId } : {}),
      }));
    };
    syncTabFromHash();
    window.addEventListener("hashchange", syncTabFromHash);
    return () => window.removeEventListener("hashchange", syncTabFromHash);
  }, []);

  useEffect(() => {
    let closed = false;
    loadOlympusState()
      .then((payload) => {
        if (!closed) setState((current) => hydrateOlympusState(current, payload));
      })
      .catch((error) => {
        if (!closed) setState((current) => markApiError(current, error.message));
      });

    // EventSource reconnects on its own; the header mirrors its state.
    const stream = new EventSource("/api/olympus/events");
    stream.addEventListener("open", () => {
      if (!closed) setState((current) => markApiConnected(current));
    });
    stream.addEventListener("state", (event) => {
      if (!closed) setState((current) => hydrateOlympusState(current, JSON.parse(event.data)));
    });
    stream.addEventListener("events", (event) => {
      if (!closed) setState((current) => appendLiveEvents(current, JSON.parse(event.data)));
    });
    stream.addEventListener("error", () => {
      if (!closed) setState((current) => markApiError(current, "Live event stream disconnected; retrying"));
    });
    return () => {
      closed = true;
      stream.close();
    };
  }, []);

  function addDraft(event) {
    event.preventDefault();
    const error = validateTicketDraft(draft);
    if (error) {
      mutate({ ...state, toast: error, toastKind: "error" });
      return;
    }
    createOlympusTicket(draft)
      .then((payload) => {
        mutate({
          ...hydrateOlympusState(state, payload.state ?? payload),
          toast: "Ticket created",
          toastKind: "success",
        });
        setDraft(emptyTicketDraft);
        setShowDialog(false);
      })
      .catch((error) => mutate({ ...state, toast: error.message, toastKind: "error" }));
  }

  return (
    <div className="min-h-dvh">
      <Header state={state} mutate={mutate} theme={theme} nav={<ViewNav activeTab={activeTab} badges={tabBadges} />} />
      <div className="mx-auto grid max-w-[1880px] grid-cols-[minmax(0,1fr)] gap-4 px-4 py-4">
        <KpiStrip state={state} flow={flow} />
        {state.runSummary?.complete && activeTab !== "aether" && <SuccessBanner summary={state.runSummary} />}
        <Suspense fallback={<ViewSkeleton />}>
          <AnimatePresence mode="wait" initial={false}>
            {renderView(activeTab, { state, boardTickets, counts, flow, draft, setDraft, addDraft, showDialog, setShowDialog, mutate, theme: theme.theme })}
          </AnimatePresence>
        </Suspense>
      </div>
      <SetupDialog state={state} mutate={mutate} />
      {/* Errors announce as role="alert", successes as role="status". */}
      <Toast message={state.toast} kind={state.toastKind} onClose={() => setState((current) => ({ ...current, toast: "" }))} />
    </div>
  );
}

/** Primary navigation; links change the hash, and number keys 1-5 jump directly (shown on hover). */
function ViewNav({ activeTab, badges }) {
  return (
    <nav aria-label="Olympus views" className="scroll-thin -mx-1 flex items-center gap-0.5 overflow-x-auto px-1">
      {tabs.map(([id, label], index) => {
        const Icon = tabIcons[id];
        const [count, tone] = badges[id] ?? [0, "neutral"];
        const active = id === activeTab;
        return (
          <Tooltip key={id} content={<span className="inline-flex items-center gap-1.5">{label} <Kbd>{index + 1}</Kbd></span>}>
            <a
              href={`#${id}`}
              aria-current={active ? "page" : undefined}
              aria-keyshortcuts={String(index + 1)}
              className={cn(
                "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground [&>svg]:size-4",
                active && "bg-surface-raised text-foreground shadow-[inset_0_0_0_1px_var(--border)]",
              )}
            >
              <Icon aria-hidden="true" />
              {label}
              <CountBadge value={count} tone={tone} />
            </a>
          </Tooltip>
        );
      })}
    </nav>
  );
}

function ViewSkeleton() {
  return (
    <div className="grid gap-4" aria-busy="true" aria-label="Loading view">
      <Skeleton className="h-24" />
      <Skeleton className="h-[48vh]" />
    </div>
  );
}

function renderView(activeTab, props) {
  if (activeTab === "live") return <LiveOps key="live" {...props} />;
  if (activeTab === "agents") return <AgentSessions key="agents" state={props.state} mutate={props.mutate} />;
  if (activeTab === "aether") return <Aether key="aether" state={props.state} theme={props.theme} />;
  if (activeTab === "records") return <Records key="records" state={props.state} mutate={props.mutate} />;
  return <Config key="config" state={props.state} mutate={props.mutate} />;
}
