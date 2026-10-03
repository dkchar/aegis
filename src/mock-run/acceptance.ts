import path from "node:path";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { CASTE_CONFIG_KEYS, type CasteConfigKey } from "../config/caste-config.js";
import { loadConfig } from "../config/load-config.js";
import { loadDispatchState, type DispatchRecord } from "../core/dispatch-state.js";
import { readPhaseLog, resolvePhaseLogPath, type PhaseName } from "../core/phase-log.js";
import { loadMergeQueueState, type MergeQueueItem } from "../merge/merge-state.js";
import { runMockCommand, type RunMockCommandOptions } from "./mock-run.js";
import { resolveDefaultMockWorkspaceRoot } from "./mock-paths.js";
import { seedMockRun, type SeedMockRunResult } from "./seed-mock-run.js";
import { createTrackerClient } from "../tracker/create-tracker.js";
import type { RuntimeStateRecord } from "../cli/runtime-state.js";
import { readRuntimeState } from "../cli/runtime-state.js";
import type { AegisIssue } from "../tracker/issue-model.js";
import { isProcessRunning } from "../cli/runtime-state.js";
import { AgoraStore, type AgoraColumn, type AgoraTicket } from "../../packages/agora/dist/index.js";
import { writeJsonAtomic } from "../shared/atomic-write.js";

const HAPPY_PATH_ISSUE_KEY = "foundation.app";
const JANUS_ISSUE_KEY = "janus.integration";
const MOCK_ACCEPTANCE_TIMEOUT_MS = 300_000;
const MOCK_ACCEPTANCE_POLL_MS = 250;

type MockCommandRunner = (
  args: string[],
  options?: RunMockCommandOptions,
) => Promise<unknown>;

export interface FinalProductQualityOptions {
  loadPageText?: (root: string) => Promise<string>;
}

interface TrackerLike {
  getIssue(id: string, root?: string): Promise<AegisIssue>;
}

function resolveAegisCliPath() {
  const currentFilePath = fileURLToPath(import.meta.url);
  const currentDirectory = path.dirname(currentFilePath);
  return path.resolve(currentDirectory, "..", "..", "dist", "index.js");
}

export interface MockAcceptanceDependencies {
  cwd?: string;
  now?: string;
  seedMockRun?: typeof seedMockRun;
  runMockCommand?: MockCommandRunner;
  waitForMockAcceptanceProgress?: typeof waitForMockAcceptanceProgress;
  collectMockAcceptanceSurface?: typeof collectMockAcceptanceSurface;
  verifyFinalApp?: typeof verifyFinalApp;
  tracker?: TrackerLike;
}

export interface MockAcceptanceRecordSummary {
  stage: string;
  oracleAssessmentRef: string | null;
  titanHandoffRef: string | null;
  sentinelVerdictRef: string | null;
  janusArtifactRef: string | null;
}

export interface MockAcceptanceQueueSummary {
  status: MergeQueueItem["status"];
  attempts: number;
  janusInvocations: number;
  lastTier: MergeQueueItem["lastTier"];
}

export interface MockAcceptanceIssueSummary {
  id: string;
  title: string;
  status: string;
}

export interface MockAcceptanceAgoraTicketSummary {
  id: string;
  title: string;
  column: AgoraColumn;
  labels: string[];
  blockedBy: string[];
  blocks: string[];
}

export interface MockAcceptanceAgoraSummary {
  tickets: MockAcceptanceAgoraTicketSummary[];
  executableOpenTicketIds: string[];
  haltedTicketIds: string[];
}

export interface MockAcceptancePhaseLogSummary {
  timestamp: string;
  phase: PhaseName;
  issueId: string;
  action: string;
  outcome: string;
  detail: string | null;
}

export interface MockAcceptanceLaborSummary {
  queueLaborPath: string;
  queueLaborPathExists: boolean;
  preservedLaborPath: string | null;
  preservedLaborPathExists: boolean;
  janusArtifactRef: string | null;
  janusArtifactExists: boolean;
  recommendedNextAction: string | null;
}

