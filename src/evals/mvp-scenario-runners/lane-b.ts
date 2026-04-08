import { existsSync } from "node:fs";
import path from "node:path";

import { DEFAULT_AEGIS_CONFIG } from "../../config/defaults.js";
import { saveDispatchState } from "../../core/dispatch-state.js";
import { pollForWork } from "../../core/poller.js";
import { runOracle } from "../../core/run-oracle.js";
import { runSentinel } from "../../core/run-sentinel.js";
import { runTitan } from "../../core/run-titan.js";
import { DispatchStage, transitionStage } from "../../core/stage-transition.js";
import { runAdmissionWorkflow } from "../../merge/admission-workflow.js";
import { loadHumanDecisionArtifact } from "../../merge/janus-integration.js";
import {
  emptyMergeQueueState,
  loadMergeQueueState,
  reconcileMergeQueueState,
  saveMergeQueueState,
  type MergeQueueState,
} from "../../merge/merge-queue-store.js";
import { processNextQueueItem } from "../../merge/queue-worker.js";
import type { JanusInvocationPolicy } from "../../merge/tiered-conflict-policy.js";
import type { AegisIssue, ReadyIssue } from "../../tracker/issue-model.js";
import type { BeadsClient } from "../../tracker/beads-client.js";
import type { MvpScenarioId } from "../wire-mvp-scenarios.js";
import {
  buildScenarioResult,
  commitGitFiles,
  createDispatchRecord,
  createScenarioSandbox,
  createScriptedRuntime,
  createTrackedIssue,
  ensureLaborPlan,
  InMemoryScenarioTracker,
  loadLatestOutcomeArtifact,
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

function buildCandidateFiles(
  issueId: string,
  filesChanged: readonly string[],
  label: string,
): Record<string, string> {
  const targetFiles = filesChanged.length > 0
    ? filesChanged
    : [`src/scenarios/${issueId}.txt`];

  return Object.fromEntries(
    targetFiles.map((relativePath, index) => [
      relativePath,
      `scenario=${issueId}\nlabel=${label}\nfile_index=${index}`,
    ]),
  );
}

function materializeTitanCandidate(
  laborPath: string,
  issueId: string,
  filesChanged: readonly string[],
  label: string,
) {
  commitGitFiles(
    laborPath,
    buildCandidateFiles(issueId, filesChanged, label),
    `scenario(${issueId}): ${label}`,
  );
}

function materializeMainBranchFiles(
  projectRoot: string,
  issueId: string,
  filesChanged: readonly string[],
  label: string,
) {
  commitGitFiles(
    projectRoot,
    buildCandidateFiles(issueId, filesChanged, label),
    `scenario(${issueId}): ${label}`,
  );
}

async function processQueueItem(
  projectRoot: string,
  eventBus: ReturnType<typeof createScenarioSandbox>["eventBus"],
  queueState: MergeQueueState,
  options: {
    janusEnabled?: boolean;
    runtime?: ReturnType<typeof createScriptedRuntime>;
    maxRetryAttempts?: number;
    janusInvocationPolicy?: JanusInvocationPolicy;
  } = {},
) {
  const result = await processNextQueueItem(queueState, {
    projectRoot,
    eventPublisher: eventBus,
    janusEnabled: options.janusEnabled ?? false,
    maxRetryAttempts: options.maxRetryAttempts ?? 2,
    targetBranch: "main",
    runtime: options.runtime,
    janusInvocationPolicy: options.janusInvocationPolicy,
  });
  if (!result) {
    throw new Error("Queue worker unexpectedly returned null");
  }

  return result;
}

function admitIssue(
  eventBus: ReturnType<typeof createScenarioSandbox>["eventBus"],
  implementedRecord: DispatchRecord,
  targetBranch: string = "main",
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
      targetBranch,
    },
  );

  return {
    queuedRecord: admission.dispatchState.records[implementedRecord.issueId],
    queueState: admission.queueState,
  };
}

