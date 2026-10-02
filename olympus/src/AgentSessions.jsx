import { ExternalLink, TerminalSquare } from "lucide-react";
import { Suspense, lazy } from "react";
import { selectAgent, setSessionFilter } from "./state.js";
import { deriveSessionView } from "./supervisionModel.js";
import { CasteIcon, EmptyState, FactList, LiveDot, StatusBadge, formatTokens, formatUsd, resolveCaste, statusTone } from "./components/aegis.jsx";
import { Badge, Button, Card, Segmented, Skeleton, cn } from "./components/ui/index.js";
import { Screen } from "./Shell.jsx";

const TerminalPane = lazy(() => import("./TerminalPane.jsx"));
const sessionFilters = ["All", "Oracle", "Titan", "Sentinel", "Janus"];

function persistSelectedSession(agentId) {
  try {
    window.localStorage.setItem("olympus.selectedSessionId", agentId);
  } catch {
    // Storage can be unavailable (private mode); the hash still carries the selection.
  }
}

export default function AgentSessions({ state, mutate }) {
  const { sortedAgents, filteredAgents, activeFilters, groupedAgents } = deriveSessionView(state, sessionFilters);
  const routeSessionId = resolveSessionIdFromHash();
  const selected = routeSessionId
    ? sortedAgents.find((agent) => agent.id === state.selectedAgentId) || sortedAgents.find((agent) => agent.id === routeSessionId) || filteredAgents[0] || sortedAgents[0] || null
    : filteredAgents[0] || sortedAgents[0] || null;
  const openSession = (agentId) => {
    if (typeof window !== "undefined") {
      persistSelectedSession(agentId);
      window.location.hash = `agents/${encodeURIComponent(agentId)}`;
    }
    mutate(selectAgent(state, agentId));
  };
  const totalCost = formatUsd(state.agents.reduce((sum, agent) => sum + (Number(agent.usage?.costUsd) || 0), 0));
  const running = state.agents.filter((agent) => ["running", "streaming"].includes(agent.status)).length;

  return (
    <Screen>
      <Card className="grid min-h-[calc(100dvh-13rem)] overflow-hidden lg:grid-cols-[20rem_minmax(0,1fr)]">
        <aside className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] border-b border-border lg:border-b-0 lg:border-r" aria-label="Agent Sessions">
          <div className="grid gap-3 border-b border-border p-3">
            <div className="flex items-center gap-2">
              <TerminalSquare className="size-4 text-muted-foreground" aria-hidden="true" />
              <h2 className="text-sm font-semibold tracking-tight">Agent Sessions</h2>
              <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                {running > 0 && <LiveDot live />}
                {running} live · {state.agents.length} total{totalCost && ` · ${totalCost}`}
              </span>
            </div>
            <Segmented size="sm" value={state.sessionFilter} options={activeFilters} onValueChange={(filter) => mutate(setSessionFilter(state, filter))} aria-label="Filter sessions by caste" />
          </div>
          <SessionList groupedAgents={groupedAgents} selected={selected} openSession={openSession} empty={filteredAgents.length === 0} />
        </aside>
        <section className="grid min-h-0 min-w-0 grid-rows-[minmax(22rem,1fr)_auto]">
          {selected ? (
            <>
              <Suspense fallback={<Skeleton className="m-4" />}>
                <TerminalPane key={selected.id} session={selected} />
              </Suspense>
              <SessionInspector agent={selected} />
            </>
          ) : (
            <div className="p-4">
              <EmptyState icon={TerminalSquare} title="No sessions yet" detail="Sessions appear here after Aegis dispatches adapter work." />
            </div>
          )}
        </section>
      </Card>
    </Screen>
  );
}

function SessionList({ groupedAgents, selected, openSession, empty }) {
  if (empty) {
    return <p className="p-4 text-[13px] text-muted-foreground">No sessions match this filter.</p>;
  }
  return (
    <nav className="scroll-thin grid content-start gap-3 overflow-y-auto p-2 lg:max-h-[calc(100dvh-19rem)]">
      {groupedAgents.map(([caste, casteAgents]) => casteAgents.length > 0 && (
        <div key={caste} className="grid gap-0.5">
          <div className="flex items-center gap-1.5 px-2 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wide text-subtle-foreground">
            <CasteIcon caste={caste} />
            {caste}
            <span className="ml-auto font-mono normal-case">{casteAgents.length}</span>
          </div>
          {casteAgents.map((agent) => {
            const active = agent.id === selected?.id;
            const live = ["running", "streaming"].includes(agent.status);
            return (
              <button
                key={agent.id}
                type="button"
                onClick={() => openSession(agent.id)}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-raised",
                  active && "bg-surface-raised shadow-[inset_0_0_0_1px_var(--border-strong)]",
                )}
              >
                <LiveDot tone={statusTone(agent.status) === "accent" ? "accent" : statusTone(agent.status)} live={live} />
                <span className="grid min-w-0">
                  <span className="truncate text-[13px] font-medium">{agent.issue}</span>
                  <span className="truncate font-mono text-[11px] text-subtle-foreground">{agent.model || agent.id}</span>
                </span>
                <span className="font-mono text-[11px] text-muted-foreground">{formatUsd(agent.usage?.costUsd) || agent.status}</span>
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function formatUsage(usage) {
  if (!usage) return "not reported";
  const parts = [
    formatUsd(usage.costUsd),
    formatTokens(usage.inputTokens) && `${formatTokens(usage.inputTokens)} in`,
    formatTokens(usage.outputTokens) && `${formatTokens(usage.outputTokens)} out`,
    usage.turns ? `${usage.turns} turns` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "not reported";
}

function SessionInspector({ agent }) {
  const sessionHref = `#agents/${encodeURIComponent(agent.id)}`;
  const caste = resolveCaste(agent.caste);
  return (
    <div className="grid gap-3 border-t border-border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <CasteIcon caste={agent.caste} className="size-4" />
        <h3 className="text-sm font-semibold tracking-tight">{caste?.label ?? agent.caste} · {agent.issue}</h3>
        <StatusBadge status={agent.status} />
        <Badge>{agent.stage}</Badge>
        <Button asChild size="sm" variant="ghost" className="ml-auto">
          <a href={sessionHref}><ExternalLink />Open View</a>
        </Button>
      </div>
      <FactList
        columns={4}
        items={[
          ["Session", agent.id],
          ["Adapter", agent.model ? `${agent.adapter} · ${agent.model}` : agent.adapter],
          ["Usage", formatUsage(agent.usage)],
          ["Working directory", agent.cwd],
          ["Transcript", agent.activity],
          ...(agent.scope?.length ? [["File scope", agent.scope.join(", ")]] : []),
        ]}
      />
    </div>
  );
}

function resolveSessionIdFromHash() {
  if (typeof window === "undefined") return "";
  const [, sessionId = ""] = window.location.hash.replace(/^#/, "").split("/");
  return decodeURIComponent(sessionId);
}