export interface MockAcceptanceFinalAppCommandSummary {
  command: string;
  exitCode: number;
  durationMs: number;
}

export interface MockAcceptanceFinalAppVerification {
  status: "passed" | "skipped";
  verifiedAt: string;
  commands: MockAcceptanceFinalAppCommandSummary[];
  skipReason?: string;
}

export interface MockAcceptanceSurface {
  config: {
    runtime: string;
    models: Record<CasteConfigKey, string>;
    fingerprint: string;
  };
  runtimeState: RuntimeStateRecord;
  dispatch: {
    happy: MockAcceptanceRecordSummary;
    janus: MockAcceptanceRecordSummary;
  };
  mergeQueue: {
    happy: MockAcceptanceQueueSummary;
    janus: MockAcceptanceQueueSummary;
  };
  trackerIssues: {
    happy: MockAcceptanceIssueSummary;
    janus: MockAcceptanceIssueSummary;
  };
  agora?: MockAcceptanceAgoraSummary;
  phaseLogs: MockAcceptancePhaseLogSummary[];
  labor: {
    happy: MockAcceptanceLaborSummary;
    janus: MockAcceptanceLaborSummary;
  };
  finalAppVerification: MockAcceptanceFinalAppVerification;
}

export interface MockAcceptanceResult {
  repoRoot: string;
  seed: SeedMockRunResult;
  happyIssueId: string;
  janusIssueId: string;
  surface: MockAcceptanceSurface;
}

export interface WaitForMockAcceptanceProgressOptions {
  timeoutMs?: number;
  pollMs?: number;
  readDispatchState?: typeof loadDispatchState;
  readMergeQueueState?: typeof loadMergeQueueState;
  readRuntimeState?: typeof readRuntimeState;
  isProcessRunning?: typeof isProcessRunning;
  sleep?: (milliseconds: number) => Promise<void>;
}

function requireIssueId(seed: SeedMockRunResult, key: string) {
  const issueId = seed.issueIdByKey[key];
  if (!issueId) {
    throw new Error(`Seeded mock run is missing required issue key "${key}".`);
  }

  return issueId;
}

function readDispatchRecord(root: string, issueId: string): DispatchRecord {
  const state = loadDispatchState(root);
  const record = state.records[issueId];
  if (!record) {
    throw new Error(`Dispatch state is missing issue ${issueId}.`);
  }

  return record;
}

function readQueueItem(root: string, issueId: string): MergeQueueItem {
  const state = loadMergeQueueState(root);
  const item = state.items.find((candidate) => candidate.issueId === issueId);
  if (!item) {
    throw new Error(`Merge queue is missing issue ${issueId}.`);
  }

  return item;
}

function readPhaseLogs(root: string): MockAcceptancePhaseLogSummary[] {
  const logPath = resolvePhaseLogPath(root);
  if (!existsSync(logPath)) {
    throw new Error(`Missing phase log at ${logPath}.`);
  }

  return readPhaseLog(root).entries.map((entry) => ({
    timestamp: entry.timestamp,
    phase: entry.phase,
    issueId: entry.issueId,
    action: entry.action,
    outcome: entry.outcome,
    detail: entry.detail ?? null,
  }));
}

async function readIssueSummary(
  tracker: TrackerLike,
  root: string,
  issueId: string,
): Promise<MockAcceptanceIssueSummary> {
  const issue = await tracker.getIssue(issueId, root);
  return {
    id: issue.id,
    title: issue.title,
    status: issue.status,
  };
}

