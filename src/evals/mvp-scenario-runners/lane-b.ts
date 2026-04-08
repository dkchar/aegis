import { DEFAULT_AEGIS_CONFIG } from "../../config/defaults.js";
import { pollForWork } from "../../core/poller.js";
import { runJanus } from "../../core/run-janus.js";
import { runOracle } from "../../core/run-oracle.js";
import { runSentinel } from "../../core/run-sentinel.js";
import { runTitan } from "../../core/run-titan.js";
import { DispatchStage, transitionStage } from "../../core/stage-transition.js";
import { emitOutcomeArtifact } from "../../merge/emit-outcome-artifact.js";
import { runAdmissionWorkflow } from "../../merge/admission-workflow.js";
import { handleJanusResult } from "../../merge/janus-integration.js";
import {
  dequeueItem,
} from "../../merge/enqueue-candidate.js";
import {
  emptyMergeQueueState,
  loadMergeQueueState,
  reconcileMergeQueueState,
  saveMergeQueueState,
  type MergeQueueState,
} from "../../merge/merge-queue-store.js";
import { preserveLabor } from "../../merge/preserve-labor.js";
import type { AegisIssue, ReadyIssue } from "../../tracker/issue-model.js";
import type { BeadsClient } from "../../tracker/beads-client.js";
import type { MvpScenarioId } from "../wire-mvp-scenarios.js";
import {
  buildScenarioResult,
  createDispatchRecord,
  createScenarioSandbox,
  createScriptedRuntime,
  createTrackedIssue,
  ensureLaborPlan,
  InMemoryScenarioTracker,
  type MvpScenarioRunner,
} from "./shared.js";
import type { DispatchRecord } from "../../core/dispatch-state.js";

function withRunningAgent(
  record: DispatchRecord,
  caste: "oracle" | "titan" | "sentinel" | "janus",
): DispatchRecord {
  return {
    ...record,
    runningAgent: createDispatchRecord(record.issueId, record.stage, {
      caste,
      sessionProvenanceId: record.sessionProvenanceId,
    }).runningAgent,
  };
}

function buildOraclePayload(overrides: {
  estimated_complexity: "trivial" | "moderate" | "complex";
  ready: boolean;
  files_affected?: string[];
}): string {
  return JSON.stringify({
    files_affected: overrides.files_affected ?? [],
    estimated_complexity: overrides.estimated_complexity,
    decompose: false,
    ready: overrides.ready,
  });
}

function buildTitanPayload(overrides: {
  outcome: "success" | "clarification" | "failure";
  summary: string;
  files_changed?: string[];
  tests_and_checks_run?: string[];
  known_risks?: string[];
  follow_up_work?: string[];
  learnings_written_to_mnemosyne?: string[];
}): string {
  return JSON.stringify({
    outcome: overrides.outcome,
    summary: overrides.summary,
    files_changed: overrides.files_changed ?? [],
    tests_and_checks_run: overrides.tests_and_checks_run ?? ["npm run test"],
    known_risks: overrides.known_risks ?? [],
    follow_up_work: overrides.follow_up_work ?? [],
    learnings_written_to_mnemosyne: overrides.learnings_written_to_mnemosyne ?? [],
  });
}

function buildSentinelPassPayload(reviewSummary: string): string {
  return JSON.stringify({
    verdict: "pass",
    reviewSummary,
    issuesFound: [],
    followUpIssueIds: [],
    riskAreas: [],
  });
}

function buildJanusPayload(overrides: {
  issueId: string;
  conflictSummary: string;
  recommendedNextAction: "requeue" | "manual_decision" | "fail";
}): string {
  return JSON.stringify({
    originatingIssueId: overrides.issueId,
    queueItemId: overrides.issueId,
    preservedLaborPath: `.aegis/labors/labor-${overrides.issueId}`,
    conflictSummary: overrides.conflictSummary,
    resolutionStrategy: "Structured Janus resolution",
    filesTouched: ["src/merge/queue-worker.ts"],
    validationsRun: ["npm run test"],
    residualRisks: [],
    recommendedNextAction: overrides.recommendedNextAction,
  });
}

async function runOracleStage(
  projectRoot: string,
  tracker: InMemoryScenarioTracker,
  issue: AegisIssue,
  payload: string,
) {
  return runOracle({
    issue,
    record: createDispatchRecord(issue.id, DispatchStage.Scouting, {
      caste: "oracle",
    }),
    runtime: createScriptedRuntime({
      [`oracle:${issue.id}`]: {
        messages: [payload],
      },
    }),
    tracker,
    budget: DEFAULT_AEGIS_CONFIG.budgets.oracle,
    projectRoot,
    operatingMode: "auto",
    allowComplexAutoDispatch: false,
    mnemosyne: DEFAULT_AEGIS_CONFIG.mnemosyne,
  });
}

