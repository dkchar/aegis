import type {
  EditableOlympusConfig,
  EditableOlympusConfigPatch,
  ReadyIssueSummary,
} from "../types/dashboard-state";

const STEER_URL = "/api/steer";
const STATE_URL = "/api/state";
const READY_ISSUES_URL = "/api/issues/ready";
const CONFIG_URL = "/api/config";
const LEARNING_URL = "/api/learning";

const CONTROL_ACTIONS = new Set(["start", "stop", "status", "auto_on", "auto_off", "pause", "resume"]);

function buildSteerBody(command: string, payload?: Record<string, unknown>): Record<string, unknown> {
  const requestId = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const issuedAt = new Date().toISOString();

  let effectiveCommand = command;
  const argsForEnvelope: Record<string, unknown> = { ...(payload ?? {}) };

  if (payload?.issueId && typeof payload.issueId === "string") {
    const commandsNeedingIssueId = new Set(["scout", "implement", "review", "focus"]);
    if (commandsNeedingIssueId.has(command)) {
      effectiveCommand = `${command} ${payload.issueId}`;
      delete argsForEnvelope.issueId;
    }
  }

  if (CONTROL_ACTIONS.has(effectiveCommand)) {
    return {
      action: effectiveCommand,
      request_id: requestId,
      issued_at: issuedAt,
      source: "olympus",
      ...argsForEnvelope,
    };
  }

  return {
    action: "command",
    request_id: requestId,
    issued_at: issuedAt,
    source: "olympus",
    args: { command: effectiveCommand, ...argsForEnvelope },
  };
}

export async function sendCommand(
  command: string,
  payload?: Record<string, unknown>,
): Promise<Response> {
  return fetch(STEER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildSteerBody(command, payload)),
  });
}

export async function killAgent(agentId: string): Promise<Response> {
  return sendCommand("kill", { agentId });
}

export async function toggleAutoMode(enabled: boolean): Promise<Response> {
  return sendCommand(enabled ? "auto_on" : "auto_off");
}

export async function fetchState() {
  const response = await fetch(STATE_URL);
  if (!response.ok) {
    throw new Error(`State fetch failed: ${response.status}`);
  }
  return response.json();
}

export async function fetchReadyIssues(): Promise<ReadyIssueSummary[]> {
  const response = await fetch(READY_ISSUES_URL);
  if (!response.ok) {
    throw new Error(`Ready issue fetch failed: ${response.status}`);
  }
  return response.json() as Promise<ReadyIssueSummary[]>;
}

export async function fetchEditableConfig(): Promise<EditableOlympusConfig> {
  const response = await fetch(CONFIG_URL);
  if (!response.ok) {
    throw new Error(`Config fetch failed: ${response.status}`);
  }
  return response.json() as Promise<EditableOlympusConfig>;
}

export async function saveEditableConfig(
  payload: EditableOlympusConfigPatch,
): Promise<{ ok: boolean; message: string; config?: EditableOlympusConfig }> {
  const response = await fetch(CONFIG_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Config update failed: ${response.status}`);
  }
  return response.json() as Promise<{ ok: boolean; message: string; config?: EditableOlympusConfig }>;
}

export async function submitLearning(record: {
  category: string;
  domain: string;
  content: string;
  tags?: string[];
}) {
  return fetch(LEARNING_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(record),
  });
}
