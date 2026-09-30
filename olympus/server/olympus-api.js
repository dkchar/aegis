import { execFileSync, spawn } from "node:child_process";
import { existsSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { LIVE_ADAPTERS } from "./adapters.js";
import { flattenConfig, unflattenAndValidateConfig } from "./config-schema.js";
import { readJson, readJsonBody, sendJson, writeJsonAtomic } from "./io.js";
import { listModelOptions, readOlympusState } from "./state-reader.js";

const COLUMNS = ["backlog", "ready", "in_progress", "in_review", "blocked", "ready_to_merge", "done", "halted"];
const START_TIMEOUT_MS = 10_000;
const EVENT_PUSH_MS = 1_500;
const EVENT_HEARTBEAT_MS = 15_000;
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
  const payload = await readJsonBody(req);
  const { config, errors } = unflattenAndValidateConfig(payload.config ?? {});
  if (errors.length > 0) {
    sendJson(res, 400, { error: `Config not saved: ${errors.join(" ")}`, errors });
    return;
  }
  writeJsonAtomic(path.join(root, ".aegis", "config.json"), config);
  sendJson(res, 200, { ok: true, config: flattenConfig(config) });
}

async function handleWorkspaceSwitch(projectRoot, runtimeState, req, res) {
  const payload = await readJsonBody(req);
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
  const payload = await readJsonBody(req);
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
  const payload = await readJsonBody(req);
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
  const payload = await readJsonBody(req);
  const action = String(payload.action ?? "");
  const config = payload.config ?? {};
  const adapter = String(config.runtime ?? "");
  if (!LIVE_ADAPTERS.includes(adapter)) {
    sendJson(res, 400, { error: "Select Claude, Codex, or Pi in Config before using Olympus controls." });
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
  let lastPayload = "";
  let pushing = false;

  // Snapshots are rebuilt every tick but only sent when something changed.
  const push = async () => {
    if (closed || pushing) return;
    pushing = true;
    try {
      const root = getRoot();
      const { generatedAt, ...state } = await readOlympusState(root, { root, seeded: root !== projectRoot });
      const payload = JSON.stringify(state);
      if (payload === lastPayload || closed) return;
      lastPayload = payload;
      res.write("event: state\n");
      res.write(`data: ${JSON.stringify({ ...state, generatedAt })}\n\n`);
    } catch (error) {
      if (!closed) {
        res.write("event: error\n");
        res.write(`data: ${JSON.stringify({ message: error instanceof Error ? error.message : String(error) })}\n\n`);
      }
    } finally {
      pushing = false;
    }
  };

  const timer = setInterval(() => void push(), EVENT_PUSH_MS);
  const heartbeat = setInterval(() => {
    if (!closed) res.write(": keep-alive\n\n");
  }, EVENT_HEARTBEAT_MS);
  req.on("close", () => {
    closed = true;
    clearInterval(timer);
    clearInterval(heartbeat);
  });
  await push();
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