async function runTitanStage(
  projectRoot: string,
  tracker: InMemoryScenarioTracker,
  issue: AegisIssue,
  record: DispatchRecord,
  payload: string,
) {
  return runTitan({
    issue,
    record: withRunningAgent(
      transitionStage(record, DispatchStage.Implementing),
      "titan",
    ),
    labor: ensureLaborPlan(projectRoot, issue.id),
    runtime: createScriptedRuntime({
      [`titan:${issue.id}`]: {
        messages: [payload],
      },
    }),
    tracker,
    budget: DEFAULT_AEGIS_CONFIG.budgets.titan,
    projectRoot,
    mnemosyne: DEFAULT_AEGIS_CONFIG.mnemosyne,
  });
}

async function runSentinelPassStage(
  projectRoot: string,
  tracker: InMemoryScenarioTracker,
  issue: AegisIssue,
  mergedRecord: DispatchRecord,
  reviewSummary: string,
) {
  return runSentinel({
    issue,
    record: withRunningAgent(
      transitionStage(mergedRecord, DispatchStage.Reviewing),
      "sentinel",
    ),
    runtime: createScriptedRuntime({
      [`sentinel:${issue.id}`]: {
        messages: [buildSentinelPassPayload(reviewSummary)],
      },
    }),
    tracker,
    budget: DEFAULT_AEGIS_CONFIG.budgets.sentinel,
    projectRoot,
  });
}

function admitIssue(
  eventBus: ReturnType<typeof createScenarioSandbox>["eventBus"],
  implementedRecord: DispatchRecord,
): {
  queuedRecord: DispatchRecord;
  queueState: MergeQueueState;
} {
  const admission = runAdmissionWorkflow(
    {
      schemaVersion: 1,
      records: {
        [implementedRecord.issueId]: implementedRecord,
      },
    },
    emptyMergeQueueState(),
    eventBus,
    {
      dispatchRecord: implementedRecord,
      candidateBranch: `aegis/${implementedRecord.issueId}`,
      targetBranch: "main",
    },
  );

  return {
    queuedRecord: admission.dispatchState.records[implementedRecord.issueId],
    queueState: admission.queueState,
  };
}

async function mergeCleanAfterQueue(
  projectRoot: string,
  tracker: InMemoryScenarioTracker,
  issue: AegisIssue,
  queuedRecord: DispatchRecord,
  reviewSummary: string,
) {
  const mergingRecord = transitionStage(queuedRecord, DispatchStage.Merging);
  const mergedRecord = transitionStage(mergingRecord, DispatchStage.Merged);

  await emitOutcomeArtifact(
    issue.id,
    "MERGED",
    `aegis/${issue.id}`,
    "main",
    0,
    "Clean merge succeeded",
    false,
    projectRoot,
  );
  await runSentinelPassStage(
    projectRoot,
    tracker,
    issue,
    mergedRecord,
    reviewSummary,
  );
  await tracker.closeIssue(issue.id);
}

async function prepareImplementedIssue(
  projectRoot: string,
  tracker: InMemoryScenarioTracker,
  issue: AegisIssue,
  oracleFiles: string[],
  titanFiles: string[],
) {
  const oracleResult = await runOracleStage(
    projectRoot,
    tracker,
    issue,
    buildOraclePayload({
      estimated_complexity: "moderate",
      ready: true,
      files_affected: oracleFiles,
    }),
  );
  if (!oracleResult.readyForImplementation) {
    throw new Error(`Scenario expected ${issue.id} to be ready for implementation`);
  }

  return runTitanStage(
    projectRoot,
    tracker,
    issue,
    oracleResult.updatedRecord,
    buildTitanPayload({
      outcome: "success",
      summary: `Implemented ${issue.id}`,
      files_changed: titanFiles,
    }),
  );
}