async function sleep(milliseconds: number) {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function isHappyProofComplete(
  record: DispatchRecord | undefined,
  queueItem: MergeQueueItem | undefined,
) {
  return record?.stage === "complete"
    && queueItem?.status === "merged"
    && typeof record.oracleAssessmentRef === "string"
    && typeof record.titanHandoffRef === "string"
    && typeof record.sentinelVerdictRef === "string";
}

function isJanusProofComplete(
  record: DispatchRecord | undefined,
  queueItem: MergeQueueItem | undefined,
) {
  if (!record || !queueItem || typeof record.janusArtifactRef !== "string") {
    return false;
  }

  const reachedT3 = queueItem.attempts >= 3
    && queueItem.janusInvocations >= 1
    && queueItem.lastTier === "T3";
  if (!reachedT3) {
    return false;
  }

  const janusRework = record.stage === "rework_required"
    && queueItem.status === "failed";
  const janusBlocked = record.stage === "blocked_on_child"
    && queueItem.status === "failed";

  return janusRework || janusBlocked;
}

function resolveNpmExecutable() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function resolveFinalAppCommand(args: string[]) {
  if (process.platform === "win32") {
    return {
      executable: process.env.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/c", `${resolveNpmExecutable()} ${args.join(" ")}`],
      display: `${resolveNpmExecutable()} ${args.join(" ")}`,
    };
  }

  return {
    executable: resolveNpmExecutable(),
    args,
    display: `${resolveNpmExecutable()} ${args.join(" ")}`,
  };
}

function resolveFinalAppVerificationPath(root: string) {
  return path.join(root, ".aegis", "final-app-verification.json");
}

function writeFinalAppVerification(root: string, verification: MockAcceptanceFinalAppVerification) {
  writeJsonAtomic(resolveFinalAppVerificationPath(root), verification);
}

function readFinalAppVerification(root: string): MockAcceptanceFinalAppVerification {
  const targetPath = resolveFinalAppVerificationPath(root);
  if (!existsSync(targetPath)) {
    throw new Error(`Missing final app verification at ${targetPath}.`);
  }

  return JSON.parse(readFileSync(targetPath, "utf8")) as MockAcceptanceFinalAppVerification;
}

async function runFinalAppCommand(root: string, args: string[]): Promise<MockAcceptanceFinalAppCommandSummary> {
  const startedAt = Date.now();
  const command = resolveFinalAppCommand(args);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command.executable, command.args, {
      cwd: root,
      stdio: "inherit",
      env: {
        ...process.env,
        CI: "1",
      },
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command.display} exited with ${String(code ?? signal)}.`));
    });
  });

  return {
    command: command.display,
    exitCode: 0,
    durationMs: Date.now() - startedAt,
  };
}

const FORBIDDEN_PRODUCT_UI_TERMS = [
  "React + TypeScript App Shell",
  "Workspace",
  "Motion proof",
  "Motion gate",
  "Motion lane",
  "lane mounted",
  "proof lane",
  "setup shell",
  "Stability snapshot",
  "UI gate",
  "Next steps",
] as const;

async function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to allocate local preview port.")));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

async function waitForPreview(baseUrl: string) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling until the preview server is ready.
    }
    await sleep(250);
  }
  throw new Error(`Generated app preview did not become ready at ${baseUrl}.`);
}

async function loadFinalAppPageText(root: string): Promise<string> {
  const port = await findAvailablePort();
  const baseUrl = `http://127.0.0.1:${port}/`;
  const preview = spawn(process.execPath, [
    path.join(root, "node_modules", "vite", "bin", "vite.js"),
    "preview",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--strictPort",
  ], {
    cwd: root,
    stdio: "ignore",
    windowsHide: true,
  });

  try {
    await waitForPreview(baseUrl);
    const requireFromApp = createRequire(path.join(root, "package.json"));
    const { chromium } = requireFromApp("playwright") as {
      chromium: {
        launch: () => Promise<{
          newPage: (options: { viewport: { width: number; height: number } }) => Promise<any>;
          close: () => Promise<void>;
        }>;
      };
    };
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const pageErrors: string[] = [];
      page.on("pageerror", (error: Error) => pageErrors.push(error.message));
      page.on("console", (message: { type: () => string; text: () => string }) => {
        if (message.type() === "error") {
          pageErrors.push(message.text());
        }
      });
      await page.goto(baseUrl, { waitUntil: "networkidle" });
      const bodyText = await page.locator("body").innerText();

      const todoHeading = page.getByRole("heading", { name: /todo/i }).first();
      if (!(await todoHeading.isVisible())) {
        throw new Error("Generated app does not show a todo heading.");
      }
      const headingBox = await todoHeading.boundingBox();
      if (!headingBox || headingBox.y > 260) {
        throw new Error("Generated app does not put the todo product in the first viewport.");
      }

      const input = page.getByRole("textbox").first();
      await input.fill("Plan launch");
      await page.getByRole("button", { name: /add/i }).first().click();
      if (!(await page.getByText("Plan launch", { exact: true }).isVisible())) {
        throw new Error("Generated app does not add and show a todo item.");
      }
      if (pageErrors.length > 0) {
        throw new Error(`Generated app emitted browser errors: ${pageErrors.join("; ")}`);
      }

      return bodyText;
    } finally {
      await browser.close();
    }
  } finally {
    preview.kill("SIGTERM");
  }
}

