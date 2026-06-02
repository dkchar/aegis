export function buildChronosTimeline(state) {
  const events = [];
  const push = (event) => {
    const issue = event.issue || issueFromText(`${event.title ?? ""} ${event.detail ?? ""}`);
    events.push({
      id: event.id || `${event.source}-${events.length}`,
      source: event.source,
      lane: event.lane || sourceLane(event.source),
      issue,
      title: event.title || event.source,
      detail: event.detail || "",
      status: event.status || "active",
      sortKey: Number.isFinite(event.sortKey) ? event.sortKey : events.length,
    });
  };

  for (const ticket of state.tickets ?? []) {
    push({
      source: "agora",
      lane: "Agora",
      issue: ticket.id,
      title: `${ticket.id} ${ticket.title}`,
      detail: `${ticket.column}${ticket.blockedBy?.length ? ` blocked by ${ticket.blockedBy.join(", ")}` : ""}`,
      status: ticket.column,
      sortKey: timeKey(ticket.updatedAt, events.length),
    });
  }

  for (const record of state.dispatchRecords ?? []) {
    push({
      source: "dispatch",
      lane: record.runningAgent?.caste || record.lastCompletedCaste || "Dispatch",
      issue: record.issueId,
      title: `${record.issueId} ${record.stage}`,
      detail: [
        record.runningAgent?.sessionId ? `session ${record.runningAgent.sessionId}` : "",
        record.oracleAssessmentRef,
        record.titanHandoffRef,
        record.sentinelVerdictRef,
        record.janusArtifactRef,
        record.failureTranscriptRef,
      ].filter(Boolean).join(" | "),
      status: record.stage,
      sortKey: events.length + 1000,
    });
  }

  for (const item of state.mergeQueue ?? []) {
    push({
      source: "merge",
      lane: "Janus",
      issue: item.issue,
      title: `${item.issue || item.id} merge ${item.state}`,
      detail: item.note || item.priority || "",
      status: item.state,
      sortKey: events.length + 2000,
    });
  }

  for (const artifact of state.artifacts ?? []) {
    push({
      source: "artifact",
      lane: artifact.owner || artifact.kind || "Artifact",
      issue: artifact.issue,
      title: `${artifact.issue || "artifact"} ${artifact.kind}`,
      detail: artifact.summary || artifact.path || "",
      status: artifact.status,
      sortKey: events.length + 3000,
    });
  }

  for (const agent of state.agents ?? []) {
    push({
      source: "session",
      lane: agent.caste || "Session",
      issue: agent.issue,
      title: `${agent.issue || agent.id} ${agent.caste || "agent"}`,
      detail: agent.activity || agent.stage || agent.id,
      status: agent.status,
      sortKey: events.length + 4000,
    });
  }

  for (const [phase, entries] of Object.entries(state.loopEvents ?? {})) {
    for (const entry of entries ?? []) {
      push({
        source: "phase",
        lane: phase,
        issue: issueFromText(entry[2]),
        title: `${phase}: ${entry[1] ?? "event"}`,
        detail: entry[2] ?? "",
        status: phase,
        sortKey: Number(entry[3] ?? events.length + 5000),
      });
    }
  }

  appendLogEvent(events, state.logs ?? []);
  return events.sort((left, right) => left.sortKey - right.sortKey).slice(-160);
}

function appendLogEvent(events, logLines) {
  if (logLines.length === 0) return;
  const lastLine = logLines[logLines.length - 1];
  const failed = logLines.some((line) => String(line).toLowerCase().includes("error"));
  events.push({
    id: `log-${events.length}`,
    source: "log",
    lane: "Terminal",
    issue: issueFromText(lastLine),
    title: `${logLines.length} daemon log lines`,
    detail: lastLine,
    status: failed ? "failed" : "active",
    sortKey: 6000,
  });
}

export function buildChronosMergeTree(state) {
  const ticketsById = new Map((state.tickets ?? []).map((ticket) => [ticket.id, ticket]));
  const recordsByIssue = new Map((state.dispatchRecords ?? []).map((record) => [record.issueId, record]));
  const artifactsByIssue = groupBy(state.artifacts ?? [], (artifact) => artifact.issue || "");
  const mergeByIssue = groupBy(state.mergeQueue ?? [], (item) => item.issue || "");

  const buildNode = (ticket, ancestry = new Set()) => {
    const childIds = (ticket.children ?? []).filter((id, index, values) => id && values.indexOf(id) === index);
    const nextAncestry = new Set([...ancestry, ticket.id]);
    return {
      id: ticket.id,
      title: ticket.title,
      column: ticket.column,
      kind: ticket.kind,
      blockedBy: ticket.blockedBy ?? [],
      scope: ticket.scope ?? [],
      dispatch: recordsByIssue.get(ticket.id) ?? null,
      artifacts: artifactsByIssue.get(ticket.id) ?? [],
      mergeItems: mergeByIssue.get(ticket.id) ?? [],
      children: childIds
        .map((childId) => ticketsById.get(childId))
        .filter((child) => child && !ancestry.has(child.id))
        .map((child) => buildNode(child, nextAncestry)),
    };
  };

  const roots = (state.tickets ?? [])
    .filter((ticket) => !ticket.parent || !ticketsById.has(ticket.parent))
    .map((ticket) => buildNode(ticket));

  return {
    roots,
    stats: {
      tickets: state.tickets?.length ?? 0,
      blocked: (state.tickets ?? []).filter((ticket) => ticket.column === "blocked" || ticket.blockedBy?.length).length,
      merging: state.mergeQueue?.length ?? 0,
      artifacts: state.artifacts?.length ?? 0,
    },
  };
}

function timeKey(value, fallback) {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

function issueFromText(value) {
  return String(value ?? "").match(/AG-\d+/)?.[0] ?? "";
}

function sourceLane(source) {
  const labels = {
    agora: "Agora",
    dispatch: "Dispatch",
    merge: "Janus",
    artifact: "Artifact",
    session: "Session",
    phase: "Loop",
    log: "Terminal",
  };
  return labels[source] ?? "Aegis";
}

function groupBy(items, keyFn) {
  const groups = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
}
