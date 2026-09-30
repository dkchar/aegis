import { Badge, Box, Group, Notification, Paper, Stack, Tabs, Text } from "@mantine/core";
import { AnimatePresence } from "motion/react";
import { Clock, FileJson, LayoutDashboard, Settings2, TerminalSquare } from "lucide-react";
import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import { createOlympusTicket, loadOlympusState } from "./api.js";
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
  columns,
  createOlympusState,
  emptyTicketDraft,
  hydrateOlympusState,
  markApiError,
  markApiConnected,
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

const tabIdList = tabs.map(([id]) => id);

export default function App() {
  const [state, setState] = useState(() => ({ ...createOlympusState(), ...resolveInitialViewState() }));
  const mutate = useToastingSetter(setState);
  const [draft, setDraft] = useState(emptyTicketDraft);
  const [showDialog, setShowDialog] = useState(false);
  const boardTickets = useMemo(() => deriveDisplayTickets(state.tickets, state.dispatchRecords), [state.tickets, state.dispatchRecords]);
  const counts = useMemo(() => deriveBoardCounts(columns, boardTickets), [boardTickets]);
  const flow = useMemo(() => deriveFlowSummary(boardTickets, state.mergeQueue), [boardTickets, state.mergeQueue]);
  const activeTab = resolveCurrentTab(state.activeTab);
  const tabBadges = useMemo(() => ({
    agents: state.agents.filter((agent) => ["running", "streaming"].includes(agent.status)).length,
    records: flow.failures + state.mergeQueue.filter((item) => item.state === "failed").length,
    config: state.configIssues.length,
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

    // EventSource reconnects on its own; the badge mirrors its state.
    const stream = new EventSource("/api/olympus/events");
    stream.addEventListener("open", () => {
      if (!closed) setState((current) => markApiConnected(current));
    });
    stream.addEventListener("state", (event) => {
      if (!closed) setState((current) => hydrateOlympusState(current, JSON.parse(event.data)));
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
    <Box mih="100dvh" px={{ base: "xs", sm: "md" }} py="sm" style={{ overflowX: "hidden" }}>
      <Stack mx="auto" maw={1880} gap="sm">
        <Header state={state} mutate={mutate} />
        <KpiStrip state={state} flow={flow} />
        <Paper withBorder px="xs" className="olympus-nav">
          <Tabs value={activeTab} onChange={changeTab}>
            <Tabs.List aria-label="Olympus views">
              {tabs.map(([id, label], index) => {
                const Icon = tabIcons[id];
                const badge = tabBadges[id];
                return (
                  <Tabs.Tab
                    key={id}
                    value={id}
                    leftSection={<Icon size={15} />}
                    rightSection={
                      <Group gap={6} wrap="nowrap">
                        {badge > 0 && <Badge size="xs" variant="filled" color={id === "agents" ? "green" : "red"} circle>{badge}</Badge>}
                        <Text component="kbd" className="olympus-kbd" visibleFrom="md">{index + 1}</Text>
                      </Group>
                    }
                  >
                    {label}
                  </Tabs.Tab>
                );
              })}
            </Tabs.List>
          </Tabs>
        </Paper>
        {state.runSummary?.complete && activeTab !== "chronos" && <SuccessBanner summary={state.runSummary} />}
        <Suspense fallback={<Text size="sm" c="dimmed" p="md">Loading view…</Text>}>
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
          withCloseButton
          onClose={() => setState((current) => ({ ...current, toast: "" }))}
          role={state.toastKind === "error" ? "alert" : "status"}
          style={{ zIndex: 500 }}
        >
          {state.toast}
        </Notification>
      )}
    </Box>
  );
}

function renderView(activeTab, props) {
  if (activeTab === "live") return <LiveOps key="live" {...props} />;
  if (activeTab === "agents") return <AgentSessions key="agents" state={props.state} mutate={props.mutate} />;
  if (activeTab === "chronos") return <Chronos key="chronos" state={props.state} />;
  if (activeTab === "records") return <Records key="records" state={props.state} mutate={props.mutate} />;
  return <Config key="config" state={props.state} mutate={props.mutate} />;
}