export async function assertFinalProductQuality(
  root: string,
  options: FinalProductQualityOptions = {},
): Promise<void> {
  const pageText = await (options.loadPageText ?? loadFinalAppPageText)(root);
  const lowerText = pageText.toLowerCase();
  const leakedTerms = FORBIDDEN_PRODUCT_UI_TERMS.filter((term) =>
    lowerText.includes(term.toLowerCase()));
  if (leakedTerms.length > 0) {
    throw new Error(`Generated app leaks orchestration vocabulary: ${leakedTerms.join(", ")}.`);
  }
  if (!lowerText.includes("todo")) {
    throw new Error("Generated app does not present itself as a todo app.");
  }
}

export async function verifyFinalApp(root: string): Promise<MockAcceptanceFinalAppVerification> {
  if (!existsSync(path.join(root, "package.json"))) {
    const verification = {
      status: "skipped" as const,
      verifiedAt: new Date().toISOString(),
      commands: [],
      skipReason: "Generated app package.json is absent; scripted mock acceptance does not produce product files.",
    };
    writeFinalAppVerification(root, verification);
    return verification;
  }

  const commandArgs = [
    ["run", "lint"],
    ["run", "build"],
    ["test"],
    ["run", "smoke"],
  ];
  const commands: MockAcceptanceFinalAppCommandSummary[] = [];
  for (const args of commandArgs) {
    commands.push(await runFinalAppCommand(root, args));
  }
  await assertFinalProductQuality(root);

  const verification = {
    status: "passed" as const,
    verifiedAt: new Date().toISOString(),
    commands,
  };
  writeFinalAppVerification(root, verification);
  return verification;
}

function readConfigSummary(root: string): MockAcceptanceSurface["config"] {
  const config = loadConfig(root);
  const normalized = JSON.stringify({
    runtime: config.runtime,
    models: config.models,
    thinking: config.thinking,
    concurrency: config.concurrency,
    thresholds: config.thresholds,
  });

  return {
    runtime: config.runtime,
    models: { ...config.models },
    fingerprint: createHash("sha256").update(normalized).digest("hex").slice(0, 16),
  };
}

function hasAgoraTickets(root: string) {
  return existsSync(path.join(root, ".agora", "tickets.json"));
}

function summarizeProofProgress(
  record: DispatchRecord | undefined,
  queueItem: MergeQueueItem | undefined,
) {
  return JSON.stringify({
    stage: record?.stage ?? null,
    queueStatus: queueItem?.status ?? null,
    attempts: queueItem?.attempts ?? null,
    janusInvocations: queueItem?.janusInvocations ?? null,
    lastTier: queueItem?.lastTier ?? null,
  });
}

function getDeadlockReason(record: DispatchRecord | undefined) {
  if (!record) {
    return null;
  }

  if (record.stage === "blocked_on_child") {
    return `created blocker without removing parent from readiness: ${record.issueId}`;
  }

  if (record.stage === "scouted" && record.oracleDecompose === true) {
    return `Oracle returned decompose=true for ${record.issueId}, but the executable proof flow has no decomposition completion path.`;
  }

  return null;
}

