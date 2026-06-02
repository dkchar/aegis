import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const root = process.cwd();

function readOlympusFile(fileName: string): string {
  return readFileSync(path.join(root, "olympus", fileName), "utf8");
}

describe("Olympus React UI", () => {
  test("ships a Vite React entry without a separate frontend package", () => {
    const index = readOlympusFile("index.html");
    const app = readOlympusFile(path.join("src", "App.jsx"));
    const liveOps = readOlympusFile(path.join("src", "LiveOps.jsx"));
    const terminalPane = readOlympusFile(path.join("src", "TerminalPane.jsx"));
    const css = readOlympusFile(path.join("src", "styles.css"));
    const viteConfig = readOlympusFile("vite.config.js");
    const server = readOlympusFile(path.join("server", "olympus-api.js"));
    const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

    expect(index).toContain('<div id="root"></div>');
    expect(index).toContain('<script type="module" src="/src/main.jsx"');
    expect(app).toContain("renderView");
    expect(app).toContain("lazy(() => import");
    expect(app).toContain("<Suspense");
    expect(liveOps).toContain("DndContext");
    expect(liveOps).toContain("DragOverlay");
    expect(liveOps).toContain("PointerSensor");
    expect(liveOps).toContain("KeyboardSensor");
    expect(liveOps).toContain("useDroppable");
    expect(terminalPane).toContain("Terminal");
    expect(liveOps).toContain("motion.");
    expect(liveOps).toContain("AddTicketDialog");
    expect(liveOps).toContain("<Modal opened={open}");
    expect(app).toContain("showDialog");
    expect(app).toContain("alert");
    expect(app).not.toContain("className=\"drag-handle\"");
    expect(css).toContain('@import "tailwindcss";');
    expect(liveOps).toContain("CompactSummary");
    expect(liveOps).toContain("overflow-x-auto");
    expect(liveOps).toContain("max-w-[calc(100vw-2rem)]");
    expect(liveOps).toContain("w-full min-w-0");
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
    expect(server).toContain("getProviders");
    expect(server).toContain("getModels");
    expect(server).toContain("models_cache.json");
    expect(server).toContain("!report.issueId && !report.caste");
    expect(server).toContain("spawnBackground");
    expect(server).toContain("waitForDaemonStart");
    expect(server).not.toContain("src/mock-run/mock-run.ts");
    expect(server).not.toContain("src/mock-run/seed-mock-run.ts");
    expect(packageJson.scripts["olympus:dev"]).toBe("vite --host 127.0.0.1 --port 4173 olympus");
    expect(packageJson.scripts["olympus:build"]).toBe("vite build olympus");
    expect(packageJson.scripts["olympus:check"]).toBe("npm run olympus:build && npm test -- tests/unit/olympus/react-ui.test.ts");
    expect(packageJson.scripts["olympus:preview"]).toBe("vite preview --host 127.0.0.1 --port 4173 olympus");
    expect(packageJson.scripts.start).toBe("npm run olympus:dev");
    expect(packageJson.scripts["start:aegis"]).toBe("node dist/index.js");
    expect(packageJson.scripts["start:olympus"]).toBe("npm run olympus:dev");
    expect(packageJson.dependencies).toHaveProperty("react");
    expect(packageJson.dependencies).toHaveProperty("@dnd-kit/core");
    expect(packageJson.dependencies).toHaveProperty("@xterm/xterm");
    expect(packageJson.dependencies).toHaveProperty("motion");
    expect(packageJson.devDependencies).toHaveProperty("vite");
    expect(packageJson.devDependencies).toHaveProperty("@vitejs/plugin-react");
    expect(packageJson.devDependencies).toHaveProperty("tailwindcss");
    expect(packageJson.devDependencies).toHaveProperty("@tailwindcss/vite");
  });

  test("covers Aegis truth-plane display surfaces", () => {
    const app = readOlympusFile(path.join("src", "App.jsx"));
    const agentSessions = readOlympusFile(path.join("src", "AgentSessions.jsx"));
    const chronos = readOlympusFile(path.join("src", "Chronos.jsx"));
    const liveOps = readOlympusFile(path.join("src", "LiveOps.jsx"));
    const records = readOlympusFile(path.join("src", "Records.jsx"));
    const shell = readOlympusFile(path.join("src", "Shell.jsx"));
    const logDeck = readOlympusFile(path.join("src", "LogDeck.jsx"));
    const main = readOlympusFile(path.join("src", "main.jsx"));
    const state = readOlympusFile(path.join("src", "state.js"));
    const uiSurface = `${app}\n${agentSessions}\n${chronos}\n${liveOps}\n${records}\n${shell}\n${logDeck}`;
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
      "Chronos",
      "Flight Recorder",
    ];

    for (const surface of requiredSurfaces) {
      expect(uiSurface).toContain(surface);
    }
    expect(app).not.toContain("function Chronos");
    expect(app).not.toContain("function AgentSessions");
    expect(main).toContain('@mantine/core/styles.css');
    expect(main).toContain("MantineProvider");
    expect(chronos).toContain("Timeline");
    expect(chronos).toContain("Tree");
    expect(chronos).toContain("ScrollArea");
    expect(chronos).not.toContain("<svg");
    expect(app).toContain("EventSource");
    expect(logDeck).toContain("Live Terminal Logs");
    expect(liveOps).toContain("Workspace");
    expect(liveOps).toContain("Browse Folder");
    expect(liveOps).toContain("browseOlympusWorkspace");
    expect(liveOps).toContain("Open Folder");
    expect(liveOps).toContain("openOlympusWorkspaceFolder");
    expect(liveOps).toContain("Select Workspace");
    expect(liveOps).toContain("Use Current Project");
    expect(liveOps).toContain("resolveNextAction");
    expect(liveOps).toContain("SupervisionStrip");
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

  test("builds Chronos timeline and merge tree from Aegis truth planes", async () => {
    const stateModule = await import(path.join(root, "olympus", "src", "state.js"));
    const base = stateModule.createOlympusState();
    const state = {
      ...base,
      tickets: [
        {
          id: "AG-1",
          title: "Build core",
          body: "",
          kind: "feature",
          column: "ready_to_merge",
          parent: null,
          children: ["AG-2"],
          blockedBy: [],
          blocks: [],
          scope: ["src/core.ts"],
          updatedAt: "2026-05-26T10:00:00.000Z",
        },
        {
          id: "AG-2",
          title: "Fix gate",
          body: "",
          kind: "blocker",
          column: "blocked",
          parent: "AG-1",
          children: [],
          blockedBy: ["AG-3"],
          blocks: [],
          scope: ["src/gate.ts"],
          updatedAt: "2026-05-26T10:01:00.000Z",
        },
      ],
      dispatchRecords: [
        {
          issueId: "AG-1",
          stage: "queued_for_merge",
          runningAgent: { caste: "Titan", sessionId: "S-1" },
          oracleAssessmentRef: ".aegis/oracle/AG-1.json",
          titanHandoffRef: ".aegis/titan/AG-1.json",
        },
      ],
      mergeQueue: [
        {
          id: "MQ-1",
          issue: "AG-1",
          state: "queued",
          priority: "tier-1",
          note: "aegis/AG-1 -> main",
        },
      ],
      artifacts: [
        {
          id: "artifact-1",
          issue: "AG-1",
          kind: "titan artifact",
          path: ".aegis/titan/AG-1.json",
          status: "succeeded",
          summary: "Implemented core",
        },
      ],
      agents: [
        {
          id: "S-1",
          issue: "AG-1",
          caste: "Titan",
          status: "running",
          stage: "implementing",
          activity: "editing",
        },
      ],
      loopEvents: {
        poll: [["10:02:00", "scan", "system status=pass", 1]],
        triage: [],
        dispatch: [["10:03:00", "launch", "AG-1 session=S-1", 2]],
        monitor: [],
        reap: [],
      },
      logs: ["[daemon] AG-1 queued", "[merge] AG-1 waiting"],
    };

    const timeline = stateModule.buildChronosTimeline(state);
    const tree = stateModule.buildChronosMergeTree(state);

    expect(timeline.map((event: { source: string }) => event.source)).toEqual(
      expect.arrayContaining(["agora", "dispatch", "merge", "artifact", "session", "phase", "log"]),
    );
    expect(timeline.some((event: { issue: string; lane: string }) => event.issue === "AG-1" && event.lane === "Titan")).toBe(true);
    expect(tree.roots[0].id).toBe("AG-1");
    expect(tree.roots[0].children[0].id).toBe("AG-2");
    expect(tree.roots[0].mergeItems[0].id).toBe("MQ-1");
    expect(tree.stats.blocked).toBe(1);
  });

  test("keeps config fields and Agora ticket fields editable in source", () => {
    const app = readOlympusFile(path.join("src", "App.jsx"));
    const agentSessions = readOlympusFile(path.join("src", "AgentSessions.jsx"));
    const liveOps = readOlympusFile(path.join("src", "LiveOps.jsx"));
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
      expect(liveOps).toContain(`name="${field}"`);
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
    expect(liveOps).toContain("TicketEditor");
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

  test("Titan prompt treats missing owned files as creatable scope", () => {
    const runner = readFileSync(path.join(root, "src", "core", "caste-runner.ts"), "utf8");

    expect(runner).toContain("Owned paths in the allowed file scope may be absent");
    expect(runner).toContain("create their parent directories and files as needed");
  });
});
