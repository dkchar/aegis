#!/usr/bin/env node
/**
 * Captures the Olympus documentation screenshots.
 *
 * Seeds the real todo graph into a temporary repository, replays a
 * representative mid-run Claude Code state into `.aegis` with Aegis's own
 * state writers, serves Olympus against it, and captures each view with
 * headless Chromium (playwright-core).
 *
 *   npm run build && npm run olympus:screenshots
 *
 * Chromium: run `npx playwright-core install chromium` once, or point
 * OLYMPUS_SCREENSHOT_CHROMIUM at an existing Chrome/Chromium binary.
 * Set OLYMPUS_SCREENSHOT_DIR to write somewhere other than docs/screenshots.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const distEntry = path.join(repoRoot, "dist", "index.js");
const outputDirectory = path.resolve(process.env.OLYMPUS_SCREENSHOT_DIR ?? path.join(repoRoot, "docs", "screenshots"));
const viewport = { width: 1600, height: 900 };
const port = Number(process.env.OLYMPUS_SCREENSHOT_PORT ?? 4183);

if (!existsSync(distEntry)) {
  console.error("Build Aegis first: npm run build");
  process.exit(1);
}

const importDist = (relativePath) => import(path.join(repoRoot, "dist", relativePath));
const { seedMockRun } = await importDist("mock-run/seed-mock-run.js");
const { saveDispatchState } = await importDist("core/dispatch-state.js");
const { saveMergeQueueState } = await importDist("merge/merge-state.js");
const { persistArtifact } = await importDist("core/artifact-store.js");
const { writePhaseLog } = await importDist("core/phase-log.js");
const { appendSessionStream, writeSessionReport } = await importDist("runtime/session-report.js");
const { writeRuntimeState } = await importDist("cli/runtime-state.js");
const { writeJsonAtomic } = await importDist("shared/atomic-write.js");
const { AgoraStore } = await import(path.join(repoRoot, "packages", "agora", "dist", "index.js"));

const MODELS = {
  oracle: "claude-sonnet-5-5",
  titan: "claude-opus-5-5",
  sentinel: "claude-sonnet-5-5",
  janus: "claude-opus-5-5",
};
const THINKING = { oracle: "low", titan: "high", sentinel: "medium", janus: "high" };

/** ISO timestamp `minutes` before now. */
function minutesAgo(minutes) {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function aegisConfig() {
  return {
    runtime: "claude",
    models: Object.fromEntries(Object.entries(MODELS).map(([caste, model]) => [caste, `anthropic:${model}`])),
    thinking: THINKING,
    concurrency: { max_agents: 4, max_oracles: 2, max_titans: 2, max_sentinels: 2, max_janus: 1 },
    thresholds: {
      poll_interval_seconds: 5,
      stuck_warning_seconds: 300,
      stuck_kill_seconds: 900,
      allow_complex_auto_dispatch: false,
      scope_overlap_threshold: 0,
      janus_retry_threshold: 2,
    },
    janus: { enabled: true, max_invocations_per_issue: 1 },
    labor: { base_path: ".aegis/labors" },
    git: { base_branch: "main" },
  };
}

function oracleArtifact(files, checks, risks) {
  return {
    files_affected: files,
    estimated_complexity: files.length > 6 ? "complex" : "moderate",
    risks,
    suggested_checks: checks,
    scope_notes: ["Stay inside the declared file ownership; sibling lanes own the remaining sources."],
  };
}

function titanArtifact(files, summary, checks) {
  return {
    outcome: "success",
    summary,
    files_changed: files,
    tests_and_checks_run: checks,
    known_risks: [],
    follow_up_work: [],
  };
}

function sentinelArtifact(verdict, summary, findings = []) {
  return {
    verdict,
    reviewSummary: summary,
    blockingFindings: findings,
    advisories: [],
    touchedFiles: [],
    contractChecks: ["Issue contract satisfied for owned files", "Lint, build, and tests re-run on the candidate"],
  };
}

/** Writes one finished session: transcript plus caste artifact, like the caste runners do. */
function writeFinishedSession(root, input) {
  const sessionId = randomUUID();
  const workingDirectory = input.caste === "oracle" ? root : path.join(root, ".aegis", "labors", input.issueId);
  const transcriptRef = persistArtifact(root, {
    family: "transcripts",
    issueId: input.issueId,
    artifactId: input.caste,
    artifact: {
      issueId: input.issueId,
      caste: input.caste,
      action: { oracle: "scout", titan: "implement", sentinel: "review" }[input.caste],
      prompt: `${input.caste} assignment for ${input.issueId}`,
      workingDirectory,
      modelRef: `anthropic:${MODELS[input.caste]}`,
      provider: "anthropic",
      modelId: MODELS[input.caste],
      thinkingLevel: THINKING[input.caste],
      sessionId,
      toolsUsed: [...new Set(input.terminalLog.flatMap((line) => line.match(/^\[tool\] (\w+)/)?.[1] ?? []))],
      messageLog: [{ role: "user", content: `${input.caste} assignment for ${input.issueId}` }],
      terminalLog: input.terminalLog,
      usage: input.usage,
      outputText: JSON.stringify(input.artifact),
      status: "succeeded",
      error: null,
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
    },
  });
  return persistArtifact(root, {
    family: input.caste,
    issueId: input.issueId,
    artifact: { ...input.artifact, session: { transcriptRef, sessionId, modelRef: `anthropic:${MODELS[input.caste]}` } },
  });
}

function streamSession(root, sessionId, lines) {
  writeSessionReport(root, { sessionId, status: "running" });
  for (const [minutes, line] of lines) {
    appendSessionStream(root, sessionId, line, minutesAgo(minutes));
  }
}

function record(issueId, patch) {
  return {
    issueId,
    stage: "pending",
    runningAgent: null,
    lastCompletedCaste: null,
    blockedByIssueId: null,
    reviewFeedbackRef: null,
    policyArtifactRef: null,
    oracleAssessmentRef: null,
    titanHandoffRef: null,
    titanClarificationRef: null,
    sentinelVerdictRef: null,
    janusArtifactRef: null,
    failureTranscriptRef: null,
    operationalFailureKind: null,
    fileScope: null,
    failureCount: 0,
    consecutiveFailures: 0,
    failureWindowStartMs: null,
    cooldownUntil: null,
    sessionProvenanceId: String(process.pid),
    updatedAt: minutesAgo(1),
    ...patch,
  };
}

/** Seeds the real todo graph, then replays a representative mid-run Claude Code state. */
async function buildSampleWorkspace(workspaceRoot) {
  const seed = await seedMockRun({ workspaceRoot, runtime: "claude" });
  const root = seed.repoRoot;
  const id = seed.issueIdByKey;
  const store = new AgoraStore({ root });
  const tickets = store.load().tickets;
  const scope = (key) => ({ files: [...tickets[id[key]].scope].sort() });
  writeJsonAtomic(path.join(root, ".aegis", "config.json"), aegisConfig());

  for (const key of ["foundation.app", "core.todo"]) {
    store.moveTicket({ ticketId: id[key], to: "done", actor: "aegis", reason: "Completed by Aegis.", reasonKind: "completed", force: true });
  }

  const shellChecks = ["npm run lint", "npm run build", "npm test -- --run"];
  const foundation = id["foundation.app"];
  const core = id["core.todo"];
  const ui = id["ui.components"];
  const motion = id["motion.polish"];

  const finished = {
    foundationOracle: writeFinishedSession(root, {
      issueId: foundation, caste: "oracle", startedAt: minutesAgo(26), finishedAt: minutesAgo(25),
      usage: { inputTokens: 18_400, outputTokens: 1_250, cacheReadInputTokens: 9_800, costUsd: 0.07, turns: 6, durationMs: 54_000 },
      artifact: oracleArtifact(scope("foundation.app").files, shellChecks, ["Vite and React versions must stay compatible with the Playwright smoke lane."]),
      terminalLog: ["[session] init model=claude-sonnet-5-5", "[tool] Glob **/*", "[tool] Read package.json", "[result] success"],
    }),
    foundationTitan: writeFinishedSession(root, {
      issueId: foundation, caste: "titan", startedAt: minutesAgo(25), finishedAt: minutesAgo(19),
      usage: { inputTokens: 212_000, outputTokens: 14_800, cacheReadInputTokens: 168_000, costUsd: 1.42, turns: 31, durationMs: 352_000 },
      artifact: titanArtifact(scope("foundation.app").files, "Created the Vite React TypeScript foundation with lint, build, test, smoke, and preview scripts.", shellChecks),
      terminalLog: ["[session] init model=claude-opus-5-5", "[tool] Write package.json", "[tool] Bash npm install", "[tool] Bash npm run build", "[tool] Bash git commit -m \"AG foundation\"", "[result] success"],
    }),
    foundationSentinel: writeFinishedSession(root, {
      issueId: foundation, caste: "sentinel", startedAt: minutesAgo(19), finishedAt: minutesAgo(17),
      usage: { inputTokens: 41_000, outputTokens: 2_100, cacheReadInputTokens: 30_500, costUsd: 0.19, turns: 9, durationMs: 98_000 },
      artifact: sentinelArtifact("pass", "Foundation builds, lints, and runs an empty test suite; no starter copy is visible."),
      terminalLog: ["[session] init model=claude-sonnet-5-5", "[tool] Bash git diff main...HEAD --stat", "[tool] Bash npm run build", "[result] success"],
    }),
    coreOracle: writeFinishedSession(root, {
      issueId: core, caste: "oracle", startedAt: minutesAgo(16), finishedAt: minutesAgo(15),
      usage: { inputTokens: 16_900, outputTokens: 1_100, cacheReadInputTokens: 8_200, costUsd: 0.06, turns: 5, durationMs: 47_000 },
      artifact: oracleArtifact(scope("core.todo").files, ["npm test -- --run src/state"], ["Persistence must tolerate an empty or corrupted localStorage entry."]),
      terminalLog: ["[session] init model=claude-sonnet-5-5", "[tool] Read src/main.tsx", "[result] success"],
    }),
    coreTitan: writeFinishedSession(root, {
      issueId: core, caste: "titan", startedAt: minutesAgo(15), finishedAt: minutesAgo(11),
      usage: { inputTokens: 158_000, outputTokens: 11_200, cacheReadInputTokens: 121_000, costUsd: 1.08, turns: 24, durationMs: 241_000 },
      artifact: titanArtifact(scope("core.todo").files, "Implemented the todo model, store, and commands with focused unit tests.", ["npm test -- --run src/state", "npm run lint"]),
      terminalLog: ["[session] init model=claude-opus-5-5", "[tool] Write src/domain/todo.ts", "[tool] Bash npm test -- --run src/state", "[result] success"],
    }),
    coreSentinel: writeFinishedSession(root, {
      issueId: core, caste: "sentinel", startedAt: minutesAgo(11), finishedAt: minutesAgo(10),
      usage: { inputTokens: 37_500, outputTokens: 1_900, cacheReadInputTokens: 27_000, costUsd: 0.17, turns: 8, durationMs: 76_000 },
      artifact: sentinelArtifact("pass", "Commands are pure, persistence is guarded, and the unit tests cover create, toggle, delete, and clear."),
      terminalLog: ["[session] init model=claude-sonnet-5-5", "[tool] Bash npm test -- --run", "[result] success"],
    }),
    uiOracle: writeFinishedSession(root, {
      issueId: ui, caste: "oracle", startedAt: minutesAgo(9), finishedAt: minutesAgo(8),
      usage: { inputTokens: 21_300, outputTokens: 1_400, cacheReadInputTokens: 10_900, costUsd: 0.08, turns: 7, durationMs: 61_000 },
      artifact: oracleArtifact(scope("ui.components").files, ["npm run lint", "npm test -- --run src/components"], ["UI copy must not leak orchestration vocabulary."]),
      terminalLog: ["[session] init model=claude-sonnet-5-5", "[tool] Read src/state/todo-store.ts", "[result] success"],
    }),
    motionOracle: writeFinishedSession(root, {
      issueId: motion, caste: "oracle", startedAt: minutesAgo(9), finishedAt: minutesAgo(8),
      usage: { inputTokens: 19_700, outputTokens: 1_300, cacheReadInputTokens: 9_400, costUsd: 0.07, turns: 6, durationMs: 58_000 },
      artifact: oracleArtifact(scope("motion.polish").files, ["npm run build"], ["Reduced-motion users need instant transitions."]),
      terminalLog: ["[session] init model=claude-sonnet-5-5", "[tool] Read src/styles", "[result] success"],
    }),
    motionTitan: writeFinishedSession(root, {
      issueId: motion, caste: "titan", startedAt: minutesAgo(8), finishedAt: minutesAgo(3),
      usage: { inputTokens: 176_000, outputTokens: 12_600, cacheReadInputTokens: 133_000, costUsd: 1.21, turns: 27, durationMs: 288_000 },
      artifact: titanArtifact(scope("motion.polish").files, "Added item and reorder motion with a reduced-motion fallback and a refined theme.", ["npm run build", "npm run lint"]),
      terminalLog: ["[session] init model=claude-opus-5-5", "[tool] Write src/motion/itemMotion.ts", "[tool] Bash npm run build", "[result] success"],
    }),
    motionReview: writeFinishedSession(root, {
      issueId: motion, caste: "sentinel", startedAt: minutesAgo(6), finishedAt: minutesAgo(5),
      usage: { inputTokens: 39_000, outputTokens: 2_300, cacheReadInputTokens: 28_400, costUsd: 0.18, turns: 9, durationMs: 81_000 },
      artifact: sentinelArtifact("fail_blocking", "Delete transitions ignore prefers-reduced-motion.", [{
        finding_kind: "contract_gap",
        summary: "AnimatedTodoItem delete exit animation runs even when prefers-reduced-motion is set.",
        required_files: ["src/components/AnimatedTodoItem.tsx"],
        owner_issue: motion,
        route: "rework_owner",
      }]),
      terminalLog: ["[session] init model=claude-sonnet-5-5", "[tool] Read src/components/AnimatedTodoItem.tsx", "[result] success"],
    }),
  };

  const uiSession = randomUUID();
  const motionSession = randomUUID();
  saveDispatchState(root, {
    schemaVersion: 1,
    records: {
      [foundation]: record(foundation, {
        stage: "complete", lastCompletedCaste: "sentinel", fileScope: scope("foundation.app"),
        oracleAssessmentRef: finished.foundationOracle, titanHandoffRef: finished.foundationTitan,
        sentinelVerdictRef: finished.foundationSentinel, reviewFeedbackRef: finished.foundationSentinel, updatedAt: minutesAgo(17),
      }),
      [core]: record(core, {
        stage: "complete", lastCompletedCaste: "sentinel", fileScope: scope("core.todo"),
        oracleAssessmentRef: finished.coreOracle, titanHandoffRef: finished.coreTitan,
        sentinelVerdictRef: finished.coreSentinel, reviewFeedbackRef: finished.coreSentinel, updatedAt: minutesAgo(10),
      }),
      [ui]: record(ui, {
        stage: "implementing", lastCompletedCaste: "oracle", fileScope: scope("ui.components"),
        oracleAssessmentRef: finished.uiOracle,
        runningAgent: { caste: "titan", sessionId: uiSession, startedAt: minutesAgo(7) },
      }),
      [motion]: record(motion, {
        stage: "reviewing", lastCompletedCaste: "titan", fileScope: scope("motion.polish"),
        oracleAssessmentRef: finished.motionOracle, titanHandoffRef: finished.motionTitan, reviewFeedbackRef: finished.motionReview,
        runningAgent: { caste: "sentinel", sessionId: motionSession, startedAt: minutesAgo(2) },
      }),
    },
  });

  streamSession(root, uiSession, [
    [7, `[session] start issue=${ui} caste=titan stage=implementing runtime=claude`],
    [6.9, "[session] init model=claude-opus-5-5"],
    [6.6, "[assistant] Reading the todo store API before wiring components."],
    [6.5, "[tool] Read src/state/todo-store.ts"],
    [6.4, "[tool] Read src/domain/todo.ts"],
    [5.8, "[tool] Write src/components/TodoInput.tsx"],
    [5.1, "[tool] Write src/components/TodoList.tsx"],
    [4.6, "[tool] Write src/components/TodoItem.tsx"],
    [4.0, "[tool] Write src/components/TodoFilters.tsx"],
    [3.4, "[tool] Write src/components/A11yStatus.tsx"],
    [2.9, "[tool] Bash npm run lint"],
    [2.7, "[tool_error] src/components/TodoFilters.tsx(14,7): 'Filter' is declared but never used."],
    [2.4, "[tool] Edit src/components/TodoFilters.tsx"],
    [2.0, "[tool] Bash npm run lint"],
    [1.4, "[tool] Bash npm test -- --run src/components"],
    [0.6, "[assistant] Lint and component tests pass; committing the component lane."],
    [0.2, "[tool] Bash git add src/components src/accessibility && git commit -m \"todo product components\""],
  ]);
  streamSession(root, motionSession, [
    [2, `[session] start issue=${motion} caste=sentinel stage=reviewing runtime=claude`],
    [1.9, "[session] init model=claude-sonnet-5-5"],
    [1.6, "[assistant] Re-checking the reduced-motion finding from the previous review."],
    [1.4, "[tool] Bash git diff main...HEAD -- src/components/AnimatedTodoItem.tsx"],
    [1.0, "[tool] Read src/motion/itemMotion.ts"],
    [0.5, "[tool] Bash npm run build"],
  ]);

  saveMergeQueueState(root, {
    schemaVersion: 1,
    items: [foundation, core].map((issueId, index) => ({
      queueItemId: `queue-${issueId}`,
      issueId,
      candidateBranch: `aegis/${issueId}`,
      targetBranch: "main",
      laborPath: path.join(root, ".aegis", "labors", issueId),
      status: "merged",
      attempts: 0,
      janusInvocations: 0,
      lastTier: "T1",
      lastError: null,
      enqueuedAt: minutesAgo(17 - index * 7),
      updatedAt: minutesAgo(16.5 - index * 7),
    })),
  });

  const phase = (minutes, entry) => writePhaseLog(root, { timestamp: minutesAgo(minutes), ...entry });
  phase(26, { phase: "poll", issueId: "_all", action: "poll_ready_work", outcome: "ok", detail: foundation });
  phase(26, { phase: "dispatch", issueId: foundation, action: "launch_oracle", outcome: "running", detail: "{\"caste\":\"oracle\"}" });
  phase(25, { phase: "reap", issueId: foundation, action: "finalize_session", outcome: "scouted" });
  phase(25, { phase: "dispatch", issueId: foundation, action: "launch_titan", outcome: "running", detail: "{\"caste\":\"titan\"}" });
  phase(19, { phase: "reap", issueId: foundation, action: "finalize_session", outcome: "implemented" });
  phase(17, { phase: "dispatch", issueId: foundation, action: "sentinel_review_completed", outcome: "queued_for_merge" });
  phase(16.5, { phase: "merge", issueId: foundation, action: "merge_candidate", outcome: "merged", detail: `{"queueItemId":"queue-${foundation}","tier":"T1","stage":"complete"}` });
  phase(16, { phase: "poll", issueId: "_all", action: "poll_ready_work", outcome: "ok", detail: core });
  phase(16, { phase: "dispatch", issueId: core, action: "launch_oracle", outcome: "running", detail: "{\"caste\":\"oracle\"}" });
  phase(11, { phase: "reap", issueId: core, action: "finalize_session", outcome: "implemented" });
  phase(10, { phase: "dispatch", issueId: core, action: "sentinel_review_completed", outcome: "queued_for_merge" });
  phase(9.5, { phase: "merge", issueId: core, action: "merge_candidate", outcome: "merged", detail: `{"queueItemId":"queue-${core}","tier":"T1","stage":"complete"}` });
  phase(9, { phase: "poll", issueId: "_all", action: "poll_ready_work", outcome: "ok", detail: `${ui},${motion}` });
  phase(9, { phase: "triage", issueId: "_all", action: "triage_ready_work", outcome: "ok", detail: `${ui},${motion}` });
  phase(9, { phase: "dispatch", issueId: ui, action: "launch_oracle", outcome: "running", detail: "{\"caste\":\"oracle\"}" });
  phase(9, { phase: "dispatch", issueId: motion, action: "launch_oracle", outcome: "running", detail: "{\"caste\":\"oracle\"}" });
  phase(7, { phase: "dispatch", issueId: ui, action: "launch_titan", outcome: "running", sessionId: uiSession, detail: "{\"caste\":\"titan\"}" });
  phase(5, { phase: "dispatch", issueId: motion, action: "sentinel_review_completed", outcome: "rework_required", detail: "{\"blockingFindingCount\":1}" });
  phase(3, { phase: "reap", issueId: motion, action: "finalize_session", outcome: "implemented" });
  phase(2, { phase: "dispatch", issueId: motion, action: "launch_sentinel", outcome: "running", sessionId: motionSession, detail: "{\"caste\":\"sentinel\"}" });
  phase(1, { phase: "monitor", issueId: "_all", action: "monitor_active_work", outcome: "ok", detail: "{\"warnings\":[],\"killList\":[],\"readyToReap\":[]}" });

  writeRuntimeState({ schema_version: 1, pid: process.pid, server_state: "running", mode: "auto", started_at: minutesAgo(26) }, root);
  const { appendFileSync } = await import("node:fs");
  const daemonLog = path.join(root, ".aegis", "logs", "daemon.log");
  appendFileSync(daemonLog, `${minutesAgo(26)} [daemon][start] runtime=claude poll_interval_seconds=5\n`);
  for (let minute = 25; minute >= 1; minute -= 6) {
    appendFileSync(daemonLog, `${minutesAgo(minute)} [daemon][heartbeat] mode=auto\n`);
  }
  return { root, sessions: { ui: uiSession, motion: motionSession } };
}

async function startOlympus(root) {
  const [{ createServer }, { default: react }, { default: tailwindcss }, { olympusApiPlugin }] = await Promise.all([
    import("vite"),
    import("@vitejs/plugin-react"),
    import("@tailwindcss/vite"),
    import(path.join(repoRoot, "olympus", "server", "olympus-api.js")),
  ]);
  const server = await createServer({
    root: path.join(repoRoot, "olympus"),
    configFile: false,
    logLevel: "warn",
    plugins: [olympusApiPlugin({ root }), react(), tailwindcss()],
    server: { host: "127.0.0.1", port, strictPort: true },
  });
  await server.listen();
  return server;
}

async function capture(baseUrl, sessions) {
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.OLYMPUS_SCREENSHOT_CHROMIUM ? { executablePath: process.env.OLYMPUS_SCREENSHOT_CHROMIUM } : {}),
  });
  const shots = [
    ["olympus-ops", "/#live", "text=Agora Graph"],
    ["olympus-sessions", `/#agents/${sessions.ui}`, ".xterm-rows"],
    ["olympus-aether", "/#aether", "canvas[role=img]"],
    ["olympus-records", "/#records", "text=Dispatch Progress"],
    ["olympus-config", "/#config", "text=models.titan"],
    ["olympus-design-system", "/design.html", "text=Design system"],
    ["olympus-design-components", "/design.html", "text=Design system", "#badges"],
    ["olympus-design-surfaces", "/design.html", ".xterm-rows", "#data"],
  ];
  const themes = (process.env.OLYMPUS_SCREENSHOT_THEMES ?? "dark").split(",");
  const failures = [];
  try {
    mkdirSync(outputDirectory, { recursive: true });
    for (const theme of themes) {
      const context = await browser.newContext({ viewport, deviceScaleFactor: 1, colorScheme: theme === "light" ? "light" : "dark" });
      await context.addInitScript((value) => {
        try {
          window.localStorage.setItem("olympus.theme", value);
        } catch {
          // Storage may be unavailable; the color scheme still applies.
        }
      }, theme);
      const page = await context.newPage();
      for (const [name, route, readySelector, scrollSelector] of shots) {
        const file = path.join(outputDirectory, `${name}${theme === "dark" ? "" : `-${theme}`}.png`);
        try {
          await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded" });
          await page.waitForSelector(readySelector, { timeout: 30_000 });
          if (scrollSelector) {
            await page.evaluate((selector) => document.querySelector(selector)?.scrollIntoView({ block: "start" }), scrollSelector);
          }
          await page.waitForTimeout(1_200);
          await page.screenshot({ path: file });
          console.log(`captured ${path.relative(repoRoot, file)}`);
        } catch (error) {
          failures.push(`${name} (${theme}): ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
        }
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
  if (failures.length > 0) {
    throw new Error(`Screenshots failed:\n${failures.join("\n")}`);
  }
}

const workspaceRoot = mkdtempSync(path.join(tmpdir(), "olympus-screenshots-"));
let server = null;
try {
  const sample = await buildSampleWorkspace(workspaceRoot);
  server = await startOlympus(sample.root);
  await capture(`http://127.0.0.1:${port}`, sample.sessions);
} finally {
  await server?.close();
  if (!process.env.OLYMPUS_SCREENSHOT_KEEP) {
    rmSync(workspaceRoot, { recursive: true, force: true });
  } else {
    console.log(`sample workspace kept at ${workspaceRoot}`);
  }
}