export async function waitForMockAcceptanceProgress(
  root: string,
  issueIds: { happyIssueId: string; janusIssueId: string },
  options: WaitForMockAcceptanceProgressOptions = {},
): Promise<void> {
  const deadline = Date.now() + (options.timeoutMs ?? MOCK_ACCEPTANCE_TIMEOUT_MS);
  const readDispatch = options.readDispatchState ?? loadDispatchState;
  const readMergeQueue = options.readMergeQueueState ?? loadMergeQueueState;
  const readRuntime = options.readRuntimeState ?? readRuntimeState;
  const processRunning = options.isProcessRunning ?? isProcessRunning;
  const pause = options.sleep ?? sleep;
  const pollMs = options.pollMs ?? MOCK_ACCEPTANCE_POLL_MS;

  while (Date.now() < deadline) {
    const runtimeState = readRuntime(root);
    if (
      !runtimeState
      || runtimeState.server_state !== "running"
      || !processRunning(runtimeState.pid)
    ) {
      throw new Error("Mock acceptance daemon stopped before proof targets completed.");
    }

    const dispatchState = readDispatch(root);
    const mergeQueueState = readMergeQueue(root);
    const happyRecord = dispatchState.records[issueIds.happyIssueId];
    const janusRecord = dispatchState.records[issueIds.janusIssueId];
    const happyQueueItem = mergeQueueState.items.find((item) => item.issueId === issueIds.happyIssueId);
    const janusQueueItem = mergeQueueState.items.find((item) => item.issueId === issueIds.janusIssueId);
    const deadlockReason = getDeadlockReason(happyRecord) ?? getDeadlockReason(janusRecord);

    if (deadlockReason) {
      throw new Error(deadlockReason);
    }

    if (hasAgoraTickets(root)) {
      const agora = readAgoraSummary(root);
      if (agora.haltedTicketIds.length > 0) {
        throw new Error(`Agora tickets halted during proof: ${agora.haltedTicketIds.join(", ")}.`);
      }
      if (agora.executableOpenTicketIds.length === 0) {
        return;
      }
    } else {
      if (
        isHappyProofComplete(happyRecord, happyQueueItem)
        && isJanusProofComplete(janusRecord, janusQueueItem)
      ) {
        return;
      }
    }

    await pause(pollMs);
  }

  const dispatchState = (options.readDispatchState ?? loadDispatchState)(root);
  const mergeQueueState = (options.readMergeQueueState ?? loadMergeQueueState)(root);
  const happyRecord = dispatchState.records[issueIds.happyIssueId];
  const janusRecord = dispatchState.records[issueIds.janusIssueId];
  const happyQueueItem = mergeQueueState.items.find((item) => item.issueId === issueIds.happyIssueId);
  const janusQueueItem = mergeQueueState.items.find((item) => item.issueId === issueIds.janusIssueId);

  throw new Error(
    `Timed out waiting for mock acceptance proof progress. happy=${summarizeProofProgress(happyRecord, happyQueueItem)} janus=${summarizeProofProgress(janusRecord, janusQueueItem)}`,
  );
}

