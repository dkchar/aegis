import { Box, Notification, Paper, Stack, Tabs } from "@mantine/core";
import { AnimatePresence } from "motion/react";
import { Clock, FileJson, LayoutDashboard, Settings2, TerminalSquare } from "lucide-react";
import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { createOlympusTicket, loadOlympusState } from "./api.js";
import SetupDialog from "./SetupDialog.jsx";
import {
  Header,
  SuccessBanner,
  resolveCurrentTab,
  resolveInitialTab,
  resolveInitialViewState,
  resolveSessionIdFromHash,
  tabIds,
} from "./Shell.jsx";
import {
  columns,
  createOlympusState,
  emptyTicketDraft,
  hydrateOlympusState,
  markApiError,
  validateTicketDraft,
} from "./state.js";
import { deriveBoardCounts, deriveDisplayTickets, deriveFlowSummary } from "./supervisionModel.js";

const AgentSessions = lazy(() => import("./AgentSessions.jsx"));
const Chronos = lazy(() => import("./Chronos.jsx"));
const Config = lazy(() => import("./ConfigView.jsx"));
const LiveOps = lazy(() => import("./LiveOps.jsx"));
const Records = lazy(() => import("./Records.jsx"));

const tabIcons = {
  live: LayoutDashboard,
  agents: TerminalSquare,
  chronos: Clock,
  records: FileJson,
  config: Settings2,
};

export default function App() {
  const [state, setState] = useState(() => ({ ...createOlympusState(), ...resolveInitialViewState() }));
  const [draft, setDraft] = useState(emptyTicketDraft);
  const [showDialog, setShowDialog] = useState(false);
  const boardTickets = useMemo(() => deriveDisplayTickets(state.tickets, state.dispatchRecords), [state.tickets, state.dispatchRecords]);
  const counts = useMemo(() => deriveBoardCounts(columns, boardTickets), [boardTickets]);
  const flow = useMemo(() => deriveFlowSummary(boardTickets, state.mergeQueue), [boardTickets, state.mergeQueue]);
  const activeTab = resolveCurrentTab(state.activeTab);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [activeTab]);

  useEffect(() => {
    const syncTabFromHash = () => {
      const tabId = resolveInitialTab();
      if (tabIds.has(tabId)) {
        setState((current) => ({
          ...current,
          activeTab: tabId,
          ...(resolveSessionIdFromHash() ? { selectedAgentId: resolveSessionIdFromHash() } : {}),
        }));
      }
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

    const stream = new EventSource("/api/olympus/events");
    stream.addEventListener("state", (event) => {
      if (!closed) setState((current) => hydrateOlympusState(current, JSON.parse(event.data)));
    });
    stream.addEventListener("error", () => {
      if (!closed) setState((current) => markApiError(current, "Live event stream disconnected"));
    });
    return () => {
      closed = true;
      stream.close();
    };
  }, []);

  function mutate(nextState) {
    setState(nextState);
    if (nextState.toast) window.clearTimeout(window.olympusToastTimer);
    window.olympusToastTimer = window.setTimeout(() => setState((current) => ({ ...current, toast: "" })), 1800);
  }

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
    <Box mih="100dvh" bg="dark.9" px={{ base: "xs", sm: "md" }} py="sm" style={{ overflowX: "hidden" }}>
      <Stack mx="auto" maw={1880} gap="sm">
        <Header state={state} flow={flow} mutate={mutate} />
        <Paper withBorder radius="sm" px="xs">
          <Tabs value={activeTab} onChange={(id) => changeTab(id, state, mutate)}>
            <Tabs.List aria-label="Olympus views">
              {Array.from(tabIds).map((id) => {
                const Icon = tabIcons[id];
                return <Tabs.Tab key={id} value={id} leftSection={<Icon size={15} />}>{tabLabel(id)}</Tabs.Tab>;
              })}
            </Tabs.List>
          </Tabs>
        </Paper>
        {state.runSummary?.complete && activeTab !== "chronos" && <SuccessBanner summary={state.runSummary} />}
        <Suspense fallback={null}>
          <AnimatePresence mode="wait" initial={false}>
            {renderView(activeTab, { state, boardTickets, counts, flow, draft, setDraft, addDraft, showDialog, setShowDialog, mutate })}
          </AnimatePresence>
        </Suspense>
      </Stack>
      <SetupDialog state={state} mutate={mutate} />
      {state.toast && (
        <Notification
          color={state.toastKind === "error" ? "red" : "green"}
          pos="fixed"
          bottom="var(--mantine-spacing-md)"
          right="var(--mantine-spacing-md)"
          maw="calc(100vw - 2rem)"
          withCloseButton={false}
          role={state.toastKind === "error" ? "alert" : "status"}
          style={{ zIndex: 500 }}
        >
          {state.toast}
        </Notification>
      )}
    </Box>
  );
}

function changeTab(id, state, mutate) {
  const label = tabLabel(id);
  window.location.hash = id;
  mutate({ ...state, activeTab: id, toast: `${label} opened`, toastKind: "success" });
}

function tabLabel(id) {
  return {
    live: "Ops",
    agents: "Sessions",
    chronos: "Chronos",
    records: "Records",
    config: "Config",
  }[id] ?? "View";
}

function renderView(activeTab, props) {
  if (activeTab === "live") return <LiveOps key="live" {...props} />;
  if (activeTab === "agents") return <AgentSessions key="agents" state={props.state} mutate={props.mutate} />;
  if (activeTab === "chronos") return <Chronos key="chronos" state={props.state} />;
  if (activeTab === "records") return <Records key="records" state={props.state} mutate={props.mutate} />;
  return <Config key="config" state={props.state} mutate={props.mutate} />;
}
