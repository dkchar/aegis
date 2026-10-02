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
    queueDepth: mergeQueue.filter((item) => item.state === "queued" || item.state === "merging").length,
    merged: mergeQueue.filter((item) => item.state === "merged").length,
  };
}

/**
 * Operator-facing status for one dispatch record. Order matters: hard
 * failures and blocks first, then live sessions, then queued/idle states.
 */
export function dispatchStatus(record, now = Date.now()) {
  if (record.stage === "failed_operational") return "failed";
  if (record.stage === "blocked_on_child" || record.blockedByIssueId) return "blocked";
  if (record.stage === "complete") return "succeeded";
  if (record.stage === "rework_required") return "reworking";
  if (record.runningAgent && record.stage === "implementing" && record.reviewFeedbackRef) return "reworking";
  if (record.runningAgent) return "running";
  if (record.cooldownUntil && Date.parse(record.cooldownUntil) > now) return "cooldown";
  if (record.stage === "queued_for_merge" || record.stage === "merging" || record.stage === "resolving_integration") return "queued";
  if (record.stage === "pending") return "pending";
  return "active";
}

export function dispatchNote(record, now = Date.now()) {
  if (record.stage === "failed_operational") {
    const failureKind = record.operationalFailureKind === "provider_usage_limit"
      ? "Provider usage limit reached"
      : record.operationalFailureKind ?? "Operational failure";
    return [
      failureKind,
      record.failureCount ? `${record.failureCount} failures` : "",
      record.failureTranscriptRef ?? "",
    ].filter(Boolean).join(" - ");
  }
  if (record.blockedByIssueId) return `Waiting on ${record.blockedByIssueId}`;
  if (record.stage === "blocked_on_child") return "Waiting on child issues";
  if (record.stage === "complete") return record.lastCompletedCaste ? `Completed by ${record.lastCompletedCaste}` : "Complete";
  const caste = record.runningAgent?.caste ?? "agent";
  if (record.stage === "rework_required") return `Review feedback requires rework: ${record.reviewFeedbackRef ?? "see verdict"}`;
  if (record.runningAgent && record.stage === "implementing" && record.reviewFeedbackRef) return `${caste} reworking review feedback from ${record.reviewFeedbackRef}`;
  if (record.runningAgent?.sessionId) return `${caste} running in ${record.runningAgent.sessionId}`;
  if (record.cooldownUntil && Date.parse(record.cooldownUntil) > now) return `Cooling down until ${record.cooldownUntil}`;
  if (record.lastCompletedCaste) return `Last completed: ${record.lastCompletedCaste}`;
  return "Awaiting loop activity";
}

export function dispatchRefs(record) {
  return [
    record.oracleAssessmentRef,
    record.titanHandoffRef,
    record.sentinelVerdictRef,
    record.reviewFeedbackRef,
    record.janusArtifactRef,
    record.failureTranscriptRef,
  ].filter(Boolean);
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
