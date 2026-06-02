export async function loadOlympusState() {
  return readJson("/api/olympus/state", { method: "GET" });
}

export async function loadModelOptions(adapter) {
  return readJson(`/api/olympus/models?adapter=${encodeURIComponent(adapter)}`, { method: "GET" });
}

export async function saveOlympusConfig(config) {
  return readJson("/api/olympus/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ config }),
  });
}

export async function runOlympusControl(action, config) {
  return readJson("/api/olympus/control", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, config }),
  });
}

export async function switchOlympusWorkspace(root) {
  return readJson("/api/olympus/workspace", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ root }),
  });
}

export async function browseOlympusWorkspace() {
  return readJson("/api/olympus/workspace/browse", { method: "POST" });
}

export async function openOlympusWorkspaceFolder() {
  return readJson("/api/olympus/workspace/open", { method: "POST" });
}

export async function moveOlympusTicket(ticketId, column) {
  return readJson("/api/olympus/tickets/move", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticketId, column }),
  });
}

export async function createOlympusTicket(ticket) {
  return readJson("/api/olympus/tickets/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticket }),
  });
}

async function readJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `${options.method ?? "GET"} ${url} failed: ${response.status}`);
  }
  return payload;
}
