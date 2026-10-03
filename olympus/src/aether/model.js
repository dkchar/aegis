/**
 * Aether scene model: pure functions that place Agora tickets on the swarm
 * map and turn loop events into signals. No DOM; the renderer animates what
 * this module decides.
 */

/**
 * Stations in normalized canvas coordinates, left to right along the flow.
 * `portrait` places them on narrow canvases: the flow runs top to bottom and
 * the side stations sit in a row underneath.
 */
export const STATIONS = [
  { id: "agora", label: "Agora", role: "ready work", tone: "info", x: 0.075, y: 0.46, portrait: { x: 0.36, y: 0.02 }, layout: "cloud" },
  { id: "oracle", label: "Oracle", role: "scout", tone: "info", x: 0.245, y: 0.36, portrait: { x: 0.24, y: 0.16 }, layout: "orbit" },
  { id: "titan", label: "Titan", role: "forge", tone: "primary", x: 0.43, y: 0.5, portrait: { x: 0.36, y: 0.31 }, layout: "orbit" },
  { id: "sentinel", label: "Sentinel", role: "gate", tone: "violet", x: 0.605, y: 0.36, portrait: { x: 0.24, y: 0.46 }, layout: "orbit" },
  { id: "merge", label: "Merge", role: "verify + land", tone: "success", x: 0.77, y: 0.5, portrait: { x: 0.36, y: 0.61 }, layout: "orbit" },
  { id: "trunk", label: "Trunk", role: "landed", tone: "success", x: 0.925, y: 0.4, portrait: { x: 0.24, y: 0.76 }, layout: "spiral" },
  { id: "janus", label: "Janus", role: "integration", tone: "warning", x: 0.655, y: 0.82, portrait: { x: 0.8, y: 0.95 }, layout: "orbit" },
  { id: "blocked", label: "Blocked", role: "waiting on children", tone: "muted", x: 0.115, y: 0.84, portrait: { x: 0.2, y: 0.95 }, layout: "cloud" },
  { id: "attention", label: "Attention", role: "failed or halted", tone: "danger", x: 0.355, y: 0.84, portrait: { x: 0.52, y: 0.95 }, layout: "cloud" },
];

/** Paths a ticket or handoff can travel. `bend` curves the path off the straight line. */
export const ROUTES = [
  { id: "agora-oracle", from: "agora", to: "oracle", kind: "flow", bend: 0.12 },
  { id: "oracle-titan", from: "oracle", to: "titan", kind: "flow", bend: -0.12 },
  { id: "titan-sentinel", from: "titan", to: "sentinel", kind: "flow", bend: 0.12 },
  { id: "sentinel-merge", from: "sentinel", to: "merge", kind: "flow", bend: -0.12 },
  { id: "merge-trunk", from: "merge", to: "trunk", kind: "flow", bend: 0.12 },
  { id: "sentinel-titan", from: "sentinel", to: "titan", kind: "rework", bend: 0.55 },
  { id: "merge-janus", from: "merge", to: "janus", kind: "escalate", bend: -0.2 },
  { id: "janus-titan", from: "janus", to: "titan", kind: "return", bend: -0.25 },
];

export const STATION_BY_ID = Object.fromEntries(STATIONS.map((station) => [station.id, station]));

const CASTE_TONES = { oracle: "info", titan: "primary", sentinel: "violet", janus: "warning" };
const CASTE_STATIONS = { oracle: "oracle", titan: "titan", sentinel: "sentinel", janus: "janus" };

/** Dispatch stage -> station and whether a session works it or it waits there. */
const STAGE_PLACEMENT = {
  pending: ["agora", "ready"],
  scouting: ["oracle", "running"],
  scouted: ["titan", "queued"],
  implementing: ["titan", "running"],
  implemented: ["sentinel", "queued"],
  reviewing: ["sentinel", "running"],
  rework_required: ["titan", "rework"],
  queued_for_merge: ["merge", "queued"],
  merging: ["merge", "running"],
  resolving_integration: ["janus", "queued"],
  blocked_on_child: ["blocked", "blocked"],
  failed_operational: ["attention", "failed"],
  complete: ["trunk", "done"],
};

const COLUMN_PLACEMENT = {
  backlog: ["agora", "backlog"],
  ready: ["agora", "ready"],
  blocked: ["blocked", "blocked"],
  done: ["trunk", "done"],
  halted: ["attention", "failed"],
};

export function casteTone(caste) {
  return CASTE_TONES[String(caste ?? "").toLowerCase()] ?? "muted";
}

// Matches the Agora tracker adapter: coordination tickets group work but are never dispatched.
function isExecutableTicket(ticket) {
  return !(ticket.labels ?? []).includes("role:coordination");
}

