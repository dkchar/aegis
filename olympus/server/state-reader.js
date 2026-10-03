import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { LIVE_ADAPTERS, listModelOptions } from "./adapters.js";
import { CASTES, flattenConfig } from "./config-schema.js";
import { readJson, readText, tailLines } from "./io.js";
import { readSessions } from "./session-reader.js";

export { listModelOptions };

const PHASES = ["poll", "triage", "dispatch", "monitor", "reap"];
const ARTIFACT_FAMILIES = ["artifacts", "oracle", "titan", "sentinel", "janus", "policy", "transcripts"];
const ARTIFACTS_PER_FAMILY = 20;
const ARTIFACT_BODY_CHARS = 4_000;
const LOOP_EVENT_FILES = 120;
const SESSION_PHASE_FILES = 240;
const GIT_BRANCH_TTL_MS = 5_000;

const directoryCache = new Map();
const branchCache = new Map();

/** Sorted `.json` entries of a directory, re-listed only when the directory changes. */
export function listJsonFiles(directory) {
  let stats;
  try {
    stats = statSync(directory);
  } catch {
    return [];
  }
  const cached = directoryCache.get(directory);
  if (cached && cached.mtimeMs === stats.mtimeMs) return cached.files;
  const files = readdirSync(directory).filter((entry) => entry.endsWith(".json")).sort();
  directoryCache.set(directory, { mtimeMs: stats.mtimeMs, files });
  return files;
}

function normalizeConfigForOlympus(config) {
  if (!config || typeof config !== "object") return config;
  if (LIVE_ADAPTERS.includes(config.runtime)) return config;
  return {
    ...config,
    runtime: "",
    models: Object.fromEntries(CASTES.map((caste) => [caste, ""])),
  };
}