function readLaborSummary(root: string, item: MergeQueueItem): MockAcceptanceLaborSummary {
  const queueLaborPath = path.isAbsolute(item.laborPath)
    ? item.laborPath
    : path.join(root, item.laborPath);
  const janusArtifactRef = path.join(root, ".aegis", "janus", `${item.issueId}.json`);

  let preservedLaborPath: string | null = null;
  let recommendedNextAction: string | null = null;
  if (existsSync(janusArtifactRef)) {
    const artifact = JSON.parse(readFileSync(janusArtifactRef, "utf8")) as Record<string, unknown>;
    preservedLaborPath = typeof artifact.preservedLaborPath === "string"
      ? artifact.preservedLaborPath
      : null;
    const mutationProposal = artifact.mutation_proposal;
    recommendedNextAction = typeof artifact.recommendedNextAction === "string"
      ? artifact.recommendedNextAction
      : typeof mutationProposal === "object"
        && mutationProposal !== null
        && !Array.isArray(mutationProposal)
        && typeof (mutationProposal as Record<string, unknown>).proposal_type === "string"
          ? (mutationProposal as Record<string, string>).proposal_type
          : null;
  }

  const resolvedPreservedLaborPath = preservedLaborPath === null
    ? null
    : path.isAbsolute(preservedLaborPath)
      ? preservedLaborPath
      : path.join(root, preservedLaborPath);

  return {
    queueLaborPath: item.laborPath,
    queueLaborPathExists: existsSync(queueLaborPath),
    preservedLaborPath,
    preservedLaborPathExists: resolvedPreservedLaborPath !== null && existsSync(resolvedPreservedLaborPath),
    janusArtifactRef: existsSync(janusArtifactRef) ? path.join(".aegis", "janus", `${item.issueId}.json`) : null,
    janusArtifactExists: existsSync(janusArtifactRef),
    recommendedNextAction,
  };
}

const EXECUTABLE_DRAIN_COLUMNS = new Set<AgoraColumn>([
  "ready",
  "in_progress",
  "in_review",
  "blocked",
  "ready_to_merge",
]);

function isExecutableTicket(ticket: AgoraTicket) {
  return ticket.labels.includes("role:executable")
    || !ticket.labels.includes("role:coordination");
}

function readAgoraSummary(root: string): MockAcceptanceAgoraSummary {
  const tickets = new AgoraStore({ root }).listTickets();
  return {
    tickets: tickets.map((ticket) => ({
      id: ticket.id,
      title: ticket.title,
      column: ticket.column,
      labels: [...ticket.labels],
      blockedBy: [...ticket.blockedBy],
      blocks: [...ticket.blocks],
    })),
    executableOpenTicketIds: tickets
      .filter((ticket) => isExecutableTicket(ticket) && EXECUTABLE_DRAIN_COLUMNS.has(ticket.column))
      .map((ticket) => ticket.id),
    haltedTicketIds: tickets
      .filter((ticket) => ticket.column === "halted")
      .map((ticket) => ticket.id),
  };
}

export async function collectMockAcceptanceSurface(
  root: string,
  issueIds: { happyIssueId: string; janusIssueId: string; tracker?: TrackerLike },
): Promise<MockAcceptanceSurface> {
  const runtimeState = readRuntimeState(root);
  if (!runtimeState) {
    throw new Error(`Missing runtime state at ${path.join(root, ".aegis", "runtime-state.json")}.`);
  }

  const tracker = issueIds.tracker ?? createTrackerClient();
  const happyRecord = readDispatchRecord(root, issueIds.happyIssueId);
  const janusRecord = readDispatchRecord(root, issueIds.janusIssueId);
  const happyQueueItem = readQueueItem(root, issueIds.happyIssueId);
  const janusQueueItem = readQueueItem(root, issueIds.janusIssueId);
  const phaseLogs = readPhaseLogs(root);
  const [happyIssue, janusIssue] = await Promise.all([
    readIssueSummary(tracker, root, issueIds.happyIssueId),
    readIssueSummary(tracker, root, issueIds.janusIssueId),
  ]);

  return {
    config: readConfigSummary(root),
    runtimeState,
    dispatch: {
      happy: {
        stage: happyRecord.stage,
        oracleAssessmentRef: happyRecord.oracleAssessmentRef,
        titanHandoffRef: happyRecord.titanHandoffRef ?? null,
        sentinelVerdictRef: happyRecord.sentinelVerdictRef,
        janusArtifactRef: happyRecord.janusArtifactRef ?? null,
      },
      janus: {
        stage: janusRecord.stage,
        oracleAssessmentRef: janusRecord.oracleAssessmentRef,
        titanHandoffRef: janusRecord.titanHandoffRef ?? null,
        sentinelVerdictRef: janusRecord.sentinelVerdictRef,
        janusArtifactRef: janusRecord.janusArtifactRef ?? null,
      },
    },
    mergeQueue: {
      happy: {
        status: happyQueueItem.status,
        attempts: happyQueueItem.attempts,
        janusInvocations: happyQueueItem.janusInvocations,
        lastTier: happyQueueItem.lastTier,
      },
      janus: {
        status: janusQueueItem.status,
        attempts: janusQueueItem.attempts,
        janusInvocations: janusQueueItem.janusInvocations,
        lastTier: janusQueueItem.lastTier,
      },
    },
    trackerIssues: {
      happy: happyIssue,
      janus: janusIssue,
    },
    agora: readAgoraSummary(root),
    phaseLogs,
    labor: {
      happy: readLaborSummary(root, happyQueueItem),
      janus: readLaborSummary(root, janusQueueItem),
    },
    finalAppVerification: readFinalAppVerification(root),
  };
}