const staleBranchReworkRunner: MvpScenarioRunner = async (context) => {
  const sandbox = createScenarioSandbox();
  try {
    const issue = createTrackedIssue("stale-001", "Stale branch rework");
    const tracker = new InMemoryScenarioTracker([issue]);
    const implementedResult = await prepareImplementedIssue(
      sandbox.projectRoot,
      tracker,
      issue,
      ["src/merge/queue-worker.ts"],
      ["src/merge/queue-worker.ts"],
    );
    const firstAdmission = admitIssue(sandbox.eventBus, implementedResult.updatedRecord);

    await emitOutcomeArtifact(
      issue.id,
      "REWORK_REQUEST",
      `aegis/${issue.id}`,
      "main",
      1,
      "Stale branch requires a refreshed implementation pass",
      true,
      sandbox.projectRoot,
    );
    await preserveLabor({
      issueId: issue.id,
      laborPath: ensureLaborPlan(sandbox.projectRoot, issue.id).laborPath,
      branchName: ensureLaborPlan(sandbox.projectRoot, issue.id).branchName,
      outcome: "REWORK_REQUEST",
      isConflict: false,
      reason: "Stale branch requires refresh",
    });

    const refreshedOracle = await runOracleStage(
      sandbox.projectRoot,
      tracker,
      issue,
      buildOraclePayload({
        estimated_complexity: "moderate",
        ready: true,
        files_affected: ["src/merge/queue-worker.ts"],
      }),
    );
    const refreshedTitan = await runTitanStage(
      sandbox.projectRoot,
      tracker,
      issue,
      refreshedOracle.updatedRecord,
      buildTitanPayload({
        outcome: "success",
        summary: "Refreshed candidate after stale-branch rework",
        files_changed: ["src/merge/queue-worker.ts"],
      }),
    );
    const refreshedQueue = dequeueItem(firstAdmission.queueState, issue.id);
    const secondAdmission = runAdmissionWorkflow(
      {
        schemaVersion: 1,
        records: {
          [issue.id]: refreshedTitan.updatedRecord,
        },
      },
      refreshedQueue,
      sandbox.eventBus,
      {
        dispatchRecord: refreshedTitan.updatedRecord,
        candidateBranch: `aegis/${issue.id}`,
        targetBranch: "main",
      },
    );

    await mergeCleanAfterQueue(
      sandbox.projectRoot,
      tracker,
      issue,
      secondAdmission.dispatchState.records[issue.id],
      "Sentinel approved reworked candidate",
    );

    return buildScenarioResult(context, {
      completionOutcomes: {
        "stale-001": "completed",
      },
      mergeOutcomes: {
        "stale-001": "merged_after_rework",
      },
    });
  } finally {
    sandbox.cleanup();
  }
};

const hardMergeConflictRunner: MvpScenarioRunner = async (context) => {
  const sandbox = createScenarioSandbox();
  try {
    const issue = createTrackedIssue("conflict-001", "Hard merge conflict");
    const tracker = new InMemoryScenarioTracker([issue]);
    const implementedResult = await prepareImplementedIssue(
      sandbox.projectRoot,
      tracker,
      issue,
      ["src/merge/apply-merge.ts"],
      ["src/merge/apply-merge.ts"],
    );
    admitIssue(sandbox.eventBus, implementedResult.updatedRecord);

    await emitOutcomeArtifact(
      issue.id,
      "MERGE_FAILED",
      `aegis/${issue.id}`,
      "main",
      2,
      "Hard merge conflict with preserved labor",
      true,
      sandbox.projectRoot,
      "CONFLICT (content): merge conflict in src/merge/apply-merge.ts",
    );
    await preserveLabor({
      issueId: issue.id,
      laborPath: ensureLaborPlan(sandbox.projectRoot, issue.id).laborPath,
      branchName: ensureLaborPlan(sandbox.projectRoot, issue.id).branchName,
      outcome: "MERGE_FAILED",
      isConflict: true,
      reason: "Hard merge conflict",
    });

    return buildScenarioResult(context, {
      completionOutcomes: {
        "conflict-001": "failed",
      },
      mergeOutcomes: {
        "conflict-001": "conflict_unresolved",
      },
    });
  } finally {
    sandbox.cleanup();
  }
};

