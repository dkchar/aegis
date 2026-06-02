import { execFileSync, spawn } from "node:child_process";
import { existsSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readJson, readRequestBody, sendJson, writeJsonAtomic } from "./io.js";
import { listModelOptions, readOlympusState } from "./state-reader.js";

const CASTES = ["oracle", "titan", "sentinel", "janus"];
const COLUMNS = ["backlog", "ready", "in_progress", "in_review", "blocked", "ready_to_merge", "done", "halted"];
const REAL_ADAPTERS = ["codex", "pi"];
const START_TIMEOUT_MS = 10_000;
const START_POLL_MS = 100;
const OLYMPUS_STATE_FILE = path.join(".aegis", "olympus-state.json");

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