function readAgoraTickets(root) {
  const snapshot = readJson(path.join(root, ".agora", "tickets.json"), null);
  const records = snapshot?.tickets && typeof snapshot.tickets === "object" ? Object.values(snapshot.tickets) : [];
  return records
    .filter((ticket) => ticket && typeof ticket === "object")
    .map((ticket) => ({
      id: ticket.id,
      title: ticket.title,
      body: ticket.body ?? "",
      kind: ticket.kind ?? "task",
      column: ticket.column ?? "backlog",
      sprint: ticket.sprint ?? null,
      phase: ticket.phase ?? null,
      parent: ticket.parent ?? null,
      children: ticket.children ?? [],
      blockedBy: ticket.blockedBy ?? [],
      blocks: ticket.blocks ?? [],
      scope: ticket.scope ?? [],
      labels: ticket.labels ?? [],
      createdBy: ticket.createdBy ?? "agent",
      createdAt: ticket.createdAt,
      updatedAt: ticket.updatedAt,
      lease: ticket.lease ?? { caste: null, sessionId: null, startedAt: null },
      artifacts: ticket.artifacts ?? {},
      attempts: ticket.attempts ?? { rework: 0, operational: 0, loop: 0 },
      loopSignatures: ticket.loopSignatures ?? [],
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function readDispatchRecords(root) {
  const dispatch = readJson(path.join(root, ".aegis", "dispatch-state.json"), { records: {} });
  return dispatch?.records && typeof dispatch.records === "object" ? Object.values(dispatch.records) : [];
}

function readMergeQueue(root) {
  const merge = readJson(path.join(root, ".aegis", "merge-queue.json"), { items: [] });
  return Array.isArray(merge?.items)
    ? merge.items.map((item) => ({
        id: item.queueItemId ?? item.id ?? item.issueId,
        issue: item.issueId ?? item.issue ?? "",
        state: item.status ?? item.state ?? "queued",
        priority: item.lastTier ?? "queue",
        attempts: item.attempts ?? 0,
        note: item.lastError ?? `${item.candidateBranch ?? "candidate"} -> ${item.targetBranch ?? "target"}`,
      }))
    : [];
}

function newestFiles(directory) {
  return listJsonFiles(directory)
    .map((fileName) => {
      try {
        return { fileName, mtime: statSync(path.join(directory, fileName)).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((left, right) => right.mtime - left.mtime)
    .slice(0, ARTIFACTS_PER_FAMILY);
}

function readArtifacts(root) {
  const artifacts = [];
  for (const family of ARTIFACT_FAMILIES) {
    const directory = path.join(root, ".aegis", family);
    if (!existsSync(directory)) continue;
    for (const { fileName } of newestFiles(directory)) {
      const filePath = path.join(directory, fileName);
      const relativePath = path.relative(root, filePath).replace(/\\/g, "/");
      const parsed = readJson(filePath, null);
      const body = parsed
        ? JSON.stringify(parsed, null, 2).slice(0, ARTIFACT_BODY_CHARS)
        : readText(filePath, ARTIFACT_BODY_CHARS);
      if (body.toLowerCase().includes("scripted")) continue;
      artifacts.push({
        id: relativePath,
        kind: `${family} artifact`,
        path: relativePath,
        owner: parsed?.caste ?? fileName.split("-")[0] ?? "",
        issue: parsed?.issueId ?? issueFromPath(relativePath),
        status: artifactStatus(parsed),
        summary: artifactSummary(parsed, body),
        filesChanged: Array.isArray(parsed?.files_changed) ? parsed.files_changed.length : undefined,
        body,
      });
    }
  }
  return artifacts
    .sort((left, right) => (left.status === "failed" ? -1 : 0) - (right.status === "failed" ? -1 : 0) || String(right.path).localeCompare(String(left.path)))
    .slice(0, 80);
}

function parseJsonBody(body) {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function issueFromPath(value) {
  return String(value ?? "").match(/AG-\d+/)?.[0] ?? "";
}

function artifactStatus(parsed) {
  const value = String(parsed?.outcome ?? parsed?.status ?? parsed?.verdict ?? "").toLowerCase();
  if (["fail_blocking", "blocked", "blocked_on_child"].includes(value)) return "blocked";
  if (["failure", "failed", "error", "rejected"].includes(value)) return "failed";
  if (["success", "succeeded", "pass", "passed", "accepted"].includes(value)) return "succeeded";
  return "ready";
}

function compactText(value) {
  return String(value).replace(/\s+/g, " ").slice(0, 360);
}

function artifactSummary(parsed, body) {
  if (!parsed || typeof parsed !== "object") {
    return extractEventMessage(body) ?? String(body ?? "").split(/\r?\n/).find(Boolean)?.slice(0, 240) ?? "Artifact record";
  }
  const direct = parsed.summary
    ?? parsed.reviewSummary
    ?? parsed.reason
    ?? extractEventMessage(parsed.error)
    ?? parsed.error
    ?? parsed.verdictSummary
    ?? parsed.message;
  if (direct) return compactText(direct);
  const terminalError = Array.isArray(parsed.terminalLog)
    ? parsed.terminalLog.find((line) => String(line).startsWith("[error]"))
    : null;
  if (terminalError) return compactText(String(terminalError).replace(/^\[error\]\s*/, ""));
  const finding = Array.isArray(parsed.blockingFindings) ? parsed.blockingFindings.find(Boolean)?.summary : null;
  if (finding) return compactText(finding);
  const risk = Array.isArray(parsed.known_risks) ? parsed.known_risks.find(Boolean) : null;
  if (risk) return compactText(risk);
  const check = Array.isArray(parsed.checks) ? parsed.checks.find(Boolean) : null;
  if (check) return compactText(check);
  return "Structured artifact available";
}

function extractEventMessage(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  for (const line of text.split(/\r?\n/)) {
    const parsed = parseJsonBody(line);
    const message = parsed?.error?.message ?? parsed?.message;
    if (message) return String(message);
  }
  return null;
}

/** Newest phase log entries, oldest first; shared by loop events and session activity. */
function readRecentPhaseEntries(root, maxEntries) {
  return tailLines(path.join(root, ".aegis", "logs", "phases.jsonl"), maxEntries)
    .map(parseJsonLine)
    .filter((entry) => entry?.phase && entry?.action)
    .sort((left, right) => Date.parse(left.timestamp ?? "") - Date.parse(right.timestamp ?? ""));
}

function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    // The first line of a tail read can be cut mid-entry.
    return null;
  }
}

function buildLoopEvents(phaseEntries) {
  const events = Object.fromEntries(PHASES.map((phase) => [phase, []]));
  for (const entry of phaseEntries.slice(-LOOP_EVENT_FILES)) {
    if (!PHASES.includes(entry.phase)) continue;
    const epoch = entry.timestamp ? Date.parse(entry.timestamp) : 0;
    const time = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString([], { hour12: false }) : "";
    const issueId = entry.issueId && entry.issueId !== "_all" ? entry.issueId : "system";
    const outcome = entry.outcome ? `status=${entry.outcome}` : "";
    const session = entry.sessionId ? `session=${entry.sessionId}` : "";
    const detail = entry.detail ? String(entry.detail) : "";
    events[entry.phase].push([time, entry.action ?? "event", [issueId, outcome, session, detail].filter(Boolean).join("  "), epoch]);
  }
  return events;
}

function latestLoopEvent(loopEvents) {
  return Object.entries(loopEvents)
    .flatMap(([phase, entries]) => entries.map((entry) => ({ phase, entry })))
    .sort((left, right) => Number(left.entry[3] ?? 0) - Number(right.entry[3] ?? 0))
    .at(-1) ?? null;
}

function readBranch(root) {
  const cached = branchCache.get(root);
  if (cached && Date.now() - cached.at < GIT_BRANCH_TTL_MS) return cached.value;
  let value = "";
  try {
    value = execFileSync("git", ["branch", "--show-current"], { cwd: root, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    value = "";
  }
  branchCache.set(root, { at: Date.now(), value });
  return value;
}

function readDaemon(root, config, loopEvents) {
  const runtime = readJson(path.join(root, ".aegis", "runtime-state.json"), null);
  const status = runtime?.server_state ?? "stopped";
  const latest = latestLoopEvent(loopEvents);
  const activity = latest ? `${latest.phase}: ${latest.entry[1]}` : (status === "running" ? "waiting for loop event" : "idle");
  return {
    status,
    mode: runtime?.mode ?? "auto",
    pid: status === "running" && runtime?.pid ? String(runtime.pid) : "none",
    phase: latest?.phase ?? "idle",
    activity,
    lastEventAt: latest?.entry?.[0] ?? "",
    startedAt: runtime?.started_at ?? "",
    uptime: status === "running" ? runtime?.started_at ?? "running" : runtime?.stopped_at ?? "not running",
    stopReason: runtime?.last_stop_reason ?? "",
    adapter: config?.runtime || "unconfigured",
    stream: existsSync(path.join(root, ".aegis", "logs", "daemon.log")) ? "connected" : "waiting",
    branch: readBranch(root) || config?.git?.base_branch || "workspace",
  };
}

function buildHealth(root, tickets, mergeQueue, artifacts, agents, records = []) {
  const statePath = path.join(root, ".aegis", "dispatch-state.json");
  const runtimePath = path.join(root, ".aegis", "runtime-state.json");
  const failedRecords = records.filter((record) => String(record?.stage ?? "").includes("failed"));
  const hasRunArtifacts = existsSync(runtimePath)
    || existsSync(statePath)
    || mergeQueue.length > 0
    || artifacts.length > 0
    || agents.length > 0;
  const emptyStatus = hasRunArtifacts ? "watch" : "idle";
  return [
    ["Tracker", tickets.length ? "pass" : emptyStatus, tickets.length ? `${tickets.length} tickets loaded` : "No tracker work loaded yet"],
    [
      "Dispatch state",
      failedRecords.length ? "watch" : (existsSync(statePath) ? "pass" : emptyStatus),
      failedRecords.length
        ? `${failedRecords.length} issue${failedRecords.length === 1 ? "" : "s"} need operational attention`
        : (existsSync(statePath) ? `last write ${statSync(statePath).mtime.toLocaleString()}` : "Created when dispatch starts"),
    ],
    ["Merge queue", mergeQueue.some((item) => item.state === "failed") ? "watch" : (mergeQueue.length ? "pass" : "idle"), mergeQueue.length ? `${mergeQueue.length} queue records` : "No merge records yet"],
    ["Artifacts", artifacts.length ? "pass" : emptyStatus, artifacts.length ? `${artifacts.length} artifact records` : "No artifacts written yet"],
    ["Sessions", agents.length ? "pass" : emptyStatus, agents.length ? `${agents.length} persisted session transcripts` : "No session transcripts yet"],
  ];
}

// Matches the Agora tracker adapter: coordination tickets group work but are never dispatched.
function isExecutableTicket(ticket) {
  return !ticket.labels.includes("role:coordination");
}

function buildRunSummary(allTickets, daemon, workspace, agents) {
  const tickets = allTickets.filter(isExecutableTicket);
  const total = tickets.length;
  const done = tickets.filter((ticket) => ticket.column === "done").length;
  const halted = tickets.filter((ticket) => ticket.column === "halted").length;
  const active = tickets.filter((ticket) => ["ready", "in_progress", "in_review", "blocked", "ready_to_merge"].includes(ticket.column)).length;
  const costUsd = agents.reduce((sum, agent) => sum + (Number(agent.usage?.costUsd) || 0), 0);
  return {
    total,
    done,
    halted,
    active,
    complete: total > 0 && done === total && halted === 0 && active === 0,
    running: daemon.status === "running",
    costUsd: Number(costUsd.toFixed(4)),
    workspace,
  };
}

/** One consistent snapshot of every Aegis truth plane for the operator console. */
export async function readOlympusState(root, workspace = { root: "", seeded: false }) {
  const config = normalizeConfigForOlympus(readJson(path.join(root, ".aegis", "config.json"), null));
  const tickets = readAgoraTickets(root);
  const dispatchRecords = readDispatchRecords(root);
  const mergeQueue = readMergeQueue(root);
  const artifacts = readArtifacts(root);
  const phaseEntries = readRecentPhaseEntries(root, SESSION_PHASE_FILES);
  const runtime = config?.runtime || LIVE_ADAPTERS[0];
  const agents = readSessions(root, dispatchRecords, phaseEntries, { runtime, models: config?.models ?? {} });
  const daemonLogs = tailLines(path.join(root, ".aegis", "logs", "daemon.log"))
    .filter((line) => !line.toLowerCase().includes("scripted"));
  const loopEvents = buildLoopEvents(phaseEntries);
  const daemon = readDaemon(root, config, loopEvents);
  return {
    generatedAt: new Date().toISOString(),
    workspace,
    daemon,
    runSummary: buildRunSummary(tickets, daemon, workspace, agents),
    adapterOptions: LIVE_ADAPTERS,
    modelOptions: { [runtime]: await listModelOptions(root, runtime) },
    ...(config ? { config: flattenConfig(config), configFilePresent: true } : { configFilePresent: false }),
    tickets,
    dispatchRecords,
    mergeQueue,
    artifacts,
    agents,
    logs: daemonLogs,
    loopEvents,
    healthChecks: buildHealth(root, tickets, mergeQueue, artifacts, agents, dispatchRecords),
  };
}