const janusEscalationRunner: MvpScenarioRunner = async (context) => {
  const sandbox = createScenarioSandbox();
  try {
    const issue = createTrackedIssue("janus-esc-001", "Janus escalation");
    const tracker = new InMemoryScenarioTracker([issue]);
    const implementedResult = await prepareImplementedIssue(
      sandbox.projectRoot,
      tracker,
      issue,
      ["src/merge/queue-worker.ts"],
      ["src/merge/queue-worker.ts"],
    );
    const admission = admitIssue(sandbox.eventBus, implementedResult.updatedRecord);
    const janusRequiredState: MergeQueueState = {
      schemaVersion: admission.queueState.schemaVersion,
      items: admission.queueState.items.map((item) => ({
        ...item,
        status: "janus_required",
        attemptCount: 2,
        lastError: "Semantic conflict threshold reached",
      })),
      processedCount: admission.queueState.processedCount,
    };
    const resolvingRecord = withRunningAgent(
      transitionStage(
        transitionStage(admission.queuedRecord, DispatchStage.Merging),
        DispatchStage.ResolvingIntegration,
      ),
      "janus",
    );

    await emitOutcomeArtifact(
      issue.id,
      "MERGE_FAILED",
      `aegis/${issue.id}`,
      "main",
      3,
      "Tier 3 merge conflict escalated to Janus",
      true,
      sandbox.projectRoot,
      "retry threshold reached",
    );

    const janusResult = await runJanus({
      issueId: issue.id,
      queueItemId: issue.id,
      preservedLaborPath: ensureLaborPlan(sandbox.projectRoot, issue.id).laborPath,
      conflictSummary: "Tier 3 merge conflict escalated to Janus",
      filesInvolved: ["src/merge/queue-worker.ts"],
      previousMergeErrors: "retry threshold reached",
      conflictTier: 3,
      record: resolvingRecord,
      runtime: createScriptedRuntime({
        [`janus:${issue.id}`]: {
          messages: [
            buildJanusPayload({
              issueId: issue.id,
              conflictSummary: "Janus resolved the integration conflict",
              recommendedNextAction: "requeue",
            }),
          ],
        },
      }),
      budget: DEFAULT_AEGIS_CONFIG.budgets.janus,
      projectRoot: sandbox.projectRoot,
    });
    const janusHandling = await handleJanusResult(
      janusResult.resolutionArtifact!,
      sandbox.projectRoot,
      janusRequiredState,
      sandbox.eventBus,
    );

    await mergeCleanAfterQueue(
      sandbox.projectRoot,
      tracker,
      issue,
      janusResult.updatedRecord,
      "Sentinel approved Janus-resolved candidate",
    );

    if (janusHandling.finalStatus !== "queued") {
      throw new Error("Janus escalation scenario must requeue after resolution");
    }

    return buildScenarioResult(context, {
      completionOutcomes: {
        "janus-esc-001": "completed",
      },
      mergeOutcomes: {
        "janus-esc-001": "conflict_resolved_janus",
      },
    });
  } finally {
    sandbox.cleanup();
  }
};

const janusHumanDecisionRunner: MvpScenarioRunner = async (context) => {
  const sandbox = createScenarioSandbox();
  try {
    const issue = createTrackedIssue("janus-hd-001", "Janus human decision");
    const tracker = new InMemoryScenarioTracker([issue]);
    const implementedResult = await prepareImplementedIssue(
      sandbox.projectRoot,
      tracker,
      issue,
      ["src/merge/janus-integration.ts"],
      ["src/merge/janus-integration.ts"],
    );
    const admission = admitIssue(sandbox.eventBus, implementedResult.updatedRecord);
    const janusRequiredState: MergeQueueState = {
      schemaVersion: admission.queueState.schemaVersion,
      items: admission.queueState.items.map((item) => ({
        ...item,
        status: "janus_required",
        attemptCount: 2,
        lastError: "semantic ambiguity detected",
      })),
      processedCount: admission.queueState.processedCount,
    };
    const resolvingRecord = withRunningAgent(
      transitionStage(
        transitionStage(admission.queuedRecord, DispatchStage.Merging),
        DispatchStage.ResolvingIntegration,
      ),
      "janus",
    );

    const janusResult = await runJanus({
      issueId: issue.id,
      queueItemId: issue.id,
      preservedLaborPath: ensureLaborPlan(sandbox.projectRoot, issue.id).laborPath,
      conflictSummary: "Semantic ambiguity requires human decision",
      filesInvolved: ["src/merge/janus-integration.ts"],
      previousMergeErrors: "semantic ambiguity detected",
      conflictTier: 3,
      record: resolvingRecord,
      runtime: createScriptedRuntime({
        [`janus:${issue.id}`]: {
          messages: [
            buildJanusPayload({
              issueId: issue.id,
              conflictSummary: "Semantic ambiguity requires human decision",
              recommendedNextAction: "manual_decision",
            }),
          ],
        },
      }),
      budget: DEFAULT_AEGIS_CONFIG.budgets.janus,
      projectRoot: sandbox.projectRoot,
    });
    const janusHandling = await handleJanusResult(
      janusResult.resolutionArtifact!,
      sandbox.projectRoot,
      janusRequiredState,
      sandbox.eventBus,
    );

    if (!janusHandling.humanDecisionCreated) {
      throw new Error("Janus human-decision scenario must create a human decision artifact");
    }

    return buildScenarioResult(context, {
      completionOutcomes: {
        "janus-hd-001": "failed",
      },
      mergeOutcomes: {
        "janus-hd-001": "conflict_unresolved",
      },
    });
  } finally {
    sandbox.cleanup();
  }
};

