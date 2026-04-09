/**
 * HTTP API client for Olympus.
 * Wraps calls to the Aegis REST endpoints.
 * Kept for future dedicated API client layer expansion.
 */

const STEER_URL = "/api/steer";
const STATE_URL = "/api/state";
const LEARNING_URL = "/api/learning";

/** Known control actions that map directly to server lifecycle actions. */
const CONTROL_ACTIONS = new Set(["start", "stop", "status", "auto_on", "auto_off", "pause", "resume"]);

/**
 * Build a proper ControlApiRequest envelope for the steer endpoint.
 */
function buildSteerBody(command: string, payload?: Record<string, unknown>): Record<string, unknown> {
  const requestId = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const issuedAt = new Date().toISOString();

  // For commands that need additional parameters (like scout <issueId>),
  // concatenate payload values into the command string when appropriate
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

/**
 * Send a control command to the orchestrator.
 */
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

/**
 * Kill a running agent by ID.
 */
export async function killAgent(agentId: string): Promise<Response> {
  return sendCommand("kill", { agentId });
}

/**
 * Toggle auto mode on or off.
 */
export async function toggleAutoMode(enabled: boolean): Promise<Response> {
  return sendCommand(enabled ? "auto_on" : "auto_off");
}

/**
 * Fetch the current orchestrator state snapshot.
 */
export async function fetchState() {
  const res = await fetch(STATE_URL);
  if (!res.ok) {
    throw new Error(`State fetch failed: ${res.status}`);
  }
  return res.json();
}

/**
 * Submit a learning record to Mnemosyne.
 */
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
