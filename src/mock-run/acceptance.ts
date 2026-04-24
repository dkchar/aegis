import path from "node:path";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { loadDispatchState, type DispatchRecord } from "../core/dispatch-state.js";
import { loadMergeQueueState, type MergeQueueItem } from "../merge/merge-state.js";
import { runMockCommand, type RunMockCommandOptions } from "./mock-run.js";
import { resolveDefaultMockWorkspaceRoot } from "./mock-paths.js";
import { seedMockRun, type SeedMockRunResult } from "./seed-mock-run.js";
import { BeadsTrackerClient } from "../tracker/beads-tracker.js";
import type { RuntimeStateRecord } from "../cli/runtime-state.js";
import { readRuntimeState } from "../cli/runtime-state.js";
import type { AegisIssue } from "../tracker/issue-model.js";
import { isProcessRunning } from "../cli/runtime-state.js";

const HAPPY_PATH_ISSUE_KEY = "setup.contract";
const JANUS_ISSUE_KEY = "setup.scaffold";
const SCRIPTED_MERGE_PLAN_ENV = "AEGIS_SCRIPTED_MERGE_PLAN";
const MOCK_ACCEPTANCE_TIMEOUT_MS = 120_000;
const MOCK_ACCEPTANCE_POLL_MS = 250;

type MockCommandRunner = (
  args: string[],
  options?: RunMockCommandOptions,
) => Promise<unknown>;

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

export interface MockAcceptancePhaseLogSummary {
  timestamp: string;
  phase: "poll" | "triage" | "dispatch" | "monitor" | "reap";
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

export interface MockAcceptanceSurface {
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
  phaseLogs: MockAcceptancePhaseLogSummary[];
  labor: {
    happy: MockAcceptanceLaborSummary;
    janus: MockAcceptanceLaborSummary;
  };
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
  const logDirectory = path.join(root, ".aegis", "logs", "phases");
  if (!existsSync(logDirectory)) {
    throw new Error(`Missing phase log directory at ${logDirectory}.`);
  }

  return readdirSync(logDirectory)
    .filter((entry) => entry.endsWith(".json"))
    .sort()
    .map((entry) => {
      const raw = readFileSync(path.join(logDirectory, entry), "utf8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return {
        timestamp: String(parsed.timestamp ?? ""),
        phase: parsed.phase as MockAcceptancePhaseLogSummary["phase"],
        issueId: String(parsed.issueId ?? ""),
        action: String(parsed.action ?? ""),
        outcome: String(parsed.outcome ?? ""),
        detail: typeof parsed.detail === "string" ? parsed.detail : null,
      };
    });
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
  return record?.stage === "reviewed"
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

  const janusRequeued = record.stage === "queued_for_merge"
    && queueItem.status === "queued";
  const janusFailed = record.stage === "failed"
    && queueItem.status === "failed";

  return janusRequeued || janusFailed;
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
  if (!record || record.stage !== "scouted") {
    return null;
  }

