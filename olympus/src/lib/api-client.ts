/**
 * HTTP API client for Olympus.
 * Wraps calls to the Aegis REST endpoints.
 * Kept for future dedicated API client layer expansion.
 */

const STEER_URL = "/api/steer";
const STATE_URL = "/api/state";
const LEARNING_URL = "/api/learning";

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
    body: JSON.stringify({ command, ...payload }),
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
