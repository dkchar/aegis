export const columns = [
  "backlog",
  "blocked",
  "ready",
  "in_progress",
  "in_review",
  "ready_to_merge",
  "done",
  "halted",
];

export { buildChronosMergeTree, buildChronosTimeline } from "./chronosModel.js";

export const columnLabels = {
  backlog: "Backlog",
  ready: "Ready",
  in_progress: "In Progress",
  in_review: "In Review",
  blocked: "Blocked",
  ready_to_merge: "Ready To Merge",
  done: "Done",
  halted: "Halted",
};

export const kinds = ["feature", "bug", "task", "blocker", "gate", "review_fix"];
export const actors = ["human", "agent", "system", "aegis"];
export const phases = ["poll", "triage", "dispatch", "monitor", "reap"];
export const adapterOptions = ["pi", "codex"];
export const thinkingOptions = ["off", "low", "medium", "high"];

export const emptyTicketDraft = {
  title: "",
  body: "",
  kind: "task",
  column: "backlog",
  sprint: "",
  phase: "",
  parent: "",
  scope: "",
  labels: "",
  blockedBy: "",
  actor: "agent",
};

export const configMeta = {
  runtime: { section: "Runtime", control: "select", options: adapterOptions, required: true },
  "models.oracle": { section: "Runtime", control: "model", required: true },
  "models.titan": { section: "Runtime", control: "model", required: true },
  "models.sentinel": { section: "Runtime", control: "model", required: true },
  "models.janus": { section: "Runtime", control: "model", required: true },
  "thinking.oracle": { section: "Runtime", control: "select", options: thinkingOptions, required: true },
  "thinking.titan": { section: "Runtime", control: "select", options: thinkingOptions, required: true },
  "thinking.sentinel": { section: "Runtime", control: "select", options: thinkingOptions, required: true },
  "thinking.janus": { section: "Runtime", control: "select", options: thinkingOptions, required: true },
  "concurrency.max_agents": { section: "Concurrency", control: "number", min: 1, max: 64, required: true },
  "concurrency.max_oracles": { section: "Concurrency", control: "number", min: 0, max: 32, required: true },
  "concurrency.max_titans": { section: "Concurrency", control: "number", min: 0, max: 32, required: true },
  "concurrency.max_sentinels": { section: "Concurrency", control: "number", min: 0, max: 32, required: true },
  "concurrency.max_janus": { section: "Concurrency", control: "number", min: 1, max: 8, required: true },
  "thresholds.poll_interval_seconds": { section: "Thresholds", control: "number", min: 1, max: 3600, required: true },
  "thresholds.stuck_warning_seconds": { section: "Thresholds", control: "number", min: 30, max: 86400, required: true },
  "thresholds.stuck_kill_seconds": { section: "Thresholds", control: "number", min: 60, max: 172800, required: true },
  "thresholds.allow_complex_auto_dispatch": { section: "Thresholds", control: "boolean", required: true },
  "thresholds.scope_overlap_threshold": { section: "Thresholds", control: "number", min: 0, max: 32, required: true },
  "thresholds.janus_retry_threshold": { section: "Thresholds", control: "number", min: 0, max: 10, required: true },
  "janus.enabled": { section: "Janus", control: "boolean", required: true },
  "janus.max_invocations_per_issue": { section: "Janus", control: "number", min: 0, max: 10, required: true },
  "labor.base_path": { section: "Paths", control: "text", required: true },
  "git.base_branch": { section: "Paths", control: "text", required: true },
  AEGIS_PI_SESSION_TIMEOUT_MS: { section: "Adapter", control: "number", min: 1000, max: 86400000, required: false },
  AEGIS_PI_ORACLE_TIMEOUT_MS: { section: "Adapter", control: "number", min: 1000, max: 86400000, required: false },
  AEGIS_PI_TITAN_TIMEOUT_MS: { section: "Adapter", control: "number", min: 1000, max: 86400000, required: false },
  AEGIS_PI_SENTINEL_TIMEOUT_MS: { section: "Adapter", control: "number", min: 1000, max: 86400000, required: false },
  AEGIS_PI_JANUS_TIMEOUT_MS: { section: "Adapter", control: "number", min: 1000, max: 86400000, required: false },
  AEGIS_PI_TIMEOUT_RETRY_COUNT: { section: "Adapter", control: "number", min: 0, max: 10, required: false },
  AEGIS_PI_TIMEOUT_RETRY_DELAY_MS: { section: "Adapter", control: "number", min: 0, max: 3600000, required: false },
};

