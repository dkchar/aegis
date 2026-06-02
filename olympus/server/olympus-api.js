import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const CASTES = ["oracle", "titan", "sentinel", "janus"];
const COLUMNS = ["backlog", "ready", "in_progress", "in_review", "blocked", "ready_to_merge", "done", "halted"];
const PHASES = ["poll", "triage", "dispatch", "monitor", "reap"];
const REAL_ADAPTERS = ["codex", "pi"];
const MAX_LOG_LINES = 180;
const START_TIMEOUT_MS = 10_000;
const START_POLL_MS = 100;
const DEFAULT_WORKSPACE = { root: "", seeded: false };
const OLYMPUS_STATE_FILE = path.join(".aegis", "olympus-state.json");

function readJson(filePath, fallback = null) {
  if (!existsSync(filePath)) return fallback;
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(tempPath, filePath);
}

function readPersistedOlympusRoot(projectRoot) {
  const state = readJson(path.join(projectRoot, OLYMPUS_STATE_FILE), null);
  return typeof state?.activeRoot === "string" && state.activeRoot
    ? state.activeRoot
    : projectRoot;
}

function persistOlympusRoot(projectRoot, activeRoot) {
  writeJsonAtomic(path.join(projectRoot, OLYMPUS_STATE_FILE), {
    activeRoot,
    updatedAt: new Date().toISOString(),
  });
}

function tailLines(filePath, maxLines = MAX_LOG_LINES) {
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .slice(-maxLines);
}

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