async function mergeCleanAfterQueue(
  projectRoot: string,
  eventBus: ReturnType<typeof createScenarioSandbox>["eventBus"],
  tracker: InMemoryScenarioTracker,
  issue: AegisIssue,
  queuedRecord: DispatchRecord,
  queueState: MergeQueueState,
  reviewSummary: string,
) {
  const queueResult = await processQueueItem(projectRoot, eventBus, queueState);
  if (queueResult.result.newStatus !== "merged") {
    throw new Error(
      `Queue worker did not merge ${issue.id} cleanly: ${JSON.stringify(queueResult.result)}`,
    );
  }
  const outcomeArtifact = loadLatestOutcomeArtifact(projectRoot, issue.id);
  if (!outcomeArtifact || outcomeArtifact.outcome !== "MERGED") {
    throw new Error(`Queue worker did not emit a MERGED artifact for ${issue.id}`);
  }

  const mergedRecord = transitionStage(
    transitionStage(queuedRecord, DispatchStage.Merging),
    DispatchStage.Merged,
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
  candidateLabel: string,
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

  const titanResult = await runTitanStage(
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
  materializeTitanCandidate(
    titanResult.handoffArtifact.laborPath,
    issue.id,
    titanResult.handoffArtifact.filesChanged,
    candidateLabel,
  );

  return titanResult;
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
      "stale initial candidate",
    );
    const firstAdmission = admitIssue(
      sandbox.eventBus,
      implementedResult.updatedRecord,
      "missing-main",
    );
    const firstPass = await processQueueItem(
      sandbox.projectRoot,
      sandbox.eventBus,
      firstAdmission.queueState,
    );
    if (firstPass.result.newStatus !== "rework_requested") {
      throw new Error(
        `Stale branch scenario must request rework on the first merge pass: ${JSON.stringify(firstPass.result)}`,
      );
    }
    const firstArtifact = loadLatestOutcomeArtifact(sandbox.projectRoot, issue.id);
    if (!firstArtifact || firstArtifact.outcome !== "REWORK_REQUEST" || !firstArtifact.laborPreserved) {
      throw new Error("Stale branch scenario must emit a preserved REWORK_REQUEST artifact");
    }

    const refreshedTitan = await prepareImplementedIssue(
      sandbox.projectRoot,
      tracker,
      issue,
      ["src/merge/queue-worker.ts"],
      ["src/merge/queue-worker.ts"],
      "stale refreshed candidate",
    );
    const secondAdmission = admitIssue(sandbox.eventBus, refreshedTitan.updatedRecord);

    await mergeCleanAfterQueue(
      sandbox.projectRoot,
      sandbox.eventBus,
      tracker,
      issue,
      secondAdmission.queuedRecord,
      secondAdmission.queueState,
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
      "hard conflict candidate",
    );
    materializeMainBranchFiles(
      sandbox.projectRoot,
      issue.id,
      ["src/merge/apply-merge.ts"],
      "hard conflict on main",
    );
    const admission = admitIssue(sandbox.eventBus, implementedResult.updatedRecord);
    const conflictResult = await processQueueItem(
      sandbox.projectRoot,
      sandbox.eventBus,
      admission.queueState,
      {
        maxRetryAttempts: 3,
      },
    );
    if (conflictResult.result.newStatus !== "merge_failed") {
      throw new Error("Hard merge conflict scenario must fail in the queue worker");
    }
    const conflictArtifact = loadLatestOutcomeArtifact(sandbox.projectRoot, issue.id);
    if (!conflictArtifact || conflictArtifact.outcome !== "MERGE_FAILED" || !conflictArtifact.laborPreserved) {
      throw new Error("Hard merge conflict scenario must preserve labor through the queue worker");
    }
    if (!existsSync(path.join(
      ensureLaborPlan(sandbox.projectRoot, issue.id).laborPath,
      ".aegis-labor",
      "preservation.json",
    ))) {
      throw new Error("Hard merge conflict scenario must persist labor preservation metadata");
    }

    return buildScenarioResult(context, {
      completionOutcomes: {
        "conflict-001": "failed",
      },
      mergeOutcomes: {
        "conflict-001": "conflict_unresolved",
      },
      humanInterventionIssueIds: [issue.id],
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
      "janus escalation candidate",
    );
    materializeMainBranchFiles(
      sandbox.projectRoot,
      issue.id,
      ["src/merge/queue-worker.ts"],
      "janus escalation main conflict",
    );
    const admission = admitIssue(sandbox.eventBus, implementedResult.updatedRecord);
    const escalationQueueState: MergeQueueState = {
      schemaVersion: admission.queueState.schemaVersion,
      items: admission.queueState.items.map((item) => ({
        ...item,
        attemptCount: 1,
      })),
      processedCount: admission.queueState.processedCount,
    };
    const firstPass = await processQueueItem(
      sandbox.projectRoot,
      sandbox.eventBus,
      escalationQueueState,
      {
        janusEnabled: true,
        maxRetryAttempts: 2,
        janusInvocationPolicy: {
          janusEnabled: true,
          maxRetryAttempts: 2,
          maxConflictFiles: 10,
          economicGuardrailsAllow: true,
        },
      },
    );
    if (firstPass.result.newStatus !== "janus_required") {
      throw new Error(
        `Janus escalation scenario must escalate through the queue worker: ${JSON.stringify(firstPass.result)}`,
      );
    }
    saveDispatchState(sandbox.projectRoot, {
      schemaVersion: 1,
      records: {
        [issue.id]: transitionStage(admission.queuedRecord, DispatchStage.Merging),
      },
    });
    const janusPass = await processQueueItem(
      sandbox.projectRoot,
      sandbox.eventBus,
      firstPass.updatedState,
      {
        janusEnabled: true,
        maxRetryAttempts: 2,
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
      },
    );
    if (janusPass.result.newStatus !== "queued") {
      throw new Error("Janus escalation scenario must requeue after Janus resolution");
    }
    commitGitFiles(
      ensureLaborPlan(sandbox.projectRoot, issue.id).laborPath,
      {
        ...buildCandidateFiles(
          issue.id,
          ["src/merge/queue-worker.ts"],
          "janus escalation main conflict",
        ),
        "src/merge/janus-resolution.ts": "resolved=true\nstrategy=requeue",
      },
      `scenario(${issue.id}): janus resolution`,
    );

    await mergeCleanAfterQueue(
      sandbox.projectRoot,
      sandbox.eventBus,
      tracker,
      issue,
      admission.queuedRecord,
      janusPass.updatedState,
      "Sentinel approved Janus-resolved candidate",
    );

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
      "janus human-decision candidate",
    );
    materializeMainBranchFiles(
      sandbox.projectRoot,
      issue.id,
      ["src/merge/janus-integration.ts"],
      "janus human-decision main conflict",
    );
    const admission = admitIssue(sandbox.eventBus, implementedResult.updatedRecord);
    const escalationQueueState: MergeQueueState = {
      schemaVersion: admission.queueState.schemaVersion,
      items: admission.queueState.items.map((item) => ({
        ...item,
        attemptCount: 1,
      })),
      processedCount: admission.queueState.processedCount,
    };
    const firstPass = await processQueueItem(
      sandbox.projectRoot,
      sandbox.eventBus,
      escalationQueueState,
      {
        janusEnabled: true,
        maxRetryAttempts: 2,
        janusInvocationPolicy: {
          janusEnabled: true,
          maxRetryAttempts: 2,
          maxConflictFiles: 10,
          economicGuardrailsAllow: true,
        },
      },
    );
    if (firstPass.result.newStatus !== "janus_required") {
      throw new Error(
        `Janus human-decision scenario must escalate through the queue worker: ${JSON.stringify(firstPass.result)}`,
      );
    }
    saveDispatchState(sandbox.projectRoot, {
      schemaVersion: 1,
      records: {
        [issue.id]: transitionStage(admission.queuedRecord, DispatchStage.Merging),
      },
    });
    const janusPass = await processQueueItem(
      sandbox.projectRoot,
      sandbox.eventBus,
      firstPass.updatedState,
      {
        janusEnabled: true,
        maxRetryAttempts: 2,
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
      },
    );
    if (janusPass.result.newStatus !== "manual_decision_required") {
      throw new Error("Janus human-decision scenario must require a manual decision");
    }
    if (!loadHumanDecisionArtifact(issue.id, sandbox.projectRoot)) {
      throw new Error("Janus human-decision scenario must create a human decision artifact");
    }

    return buildScenarioResult(context, {
      completionOutcomes: {
        "janus-hd-001": "failed",
      },
      mergeOutcomes: {
        "janus-hd-001": "conflict_unresolved",
      },
      humanInterventionIssueIds: [issue.id],
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
      "restart merge candidate",
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
      sandbox.eventBus,
      tracker,
      issue,
      admission.queuedRecord,
      reconciledQueue,
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
    materializeTitanCandidate(
      titanResult.handoffArtifact.laborPath,
      issue.id,
      titanResult.handoffArtifact.filesChanged,
      "polling-only candidate",
    );
    const admission = admitIssue(sandbox.eventBus, titanResult.updatedRecord);

    await mergeCleanAfterQueue(
      sandbox.projectRoot,
      sandbox.eventBus,
      tracker,
      issue,
      admission.queuedRecord,
      admission.queueState,
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
