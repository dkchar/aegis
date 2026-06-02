import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { readJson, tailLines } from "./io.js";
import { readSessions } from "./session-reader.js";

const CASTES = ["oracle", "titan", "sentinel", "janus"];
const PHASES = ["poll", "triage", "dispatch", "monitor", "reap"];
const REAL_ADAPTERS = ["codex", "pi"];

function flattenConfig(config) {
  if (!config || typeof config !== "object") return null;
  return {
    runtime: config.runtime ?? "",
    "models.oracle": config.models?.oracle ?? "",
    "models.titan": config.models?.titan ?? "",
    "models.sentinel": config.models?.sentinel ?? "",
    "models.janus": config.models?.janus ?? "",
    "thinking.oracle": config.thinking?.oracle ?? "",
    "thinking.titan": config.thinking?.titan ?? "",
    "thinking.sentinel": config.thinking?.sentinel ?? "",
    "thinking.janus": config.thinking?.janus ?? "",
    "concurrency.max_agents": String(config.concurrency?.max_agents ?? ""),
    "concurrency.max_oracles": String(config.concurrency?.max_oracles ?? ""),
    "concurrency.max_titans": String(config.concurrency?.max_titans ?? ""),
    "concurrency.max_sentinels": String(config.concurrency?.max_sentinels ?? ""),
    "concurrency.max_janus": String(config.concurrency?.max_janus ?? ""),
    "thresholds.poll_interval_seconds": String(config.thresholds?.poll_interval_seconds ?? ""),
    "thresholds.stuck_warning_seconds": String(config.thresholds?.stuck_warning_seconds ?? ""),
    "thresholds.stuck_kill_seconds": String(config.thresholds?.stuck_kill_seconds ?? ""),
    "thresholds.allow_complex_auto_dispatch": String(config.thresholds?.allow_complex_auto_dispatch ?? ""),
    "thresholds.scope_overlap_threshold": String(config.thresholds?.scope_overlap_threshold ?? ""),
    "thresholds.janus_retry_threshold": String(config.thresholds?.janus_retry_threshold ?? ""),
    "janus.enabled": String(config.janus?.enabled ?? ""),
    "janus.max_invocations_per_issue": String(config.janus?.max_invocations_per_issue ?? ""),
    "labor.base_path": config.labor?.base_path ?? "",
    "git.base_branch": config.git?.base_branch ?? "",
  };
}

function normalizeConfigForOlympus(config) {
  if (!config || typeof config !== "object") return config;
  if (REAL_ADAPTERS.includes(config.runtime)) return config;
  return {
    ...config,
    runtime: "",
    models: Object.fromEntries(CASTES.map((caste) => [caste, ""])),
  };
}

function detectAdapterOptions(root) {
  const runtimeDir = existsSync(path.join(root, "src", "runtime"))
    ? path.join(root, "src", "runtime")
    : path.join(process.cwd(), "src", "runtime");
  if (!existsSync(runtimeDir)) return [];
  return readdirSync(runtimeDir)
    .map((fileName) => fileName.match(/^(.+)-caste-runtime\.ts$/)?.[1])
    .filter(Boolean)
    .filter((name) => name !== "create" && name !== "scripted")
    .sort();
}

function readCodexModelOptions() {
  const cachePath = path.join(homedir(), ".codex", "models_cache.json");
  const cache = readJson(cachePath, null);
  const models = Array.isArray(cache?.models) ? cache.models : [];
  return models
    .filter((model) => typeof model?.slug === "string" && model.visibility !== "hidden")
    .map((model) => ({
      provider: "openai-codex",
      id: model.slug,
      value: `openai-codex:${model.slug}`,
      label: `Codex / ${model.display_name ?? model.slug}`,
      reasoning: model.default_reasoning_level ?? "medium",
    }))
    .sort((left, right) => {
      const leftMini = /mini|small|spark/i.test(left.id) ? 0 : 1;
      const rightMini = /mini|small|spark/i.test(right.id) ? 0 : 1;
      return leftMini - rightMini || left.label.localeCompare(right.label);
    });
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
        note: item.lastError ?? `${item.candidateBranch ?? "candidate"} -> ${item.targetBranch ?? "target"}`,
      }))
    : [];
}