export function assertMockAcceptanceSurface(surface: MockAcceptanceSurface) {
  if (surface.runtimeState.server_state !== "stopped") {
    throw new Error(`Expected mock-run runtime to be stopped, got ${surface.runtimeState.server_state}.`);
  }

  if (surface.dispatch.happy.stage !== "complete") {
    throw new Error(`Expected happy-path issue to be complete, got ${surface.dispatch.happy.stage}.`);
  }

  if (!surface.dispatch.happy.oracleAssessmentRef || !surface.dispatch.happy.titanHandoffRef || !surface.dispatch.happy.sentinelVerdictRef) {
    throw new Error("Happy-path proof surface is missing required artifacts.");
  }

  if (surface.mergeQueue.happy.status !== "merged") {
    throw new Error(`Expected happy-path merge queue item to be merged, got ${surface.mergeQueue.happy.status}.`);
  }

  const janusMerged = surface.dispatch.janus.stage === "complete"
    && surface.mergeQueue.janus.status === "merged";
  const janusRework = surface.dispatch.janus.stage === "rework_required"
    && surface.mergeQueue.janus.status === "failed"
    && surface.labor.janus.recommendedNextAction === "requeue_parent";
  const janusBlocked = surface.dispatch.janus.stage === "blocked_on_child"
    && surface.mergeQueue.janus.status === "failed"
    && surface.labor.janus.recommendedNextAction === "create_integration_blocker";

  if (!janusMerged && !janusRework && !janusBlocked) {
    throw new Error(
      `Expected Janus-path issue to merge, require rework, or block on child, got dispatch=${surface.dispatch.janus.stage} queue=${surface.mergeQueue.janus.status}.`,
    );
  }

  if (!janusMerged && !surface.dispatch.janus.janusArtifactRef) {
    throw new Error("Janus proof surface is missing its artifact reference.");
  }

  if (!janusMerged && surface.mergeQueue.janus.janusInvocations < 1) {
    throw new Error("Janus proof surface did not record an invocation.");
  }

  if (!janusMerged && (surface.mergeQueue.janus.attempts < 3 || surface.mergeQueue.janus.lastTier !== "T3")) {
    throw new Error("Janus proof surface did not reach deterministic T3 escalation.");
  }

  if (surface.trackerIssues.happy.status !== "closed") {
    throw new Error(`Expected happy-path tracker issue to be closed, got ${surface.trackerIssues.happy.status}.`);
  }

  if (!surface.trackerIssues.janus.status) {
    throw new Error("Janus-path tracker issue status is missing.");
  }

  if (surface.agora) {
    if (surface.agora.executableOpenTicketIds.length > 0) {
      throw new Error(`Executable Agora tickets remain undrained: ${surface.agora.executableOpenTicketIds.join(", ")}.`);
    }

    if (surface.agora.haltedTicketIds.length > 0) {
      throw new Error(`Agora tickets halted during proof: ${surface.agora.haltedTicketIds.join(", ")}.`);
    }
  }

  if (!surface.phaseLogs.some((entry) => entry.phase === "poll")) {
    throw new Error("Phase log evidence is missing the poll phase.");
  }

  if (!surface.phaseLogs.some((entry) => entry.phase === "dispatch")) {
    throw new Error("Phase log evidence is missing the dispatch phase.");
  }

  if (!surface.phaseLogs.some((entry) => entry.phase === "monitor")) {
    throw new Error("Phase log evidence is missing the monitor phase.");
  }

  if (!surface.phaseLogs.some((entry) => entry.phase === "reap")) {
    throw new Error("Phase log evidence is missing the reap phase.");
  }

  if (!surface.labor.happy.queueLaborPathExists || !surface.labor.janus.queueLaborPathExists) {
    throw new Error("Labor evidence is missing the retained queue path.");
  }

  if (!janusMerged && (!surface.labor.janus.janusArtifactExists || !surface.labor.janus.preservedLaborPathExists)) {
    throw new Error("Janus labor evidence is missing the preserved worktree artifact.");
  }

  if (surface.finalAppVerification.status === "skipped") {
    if (surface.config.runtime !== "scripted") {
      throw new Error(`Final app verification skipped for ${surface.config.runtime}: ${surface.finalAppVerification.skipReason ?? "no reason recorded"}.`);
    }
    return;
  }

  if (surface.finalAppVerification.commands.length === 0) {
    throw new Error("Final app verification did not record any commands.");
  }

  const failedFinalAppCommands = surface.finalAppVerification.commands
    .filter((command) => command.exitCode !== 0)
    .map((command) => command.command);
  if (failedFinalAppCommands.length > 0) {
    throw new Error(`Final app verification failed: ${failedFinalAppCommands.join(", ")}.`);
  }
}