function unflattenConfig(flat) {
  const numberValue = (key) => Number(flat[key]);
  const booleanValue = (key) => String(flat[key]) === "true";
  return {
    runtime: String(flat.runtime ?? ""),
    models: Object.fromEntries(CASTES.map((caste) => [caste, String(flat[`models.${caste}`] ?? "")])),
    thinking: Object.fromEntries(CASTES.map((caste) => [caste, String(flat[`thinking.${caste}`] ?? "medium")])),
    concurrency: {
      max_agents: numberValue("concurrency.max_agents"),
      max_oracles: numberValue("concurrency.max_oracles"),
      max_titans: numberValue("concurrency.max_titans"),
      max_sentinels: numberValue("concurrency.max_sentinels"),
      max_janus: numberValue("concurrency.max_janus"),
    },
    thresholds: {
      poll_interval_seconds: numberValue("thresholds.poll_interval_seconds"),
      stuck_warning_seconds: numberValue("thresholds.stuck_warning_seconds"),
      stuck_kill_seconds: numberValue("thresholds.stuck_kill_seconds"),
      allow_complex_auto_dispatch: booleanValue("thresholds.allow_complex_auto_dispatch"),
      scope_overlap_threshold: numberValue("thresholds.scope_overlap_threshold"),
      janus_retry_threshold: numberValue("thresholds.janus_retry_threshold"),
    },
    janus: {
      enabled: booleanValue("janus.enabled"),
      max_invocations_per_issue: numberValue("janus.max_invocations_per_issue"),
    },
    labor: {
      base_path: String(flat["labor.base_path"] ?? ""),
    },
    git: {
      base_branch: String(flat["git.base_branch"] ?? ""),
    },
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

function nodeCommand() {
  return process.execPath;
}

function quotePowerShellString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function buildWindowsBackgroundLaunchScript(command, args, cwd) {
  const quotedArgs = args.map((arg) => quotePowerShellString(arg)).join(", ");

  return [
    `$proc = Start-Process -FilePath ${quotePowerShellString(command)}`,
    `-ArgumentList @(${quotedArgs})`,
    `-WorkingDirectory ${quotePowerShellString(cwd)}`,
    "-WindowStyle Hidden",
    "-PassThru;",
    "[Console]::Out.Write($proc.Id)",
  ].join(" ");
}

function spawnBackground(command, args, cwd, env = {}) {
  if (process.platform === "win32") {
    const launcherOutput = execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        buildWindowsBackgroundLaunchScript(command, args, cwd),
      ],
      {
        cwd,
        env: childEnv(env),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    const daemonPid = Number(String(launcherOutput).trim());
    if (!Number.isInteger(daemonPid) || daemonPid <= 0) {
      throw new Error("Failed to determine Aegis daemon pid.");
    }
    return daemonPid;
  }

  const child = spawn(command, args, {
    cwd,
    env: childEnv(env),
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  if (typeof child.pid !== "number") {
    throw new Error("Failed to determine Aegis daemon pid.");
  }
  child.unref();
  return child.pid;
}

async function sleep(milliseconds) {
  await new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function waitForDaemonStart(root, expectedPid, timeoutMs = START_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const runtime = readJson(path.join(root, ".aegis", "runtime-state.json"), null);
    if (runtime?.server_state === "running" && Number(runtime.pid) === expectedPid) {
      return runtime;
    }
    await sleep(START_POLL_MS);
  }
  throw new Error(`Timed out waiting for Aegis daemon start after ${timeoutMs}ms`);
}

function childEnv(extra = {}) {
  return Object.fromEntries(
    Object.entries({ ...process.env, ...extra }).filter(([key, value]) => value !== undefined && !key.startsWith("=")),
  );
}

function runNode(root, args, env = {}) {
  return execFileSync(nodeCommand(), args, {
    cwd: root,
    env: childEnv(env),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  }).trim();
}

function chooseWorkspaceDirectory(initialRoot) {
  if (process.platform === "win32") {
    const script = [
      "Add-Type -AssemblyName System.Windows.Forms;",
      "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog;",
      "$dialog.Description = 'Select an initialized Aegis workspace';",
      `$dialog.SelectedPath = ${quotePowerShellString(initialRoot)};`,
      "$dialog.ShowNewFolderButton = $false;",
      "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.SelectedPath) }",
    ].join(" ");
    return execFileSync(
      "powershell",
      ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-Command", script],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: false },
    ).trim();
  }

  if (process.platform === "darwin") {
    return execFileSync(
      "osascript",
      ["-e", `POSIX path of (choose folder with prompt "Select an initialized Aegis workspace" default location POSIX file ${JSON.stringify(initialRoot)})`],
      { encoding: "utf8" },
    ).trim();
  }

  throw new Error("Native workspace picker is not available on this platform. Enter the workspace path manually.");
}

function openWorkspaceDirectory(root) {
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error("Workspace does not exist or is not a directory.");
  }

  const command =
    process.platform === "win32"
      ? "explorer.exe"
      : process.platform === "darwin"
        ? "open"
        : "xdg-open";
  const child = spawn(command, [root], {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  child.unref();
}

function runTsc(root, tsconfig) {
  return runNode(root, [path.join(root, "node_modules", "typescript", "bin", "tsc"), "--project", tsconfig]);
}

function buildProject(root) {
  rmSync(path.join(root, "packages", "agora", "dist"), { recursive: true, force: true });
  runTsc(root, path.join(root, "packages", "agora", "tsconfig.json"));
  rmSync(path.join(root, "dist"), { recursive: true, force: true });
  runTsc(root, path.join(root, "tsconfig.json"));
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
  const ticketsPath = path.join(root, ".agora", "tickets.json");
  const snapshot = readJson(ticketsPath, null);
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
      if (body.toLowerCase().includes("scripted")) {
        continue;
      }
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
    const message = [issueId, outcome, session, detail].filter(Boolean).join("  ");
    events[entry.phase].push([time, entry.action ?? "event", message, epoch]);
  }
  return events;
}

function readRecentPhaseEntries(root, maxEntries = 240) {
  const phaseDir = path.join(root, ".aegis", "logs", "phases");
  if (!existsSync(phaseDir)) return [];
  return readdirSync(phaseDir)
    .filter((entry) => entry.endsWith(".json"))
    .sort()
    .slice(-maxEntries)
    .map((fileName) => ({ fileName, entry: readJson(path.join(phaseDir, fileName), null) }))
    .filter(({ entry }) => entry?.phase && entry?.action)
    .sort((left, right) => Date.parse(left.entry.timestamp ?? "") - Date.parse(right.entry.timestamp ?? ""));
}

function phaseEntryMatchesSession(entry, session) {
  if (!entry || !session?.id) return false;
  const issue = String(session.issue ?? "");
  const detail = String(entry.detail ?? "");
  return entry.sessionId === session.id
    || (issue && entry.issueId === issue)
    || detail.includes(session.id)
    || (issue && detail.includes(issue));
}

function formatSessionPhaseLine(entry) {
  const time = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString([], { hour12: false }) : "";
  return [
    `[phase] ${time}`,
    entry.phase,
    entry.action,
    `status=${entry.outcome}`,
    entry.issueId && entry.issueId !== "_all" ? `issue=${entry.issueId}` : "",
    entry.sessionId ? `session=${entry.sessionId}` : "",
    entry.detail ? `detail=${summarizeBlock(entry.detail)}` : "",
  ].filter(Boolean).join(" ");
}

function readSessionActivityLines(root, session, maxLines = 80) {
  const lines = [];
  const streamLog = tailLines(path.join(root, ".aegis", "logs", "session-streams", `${session.id}.log`), maxLines);
  if (streamLog.length > 0) {
    lines.push(...streamLog);
  }

  const report = readJson(path.join(root, ".aegis", "logs", "sessions", `${session.id}.json`), null);

  if (report?.status) {
    lines.push(`[session] status=${report.status}`);
  }
  if (report?.finishedAt) {
    lines.push(`[session] finished=${report.finishedAt}`);
  }
  if (report?.error) {
    lines.push(`[error] ${summarizeBlock(report.error)}`);
  }

  for (const { entry } of readRecentPhaseEntries(root)) {
    if (phaseEntryMatchesSession(entry, session)) {
      lines.push(formatSessionPhaseLine(entry));
    }
  }

  const daemonNeedles = [session.id, session.issue].filter(Boolean).map((value) => String(value).toLowerCase());
  if (daemonNeedles.length > 0) {
    for (const line of tailLines(path.join(root, ".aegis", "logs", "daemon.log"), 240)) {
      const lower = line.toLowerCase();
      if (daemonNeedles.some((needle) => lower.includes(needle))) {
        lines.push(`[daemon] ${line}`);
      }
    }
  }

  return dedupeLines(lines).slice(-maxLines);
}

function latestLoopEvent(loopEvents) {
  if (!loopEvents) return null;
  return Object.entries(loopEvents)
    .flatMap(([phase, entries]) => entries.map((entry) => ({ phase, entry })))
    .filter((item) => Array.isArray(item.entry))
    .sort((left, right) => Number(left.entry[3] ?? 0) - Number(right.entry[3] ?? 0))
    .at(-1) ?? null;
}

function readSessionTranscripts(root) {
  const transcriptDir = path.join(root, ".aegis", "transcripts");
  if (!existsSync(transcriptDir)) return new Map();
  const transcripts = new Map();
  for (const fileName of readdirSync(transcriptDir).filter((entry) => entry.endsWith(".json"))) {
    const transcript = readJson(path.join(transcriptDir, fileName), null);
    if (!transcript?.sessionId) continue;
    if (transcript.provider === "scripted" || String(transcript.modelRef ?? "").startsWith("scripted:")) continue;
    transcripts.set(transcript.sessionId, {
      ...transcript,
      transcriptPath: path.join(".aegis", "transcripts", fileName).replace(/\\/g, "/"),
    });
  }
  return transcripts;
}

function linesFromTranscript(transcript, context = {}) {
  const lines = [
    `$ aegis session inspect ${transcript.sessionId}`,
    `# provider ${transcript.provider ?? "adapter"}`,
    `# model ${transcript.modelRef ?? transcript.modelId ?? "unknown"}`,
    `# thinking ${transcript.thinkingLevel ?? "unknown"}`,
    `# workingDirectory ${transcript.workingDirectory ?? "workspace"}`,
  ];

  if (Array.isArray(transcript?.terminalLog) && transcript.terminalLog.length > 0) {
    let inFinalBlock = false;
    let capturedFinalBlock = false;
    for (const line of transcript.terminalLog) {
      const rawLine = String(line ?? "").trimEnd();
      if (rawLine.trim() === "[final]") {
        inFinalBlock = true;
        capturedFinalBlock = false;
        continue;
      }
      if (inFinalBlock && !/^\s*(\[|\$|#)/.test(rawLine)) {
        if (!capturedFinalBlock) {
          lines.push(...formatFinalOutput(transcript.outputText || rawLine));
          capturedFinalBlock = true;
        }
        continue;
      }
      inFinalBlock = false;
      const formatted = formatTranscriptLine(line);
      if (Array.isArray(formatted)) lines.push(...formatted);
      else if (formatted) lines.push(formatted);
    }
  }

  for (const message of transcript.messageLog ?? []) {
    const role = message.role ?? "message";
    const content = String(message.content ?? "");
    if (role === "user" && content.includes("You are a dispatched Aegis caste subagent")) {
      continue;
    }
    const parsedContent = parseJsonBody(content);
    if (parsedContent) {
      if (role !== "assistant") lines.push(`[${role}] ${summarizeBlock(content)}`);
      continue;
    }
    const summary = summarizeBlock(content);
    if (summary) lines.push(`[${role}] ${summary}`);
  }
  if (transcript.outputText) {
    lines.push(...formatFinalOutput(transcript.outputText));
  }
  const error = context.error ?? transcript.error;
  if (error) {
    lines.push(`[error] ${summarizeBlock(error)}`);
  }
  return dedupeLines(lines);
}

function dedupeLines(lines) {
  const seen = new Set();
  return lines.filter((line) => {
    if (seen.has(line)) return false;
    seen.add(line);
    return true;
  });
}

function formatTranscriptLine(line) {
  const value = String(line ?? "").trimEnd();
  if (!value) return "";
  if (/^\[codex\]\s+(thread|turn|item)\./i.test(value)) return "";
  if (/^\[status\]\s+(item|turn)\.completed/i.test(value)) return "";
  if (value.includes("[final] {") || value.includes('{"files_affected"')) return ["[final] structured output captured"];
  if (value.startsWith("[final]")) return formatFinalOutput(value.replace(/^\[final\]\s*/, ""));
  if (value.trimStart().startsWith("{")) return formatFinalOutput(value);
  return value.length > 420 ? `${value.slice(0, 417)}...` : value;
}

function formatFinalOutput(outputText) {
  const text = String(outputText ?? "").trim().replace(/^\[final\]\s*/, "");
  if (!text) return [];
  const parsed = parseJsonBody(text);
  if (!parsed) return text.startsWith("{") || text.includes('{"files_affected"') ? ["[final] structured output captured"] : [`[final] ${summarizeBlock(text)}`];
  const lines = [];
  const outcome = parsed.outcome ?? parsed.status ?? parsed.verdict;
  if (outcome) lines.push(`[final] ${parsed.verdict ? "verdict" : "outcome"}=${outcome}`);
  if (parsed.summary) lines.push(`[summary] ${summarizeBlock(parsed.summary)}`);
  if (parsed.reviewSummary) lines.push(`[review] ${summarizeBlock(parsed.reviewSummary)}`);
  if (Array.isArray(parsed.blockingFindings)) {
    for (const finding of parsed.blockingFindings.slice(0, 3)) {
      lines.push(`[finding] ${summarizeBlock(formatFinding(finding))}`);
    }
  }
  if (Array.isArray(parsed.files_changed)) lines.push(`[files] changed=${parsed.files_changed.length}`);
  if (Array.isArray(parsed.files_affected)) lines.push(`[files] affected=${parsed.files_affected.length}`);
  if (parsed.estimated_complexity) lines.push(`[scope] complexity=${parsed.estimated_complexity}`);
  if (Array.isArray(parsed.checks) && parsed.checks.length) lines.push(`[checks] ${summarizeBlock(parsed.checks.join("; "))}`);
  if (Array.isArray(parsed.suggested_checks) && parsed.suggested_checks.length) lines.push(`[checks] ${summarizeBlock(parsed.suggested_checks.join("; "))}`);
  if (Array.isArray(parsed.known_risks) && parsed.known_risks.length) lines.push(`[risks] ${summarizeBlock(parsed.known_risks.join("; "))}`);
  if (Array.isArray(parsed.risks) && parsed.risks.length) lines.push(`[risks] ${summarizeBlock(parsed.risks.join("; "))}`);
  if (parsed.mutation_proposal) lines.push(`[proposal] ${summarizeBlock(formatValue(parsed.mutation_proposal))}`);
  return lines.length ? lines : [`[final] ${summarizeBlock(text)}`];
}

function summarizeBlock(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 520);
}

function formatValue(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatFinding(finding) {
  if (!finding || typeof finding !== "object") return finding;
  return [
    finding.finding_kind,
    finding.route,
    finding.owner_issue,
    finding.summary,
  ].filter(Boolean).join(" - ");
}

function transcriptControlStatus(transcript) {
  const parsed = parseJsonBody(transcript?.outputText ?? "");
  const value = String(parsed?.outcome ?? parsed?.status ?? parsed?.verdict ?? "").toLowerCase();
  if (["fail_blocking", "blocked", "blocked_on_child"].includes(value)) return "blocked";
  if (["failure", "failed", "error", "rejected"].includes(value)) return "failed";
  if (["success", "succeeded", "pass", "passed", "accepted"].includes(value)) return "succeeded";
  return "";
}

function sessionFromTranscript(transcript, existing = null) {
  const controlStatus = transcriptControlStatus(transcript);
  const status = existing?.status === "failed" || transcript.status === "failed" || controlStatus === "failed"
    ? "failed"
    : controlStatus || transcript.status || existing?.status || "unknown";
  const error = existing?.error ?? transcript.error ?? "";
  return {
    id: transcript.sessionId,
    caste: transcript.caste ? transcript.caste.replace(/^\w/, (letter) => letter.toUpperCase()) : existing?.caste ?? "Agent",
    issue: transcript.issueId ?? existing?.issue ?? "unbound",
    stage: transcript.action ?? existing?.stage ?? "session",
    status,
    adapter: transcript.provider ?? existing?.adapter ?? "adapter",
    cwd: transcript.workingDirectory ?? existing?.cwd ?? "workspace",
    activity: transcript.transcriptPath ?? existing?.activity ?? "transcript",
    error,
    lines: linesFromTranscript(transcript, { error }),
  };
}

function readSessions(root, records) {
  const sessionsById = new Map();
  const transcriptsBySessionId = readSessionTranscripts(root);
  const failureByTranscript = new Map();
  for (const record of records) {
    if (record?.stage !== "failed_operational" || !record.failureTranscriptRef) continue;
    failureByTranscript.set(normalizeRef(record.failureTranscriptRef), record);
  }
  for (const record of records) {
    if (!record?.runningAgent?.sessionId) continue;
    const sessionId = record.runningAgent.sessionId;
    const transcript = transcriptsBySessionId.get(sessionId);
    const session = {
      id: sessionId,
      caste: record.runningAgent.caste?.replace(/^\w/, (letter) => letter.toUpperCase()) ?? "Agent",
      issue: record.issueId,
      stage: record.stage,
      status: "running",
      adapter: "adapter",
      cwd: record.fileScope?.files?.join(", ") || "workspace",
      activity: record.updatedAt ? `state updated ${record.updatedAt}` : "state active",
      lines: [],
    };
    const liveLines = readSessionActivityLines(root, session);
    session.lines = [
        `$ aegis session inspect ${sessionId}`,
        `[adapter] ${record.runningAgent.caste ?? "agent"}`,
        `[issue] ${record.issueId}`,
        `[stage] ${record.stage}`,
        `[status] running`,
        ...(liveLines.length ? liveLines : ["[stream] waiting for durable session events"]),
      ];
    sessionsById.set(sessionId, transcript ? sessionFromTranscript(transcript, session) : session);
  }

  const sessionDir = path.join(root, ".aegis", "logs", "sessions");
  if (existsSync(sessionDir)) {
    for (const fileName of readdirSync(sessionDir).filter((entry) => entry.endsWith(".json"))) {
      const report = readJson(path.join(sessionDir, fileName), null);
      if (!report?.sessionId) continue;
      const existing = sessionsById.get(report.sessionId);
      const transcript = transcriptsBySessionId.get(report.sessionId);
      const reportStatus = report.status === "failed" || existing?.status === "failed" ? "failed" : report.status ?? existing?.status ?? "unknown";
      const reportError = report.error ?? existing?.error ?? "";
      if (!existing && !transcript && !report.issueId && !report.caste) {
        continue;
      }
      const reported = {
        ...(existing ?? {
          id: report.sessionId,
          caste: "Agent",
          issue: "unbound",
          stage: "session",
          adapter: "adapter",
          cwd: "workspace",
          activity: "session report available",
          lines: [`$ aegis session inspect ${report.sessionId}`],
        }),
        status: reportStatus,
        error: reportError,
        activity: reportError || report.finishedAt || existing?.activity || "session report available",
      };
      const liveLines = readSessionActivityLines(root, reported);
      reported.lines = dedupeLines([
          ...(existing?.lines ?? [`$ aegis session inspect ${report.sessionId}`]),
          ...liveLines,
          `[status] ${reportStatus}`,
          ...(report.finishedAt ? [`[finished] ${report.finishedAt}`] : []),
          ...(reportError ? [`[error] ${summarizeBlock(reportError)}`] : []),
        ]);
      sessionsById.set(report.sessionId, transcript ? sessionFromTranscript(transcript, reported) : reported);
    }
  }

  for (const [sessionId, transcript] of transcriptsBySessionId) {
    const failure = failureByTranscript.get(normalizeRef(transcript.transcriptPath));
    if (failure) {
      const existing = sessionsById.get(sessionId);
      sessionsById.set(sessionId, sessionFromTranscript(transcript, {
        ...existing,
        id: sessionId,
        issue: failure.issueId ?? existing?.issue,
        stage: failure.stage ?? existing?.stage,
        status: "failed",
        error: failure.operationalFailureKind ?? existing?.error ?? "operational failure",
        activity: failure.failureTranscriptRef ?? existing?.activity,
      }));
    } else if (!sessionsById.has(sessionId)) {
      sessionsById.set(sessionId, sessionFromTranscript(transcript));
    }
  }

  return [...sessionsById.values()].sort((left, right) =>
    String(left.issue).localeCompare(String(right.issue))
    || String(left.caste).localeCompare(String(right.caste))
    || String(left.id).localeCompare(String(right.id)));
}

function normalizeRef(value) {
  return String(value ?? "").replace(/\\/g, "/");
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
  };
}

async function listModelOptions(root, adapter) {
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

async function readOlympusState(root, workspace = DEFAULT_WORKSPACE) {
  const configPath = path.join(root, ".aegis", "config.json");
  const config = normalizeConfigForOlympus(readJson(configPath, null));
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
  const modelOptions = runtime ? {
    [runtime]: await listModelOptions(root, runtime),
  } : {};

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

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function writeConfig(root, req, res) {
  const body = await readRequestBody(req);
  const payload = JSON.parse(body || "{}");
  const config = unflattenConfig(payload.config ?? {});
  await writeJsonAtomic(path.join(root, ".aegis", "config.json"), config);
  sendJson(res, 200, { ok: true, config: flattenConfig(config) });
}

async function handleWorkspaceSwitch(projectRoot, runtimeState, req, res) {
  const body = await readRequestBody(req);
  const payload = JSON.parse(body || "{}");
  const requestedRoot = String(payload.root ?? "").trim();
  const nextRoot = requestedRoot ? path.resolve(requestedRoot) : projectRoot;

  if (!existsSync(nextRoot)) {
    sendJson(res, 404, { error: `Workspace does not exist: ${nextRoot}` });
    return;
  }

  runtimeState.activeRoot = nextRoot;
  persistOlympusRoot(projectRoot, nextRoot);
  sendJson(res, 200, {
    ok: true,
    message: nextRoot === projectRoot ? "Current project selected" : "Workspace selected",
    state: await readOlympusState(nextRoot, { root: nextRoot, seeded: nextRoot !== projectRoot }),
  });
}

async function handleWorkspaceBrowse(projectRoot, runtimeState, res) {
  const selectedRoot = chooseWorkspaceDirectory(runtimeState.activeRoot || projectRoot);
  if (!selectedRoot) {
    sendJson(res, 200, {
      ok: false,
      message: "Workspace selection cancelled",
      state: await readOlympusState(runtimeState.activeRoot || projectRoot, {
        root: runtimeState.activeRoot || projectRoot,
        seeded: (runtimeState.activeRoot || projectRoot) !== projectRoot,
      }),
    });
    return;
  }

  const nextRoot = path.resolve(selectedRoot);
  if (!existsSync(nextRoot)) {
    sendJson(res, 404, { error: `Workspace does not exist: ${nextRoot}` });
    return;
  }

  runtimeState.activeRoot = nextRoot;
  persistOlympusRoot(projectRoot, nextRoot);
  sendJson(res, 200, {
    ok: true,
    message: "Workspace selected",
    state: await readOlympusState(nextRoot, { root: nextRoot, seeded: nextRoot !== projectRoot }),
  });
}

async function handleWorkspaceOpen(projectRoot, runtimeState, res) {
  const root = runtimeState.activeRoot || projectRoot;
  openWorkspaceDirectory(root);
  sendJson(res, 200, {
    ok: true,
    message: `Opened workspace folder: ${root}`,
    state: await readOlympusState(root, { root, seeded: root !== projectRoot }),
  });
}

function buildAdapterEnv(flatConfig) {
  return Object.fromEntries(
    Object.entries(flatConfig ?? {})
      .filter(([key, value]) => key.startsWith("AEGIS_") && String(value ?? "").trim())
      .map(([key, value]) => [key, String(value)]),
  );
}

function isPreparedWorkspace(root) {
  return Boolean(
    root
      && existsSync(root)
      && existsSync(path.join(root, ".agora", "tickets.json"))
      && existsSync(path.join(root, ".aegis", "config.json")),
  );
}

function isBuiltCli(projectRoot) {
  return existsSync(path.join(projectRoot, "dist", "index.js"));
}

function runtimeStatus(root) {
  return readJson(path.join(root, ".aegis", "runtime-state.json"), null)?.server_state ?? "stopped";
}

async function loadAgoraStore(projectRoot) {
  const entry = path.join(projectRoot, "packages", "agora", "dist", "index.js");
  if (!existsSync(entry)) {
    runTsc(projectRoot, path.join(projectRoot, "packages", "agora", "tsconfig.json"));
  }
  return (await import(pathToFileURL(entry).href)).AgoraStore;
}

function normalizeList(value) {
  return String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function handleTicketCreate(projectRoot, runtimeState, req, res) {
  const body = await readRequestBody(req);
  const payload = JSON.parse(body || "{}");
  const root = runtimeState.activeRoot || projectRoot;
  const draft = payload.ticket ?? {};
  const title = String(draft.title ?? "").trim();
  if (!title) {
    sendJson(res, 400, { error: "Title is required." });
    return;
  }
  if (!existsSync(path.join(root, ".agora", "tickets.json"))) {
    sendJson(res, 409, { error: "Agora is not initialized for the selected workspace." });
    return;
  }
  const AgoraStore = await loadAgoraStore(projectRoot);
  const store = new AgoraStore({ root });
  store.createTicket({
    title,
    body: String(draft.body ?? ""),
    kind: String(draft.kind ?? "task"),
    column: String(draft.column ?? "backlog"),
    sprint: String(draft.sprint ?? "").trim() || null,
    phase: String(draft.phase ?? "").trim() || null,
    parent: String(draft.parent ?? "").trim() || null,
    scope: normalizeList(draft.scope),
    labels: normalizeList(draft.labels),
    blockedBy: normalizeList(draft.blockedBy),
    actor: String(draft.actor ?? draft.createdBy ?? "agent"),
  });
  sendJson(res, 200, {
    ok: true,
    state: await readOlympusState(root, { root, seeded: root !== projectRoot }),
  });
}

async function handleTicketMove(projectRoot, runtimeState, req, res) {
  const body = await readRequestBody(req);
  const payload = JSON.parse(body || "{}");
  const ticketId = String(payload.ticketId ?? "").trim();
  const column = String(payload.column ?? "").trim();
  if (!ticketId) {
    sendJson(res, 400, { error: "Ticket id is required." });
    return;
  }
  if (!COLUMNS.includes(column)) {
    sendJson(res, 400, { error: "Column is invalid." });
    return;
  }

  const root = runtimeState.activeRoot || projectRoot;
  const cliPath = path.join(projectRoot, "packages", "agora", "dist", "cli.js");
  execFileSync(nodeCommand(), [cliPath, "move", ticketId, column, "--reason", "Moved from Olympus.", "--actor", "human", "--force", "--json"], {
    cwd: root,
    env: childEnv(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  sendJson(res, 200, {
    ok: true,
    state: await readOlympusState(root, { root, seeded: root !== projectRoot }),
  });
}

async function handleControl(projectRoot, runtimeState, req, res) {
  const body = await readRequestBody(req);
  const payload = JSON.parse(body || "{}");
  const action = String(payload.action ?? "");
  const config = payload.config ?? {};
  const adapter = String(config.runtime ?? "codex");
  if (!REAL_ADAPTERS.includes(adapter)) {
    sendJson(res, 400, { error: "Select Pi or Codex in Config before using Olympus controls." });
    return;
  }

  if (action === "start") {
    const root = runtimeState.activeRoot || projectRoot;
    if (!isPreparedWorkspace(root)) {
      sendJson(res, 409, { error: "Selected workspace is not initialized. Run terminal commands: npm run build, node dist/index.js init, then add or seed Agora work." });
      return;
    }
    if (!isBuiltCli(projectRoot)) {
      buildProject(projectRoot);
    }
    if (runtimeStatus(root) === "running") {
      sendJson(res, 200, {
        ok: true,
        message: "Aegis is already running",
        state: await readOlympusState(root, { root, seeded: root !== projectRoot }),
      });
      return;
    }
    const daemonPid = spawnBackground(nodeCommand(), [path.join(projectRoot, "dist", "index.js"), "start"], root, buildAdapterEnv(config));
    await waitForDaemonStart(root, daemonPid);
    runtimeState.activeRoot = root;
    persistOlympusRoot(projectRoot, root);
    sendJson(res, 200, {
      ok: true,
      message: "Aegis started",
      state: await readOlympusState(root, { root, seeded: root !== projectRoot }),
    });
    return;
  }

  if (action === "stop") {
    const root = runtimeState.activeRoot || projectRoot;
    if (!isPreparedWorkspace(root)) {
      sendJson(res, 409, { error: "No initialized Aegis workspace is selected." });
      return;
    }
    if (runtimeStatus(root) !== "running") {
      sendJson(res, 200, {
        ok: true,
        message: "No Aegis daemon is running",
        state: await readOlympusState(root, { root, seeded: root !== projectRoot }),
      });
      return;
    }
    runNode(root, [path.join(projectRoot, "dist", "index.js"), "stop"], buildAdapterEnv(config));
    sendJson(res, 200, {
      ok: true,
      message: "Aegis stopped",
      state: await readOlympusState(root, { root, seeded: root !== projectRoot }),
    });
    return;
  }

  sendJson(res, 400, { error: `Unsupported control action: ${action}` });
}

async function sendEvents(getRoot, projectRoot, req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  let closed = false;
  req.on("close", () => {
    closed = true;
  });

  const push = async () => {
    if (closed) return;
    const root = getRoot();
    const payload = await readOlympusState(root, { root, seeded: root !== projectRoot });
    res.write(`event: state\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  await push();
  const timer = setInterval(() => {
    push().catch((error) => {
      res.write(`event: error\n`);
      res.write(`data: ${JSON.stringify({ message: error.message })}\n\n`);
    });
  }, 1500);

  req.on("close", () => clearInterval(timer));
}

export function olympusApiPlugin({ root = process.cwd() } = {}) {
  const projectRoot = path.resolve(root);
  const runtimeState = {
    activeRoot: readPersistedOlympusRoot(projectRoot),
  };
  return {
    name: "aegis-olympus-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        if (!url.pathname.startsWith("/api/olympus")) {
          next();
          return;
        }

        try {
          if (req.method === "GET" && url.pathname === "/api/olympus/state") {
            sendJson(res, 200, await readOlympusState(runtimeState.activeRoot, {
              root: runtimeState.activeRoot,
              seeded: runtimeState.activeRoot !== projectRoot,
            }));
            return;
          }
          if (req.method === "GET" && url.pathname === "/api/olympus/events") {
            await sendEvents(() => runtimeState.activeRoot, projectRoot, req, res);
            return;
          }
          if (req.method === "GET" && url.pathname === "/api/olympus/models") {
            sendJson(res, 200, await listModelOptions(projectRoot, url.searchParams.get("adapter") ?? "pi"));
            return;
          }
          if (req.method === "POST" && url.pathname === "/api/olympus/config") {
            await writeConfig(runtimeState.activeRoot, req, res);
            return;
          }
          if (req.method === "POST" && url.pathname === "/api/olympus/workspace") {
            await handleWorkspaceSwitch(projectRoot, runtimeState, req, res);
            return;
          }
          if (req.method === "POST" && url.pathname === "/api/olympus/workspace/browse") {
            await handleWorkspaceBrowse(projectRoot, runtimeState, res);
            return;
          }
          if (req.method === "POST" && url.pathname === "/api/olympus/workspace/open") {
            await handleWorkspaceOpen(projectRoot, runtimeState, res);
            return;
          }
          if (req.method === "POST" && url.pathname === "/api/olympus/control") {
            await handleControl(projectRoot, runtimeState, req, res);
            return;
          }
          if (req.method === "POST" && url.pathname === "/api/olympus/tickets/move") {
            await handleTicketMove(projectRoot, runtimeState, req, res);
            return;
          }
          if (req.method === "POST" && url.pathname === "/api/olympus/tickets/create") {
            await handleTicketCreate(projectRoot, runtimeState, req, res);
            return;
          }

          sendJson(res, 404, { error: "Unknown Olympus API route." });
        } catch (error) {
          sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
        }
      });
    },
  };
}
