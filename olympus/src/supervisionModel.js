export function displayColumnForDispatch(ticket, record) {
  if (!record) return ticket.column;
  if (record.runningAgent) return "in_progress";
  if (record.stage === "failed_operational") return "halted";
  if (record.stage === "blocked_on_child") return "blocked";
  if (record.stage === "queued_for_merge" || record.stage === "merging" || record.stage === "resolving_integration") return "ready_to_merge";
  if (record.stage === "reviewing" || record.stage === "implemented" || record.stage === "rework_required") return "in_review";
  if (record.stage === "complete") return "done";
  if (record.stage && record.stage !== "pending") return "in_progress";
  return ticket.column;
}

export function deriveDisplayTickets(tickets, dispatchRecords = []) {
  const recordsByIssue = new Map(dispatchRecords.map((record) => [record.issueId, record]));
  return tickets.map((ticket) => {
    const record = recordsByIssue.get(ticket.id);
    return {
      ...ticket,
      trackerColumn: ticket.column,
      runtimeStage: record?.stage ?? null,
      runtimeAgent: record?.runningAgent ?? null,
      column: displayColumnForDispatch(ticket, record),
    };
  });
}

export function deriveBoardCounts(columns, tickets) {
  return Object.fromEntries(columns.map((column) => [column, tickets.filter((ticket) => ticket.column === column).length]));
}

export function deriveFlowSummary(tickets, mergeQueue = []) {
  const executable = ["ready", "in_progress", "in_review", "ready_to_merge"];
  return {
    executable: tickets.filter((ticket) => executable.includes(ticket.column)).length,
    failures: tickets.filter((ticket) => ticket.column === "halted").length,
    blocked: tickets.filter((ticket) => ticket.column === "blocked").length,
    complete: tickets.filter((ticket) => ticket.column === "done").length,
    queueDepth: mergeQueue.length,
  };
}

export function deriveOpsSummaryItems(state, counts, flow) {
  const activeSessionCount = state.agents.filter((agent) => ["running", "streaming"].includes(agent.status)).length;
  return [
    ["Daemon", state.daemon.activity ?? state.daemon.status],
    ["Ready", counts.ready],
    ["Sessions", activeSessionCount],
    ["Queue", flow.queueDepth],
    ["Failures", flow.failures],
  ];
}

export function deriveSessionView(state, sessionFilters) {
  const sortedAgents = [...state.agents].sort(compareSessions);
  const filteredAgents = state.sessionFilter === "All"
    ? sortedAgents
    : sortedAgents.filter((agent) => agent.caste === state.sessionFilter);
  const activeFilters = ["All", ...new Set([...sessionFilters.slice(1), ...state.agents.map((agent) => agent.caste).filter(Boolean)])];
  const groupedAgents = activeFilters.slice(1).map((caste) => [caste, filteredAgents.filter((agent) => agent.caste === caste)]);

  return {
    sortedAgents,
    filteredAgents,
    activeFilters,
    groupedAgents,
  };
}

export function compareSessions(left, right) {
  return sessionStatusRank(left.status) - sessionStatusRank(right.status)
    || String(left.issue).localeCompare(String(right.issue))
    || String(left.caste).localeCompare(String(right.caste))
    || String(left.id).localeCompare(String(right.id));
}

function sessionStatusRank(status) {
  if (status === "running" || status === "streaming") return 0;
  if (["failed", "blocked", "reworking", "cooldown"].includes(status)) return 1;
  if (["pending", "queued"].includes(status)) return 2;
  if (["succeeded", "done", "pass"].includes(status)) return 4;
  return 3;
}
