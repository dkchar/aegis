import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

import type { AegisConfig } from "../config/schema.js";
import { DispatchStage, transitionStage } from "./stage-transition.js";
import {
  loadDispatchState,
  saveDispatchState,
  type DispatchRecord,
  type DispatchState,
} from "./dispatch-state.js";
import { createLoopPhaseLog } from "../events/dashboard-events.js";
import {
  loadMergeQueueState,
  nextQueuedItem,
  saveMergeQueueState,
  type QueueItemStatus,
} from "../merge/merge-queue-store.js";
import { runAdmissionWorkflow } from "../merge/admission-workflow.js";
import { processNextQueueItem } from "../merge/queue-worker.js";
import { runOracle } from "./run-oracle.js";
import { runTitan } from "./run-titan.js";
import { runSentinel } from "./run-sentinel.js";
import { parseOracleAssessment } from "../castes/oracle/oracle-parser.js";
import { planLaborCreation, type LaborCreationPlan } from "../labor/create-labor.js";
import type { AgentRuntime } from "../runtime/agent-runtime.js";
import type { BeadsClient } from "../tracker/beads-client.js";
import type { AegisIssue } from "../tracker/issue-model.js";
import type { LiveEventPublisher } from "../events/event-bus.js";
import type { ParsedCommand } from "../cli/parse-command.js";
import type { CommandExecutionResult } from "./command-executor.js";

interface DirectCommandDependencies {
  projectRoot: string;
  config: AegisConfig;
  tracker: BeadsClient;
  runtime: AgentRuntime;
  eventPublisher: LiveEventPublisher;
}

interface OracleStageOutcome {
  issue: AegisIssue;
  record: DispatchRecord;
  readyForImplementation: boolean;
  message: string;
}

interface TitanStageOutcome {
  issue: AegisIssue;
  record: DispatchRecord;
  labor: LaborCreationPlan;
  message: string;
}

interface MergeStageOutcome {
  issue: AegisIssue;
  record: DispatchRecord;
  message: string;
}

const NOOP_SUBSCRIBE: LiveEventPublisher["subscribe"] = () => () => {};
let mergeQueueLock: Promise<void> = Promise.resolve();

function createPendingDispatchRecord(
  issueId: string,
  sessionProvenanceId: string,
): DispatchRecord {
  const now = new Date().toISOString();

  return {
    issueId,
    stage: DispatchStage.Pending,
    runningAgent: null,
    oracleAssessmentRef: null,
    sentinelVerdictRef: null,
    fileScope: null,
    failureCount: 0,
    consecutiveFailures: 0,
    failureWindowStartMs: null,
    cooldownUntil: null,
    cumulativeSpendUsd: null,
    sessionProvenanceId,
    updatedAt: now,
  };
}

function withRunningAgent(
  record: DispatchRecord,
  caste: "oracle" | "titan" | "sentinel",
): DispatchRecord {
  const now = new Date().toISOString();

  return {
    ...record,
    runningAgent: {
      caste,
      sessionId: `${record.issueId}-${caste}-${randomUUID()}`,
      startedAt: now,
    },
    updatedAt: now,
  };
}

function persistDispatchRecord(
  deps: DirectCommandDependencies,
  state: DispatchState,
  record: DispatchRecord,
): DispatchState {
  const latestState = loadDispatchState(deps.projectRoot);
  const baseState = latestState.schemaVersion === state.schemaVersion
    ? latestState
    : state;
  const nextState: DispatchState = {
    schemaVersion: baseState.schemaVersion,
    records: {
      ...baseState.records,
      [record.issueId]: record,
    },
  };
  saveDispatchState(deps.projectRoot, nextState);
  return nextState;
}

async function withMergeQueueLock<T>(work: () => Promise<T>): Promise<T> {
  const previous = mergeQueueLock;
  let release: () => void = () => {};
  mergeQueueLock = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;

  try {
    return await work();
  } finally {
    release();
  }
}

function runGit(
  workingDirectory: string,
  args: readonly string[],
): string {
  const result = spawnSync("git", args, {
    cwd: workingDirectory,
    encoding: "utf8",
    windowsHide: true,
  });

  if (result.status !== 0) {
    const detail = (result.stderr ?? result.stdout ?? "unknown error").trim();
    throw new Error(`git ${args.join(" ")} failed: ${detail}`);
  }

  return (result.stdout ?? "").trim();
}