const restartDuringMergeRunner: MvpScenarioRunner = async (context) => {
  const sandbox = createScenarioSandbox();
  try {
    const issue = createTrackedIssue("restart-merge-001", "Restart during merge");
    const tracker = new InMemoryScenarioTracker([issue]);
    const implementedResult = await prepareImplementedIssue(
      sandbox.projectRoot,
      tracker,
      issue,
      ["src/merge/merge-queue-store.ts"],
      ["src/merge/merge-queue-store.ts"],
    );
    const admission = admitIssue(sandbox.eventBus, implementedResult.updatedRecord);
    const activeQueueState: MergeQueueState = {
      schemaVersion: admission.queueState.schemaVersion,
      items: admission.queueState.items.map((item) => ({
        ...item,
        status: "active",
      })),
      processedCount: admission.queueState.processedCount,
    };

    saveMergeQueueState(sandbox.projectRoot, activeQueueState);
    const reconciledQueue = reconcileMergeQueueState(
      loadMergeQueueState(sandbox.projectRoot),
      "restart-session",
    );
    const mergingRecord = transitionStage(admission.queuedRecord, DispatchStage.Merging);
    void mergingRecord;

    if (reconciledQueue.items[0]?.status !== "queued") {
      throw new Error("Restart merge scenario must requeue active merge work");
    }

    await mergeCleanAfterQueue(
      sandbox.projectRoot,
      tracker,
      issue,
      admission.queuedRecord,
      "Sentinel approved post-restart merge recovery",
    );

    return buildScenarioResult(context, {
      completionOutcomes: {
        "restart-merge-001": "completed",
      },
      mergeOutcomes: {
        "restart-merge-001": "merged_clean",
      },
    });
  } finally {
    sandbox.cleanup();
  }
};

const pollingOnlyRunner: MvpScenarioRunner = async (context) => {
  const sandbox = createScenarioSandbox();
  try {
    const issue = createTrackedIssue("poll-001", "Polling-only issue");
    const tracker = new InMemoryScenarioTracker([issue]);
    const client: Pick<BeadsClient, "getReadyQueue"> = {
      getReadyQueue: () => tracker.getReadyQueue(),
    };

    const firstPoll = await pollForWork(
      client as BeadsClient,
      {
        schemaVersion: 1,
        records: {},
      },
    );
    if (!firstPoll.needsOracle.includes(issue.id)) {
      throw new Error("Polling-only scenario must discover ready work without hooks");
    }

    const oracleResult = await runOracleStage(
      sandbox.projectRoot,
      tracker,
      issue,
      buildOraclePayload({
        estimated_complexity: "moderate",
        ready: true,
        files_affected: ["src/core/poller.ts"],
      }),
    );
    const secondPoll = await pollForWork(
      client as BeadsClient,
      {
        schemaVersion: 1,
        records: {
          [issue.id]: oracleResult.updatedRecord,
        },
      },
      new Map([[issue.id, oracleResult.assessment!]]),
    );
    if (!secondPoll.dispatchable.some((dispatchable) => dispatchable.issueId === issue.id)) {
      throw new Error("Polling-only scenario must rediscover dispatchable scouted work");
    }

    const titanResult = await runTitanStage(
      sandbox.projectRoot,
      tracker,
      issue,
      oracleResult.updatedRecord,
      buildTitanPayload({
        outcome: "success",
        summary: "Implemented polling-only issue",
        files_changed: ["src/core/poller.ts"],
      }),
    );
    const admission = admitIssue(sandbox.eventBus, titanResult.updatedRecord);

    await mergeCleanAfterQueue(
      sandbox.projectRoot,
      tracker,
      issue,
      admission.queuedRecord,
      "Sentinel approved polling-only candidate",
    );

    return buildScenarioResult(context, {
      completionOutcomes: {
        "poll-001": "completed",
      },
      mergeOutcomes: {
        "poll-001": "merged_clean",
      },
    });
  } finally {
    sandbox.cleanup();
  }
};

export const laneBScenarioRunners: Partial<Record<MvpScenarioId, MvpScenarioRunner>> = {
  "stale-branch-rework": staleBranchReworkRunner,
  "hard-merge-conflict": hardMergeConflictRunner,
  "janus-escalation": janusEscalationRunner,
  "janus-human-decision": janusHumanDecisionRunner,
  "restart-during-merge": restartDuringMergeRunner,
  "polling-only": pollingOnlyRunner,
};