function readArtifacts(root) {
  const roots = ["artifacts", "oracle", "titan", "sentinel", "janus", "policy", "transcripts"]
    .map((entry) => path.join(root, ".aegis", entry))
    .filter((candidate) => existsSync(candidate));
  if (!roots.length) return [];
  const artifacts = [];
  for (const directory of roots) {
    const kind = path.basename(directory);
    const files = readdirSync(directory)
      .filter((entry) => entry.endsWith(".json"))
      .map((fileName) => ({ fileName, mtime: statSync(path.join(directory, fileName)).mtimeMs }))
      .sort((left, right) => right.mtime - left.mtime)
      .slice(0, 20);
    for (const { fileName } of files) {
      const filePath = path.join(directory, fileName);
      const relativePath = path.relative(root, filePath).replace(/\\/g, "/");
      const rawBody = readFileSync(filePath, "utf8");
      const body = rawBody.slice(0, 4000);
      if (body.toLowerCase().includes("scripted")) continue;
      const parsed = parseJsonBody(rawBody);
      artifacts.push({
        id: relativePath,
        kind: `${kind} artifact`,
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
  if (direct) return String(direct).replace(/\s+/g, " ").slice(0, 360);
  const terminalError = Array.isArray(parsed.terminalLog)
    ? parsed.terminalLog.find((line) => String(line).startsWith("[error]"))
    : null;
  if (terminalError) return String(terminalError).replace(/^\[error\]\s*/, "").replace(/\s+/g, " ").slice(0, 360);
  const finding = Array.isArray(parsed.blockingFindings) ? parsed.blockingFindings.find(Boolean)?.summary : null;
  if (finding) return String(finding).replace(/\s+/g, " ").slice(0, 360);
  const risk = Array.isArray(parsed.known_risks) ? parsed.known_risks.find(Boolean) : null;
  if (risk) return String(risk).replace(/\s+/g, " ").slice(0, 360);
  const check = Array.isArray(parsed.checks) ? parsed.checks.find(Boolean) : null;
  if (check) return String(check).replace(/\s+/g, " ").slice(0, 360);
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

function readLoopEvents(root) {
  const phaseDir = path.join(root, ".aegis", "logs", "phases");
  if (!existsSync(phaseDir)) return null;
  const events = Object.fromEntries(PHASES.map((phase) => [phase, []]));
  for (const fileName of readdirSync(phaseDir).filter((entry) => entry.endsWith(".json")).sort().slice(-120)) {
    const entry = readJson(path.join(phaseDir, fileName), null);
    if (!entry || !PHASES.includes(entry.phase)) continue;
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
  if (!loopEvents) return null;
  return Object.entries(loopEvents)
    .flatMap(([phase, entries]) => entries.map((entry) => ({ phase, entry })))
    .filter((item) => Array.isArray(item.entry))
    .sort((left, right) => Number(left.entry[3] ?? 0) - Number(right.entry[3] ?? 0))
    .at(-1) ?? null;
}

function readDaemon(root, config, loopEvents) {
  const runtime = readJson(path.join(root, ".aegis", "runtime-state.json"), null);
  const branch = execGit(root, ["branch", "--show-current"]) || config?.git?.base_branch || "workspace";
  const status = runtime?.server_state ?? "stopped";
  const latest = latestLoopEvent(loopEvents);
  const activity = latest ? `${latest.phase}: ${latest.entry[1]}` : (status === "running" ? "waiting for loop event" : "idle");
  return {
    status,
    pid: status === "running" && runtime?.pid ? String(runtime.pid) : "none",
    phase: latest?.phase ?? "idle",
    activity,
    lastEventAt: latest?.entry?.[0] ?? "",
    uptime: status === "running" ? runtime?.started_at ?? "running" : runtime?.stopped_at ?? "not running",
    adapter: config?.runtime ?? "unconfigured",
    stream: existsSync(path.join(root, ".aegis", "logs", "daemon.log")) ? "connected" : "waiting",
    branch,
  };
}

function execGit(root, args) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true }).trim();
  } catch {
    return "";
  }
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

function buildRunSummary(tickets, daemon, workspace) {
  const total = tickets.length;
  const done = tickets.filter((ticket) => ticket.column === "done").length;
  const halted = tickets.filter((ticket) => ticket.column === "halted").length;
  const active = tickets.filter((ticket) => ["ready", "in_progress", "in_review", "blocked", "ready_to_merge"].includes(ticket.column)).length;
  return {
    total,
    done,
    halted,
    active,
    complete: total > 0 && done === total && halted === 0 && active === 0,
    running: daemon.status === "running",
    workspace,
  };
}

export async function listModelOptions(root, adapter) {
  if (adapter === "codex") {
    const options = readCodexModelOptions();
    return {
      options,
      providers: options.length ? ["openai-codex"] : [],
      message: options.length ? "" : "Run Codex once so local model availability can be cached.",
    };
  }

  if (adapter !== "pi") {
    return { options: [], providers: [], message: "No authenticated model registry is exposed for this adapter yet." };
  }

  try {
    const { getModels, getProviders } = await import("@mariozechner/pi-ai");
    const providers = getProviders().sort();
    return {
      providers,
      options: providers
        .flatMap((provider) => getModels(provider).map((model) => ({
          provider,
          id: model.id,
          value: `${provider}:${model.id}`,
          label: `${provider} / ${model.name ?? model.id}`,
        })))
        .sort((left, right) => left.label.localeCompare(right.label)),
      message: providers.length ? "" : "No Pi model providers are exposed by the runtime registry.",
    };
  } catch (error) {
    return {
      options: [],
      providers: [],
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function readOlympusState(root, workspace = { root: "", seeded: false }) {
  const config = normalizeConfigForOlympus(readJson(path.join(root, ".aegis", "config.json"), null));
  const tickets = readAgoraTickets(root);
  const dispatchRecords = readDispatchRecords(root);
  const mergeQueue = readMergeQueue(root);
  const artifacts = readArtifacts(root);
  const agents = readSessions(root, dispatchRecords);
  const daemonLogs = tailLines(path.join(root, ".aegis", "logs", "daemon.log"))
    .filter((line) => !line.toLowerCase().includes("scripted"));
  const loopEvents = readLoopEvents(root);
  const adapterOptions = detectAdapterOptions(root);
  const runtime = config?.runtime ?? adapterOptions[0] ?? "pi";
  const modelOptions = runtime ? { [runtime]: await listModelOptions(root, runtime) } : {};
  const daemon = readDaemon(root, config, loopEvents);
  return {
    generatedAt: new Date().toISOString(),
    workspace,
    daemon,
    runSummary: buildRunSummary(tickets, daemon, workspace),
    adapterOptions,
    modelOptions,
    ...(config ? { config: flattenConfig(config), configFilePresent: true } : { configFilePresent: false }),
    tickets,
    dispatchRecords,
    mergeQueue,
    artifacts,
    agents,
    logs: daemonLogs,
    loopEvents: loopEvents ?? Object.fromEntries(PHASES.map((phase) => [phase, []])),
    healthChecks: buildHealth(root, tickets, mergeQueue, artifacts, agents, dispatchRecords),
  };
}