/** Where a ticket sits on the map, from its dispatch record first and its Agora column second. */
export function placeTicket(ticket, record) {
  // Tracker terminal states win: a closed or halted ticket is done with the swarm.
  if (ticket.column === "done" || ticket.column === "halted") {
    const [station, status] = COLUMN_PLACEMENT[ticket.column];
    return { station, status };
  }

  if (record && record.stage !== "pending") {
    const [station, status] = STAGE_PLACEMENT[record.stage] ?? ["agora", "ready"];
    const working = record.runningAgent && (status === "queued" || status === "running");
    // A running agent pins the ticket to its caste's station, whatever the stage says.
    const agentStation = working ? CASTE_STATIONS[String(record.runningAgent.caste).toLowerCase()] : null;
    return {
      station: agentStation ?? station,
      status: working ? "running" : status === "running" ? "queued" : status,
    };
  }

  const [station, status] = COLUMN_PLACEMENT[ticket.column] ?? ["agora", "ready"];
  return { station, status };
}

/** Latest adapter activity line; loop phase lines merged into the session view are skipped. */
function lastActivity(lines) {
  if (!Array.isArray(lines)) return "";
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = String(lines[index]);
    if (!line.startsWith("[phase]")) return line;
  }
  return "";
}

/** One mote per executable ticket, plus per-station load and run totals. */
export function buildAetherScene(state) {
  const tickets = (state.tickets ?? []).filter(isExecutableTicket);
  // Only unfinished tickets still block; a landed blocker no longer holds anything back.
  const openTicketIds = new Set(tickets.filter((ticket) => ticket.column !== "done").map((ticket) => ticket.id));
  const recordsByIssue = new Map((state.dispatchRecords ?? []).map((record) => [record.issueId, record]));
  const runningBySession = new Map((state.agents ?? [])
    .filter((agent) => agent.status === "running" || agent.status === "streaming")
    .map((agent) => [agent.id, agent]));

  const motes = tickets.map((ticket) => {
    const record = recordsByIssue.get(ticket.id) ?? null;
    const { station, status } = placeTicket(ticket, record);
    const sessionId = status === "running" ? record?.runningAgent?.sessionId ?? null : null;
    const agent = sessionId ? runningBySession.get(sessionId) : null;
    const caste = status === "running" ? String(record?.runningAgent?.caste ?? "").toLowerCase() : null;
    return {
      id: ticket.id,
      title: ticket.title ?? ticket.id,
      station,
      status,
      stage: record?.stage ?? ticket.column ?? "backlog",
      caste,
      tone: caste ? casteTone(caste) : STATION_BY_ID[station].tone,
      sessionId,
      activity: agent ? lastActivity(agent.lines) : "",
      blockedBy: (ticket.blockedBy ?? []).filter((id) => openTicketIds.has(id)),
      failures: record?.failureCount ?? 0,
      scope: record?.fileScope?.files ?? ticket.scope ?? [],
      updatedAt: record?.updatedAt ?? ticket.updatedAt ?? "",
    };
  }).sort((left, right) => left.id.localeCompare(right.id, undefined, { numeric: true }));

  const load = Object.fromEntries(STATIONS.map((station) => [station.id, { total: 0, running: 0 }]));
  for (const mote of motes) {
    load[mote.station].total += 1;
    if (mote.status === "running") load[mote.station].running += 1;
  }

  const inFlight = motes.filter((mote) => !["agora", "trunk", "blocked", "attention"].includes(mote.station)).length;
  return {
    motes,
    load,
    totals: {
      tickets: motes.length,
      done: load.trunk.total,
      inFlight,
      running: motes.filter((mote) => mote.status === "running").length,
      attention: load.attention.total,
      blocked: load.blocked.total,
    },
  };
}

function casteLabel(caste) {
  const value = String(caste ?? "");
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : "Session";
}

function parseDetail(detail) {
  try {
    return JSON.parse(detail ?? "");
  } catch {
    return null;
  }
}

const HANDOFFS = {
  scouted: { route: "oracle-titan", tone: "info", text: (id) => `Oracle handed ${id} to Titan` },
  implemented: { route: "titan-sentinel", tone: "primary", text: (id) => `Titan handed ${id} to Sentinel` },
  queued_for_merge: { route: "sentinel-merge", tone: "violet", text: (id) => `Sentinel passed ${id} to the merge queue` },
  rework_required: { route: "sentinel-titan", tone: "danger", text: (id) => `${id} sent back to Titan for rework` },
  blocked_on_child: { tone: "warning", text: (id) => `${id} blocked on a child ticket` },
};

const FAILED_OUTCOMES = new Set(["failed", "failed_operational", "kill"]);