export const settings = Object.entries({
  runtime: "pi",
  "models.oracle": "",
  "models.titan": "",
  "models.sentinel": "",
  "models.janus": "",
  "thinking.oracle": "medium",
  "thinking.titan": "high",
  "thinking.sentinel": "medium",
  "thinking.janus": "high",
  "concurrency.max_agents": "24",
  "concurrency.max_oracles": "6",
  "concurrency.max_titans": "12",
  "concurrency.max_sentinels": "4",
  "concurrency.max_janus": "2",
  "thresholds.poll_interval_seconds": "8",
  "thresholds.stuck_warning_seconds": "420",
  "thresholds.stuck_kill_seconds": "900",
  "thresholds.allow_complex_auto_dispatch": "false",
  "thresholds.scope_overlap_threshold": "1",
  "thresholds.janus_retry_threshold": "2",
  "janus.enabled": "true",
  "janus.max_invocations_per_issue": "2",
  "labor.base_path": ".aegis/labor",
  "git.base_branch": "main",
  AEGIS_PI_SESSION_TIMEOUT_MS: "900000",
  AEGIS_PI_ORACLE_TIMEOUT_MS: "300000",
  AEGIS_PI_TITAN_TIMEOUT_MS: "900000",
  AEGIS_PI_SENTINEL_TIMEOUT_MS: "420000",
  AEGIS_PI_JANUS_TIMEOUT_MS: "900000",
  AEGIS_PI_TIMEOUT_RETRY_COUNT: "1",
  AEGIS_PI_TIMEOUT_RETRY_DELAY_MS: "30000",
});

export function createOlympusState() {
  const config = Object.fromEntries(settings);
  const configIssues = getConfigIssues(config);
  return {
    activeTab: "live",
    activeConfigSection: "Runtime",
    selectedAgentId: "",
    sessionFilter: "All",
    editingTicketId: null,
    activeDragId: null,
    expandedArtifactIds: [],
    showConfigDialog: configIssues.length > 0,
    toast: "",
    toastKind: "success",
    apiStatus: "connecting",
    apiMessage: "Waiting for Olympus event stream",
    lastRefreshAt: "",
    adapterOptions,
    modelOptions: {},
    daemon: {
      status: "stopped",
      pid: "none",
      phase: "poll",
      uptime: "not running",
      adapter: "unconfigured",
      stream: "waiting",
      branch: "workspace",
    },
    workspace: { root: "", seeded: false },
    runSummary: { total: 0, done: 0, halted: 0, active: 0, complete: false, running: false },
    tickets: [],
    artifacts: [],
    healthChecks: [],
    loopEvents: Object.fromEntries(phases.map((phase) => [phase, []])),
    logs: [],
    agents: [],
    mergeQueue: [],
    dispatchRecords: [],
    config,
    configIssues,
    configDirty: false,
  };
}

export function hydrateOlympusState(state, payload) {
  const config = payload.config && !state.configDirty ? { ...state.config, ...payload.config } : state.config;
  const selectedAgentId = payload.agents?.some((agent) => agent.id === state.selectedAgentId)
    ? state.selectedAgentId
    : payload.agents?.[0]?.id ?? state.selectedAgentId;

  return {
    ...state,
    ...(payload.daemon ? { daemon: { ...state.daemon, ...payload.daemon } } : {}),
    ...(payload.tickets ? { tickets: payload.tickets } : {}),
    ...(payload.mergeQueue ? { mergeQueue: payload.mergeQueue } : {}),
    ...(payload.artifacts ? { artifacts: payload.artifacts } : {}),
    ...(payload.agents ? { agents: payload.agents, selectedAgentId } : {}),
    ...(payload.dispatchRecords ? { dispatchRecords: payload.dispatchRecords } : {}),
    ...(payload.logs ? { logs: payload.logs } : {}),
    ...(payload.loopEvents ? { loopEvents: payload.loopEvents } : {}),
    ...(payload.healthChecks ? { healthChecks: payload.healthChecks } : {}),
    ...(payload.workspace ? { workspace: payload.workspace } : {}),
    ...(payload.runSummary ? { runSummary: payload.runSummary } : {}),
    ...(payload.adapterOptions ? { adapterOptions: payload.adapterOptions } : {}),
    ...(payload.modelOptions ? { modelOptions: { ...state.modelOptions, ...payload.modelOptions } } : {}),
    config,
    configIssues: getConfigIssues(config),
    showConfigDialog: state.showConfigDialog && getConfigIssues(config).length > 0,
    apiStatus: "connected",
    apiMessage: payload.configFilePresent === false ? "Configuration file not found" : "Live event stream connected",
    lastRefreshAt: payload.generatedAt ?? new Date().toISOString(),
  };
}