function gitBranchExists(projectRoot: string, branchName: string): boolean {
  const result = spawnSync(
    "git",
    ["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`],
    {
      cwd: projectRoot,
      windowsHide: true,
    },
  );

  return result.status === 0;
}

function ensureLaborWorktree(
  projectRoot: string,
  issueId: string,
  baseBranch: string = "main",
): LaborCreationPlan {
  const labor = planLaborCreation({
    issueId,
    projectRoot,
    baseBranch,
  });

  if (!existsSync(path.join(labor.laborPath, ".git"))) {
    mkdirSync(path.dirname(labor.laborPath), { recursive: true });
    const worktreeArgs = gitBranchExists(projectRoot, labor.branchName)
      ? ["worktree", "add", labor.laborPath, labor.branchName]
      : [...labor.createWorktreeCommand.args];
    runGit(projectRoot, worktreeArgs);
  }

  return labor;
}

function commitLaborChanges(laborPath: string, issueId: string) {
  const statusOutput = runGit(laborPath, ["status", "--porcelain"]);
  if (statusOutput.trim() === "") {
    return false;
  }

  runGit(laborPath, ["add", "-A"]);
  runGit(laborPath, ["commit", "-m", `aegis(${issueId}): prepare merge candidate`]);
  return true;
}

function loadAssessment(
  projectRoot: string,
  record: DispatchRecord,
) {
  if (!record.oracleAssessmentRef) {
    return null;
  }

  const absolutePath = path.join(projectRoot, record.oracleAssessmentRef);
  return parseOracleAssessment(readFileSync(absolutePath, "utf8"));
}

function describeAlreadyReached(record: DispatchRecord): string {
  return `Issue ${record.issueId} is already at stage=${record.stage}.`;
}

export function reconcileDispatchRecordAfterQueueStatus(
  record: DispatchRecord,
  queueStatus: QueueItemStatus,
): DispatchRecord {
  switch (queueStatus) {
    case "merged": {
      let mergedRecord = record;

      if (mergedRecord.stage === DispatchStage.QueuedForMerge) {
        mergedRecord = transitionStage(mergedRecord, DispatchStage.Merging);
      }

      if (
        mergedRecord.stage === DispatchStage.Merging
        || mergedRecord.stage === DispatchStage.ResolvingIntegration
      ) {
        return transitionStage(mergedRecord, DispatchStage.Merged);
      }

      return mergedRecord;
    }

    case "queued":
      if (record.stage === DispatchStage.ResolvingIntegration) {
        return transitionStage(record, DispatchStage.QueuedForMerge);
      }
      return record;

    case "janus_required":
      if (record.stage === DispatchStage.QueuedForMerge) {
        return transitionStage(record, DispatchStage.Merging);
      }
      return record;

    case "merge_failed":
    case "rework_requested":
    case "manual_decision_required":
    case "janus_failed":
      if (record.stage === DispatchStage.Failed) {
        return record;
      }
      if (
        record.stage === DispatchStage.Implemented
        || record.stage === DispatchStage.QueuedForMerge
        || record.stage === DispatchStage.Merging
        || record.stage === DispatchStage.ResolvingIntegration
      ) {
        return transitionStage(record, DispatchStage.Failed);
      }
      break;

    default:
      return record;
  }

  throw new Error(
    `Cannot reconcile queue status ${queueStatus} from dispatch stage=${record.stage}.`,
  );
}

async function scoutIssue(
  deps: DirectCommandDependencies,
  issueId: string,
): Promise<CommandExecutionResult> {
  const issue = await deps.tracker.getIssue(issueId);
  if (issue.status === "closed") {
    return {
      kind: "scout",
      status: "handled",
      message: `Issue ${issueId} is already closed.`,
    };
  }

  let state = loadDispatchState(deps.projectRoot);
  const sessionProvenanceId = `direct-${randomUUID()}`;
  let record = state.records[issueId] ?? createPendingDispatchRecord(issueId, sessionProvenanceId);

  if (
    record.stage !== DispatchStage.Pending
    && record.stage !== DispatchStage.Failed
    && record.stage !== DispatchStage.Scouting
  ) {
    return {
      kind: "scout",
      status: "handled",
      message: describeAlreadyReached(record),
    };
  }

  if (record.stage === DispatchStage.Failed) {
    record = transitionStage(record, DispatchStage.Pending);
  }

  const scoutingRecord = record.stage === DispatchStage.Pending
    ? transitionStage(record, DispatchStage.Scouting)
    : record;
  record = withRunningAgent(scoutingRecord, "oracle");
  state = persistDispatchRecord(deps, state, record);

  const oracleResult = await runOracle({
    issue,
    record,
    runtime: deps.runtime,
    tracker: deps.tracker,
    budget: deps.config.budgets.oracle,
    projectRoot: deps.projectRoot,
    operatingMode: "conversational",
    allowComplexAutoDispatch: true,
    mnemosyne: deps.config.mnemosyne,
    model: deps.config.models.oracle,
    eventPublisher: deps.eventPublisher,
  });
  persistDispatchRecord(deps, state, oracleResult.updatedRecord);

  if (oracleResult.updatedRecord.stage === DispatchStage.Failed) {
    const failureReason = oracleResult.failureReason ?? "unknown error";

    // Detect tool-call failure: model produced no output.
    // Emit a FATAL loop phase log and let the caller handle stopping the loop.
    // DO NOT close the issue — the user needs to change their model config first.
    if (failureReason === "Oracle did not return a final message payload") {
      deps.eventPublisher.publish(createLoopPhaseLog(
        "monitor",
        `FATAL: oracle produced no output — model may not support tool calling. Change the model in .pi/settings.json and restart.`,
        issueId,
      ));

      return {
        kind: "scout",
        status: "declined",
        message: `Scout failed for ${issueId}: ${failureReason}`,
      };
    }

    return {
      kind: "scout",
      status: "declined",
      message: `Scout failed for ${issueId}: ${failureReason}`,
    };
  }

  if (oracleResult.readyForImplementation) {
    return {
      kind: "scout",
      status: "handled",
      message: `Scouted ${issueId}; ready for implementation.`,
    };
  }

  if (oracleResult.createdIssues.length > 0) {
    return {
      kind: "scout",
      status: "handled",
      message: `Scouted ${issueId}; created ${oracleResult.createdIssues.length} derived issue(s).`,
    };
  }

  return {
    kind: "scout",
    status: "handled",
    message: `Scouted ${issueId}.`,
  };
}

async function ensureOracleStage(
  deps: DirectCommandDependencies,
  issueId: string,
): Promise<OracleStageOutcome | CommandExecutionResult> {
  const issue = await deps.tracker.getIssue(issueId);
  let state = loadDispatchState(deps.projectRoot);
  const sessionProvenanceId = `direct-${randomUUID()}`;
  let record = state.records[issueId] ?? createPendingDispatchRecord(issueId, sessionProvenanceId);

  if (record.stage === DispatchStage.Complete) {
    return {
      kind: "process",
      status: "handled",
      message: `Issue ${issueId} is already complete.`,
    };
  }

  if (record.stage === DispatchStage.Failed) {
    record = transitionStage(record, DispatchStage.Pending);
  }

  if (record.stage === DispatchStage.Pending || record.stage === DispatchStage.Scouting) {
    const scoutingRecord = record.stage === DispatchStage.Pending
      ? transitionStage(record, DispatchStage.Scouting)
      : record;
    record = withRunningAgent(scoutingRecord, "oracle");
    state = persistDispatchRecord(deps, state, record);

    const oracleResult = await runOracle({
      issue,
      record,
      runtime: deps.runtime,
      tracker: deps.tracker,
      budget: deps.config.budgets.oracle,
      projectRoot: deps.projectRoot,
      operatingMode: "conversational",
      allowComplexAutoDispatch: true,
      mnemosyne: deps.config.mnemosyne,
      model: deps.config.models.oracle,
      eventPublisher: deps.eventPublisher,
    });
    state = persistDispatchRecord(deps, state, oracleResult.updatedRecord);
    const refreshedIssue = await deps.tracker.getIssue(issueId);

    if (oracleResult.updatedRecord.stage === DispatchStage.Failed) {
      return {
        kind: "process",
        status: "declined",
        message: `Scout failed for ${issueId}: ${oracleResult.failureReason ?? "unknown error"}`,
      };
    }

    return {
      issue: refreshedIssue,
      record: oracleResult.updatedRecord,
      readyForImplementation: oracleResult.readyForImplementation,
      message: oracleResult.readyForImplementation
        ? `Scouted ${issueId}; ready for implementation.`
        : `Scouted ${issueId}.`,
    };
  }

  if (record.stage !== DispatchStage.Scouted
    && record.stage !== DispatchStage.Implementing
    && record.stage !== DispatchStage.Implemented
    && record.stage !== DispatchStage.QueuedForMerge
    && record.stage !== DispatchStage.Merging
    && record.stage !== DispatchStage.Merged
    && record.stage !== DispatchStage.Reviewing) {
    return {
      kind: "process",
      status: "declined",
      message: `Cannot use direct commands from stage=${record.stage}.`,
    };
  }

  const assessment = loadAssessment(deps.projectRoot, record);
  const readyForImplementation = assessment?.ready === true && issue.blockers.length === 0;

  return {
    issue,
    record,
    readyForImplementation,
    message: describeAlreadyReached(record),
  };
}

async function implementIssue(
  deps: DirectCommandDependencies,
  issueId: string,
): Promise<CommandExecutionResult> {
  const oracleStage = await ensureOracleStage(deps, issueId);
  if ("status" in oracleStage) {
    return {
      ...oracleStage,
      kind: "implement",
    };
  }

  if (oracleStage.record.stage === DispatchStage.Implemented
    || oracleStage.record.stage === DispatchStage.QueuedForMerge
    || oracleStage.record.stage === DispatchStage.Merging
    || oracleStage.record.stage === DispatchStage.Merged
    || oracleStage.record.stage === DispatchStage.Reviewing
    || oracleStage.record.stage === DispatchStage.Complete) {
    return {
      kind: "implement",
      status: "handled",
      message: describeAlreadyReached(oracleStage.record),
    };
  }

  if (!oracleStage.readyForImplementation) {
    return {
      kind: "implement",
      status: "declined",
      message: `Issue ${issueId} is not ready for implementation after scouting.`,
    };
  }

  let state = loadDispatchState(deps.projectRoot);
  const labor = ensureLaborWorktree(deps.projectRoot, issueId);
  const implementingStageRecord = oracleStage.record.stage === DispatchStage.Scouted
    ? transitionStage(oracleStage.record, DispatchStage.Implementing)
    : oracleStage.record;
  const implementingRecord = withRunningAgent(implementingStageRecord, "titan");
  state = persistDispatchRecord(deps, state, implementingRecord);

  const titanResult = await runTitan({
    issue: oracleStage.issue,
    record: implementingRecord,
    labor,
    runtime: deps.runtime,
    tracker: deps.tracker,
    budget: deps.config.budgets.titan,
    projectRoot: deps.projectRoot,
    mnemosyne: deps.config.mnemosyne,
    model: deps.config.models.titan,
    eventPublisher: deps.eventPublisher,
  });
  persistDispatchRecord(deps, state, titanResult.updatedRecord);

  if (titanResult.updatedRecord.stage !== DispatchStage.Implemented) {
    return {
      kind: "implement",
      status: "declined",
      message: `Implementation failed for ${issueId}: ${titanResult.failureReason ?? titanResult.outcome}`,
    };
  }

  commitLaborChanges(labor.laborPath, issueId);

  return {
    kind: "implement",
    status: "handled",
    message: `Implemented ${issueId}; candidate branch ${labor.branchName} is ready.`,
  };
}

async function ensureImplementedStage(
  deps: DirectCommandDependencies,
  issueId: string,
): Promise<TitanStageOutcome | CommandExecutionResult> {
  const implementResult = await implementIssue(deps, issueId);
  if (implementResult.status !== "handled") {
    return {
      ...implementResult,
      kind: "review",
    };
  }

  const issue = await deps.tracker.getIssue(issueId);
  const record = loadDispatchState(deps.projectRoot).records[issueId];
  if (!record) {
    return {
      kind: "review",
      status: "declined",
      message: `No dispatch record exists for ${issueId}.`,
    };
  }

  if (record.stage !== DispatchStage.Implemented
    && record.stage !== DispatchStage.QueuedForMerge
    && record.stage !== DispatchStage.Merging
    && record.stage !== DispatchStage.Merged
    && record.stage !== DispatchStage.Reviewing
    && record.stage !== DispatchStage.Complete) {
    return {
      kind: "review",
      status: "declined",
      message: `Issue ${issueId} did not reach an implemented state.`,
    };
  }

  return {
    issue,
    record,
    labor: ensureLaborWorktree(deps.projectRoot, issueId),
    message: implementResult.message,
  };
}

async function ensureMergedStage(
  deps: DirectCommandDependencies,
  issueId: string,
): Promise<MergeStageOutcome | CommandExecutionResult> {
  const implementedStage = await ensureImplementedStage(deps, issueId);
  if ("status" in implementedStage) {
    return implementedStage;
  }

  return withMergeQueueLock(async () => {
    const latestRecord = loadDispatchState(deps.projectRoot).records[issueId] ?? implementedStage.record;

    if (latestRecord.stage === DispatchStage.Merged
      || latestRecord.stage === DispatchStage.Reviewing
      || latestRecord.stage === DispatchStage.Complete) {
      return {
        issue: implementedStage.issue,
        record: latestRecord,
        message: describeAlreadyReached(latestRecord),
      };
    }

    let dispatchState = loadDispatchState(deps.projectRoot);
    let queueState = loadMergeQueueState(deps.projectRoot);

    if (latestRecord.stage === DispatchStage.Implemented) {
      const admission = runAdmissionWorkflow(
        dispatchState,
        queueState,
        deps.eventPublisher,
        {
          dispatchRecord: latestRecord,
          candidateBranch: implementedStage.labor.branchName,
          targetBranch: "main",
        },
      );

      dispatchState = admission.dispatchState;
      queueState = admission.queueState;
      saveDispatchState(deps.projectRoot, dispatchState);
      saveMergeQueueState(deps.projectRoot, queueState);
    }

    let currentRecord = loadDispatchState(deps.projectRoot).records[issueId];
    if (!currentRecord) {
      return {
        kind: "review",
        status: "declined",
        message: `No dispatch record exists for ${issueId}.`,
      };
    }

    const queueStateForProcessing = loadMergeQueueState(deps.projectRoot);
    const janusRequiredItem = queueStateForProcessing.items.find(
      (item) => item.status === "janus_required",
    );
    if (janusRequiredItem && janusRequiredItem.issueId !== issueId) {
      return {
        kind: "review",
        status: "declined",
        message: `Issue ${issueId} cannot bypass Janus work for ${janusRequiredItem.issueId}.`,
      };
    }

    const nextQueued = nextQueuedItem(queueStateForProcessing);
    if (nextQueued && nextQueued.issueId !== issueId) {
      return {
        kind: "review",
        status: "declined",
        message: `Issue ${issueId} is queued behind ${nextQueued.issueId}; direct review cannot skip FIFO merge order.`,
      };
    }

    if (currentRecord.stage === DispatchStage.QueuedForMerge) {
      currentRecord = transitionStage(currentRecord, DispatchStage.Merging);
      dispatchState = {
        schemaVersion: dispatchState.schemaVersion,
        records: {
          ...dispatchState.records,
          [issueId]: currentRecord,
        },
      };
      saveDispatchState(deps.projectRoot, dispatchState);
    }

    const queueResult = await processNextQueueItem(queueStateForProcessing, {
      projectRoot: deps.projectRoot,
      eventPublisher: deps.eventPublisher,
      janusEnabled: deps.config.janus.enabled,
      maxRetryAttempts: deps.config.thresholds.janus_retry_threshold,
      targetBranch: "main",
      runtime: deps.runtime,
      janusModel: deps.config.models.janus,
    });

    if (!queueResult) {
      return {
        kind: "review",
        status: "declined",
        message: `Merge queue is empty for ${issueId}.`,
      };
    }

    saveMergeQueueState(deps.projectRoot, queueResult.updatedState);
    dispatchState = loadDispatchState(deps.projectRoot);
    const postQueueRecord = dispatchState.records[issueId] ?? currentRecord;
    const reconciledRecord = reconcileDispatchRecordAfterQueueStatus(
      postQueueRecord,
      queueResult.result.newStatus,
    );

    if (reconciledRecord !== postQueueRecord) {
      dispatchState = {
        schemaVersion: dispatchState.schemaVersion,
        records: {
          ...dispatchState.records,
          [issueId]: reconciledRecord,
        },
      };
      saveDispatchState(deps.projectRoot, dispatchState);
    }

    if (queueResult.result.newStatus !== "merged") {
      const detail = queueResult.result.error ?? queueResult.result.newStatus;
      const message = queueResult.result.newStatus === "janus_required"
        ? `Merge for ${issueId} now requires Janus resolution before review can continue.`
        : queueResult.result.newStatus === "queued"
          ? `Janus resolved ${issueId}; the candidate was requeued for a fresh mechanical merge pass.`
          : `Merge failed for ${issueId}: ${detail}`;

      return {
        kind: "review",
        status: "declined",
        message,
      };
    }

    return {
      issue: implementedStage.issue,
      record: reconciledRecord,
      message: `Merged ${issueId}.`,
    };
  });
}

async function reviewIssue(
  deps: DirectCommandDependencies,
  issueId: string,
  finalVerb: "reviewed" | "processed",
): Promise<CommandExecutionResult> {
  const mergedStage = await ensureMergedStage(deps, issueId);
  if ("status" in mergedStage) {
    return {
      ...mergedStage,
      kind: finalVerb === "reviewed" ? "review" : "process",
    };
  }

  if (mergedStage.record.stage === DispatchStage.Complete) {
    return {
      kind: finalVerb === "reviewed" ? "review" : "process",
      status: "handled",
      message: `Issue ${issueId} is already complete.`,
    };
  }

  const reviewingStageRecord = mergedStage.record.stage === DispatchStage.Merged
    ? transitionStage(mergedStage.record, DispatchStage.Reviewing)
    : mergedStage.record;
  const reviewingRecord = withRunningAgent(reviewingStageRecord, "sentinel");
  let state = loadDispatchState(deps.projectRoot);
  state = persistDispatchRecord(deps, state, reviewingRecord);

  const sentinelResult = await runSentinel({
    issue: mergedStage.issue,
    record: reviewingRecord,
    runtime: deps.runtime,
    tracker: deps.tracker,
    budget: deps.config.budgets.sentinel,
    projectRoot: deps.projectRoot,
    model: deps.config.models.sentinel,
    eventPublisher: deps.eventPublisher,
  });
  state = persistDispatchRecord(deps, state, sentinelResult.updatedRecord);

  if (sentinelResult.updatedRecord.stage !== DispatchStage.Complete) {
    return {
      kind: finalVerb === "reviewed" ? "review" : "process",
      status: "declined",
      message: `Sentinel review failed for ${issueId}: ${sentinelResult.failureReason ?? "review did not pass"}`,
    };
  }

  await deps.tracker.closeIssue(issueId, "Completed");

  return {
    kind: finalVerb === "reviewed" ? "review" : "process",
    status: "handled",
    message: finalVerb === "reviewed"
      ? `Reviewed ${issueId}; Sentinel passed and the issue is closed.`
      : `Processed ${issueId}; completed review and closed the issue.`,
  };
}

export async function executeProjectDirectCommand(
  command: ParsedCommand,
  deps: DirectCommandDependencies,
): Promise<CommandExecutionResult> {
  if (command.kind === "unsupported") {
    return {
      kind: "unsupported",
      status: "unsupported",
      message: command.reason,
    };
  }

  if (command.kind === "scout") {
    return scoutIssue(deps, command.issueId);
  }

  if (command.kind === "implement") {
    return implementIssue(deps, command.issueId);
  }

  if (command.kind === "review") {
    return reviewIssue(deps, command.issueId, "reviewed");
  }

  if (command.kind === "process") {
    return reviewIssue(deps, command.issueId, "processed");
  }

  return {
    kind: command.kind,
    status: "handled",
    message: `Command "${command.kind}" acknowledged.`,
  };
}

export function createNoopEventPublisher(): LiveEventPublisher {
  return {
    publish: () => {},
    subscribe: NOOP_SUBSCRIBE,
  };
}