  if (record.oracleDecompose === true) {
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

    if (
      isHappyProofComplete(happyRecord, happyQueueItem)
      && isJanusProofComplete(janusRecord, janusQueueItem)
    ) {
      return;
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
    recommendedNextAction = typeof artifact.recommendedNextAction === "string"
      ? artifact.recommendedNextAction
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

export async function collectMockAcceptanceSurface(
  root: string,
  issueIds: { happyIssueId: string; janusIssueId: string; tracker?: TrackerLike },
): Promise<MockAcceptanceSurface> {
  const runtimeState = readRuntimeState(root);
  if (!runtimeState) {
    throw new Error(`Missing runtime state at ${path.join(root, ".aegis", "runtime-state.json")}.`);
  }

  const tracker = issueIds.tracker ?? new BeadsTrackerClient();
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
    phaseLogs,
    labor: {
      happy: readLaborSummary(root, happyQueueItem),
      janus: readLaborSummary(root, janusQueueItem),
    },
  };
}

export function assertMockAcceptanceSurface(surface: MockAcceptanceSurface) {
  if (surface.runtimeState.server_state !== "stopped") {
    throw new Error(`Expected mock-run runtime to be stopped, got ${surface.runtimeState.server_state}.`);
  }

  if (surface.dispatch.happy.stage !== "reviewed") {
    throw new Error(`Expected happy-path issue to be reviewed, got ${surface.dispatch.happy.stage}.`);
  }

  if (!surface.dispatch.happy.oracleAssessmentRef || !surface.dispatch.happy.titanHandoffRef || !surface.dispatch.happy.sentinelVerdictRef) {
    throw new Error("Happy-path proof surface is missing required artifacts.");
  }

  if (surface.mergeQueue.happy.status !== "merged") {
    throw new Error(`Expected happy-path merge queue item to be merged, got ${surface.mergeQueue.happy.status}.`);
  }

  const janusRequeued = surface.dispatch.janus.stage === "queued_for_merge"
    && surface.mergeQueue.janus.status === "queued";
  const janusFailClosed = surface.dispatch.janus.stage === "failed"
    && surface.mergeQueue.janus.status === "failed"
    && surface.labor.janus.recommendedNextAction === "manual_decision";

  if (!janusRequeued && !janusFailClosed) {
    throw new Error(
      `Expected Janus-path issue to be requeued or fail-closed, got dispatch=${surface.dispatch.janus.stage} queue=${surface.mergeQueue.janus.status}.`,
    );
  }

  if (!surface.dispatch.janus.janusArtifactRef) {
    throw new Error("Janus proof surface is missing its artifact reference.");
  }

  if (surface.mergeQueue.janus.janusInvocations < 1) {
    throw new Error("Janus proof surface did not record an invocation.");
  }

  if (surface.mergeQueue.janus.attempts < 3 || surface.mergeQueue.janus.lastTier !== "T3") {
    throw new Error("Janus proof surface did not reach deterministic T3 escalation.");
  }

  if (surface.trackerIssues.happy.status !== "closed") {
    throw new Error(`Expected happy-path tracker issue to be closed, got ${surface.trackerIssues.happy.status}.`);
  }

  if (!surface.trackerIssues.janus.status) {
    throw new Error("Janus-path tracker issue status is missing.");
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

  if (!surface.labor.janus.janusArtifactExists || !surface.labor.janus.preservedLaborPathExists) {
    throw new Error("Janus labor evidence is missing the preserved worktree artifact.");
  }
}

function buildScriptedMergePlan(issueId: string) {
  return JSON.stringify({
    rules: [
      {
        issueId,
        candidateBranch: `aegis/${issueId}`,
        outcomes: [
          { outcome: "conflict", detail: "Deterministic acceptance merge conflict." },
          { outcome: "conflict", detail: "Deterministic acceptance merge conflict." },
          { outcome: "conflict", detail: "Deterministic acceptance merge conflict." },
        ],
      },
    ],
  });
}

async function withTemporaryEnv<T>(
  key: string,
  value: string | undefined,
  action: () => Promise<T>,
): Promise<T> {
  const previous = process.env[key];
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }

  try {
    return await action();
  } finally {
    if (previous === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous;
    }
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
  const tracker = options.tracker ?? new BeadsTrackerClient();

  await withTemporaryEnv(SCRIPTED_MERGE_PLAN_ENV, buildScriptedMergePlan(janusIssueId), async () => {
    await runCommand(["node", aegisCliPath, "start"], { mockDir: seed.repoRoot });
    await runCommand(["node", aegisCliPath, "status"], { mockDir: seed.repoRoot });
    await waitForProgress(seed.repoRoot, {
      happyIssueId,
      janusIssueId,
    });
    await runCommand(["node", aegisCliPath, "stop"], { mockDir: seed.repoRoot });
    await runCommand(["node", aegisCliPath, "status"], { mockDir: seed.repoRoot });
  });

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