export function markApiError(state, message) {
  return {
    ...state,
    apiStatus: "offline",
    apiMessage: message || "Olympus API unavailable",
  };
}

export function updateModelOptions(state, adapter, result) {
  return {
    ...state,
    modelOptions: {
      ...state.modelOptions,
      [adapter]: result,
    },
  };
}

export function addTicket(state, draft) {
  const validationError = validateTicketDraft(draft);
  if (validationError) {
    return { ...state, toast: validationError, toastKind: "error" };
  }
  const now = new Date().toISOString();
  const blockedBy = normalizeStringList(draft.blockedBy);
  const ticket = createTicketShape({
    id: nextTicketId(state.tickets),
    title: draft.title || "Untitled ticket",
    body: draft.body || "",
    kind: draft.kind || "task",
    column: blockedBy.length > 0 ? "blocked" : draft.column || "backlog",
    sprint: emptyToNull(draft.sprint),
    phase: emptyToNull(draft.phase),
    parent: emptyToNull(draft.parent),
    scope: normalizeStringList(draft.scope),
    labels: normalizeStringList(draft.labels),
    blockedBy,
    createdBy: draft.actor || "agent",
    createdAt: now,
    updatedAt: now,
  });
  return appendLog(
    { ...state, tickets: [...state.tickets, ticket], toast: `${ticket.id} added`, toastKind: "success" },
    `[Agora] ${ticket.id} added in ${ticket.column}`,
  );
}

export function updateTicket(state, ticketId, patch) {
  const nextState = {
    ...state,
    tickets: state.tickets.map((ticket) => {
      if (ticket.id !== ticketId) return ticket;
      const normalized = normalizeTicketPatch(patch);
      const blockedBy = normalized.blockedBy ?? ticket.blockedBy;
      return {
        ...ticket,
        ...normalized,
        column:
          blockedBy.length > 0 && !["done", "halted"].includes(normalized.column ?? ticket.column)
            ? "blocked"
            : normalized.column ?? ticket.column,
        blockedBy,
        updatedAt: new Date().toISOString(),
      };
    }),
    toast: `${ticketId} updated`,
    toastKind: "success",
  };
  return appendLog(nextState, `[Agora] ${ticketId} updated`);
}

export function moveTicket(state, ticketId, column) {
  return updateTicket(state, ticketId, { column });
}

export function toggleArtifact(state, artifactId) {
  const expanded = state.expandedArtifactIds.includes(artifactId)
    ? state.expandedArtifactIds.filter((id) => id !== artifactId)
    : [...state.expandedArtifactIds, artifactId];
  return { ...state, expandedArtifactIds: expanded };
}

export function updateConfig(state, key, value) {
  const error = validateConfigValue(key, value);
  if (error) {
    return { ...state, toast: error, toastKind: "error" };
  }
  const config = { ...state.config, [key]: value };
  return {
    ...state,
    config,
    configIssues: getConfigIssues(config),
    configDirty: true,
    toast: `${key} changed`,
    toastKind: "success",
  };
}

export function saveConfigSucceeded(state, config) {
  return {
    ...state,
    config: { ...state.config, ...config },
    configIssues: getConfigIssues({ ...state.config, ...config }),
    configDirty: false,
    showConfigDialog: getConfigIssues({ ...state.config, ...config }).length > 0,
    toast: "Config saved",
    toastKind: "success",
  };
}