export async function runMockAcceptance(
  options: MockAcceptanceDependencies = {},
): Promise<MockAcceptanceResult> {
  const workspaceRoot = options.cwd
    ? path.resolve(options.cwd)
    : resolveDefaultMockWorkspaceRoot();
  const aegisCliPath = resolveAegisCliPath();
  const seed = await (options.seedMockRun ?? seedMockRun)({ workspaceRoot });
  const happyIssueId = requireIssueId(seed, HAPPY_PATH_ISSUE_KEY);
  const janusIssueId = requireIssueId(seed, JANUS_ISSUE_KEY);
  const runCommand = options.runMockCommand ?? runMockCommand;
  const waitForProgress = options.waitForMockAcceptanceProgress ?? waitForMockAcceptanceProgress;
  const collectSurface = options.collectMockAcceptanceSurface ?? collectMockAcceptanceSurface;
  const verifyApp = options.verifyFinalApp ?? verifyFinalApp;
  const tracker = options.tracker ?? createTrackerClient();

  await runCommand(["node", aegisCliPath, "start"], { mockDir: seed.repoRoot });
  await runCommand(["node", aegisCliPath, "status"], { mockDir: seed.repoRoot });
  await waitForProgress(seed.repoRoot, {
    happyIssueId,
    janusIssueId,
  });
  await runCommand(["node", aegisCliPath, "stop"], { mockDir: seed.repoRoot });
  await runCommand(["node", aegisCliPath, "status"], { mockDir: seed.repoRoot });
  await verifyApp(seed.repoRoot);

  const surface = await collectSurface(seed.repoRoot, {
    happyIssueId,
    janusIssueId,
    tracker,
  });
  assertMockAcceptanceSurface(surface);

  return {
    repoRoot: seed.repoRoot,
    seed,
    happyIssueId,
    janusIssueId,
    surface,
  };
}

function isDirectExecution(entryPoint = process.argv[1]): boolean {
  if (!entryPoint) {
    return false;
  }

  return path.resolve(entryPoint) === path.resolve(fileURLToPath(import.meta.url));
}

if (isDirectExecution()) {
  runMockAcceptance().then(
    (result) => {
      console.log(`Mock acceptance completed at ${result.repoRoot}`);
      console.log(`Happy path issue: ${result.happyIssueId}`);
      console.log(`Janus path issue: ${result.janusIssueId}`);
    },
    (error: unknown) => {
      const details = error instanceof Error ? error.message : String(error);
      console.error(details);
      process.exitCode = 1;
    },
  );
}
