import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const root = process.cwd();

function readOlympusFile(fileName: string): string {
  return readFileSync(path.join(root, "olympus", fileName), "utf8");
}

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? listSourceFiles(entryPath) : [entryPath];
  });
}

describe("Olympus React UI", () => {
  test("ships a Vite React entry without a separate frontend package", () => {
    const index = readOlympusFile("index.html");
    const app = readOlympusFile(path.join("src", "App.jsx"));
    const liveOps = readOlympusFile(path.join("src", "LiveOps.jsx"));
    const ticketBoard = readOlympusFile(path.join("src", "liveOps", "TicketBoard.jsx"));
    const ticketCard = readOlympusFile(path.join("src", "liveOps", "TicketCard.jsx"));
    const ticketForms = readOlympusFile(path.join("src", "liveOps", "TicketForms.jsx"));
    const terminalPane = readOlympusFile(path.join("src", "TerminalPane.jsx"));
    const css = readOlympusFile(path.join("src", "styles.css"));
    const viteConfig = readOlympusFile("vite.config.js");
    const server = readOlympusFile(path.join("server", "olympus-api.js"));
    const stateReader = readOlympusFile(path.join("server", "state-reader.js"));
    const adapters = readOlympusFile(path.join("server", "adapters.js"));
    const configSchema = readOlympusFile(path.join("server", "config-schema.js"));
    const sessionReader = readOlympusFile(path.join("server", "session-reader.js"));
    const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

    expect(index).toContain('<div id="root"></div>');
    expect(index).toContain('<script type="module" src="/src/main.jsx"');
    expect(app).toContain("renderView");
    expect(app).toContain("lazy(() => import");
    expect(app).toContain("<Suspense");
    expect(ticketBoard).toContain("DndContext");
    expect(ticketBoard).toContain("DragOverlay");
    expect(liveOps).toContain("PointerSensor");
    expect(liveOps).toContain("KeyboardSensor");
    expect(ticketBoard).toContain("useDroppable");
    expect(terminalPane).toContain("Terminal");
    expect(ticketCard).toContain("motion.");
    expect(ticketBoard).toContain("AddTicketDialog");
    expect(ticketBoard).toContain("<Dialog open={open}");
    expect(app).toContain("showDialog");
    expect(app).toContain("alert");
    expect(app).not.toContain("className=\"drag-handle\"");
    expect(css).toContain('@import "tailwindcss";');
    expect(liveOps).toContain("CollapsibleSection");
    expect(ticketBoard).toContain("overflow-x-auto");
    expect(ticketCard).toContain("max-w-[calc(100vw-2rem)]");
    expect(ticketForms).toContain("w-full min-w-0");
    expect(css).not.toContain("grid-template-columns:");
    expect(css).not.toContain("grid-auto-flow: column");
    expect(css).not.toContain("max-width:");
    expect(viteConfig).toContain("tailwindcss()");
    expect(viteConfig).toContain("react()");
    expect(viteConfig).toContain("olympusApiPlugin()");
    expect(server).toContain("/api/olympus/state");
    expect(server).toContain("/api/olympus/events");
    expect(server).toContain("/api/olympus/models");
    expect(server).toContain("/api/olympus/workspace");
    expect(server).toContain("/api/olympus/workspace/browse");
    expect(server).toContain("/api/olympus/workspace/open");
    expect(server).toContain("/api/olympus/control");
    expect(server).toContain("handleWorkspaceSwitch");
    expect(server).toContain("chooseWorkspaceDirectory");
    expect(server).toContain("openWorkspaceDirectory");
    expect(server).toContain("FolderBrowserDialog");
    expect(server).toContain("Workspace does not exist");
    expect(stateReader).toContain("readOlympusState");
    expect(adapters).toContain("getProviders");
    expect(adapters).toContain("getModels");
    expect(adapters).toContain("models_cache.json");
    expect(adapters).toContain("claude-opus-5-5");
    expect(configSchema).toContain("unflattenAndValidateConfig");
    expect(server).toContain("unflattenAndValidateConfig");
    expect(sessionReader).toContain("!report.issueId && !report.caste");
    expect(server).toContain("spawnBackground");
    expect(server).toContain("waitForDaemonStart");
    expect(server).not.toContain("src/mock-run/mock-run.ts");
    expect(server).not.toContain("src/mock-run/seed-mock-run.ts");
    expect(packageJson.scripts["olympus:dev"]).toBe("vite --host 127.0.0.1 --port 4173 olympus");
    expect(packageJson.scripts["olympus:build"]).toBe("vite build olympus");
    expect(packageJson.scripts["olympus:check"]).toBe("npm run olympus:build && npm test -- tests/unit/olympus/react-ui.test.ts");
    expect(packageJson.scripts["olympus:preview"]).toBe("vite preview --host 127.0.0.1 --port 4173 olympus");
    expect(packageJson.scripts.start).toBe("node dist/index.js");
    expect(packageJson.scripts["start:aegis"]).toBe("node dist/index.js");
    expect(packageJson.scripts["start:olympus"]).toBe("npm run olympus:dev");
    expect(packageJson.dependencies).toHaveProperty("react");
    expect(packageJson.dependencies).toHaveProperty("@dnd-kit/core");
    expect(packageJson.dependencies).toHaveProperty("@xterm/xterm");
    expect(packageJson.dependencies).not.toHaveProperty("@xyflow/react");
    expect(packageJson.dependencies).not.toHaveProperty("@dagrejs/dagre");
    expect(packageJson.dependencies).toHaveProperty("motion");
    expect(packageJson.devDependencies).toHaveProperty("vite");
    expect(packageJson.devDependencies).toHaveProperty("@vitejs/plugin-react");
    expect(packageJson.devDependencies).toHaveProperty("tailwindcss");
    expect(packageJson.devDependencies).toHaveProperty("@tailwindcss/vite");
  });

  test("covers Aegis truth-plane display surfaces", () => {
    const app = readOlympusFile(path.join("src", "App.jsx"));
    const agentSessions = readOlympusFile(path.join("src", "AgentSessions.jsx"));
    const aether = readOlympusFile(path.join("src", "Aether.jsx"));
    const aetherEngine = readOlympusFile(path.join("src", "aether", "engine.js"));
    const liveOps = readOlympusFile(path.join("src", "LiveOps.jsx"));
    const records = readOlympusFile(path.join("src", "Records.jsx"));
    const shell = readOlympusFile(path.join("src", "Shell.jsx"));
    const logDeck = readOlympusFile(path.join("src", "LogDeck.jsx"));
    const workspacePanel = readOlympusFile(path.join("src", "liveOps", "WorkspacePanel.jsx"));
    const healthPanels = readOlympusFile(path.join("src", "liveOps", "HealthPanels.jsx"));
    const ticketBoard = readOlympusFile(path.join("src", "liveOps", "TicketBoard.jsx"));
    const main = readOlympusFile(path.join("src", "main.jsx"));
    const state = readOlympusFile(path.join("src", "state.js"));
    const uiSurface = `${app}\n${agentSessions}\n${aether}\n${liveOps}\n${records}\n${shell}\n${logDeck}\n${workspacePanel}\n${healthPanels}\n${ticketBoard}`;
    const requiredSurfaces = [
      "Daemon",
      "Agent Sessions",
      "Agora Graph",
      "Dispatch Progress",
      "Merge Queue",
      "Artifacts",
      "Logs",
      "Attention",
      "Run Health",
      "Daemon Events",
      "Terminal",
      "Aether",
      "Signals",
    ];

    for (const surface of requiredSurfaces) {
      expect(uiSurface).toContain(surface);
    }
    expect(app).not.toContain("function Aether");
    expect(app).not.toContain("function AgentSessions");
    expect(main).toContain("@fontsource-variable/geist");
    expect(main).not.toContain("@xyflow");
    expect(main).toContain("TooltipProvider");
    expect(aether).toContain("<canvas");
    expect(aether).toContain('role="img"');
    expect(aether).toContain("prefers-reduced-motion");
    expect(aetherEngine).toContain("requestAnimationFrame");
    expect(aetherEngine).toContain("readPalette");
    expect(app).toContain('addEventListener("events"');
    expect(app).toContain("EventSource");
    expect(logDeck).toContain("Live Terminal Logs");
    expect(workspacePanel).toContain("Workspace");
    expect(workspacePanel).toContain("Browse Folder");
    expect(workspacePanel).toContain("browseOlympusWorkspace");
    expect(workspacePanel).toContain("Open Folder");
    expect(workspacePanel).toContain("openOlympusWorkspaceFolder");
    expect(workspacePanel).toContain("Select Workspace");
    expect(workspacePanel).toContain("Use Current Project");
    expect(workspacePanel).toContain("resolveNextAction");
    expect(app).not.toContain("Operator Queue");
    expect(app).not.toContain("Terminal Command");
    expect(app).not.toContain("Copy Command");
    expect(app).not.toContain("navigator.clipboard.writeText");
    expect(app).not.toContain("node dist/index.js status");
    expect(app).not.toContain("Dry Run");
    expect(app).not.toContain("Pause");
    expect(app).not.toContain("Seeding");
    expect(app).not.toContain("Run seeding");
    expect(app).not.toContain('control("seed")');
    expect(app).not.toMatch(/Seeded|Proof|deterministic|runtime-discovered|hardcoded|Generic|mock/i);
    expect(state).not.toContain("scripted");
    expect(state).not.toContain("setDaemonStatus");
    expect(uiSurface).not.toContain("function DispatchLoop");
    expect(uiSurface).not.toContain("Dead controls");
  });

  test("builds every view on the Olympus design system", () => {
    const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    const sources = listSourceFiles(path.join(root, "olympus", "src"));
    const uiIndex = readOlympusFile(path.join("src", "components", "ui", "index.js"));
    const css = readOlympusFile(path.join("src", "styles.css"));
    const viteConfig = readOlympusFile("vite.config.js");

    for (const file of sources) {
      expect(readFileSync(file, "utf8"), file).not.toContain("@mantine");
    }
    expect(packageJson.dependencies).not.toHaveProperty("@mantine/core");
    expect(packageJson.dependencies).toHaveProperty("radix-ui");
    expect(packageJson.dependencies).toHaveProperty("cmdk");
    expect(packageJson.dependencies).toHaveProperty("class-variance-authority");
    for (const primitive of ["Button", "Badge", "Card", "Dialog", "Select", "Combobox", "Segmented", "Tabs", "Tooltip", "Alert", "Toast", "NumberInput", "Field"]) {
      expect(uiIndex).toContain(primitive);
    }
    expect(css).toContain("@theme inline");
    expect(css).toContain('[data-theme="light"]');
    expect(existsSync(path.join(root, "olympus", "design.html"))).toBe(true);
    expect(viteConfig).toContain("design.html");
    expect(readOlympusFile(path.join("src", "design", "DesignSystem.jsx"))).toContain("Design system");
    expect(packageJson.scripts["olympus:screenshots"]).toBe("node olympus/scripts/screenshots.mjs");
  });

  test("labels dispatch records by what the operator should do next", async () => {
    const model = await import(path.join(root, "olympus", "src", "supervisionModel.js"));
    const base = { issueId: "AG-1", stage: "pending", runningAgent: null, cooldownUntil: null };
    const sentinel = { caste: "sentinel", sessionId: "sentinel-AG-1" };
    const titan = { caste: "titan", sessionId: "titan-AG-1" };
    const now = Date.parse("2026-10-02T12:00:00.000Z");

    expect(model.dispatchStatus(base, now)).toBe("pending");
    expect(model.dispatchStatus({ ...base, stage: "complete", reviewFeedbackRef: "old.json" }, now)).toBe("succeeded");
    expect(model.dispatchStatus({ ...base, stage: "reviewing", runningAgent: sentinel, reviewFeedbackRef: "old.json" }, now)).toBe("running");
    expect(model.dispatchStatus({ ...base, stage: "implementing", runningAgent: titan, reviewFeedbackRef: "verdict.json" }, now)).toBe("reworking");
    expect(model.dispatchStatus({ ...base, stage: "rework_required" }, now)).toBe("reworking");
    expect(model.dispatchStatus({ ...base, stage: "scouted", cooldownUntil: "2026-10-02T12:05:00.000Z" }, now)).toBe("cooldown");
    expect(model.dispatchStatus({ ...base, stage: "scouted", cooldownUntil: "2026-10-02T11:55:00.000Z" }, now)).toBe("active");
    expect(model.dispatchStatus({ ...base, stage: "queued_for_merge" }, now)).toBe("queued");
    expect(model.dispatchStatus({ ...base, stage: "failed_operational", operationalFailureKind: "provider_usage_limit", failureCount: 3 }, now)).toBe("failed");
    expect(model.dispatchNote({ ...base, stage: "failed_operational", operationalFailureKind: "provider_usage_limit", failureCount: 3 }, now)).toBe("Provider usage limit reached - 3 failures");
    expect(model.dispatchStatus({ ...base, stage: "blocked_on_child" }, now)).toBe("blocked");
    expect(model.dispatchRefs({ ...base, oracleAssessmentRef: "a.json", titanHandoffRef: "b.json" })).toEqual(["a.json", "b.json"]);
  });

  test("orders blocked work before ready work in the Agora board", async () => {
    const stateModule = await import(path.join(root, "olympus", "src", "state.js"));

    expect(stateModule.columns.slice(0, 7)).toEqual([
      "backlog",
      "blocked",
      "ready",
      "in_progress",
      "in_review",
      "ready_to_merge",
      "done",
    ]);
  });

  test("merges snapshot and live loop events by log offset", async () => {
    const stateModule = await import(path.join(root, "olympus", "src", "state.js"));
    const entry = (seq: number, action: string) => ({ seq, phase: "dispatch", issueId: "AG-1", action, outcome: "running" });
    const base = { ...stateModule.createOlympusState(), events: [entry(10, "a"), entry(20, "b")] };

    const appended = stateModule.appendLiveEvents(base, { entries: [entry(20, "b"), entry(30, "c")] });
    expect(appended.events.map((event: { seq: number }) => event.seq)).toEqual([10, 20, 30]);

    const hydrated = stateModule.hydrateOlympusState(appended, { events: [entry(5, "early"), entry(30, "c")] });
    expect(hydrated.events.map((event: { seq: number }) => event.seq)).toEqual([5, 10, 20, 30]);

    const switched = stateModule.hydrateOlympusState(hydrated, { workspace: { root: "/other", seeded: true }, events: [entry(7, "other log")] });
    expect(switched.events.map((event: { action: string }) => event.action)).toEqual(["other log"]);

    expect(stateModule.appendLiveEvents(appended, { entries: [] })).toBe(appended);
    expect(stateModule.appendLiveEvents(appended, { entries: [entry(0, "new run")], reset: true }).events).toHaveLength(1);

    const many = Array.from({ length: stateModule.LIVE_EVENT_LIMIT + 5 }, (_, index) => entry(index, "x"));
    const capped = stateModule.mergeLiveEvents([], many);
    expect(capped).toHaveLength(stateModule.LIVE_EVENT_LIMIT);
    expect(capped[0].seq).toBe(5);
  });

  test("keeps config fields and Agora ticket fields editable in source", () => {
    const app = readOlympusFile(path.join("src", "App.jsx"));
    const agentSessions = readOlympusFile(path.join("src", "AgentSessions.jsx"));
    const liveOps = readOlympusFile(path.join("src", "LiveOps.jsx"));
    const ticketForms = readOlympusFile(path.join("src", "liveOps", "TicketForms.jsx"));
    const config = readOlympusFile(path.join("src", "ConfigView.jsx"));
    const setupDialog = readOlympusFile(path.join("src", "SetupDialog.jsx"));
    const state = readOlympusFile(path.join("src", "state.js"));
    const configSettings = [
      "runtime",
      "models.oracle",
      "models.titan",
      "models.sentinel",
      "models.janus",
      "thinking.oracle",
      "thinking.titan",
      "thinking.sentinel",
      "thinking.janus",
      "concurrency.max_agents",
      "concurrency.max_oracles",
      "concurrency.max_titans",
      "concurrency.max_sentinels",
      "concurrency.max_janus",
      "thresholds.poll_interval_seconds",
      "thresholds.stuck_warning_seconds",
      "thresholds.stuck_kill_seconds",
      "thresholds.allow_complex_auto_dispatch",
      "thresholds.scope_overlap_threshold",
      "thresholds.janus_retry_threshold",
      "janus.enabled",
      "janus.max_invocations_per_issue",
      "labor.base_path",
      "git.base_branch",
      "AEGIS_PI_SESSION_TIMEOUT_MS",
      "AEGIS_PI_ORACLE_TIMEOUT_MS",
      "AEGIS_PI_TITAN_TIMEOUT_MS",
      "AEGIS_PI_SENTINEL_TIMEOUT_MS",
      "AEGIS_PI_JANUS_TIMEOUT_MS",
      "AEGIS_PI_TIMEOUT_RETRY_COUNT",
      "AEGIS_PI_TIMEOUT_RETRY_DELAY_MS",
    ];
    const ticketFields = [
      "title",
      "body",
      "kind",
      "column",
      "sprint",
      "phase",
      "parent",
      "scope",
      "labels",
      "blockedBy",
      "createdBy",
    ];

    for (const setting of configSettings) {
      expect(state).toContain(setting);
    }
    for (const field of ticketFields) {
      expect(ticketForms).toContain(`name="${field}"`);
    }
    expect(state).toContain("configMeta");
    expect(config).toContain("ConfigField");
    expect(config).toContain("select");
    expect(config).toContain("NumberInput");
    expect(config).toContain("Select authenticated model");
    expect(setupDialog).toContain("Finish Config");
    expect(setupDialog).toContain("Open Config");
    expect(agentSessions).toContain("Open View");
    expect(state).not.toContain("node dist/index.js status");
    expect(agentSessions).toContain("olympus.selectedSessionId");
    expect(agentSessions).toContain("#agents/");
    expect(ticketForms).toContain("TicketEditor");
    expect(app).toContain("validateTicketDraft");
  });

  test("kanban reducer adds, edits, moves, and expands artifacts immutably", async () => {
    const stateModule = await import(path.join(root, "olympus", "src", "state.js"));
    const baseState = stateModule.createOlympusState();
    const added = stateModule.addTicket(baseState, {
      title: "Wire Olympus controls",
      body: "Create controls for add/edit flow.",
      kind: "feature",
      column: "ready",
      sprint: "sprint-olympus",
      phase: "ui",
      parent: "AG-0101",
      labels: "ui, backend",
      scope: "olympus/src/App.jsx,tests/unit/olympus/react-ui.test.ts",
      blockedBy: "AG-0101",
      actor: "agent",
    });

    expect(added).not.toBe(baseState);
    expect(baseState.tickets.some((ticket: { title: string }) => ticket.title === "Wire Olympus controls")).toBe(false);
    const newTicket = added.tickets.find((ticket: { title: string }) => ticket.title === "Wire Olympus controls");
    expect(newTicket.column).toBe("blocked");
    expect(newTicket.kind).toBe("feature");
    expect(newTicket.scope).toEqual(["olympus/src/App.jsx", "tests/unit/olympus/react-ui.test.ts"]);
    expect(newTicket.labels).toEqual(["ui", "backend"]);
    expect(newTicket.blockedBy).toEqual(["AG-0101"]);
    expect(newTicket.createdBy).toBe("agent");

    const edited = stateModule.updateTicket(added, newTicket.id, { title: "Wire Olympus React controls", blockedBy: "" });
    expect(edited.tickets.find((ticket: { id: string }) => ticket.id === newTicket.id).title).toBe(
      "Wire Olympus React controls",
    );
    expect(edited.tickets.find((ticket: { id: string }) => ticket.id === newTicket.id).blockedBy).toEqual([]);

    const moved = stateModule.moveTicket(edited, newTicket.id, "in_progress");
    expect(moved.tickets.find((ticket: { id: string }) => ticket.id === newTicket.id).column).toBe("in_progress");

    const withArtifact = {
      ...moved,
      artifacts: [{ id: "artifact-1", kind: "Titan handoff", path: ".aegis/titan/AG-1.json", status: "ready", body: "{}" }],
    };
    const artifactId = withArtifact.artifacts[0].id;
    const expanded = stateModule.toggleArtifact(withArtifact, artifactId);
    expect(expanded.expandedArtifactIds).toContain(artifactId);
  });

  test("ticket draft validation returns user-facing errors before adding", async () => {
    const stateModule = await import(path.join(root, "olympus", "src", "state.js"));

    expect(stateModule.validateTicketDraft({ title: "", scope: "src/App.ts" })).toEqual("Title is required.");
    expect(stateModule.validateTicketDraft({ title: "Broken", kind: "wrong", scope: "" })).toEqual("Kind is invalid.");
    expect(stateModule.validateTicketDraft({ title: "Ready", kind: "task", column: "ready", scope: "" })).toBeNull();
  });
});