export function selectAgent(state, agentId) {
  return { ...state, selectedAgentId: agentId, toast: `${agentId} selected`, toastKind: "success" };
}

export function setConfigSection(state, section) {
  return { ...state, activeConfigSection: section };
}

export function setSessionFilter(state, filter) {
  return { ...state, sessionFilter: filter };
}

export function openConfigForMissing(state) {
  return {
    ...state,
    activeTab: "config",
    activeConfigSection: "Runtime",
    showConfigDialog: false,
    toast: "Complete configuration",
    toastKind: "success",
  };
}

export function dismissConfigDialog(state) {
  return { ...state, showConfigDialog: false };
}

export function validateTicketDraft(draft) {
  if (!String(draft.title ?? "").trim()) {
    return "Title is required.";
  }
  if (!kinds.includes(draft.kind)) {
    return "Kind is invalid.";
  }
  if (!columns.includes(draft.column)) {
    return "Column is invalid.";
  }
  if (!actors.includes(draft.actor ?? draft.createdBy ?? "agent")) {
    return "Created by is invalid.";
  }
  return null;
}

export function validateConfigValue(key, value) {
  const meta = configMeta[key];
  if (!meta) return null;
  const stringValue = String(value ?? "").trim();
  if (meta.required && !stringValue) {
    return `${key} is required.`;
  }
  if (meta.control === "number" && stringValue) {
    const parsed = Number(stringValue);
    if (!Number.isFinite(parsed)) return `${key} must be numeric.`;
    if (meta.min !== undefined && parsed < meta.min) return `${key} must be at least ${meta.min}.`;
    if (meta.max !== undefined && parsed > meta.max) return `${key} must be at most ${meta.max}.`;
  }
  if (meta.control === "model") {
    return null;
  }
  if (key === "runtime") {
    return null;
  }
  if (meta.control === "select" && stringValue && !meta.options.includes(stringValue)) {
    return `${key} has an invalid choice.`;
  }
  if (meta.control === "boolean" && !["true", "false"].includes(stringValue)) {
    return `${key} must be true or false.`;
  }
  return null;
}

export function getConfigIssues(config) {
  return Object.entries(configMeta)
    .filter(([key, meta]) => meta.required && !String(config[key] ?? "").trim())
    .map(([key]) => key);
}

function appendLog(state, line) {
  return { ...state, logs: [...state.logs.slice(-11), line] };
}

function createTicketShape(input) {
  const now = input.createdAt ?? "2026-05-07T13:30:00.000Z";
  return {
    id: input.id,
    title: input.title,
    body: input.body ?? "",
    kind: input.kind ?? "task",
    column: input.column ?? "backlog",
    sprint: input.sprint ?? null,
    phase: input.phase ?? null,
    parent: input.parent ?? null,
    children: input.children ?? [],
    blockedBy: input.blockedBy ?? [],
    blocks: input.blocks ?? [],
    scope: input.scope ?? [],
    labels: input.labels ?? [],
    createdBy: input.createdBy ?? "agent",
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    lease: input.lease ?? { caste: null, sessionId: null, startedAt: null },
    artifacts: input.artifacts ?? {},
    attempts: input.attempts ?? { rework: 0, operational: 0, loop: 0 },
    loopSignatures: input.loopSignatures ?? [],
  };
}

function normalizeTicketPatch(patch) {
  const normalized = { ...patch };
  for (const key of ["scope", "labels", "blockedBy"]) {
    if (typeof normalized[key] === "string") {
      normalized[key] = normalizeStringList(normalized[key]);
    }
  }
  for (const key of ["sprint", "phase", "parent"]) {
    if (key in normalized) {
      normalized[key] = emptyToNull(normalized[key]);
    }
  }
  return normalized;
}

function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }
  if (!value) {
    return [];
  }
  return String(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function emptyToNull(value) {
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed : null;
}

function nextTicketId(existingTickets) {
  const max = existingTickets.reduce((highest, ticket) => {
    const match = /^AG-(\d+)$/.exec(ticket.id);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);
  return `AG-${String(max + 1).padStart(4, "0")}`;
}