/**
 * Maps one loop event to a signal: the sentence shown in the feed and the
 * effect the map plays. Cycle summaries (`_all`) only pulse Agora on a poll;
 * typed handoffs travel as packets between stations.
 */
export function describeEvent(entry) {
  const id = entry?.issueId;
  const base = { seq: entry?.seq, issueId: id, timestamp: entry?.timestamp ?? "", action: entry?.action ?? "" };
  if (!id || !entry.action) return null;

  if (id === "_all") {
    return entry.action === "poll_ready_work"
      ? { ...base, issueId: null, tone: "info", text: null, effect: { kind: "pulse", station: "agora", tone: "info" } }
      : null;
  }

  const launch = /^launch_(oracle|titan|sentinel|janus)$/.exec(entry.action);
  if (launch) {
    const caste = launch[1];
    return FAILED_OUTCOMES.has(entry.outcome)
      ? { ...base, tone: "danger", text: `${casteLabel(caste)} failed to launch on ${id}`, effect: { kind: "shock", tone: "danger" } }
      : { ...base, tone: casteTone(caste), text: `${casteLabel(caste)} session started on ${id}`, effect: { kind: "ignite", tone: casteTone(caste) } };
  }

  if (entry.action === "finalize_session" || entry.action === "sentinel_review_completed") {
    if (FAILED_OUTCOMES.has(entry.outcome)) {
      return { ...base, tone: "danger", text: `${id} session failed`, effect: { kind: "shock", tone: "danger" } };
    }
    const handoff = HANDOFFS[entry.outcome];
    if (handoff) {
      return {
        ...base,
        tone: handoff.tone,
        text: handoff.text(id),
        effect: handoff.route ? { kind: "packet", route: handoff.route, tone: handoff.tone } : { kind: "pulse", tone: handoff.tone },
      };
    }
    return null;
  }

  if (entry.action === "janus_resolution_completed") {
    if (entry.outcome === "rework_required") {
      return { ...base, tone: "warning", text: `Janus returned ${id} to Titan`, effect: { kind: "packet", route: "janus-titan", tone: "warning" } };
    }
    if (entry.outcome === "blocked_on_child") {
      return { ...base, tone: "warning", text: `Janus opened an integration blocker for ${id}`, effect: { kind: "pulse", tone: "warning" } };
    }
    return FAILED_OUTCOMES.has(entry.outcome)
      ? { ...base, tone: "danger", text: `Janus failed on ${id}`, effect: { kind: "shock", tone: "danger" } }
      : null;
  }

  if (entry.action === "merge_candidate") {
    const tier = parseDetail(entry.detail)?.tier;
    switch (entry.outcome) {
      case "merged":
        return { ...base, tone: "success", text: `${id} landed on the trunk`, effect: { kind: "packet", route: "merge-trunk", tone: "success", flare: "trunk" } };
      case "requeued":
        return { ...base, tone: "warning", text: `${id} requeued at the merge queue${tier ? ` (${tier})` : ""}`, effect: { kind: "pulse", tone: "warning" } };
      case "escalated":
        return { ...base, tone: "warning", text: `${id} escalated to Janus`, effect: { kind: "packet", route: "merge-janus", tone: "warning" } };
      default:
        return { ...base, tone: "danger", text: `${id} failed to merge`, effect: { kind: "shock", tone: "danger" } };
    }
  }

  if (entry.action === "stuck_warning_threshold") {
    return { ...base, tone: "warning", text: `${id} session has gone quiet`, effect: { kind: "pulse", tone: "warning" } };
  }
  if (entry.action === "stuck_kill_threshold") {
    return { ...base, tone: "danger", text: `${id} session killed after going idle`, effect: { kind: "shock", tone: "danger" } };
  }
  if (entry.action === "sentinel_blocking_findings") {
    return { ...base, tone: "danger", text: `Sentinel raised blocking findings on ${id}`, effect: null };
  }
  if (/_recovered$|_requeued$|_expanded$|_cleared$/.test(entry.action)) {
    return { ...base, tone: "muted", text: `${id}: ${entry.action.replaceAll("_", " ")}`, effect: null };
  }
  return null;
}

/** Feed rows, newest first: only events that read as a sentence. */
export function buildSignalFeed(events, limit = 60) {
  const signals = [];
  for (let index = (events ?? []).length - 1; index >= 0 && signals.length < limit; index -= 1) {
    const signal = describeEvent(events[index]);
    if (signal?.text) signals.push(signal);
  }
  return signals;
}

/** True for an activity line that reports a tool error or denial. */
export function isErrorActivity(line) {
  return /\[(tool_error|error)\]|denied|failed/i.test(String(line ?? ""));
}
