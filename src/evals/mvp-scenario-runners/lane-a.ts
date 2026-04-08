import { DEFAULT_AEGIS_CONFIG } from "../../config/defaults.js";
import {
  loadDispatchState,
  reconcileDispatchState,
  saveDispatchState,
  type DispatchRecord,
  type DispatchState,
} from "../../core/dispatch-state.js";
import { DispatchStage, transitionStage } from "../../core/stage-transition.js";
import { runOracle } from "../../core/run-oracle.js";
import { runSentinel } from "../../core/run-sentinel.js";
import { runTitan } from "../../core/run-titan.js";
import { emitOutcomeArtifact } from "../../merge/emit-outcome-artifact.js";
import { runAdmissionWorkflow } from "../../merge/admission-workflow.js";
import { emptyMergeQueueState } from "../../merge/merge-queue-store.js";
import type { AegisIssue } from "../../tracker/issue-model.js";
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
  decompose?: boolean;
  sub_issues?: string[];
}): string {
  return JSON.stringify({
    files_affected: overrides.files_affected ?? [],
    estimated_complexity: overrides.estimated_complexity,
    decompose: overrides.decompose ?? false,
    ready: overrides.ready,
    ...(overrides.sub_issues ? { sub_issues: overrides.sub_issues } : {}),
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
  blocking_question?: string;
  handoff_note?: string;
}): string {
  return JSON.stringify({
    outcome: overrides.outcome,
    summary: overrides.summary,
    files_changed: overrides.files_changed ?? [],
    tests_and_checks_run: overrides.tests_and_checks_run ?? ["npm run test"],
    known_risks: overrides.known_risks ?? [],
    follow_up_work: overrides.follow_up_work ?? [],
    learnings_written_to_mnemosyne: overrides.learnings_written_to_mnemosyne ?? [],
    ...(overrides.blocking_question
      ? { blocking_question: overrides.blocking_question }
      : {}),
    ...(overrides.handoff_note ? { handoff_note: overrides.handoff_note } : {}),
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

async function runOracleStage(
  projectRoot: string,
  tracker: InMemoryScenarioTracker,
  issue: AegisIssue,
  payload: string,
  allowComplexAutoDispatch: boolean = false,
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
    allowComplexAutoDispatch,
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
  const implementingRecord = withRunningAgent(
    record.stage === DispatchStage.Implementing
      ? record
      : transitionStage(record, DispatchStage.Implementing),
    "titan",
  );

  return runTitan({
    issue,
    record: implementingRecord,
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
  const reviewingRecord = withRunningAgent(
    transitionStage(mergedRecord, DispatchStage.Reviewing),
    "sentinel",
  );

  return runSentinel({
    issue,
    record: reviewingRecord,
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

async function admitAndMergeClean(
  projectRoot: string,
  eventBus: ReturnType<typeof createScenarioSandbox>["eventBus"],
  tracker: InMemoryScenarioTracker,
  issue: AegisIssue,
  implementedRecord: DispatchRecord,
): Promise<DispatchRecord> {
  const dispatchState: DispatchState = {
    schemaVersion: 1,
    records: {
      [issue.id]: implementedRecord,
    },
  };
  const admission = runAdmissionWorkflow(
    dispatchState,
    emptyMergeQueueState(),
    eventBus,
    {
      dispatchRecord: implementedRecord,
      candidateBranch: `aegis/${issue.id}`,
      targetBranch: "main",
    },
  );
  const queuedRecord = admission.dispatchState.records[issue.id];
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

  await tracker.closeIssue(issue.id);

  return mergedRecord;
}

async function runCompletedIssue(
  projectRoot: string,
  eventBus: ReturnType<typeof createScenarioSandbox>["eventBus"],
  tracker: InMemoryScenarioTracker,
  issue: AegisIssue,
  options: {
    oraclePayload: string;
    titanPayload?: string;
    sentinelSummary?: string;
    titanRecordOverride?: (record: DispatchRecord) => DispatchRecord;
  },
) {
  const oracleResult = await runOracleStage(
    projectRoot,
    tracker,
    issue,
    options.oraclePayload,
  );
  if (!oracleResult.readyForImplementation) {
    throw new Error(`Scenario expected ${issue.id} to be ready for implementation`);
  }

  const titanRecord = options.titanRecordOverride
    ? options.titanRecordOverride(oracleResult.updatedRecord)
    : oracleResult.updatedRecord;
  const titanResult = await runTitanStage(
    projectRoot,
    tracker,
    issue,
    titanRecord,
    options.titanPayload ?? buildTitanPayload({
      outcome: "success",
      summary: `Implemented ${issue.id}`,
      files_changed: ["src/index.ts"],
    }),
  );

  const mergedRecord = await admitAndMergeClean(
    projectRoot,
    eventBus,
    tracker,
    issue,
    titanResult.updatedRecord,
  );
  await runSentinelPassStage(
    projectRoot,
    tracker,
    issue,
    mergedRecord,
    options.sentinelSummary ?? `Sentinel approved ${issue.id}`,
  );
}

const singleCleanIssueRunner: MvpScenarioRunner = async (context) => {
  const sandbox = createScenarioSandbox();
  try {
    const issue = createTrackedIssue("test-001", "Single clean issue");
    const tracker = new InMemoryScenarioTracker([issue]);

    await runCompletedIssue(sandbox.projectRoot, sandbox.eventBus, tracker, issue, {
      oraclePayload: buildOraclePayload({
        estimated_complexity: "trivial",
        ready: true,
        files_affected: ["src/index.ts"],
      }),
    });

    return buildScenarioResult(context, {
      completionOutcomes: {
        "test-001": "completed",
      },
      mergeOutcomes: {
        "test-001": "merged_clean",
      },
    });
  } finally {
    sandbox.cleanup();
  }
};

const complexPauseRunner: MvpScenarioRunner = async (context) => {
  const sandbox = createScenarioSandbox();
  try {
    const issue = createTrackedIssue("complex-001", "Complex issue requiring pause");
    const tracker = new InMemoryScenarioTracker([issue]);

    const oracleResult = await runOracleStage(
      sandbox.projectRoot,
      tracker,
      issue,
      buildOraclePayload({
        estimated_complexity: "complex",
        ready: true,
        files_affected: ["src/core/dispatch-loop.ts"],
      }),
      false,
    );

    if (!oracleResult.requiresComplexityGate) {
      throw new Error("Complex scenario must require a complexity gate");
    }

    return buildScenarioResult(context, {
      completionOutcomes: {
        "complex-001": "paused_complex",
      },
      mergeOutcomes: {
        "complex-001": "not_attempted",
      },
    });
  } finally {
    sandbox.cleanup();
  }
};

const decompositionRunner: MvpScenarioRunner = async (context) => {
  const sandbox = createScenarioSandbox();
  try {
    const [parentFixtureIssue, firstChildFixtureIssue, secondChildFixtureIssue] = context.fixture.issues;
    const parentIssue = createTrackedIssue(parentFixtureIssue.id, "Parent decomposition issue", {
      issueClass: "primary",
    });
    const tracker = new InMemoryScenarioTracker([parentIssue], {
      generatedIssueIds: [firstChildFixtureIssue.id, secondChildFixtureIssue.id],
    });

    const oracleResult = await runOracleStage(
      sandbox.projectRoot,
      tracker,
      parentIssue,
      buildOraclePayload({
        estimated_complexity: "moderate",
        ready: true,
        decompose: true,
        sub_issues: [
          "Implement child scope A",
          "Implement child scope B",
        ],
        files_affected: ["src/core/orchestrator.ts"],
      }),
    );

    if (oracleResult.createdIssues.length !== 2) {
      throw new Error("Decomposition scenario must create two child issues");
    }

    const firstChild = await tracker.getIssue(firstChildFixtureIssue.id);
    const secondChild = await tracker.getIssue(secondChildFixtureIssue.id);

    await runCompletedIssue(sandbox.projectRoot, sandbox.eventBus, tracker, firstChild, {
      oraclePayload: buildOraclePayload({
        estimated_complexity: "trivial",
        ready: true,
        files_affected: ["src/core/orchestrator.ts"],
      }),
      titanPayload: buildTitanPayload({
        outcome: "success",
        summary: `Implemented ${firstChild.id}`,
        files_changed: ["src/core/orchestrator.ts"],
      }),
      sentinelSummary: `Sentinel approved ${firstChild.id}`,
    });
    await runCompletedIssue(sandbox.projectRoot, sandbox.eventBus, tracker, secondChild, {
      oraclePayload: buildOraclePayload({
        estimated_complexity: "trivial",
        ready: true,
        files_affected: ["src/core/orchestrator.ts"],
      }),
      titanPayload: buildTitanPayload({
        outcome: "success",
        summary: `Implemented ${secondChild.id}`,
        files_changed: ["src/core/orchestrator.ts"],
      }),
      sentinelSummary: `Sentinel approved ${secondChild.id}`,
    });
    const parentTitanResult = await runTitanStage(
      sandbox.projectRoot,
      tracker,
      parentIssue,
      oracleResult.updatedRecord,
      buildTitanPayload({
        outcome: "success",
        summary: `Implemented ${parentIssue.id}`,
        files_changed: ["src/core/orchestrator.ts"],
      }),
    );
    const parentMergedRecord = await admitAndMergeClean(
      sandbox.projectRoot,
      sandbox.eventBus,
      tracker,
      parentIssue,
      parentTitanResult.updatedRecord,
    );
    await runSentinelPassStage(
      sandbox.projectRoot,
      tracker,
      parentIssue,
      parentMergedRecord,
      `Sentinel approved ${parentIssue.id}`,
    );

    return buildScenarioResult(context, {
      completionOutcomes: {
        [parentFixtureIssue.id]: "completed",
        [firstChildFixtureIssue.id]: "completed",
        [secondChildFixtureIssue.id]: "completed",
      },
      mergeOutcomes: {
        [parentFixtureIssue.id]: "merged_clean",
        [firstChildFixtureIssue.id]: "merged_clean",
        [secondChildFixtureIssue.id]: "merged_clean",
      },
    });
  } finally {
    sandbox.cleanup();
  }
};

const clarificationRunner: MvpScenarioRunner = async (context) => {
  const sandbox = createScenarioSandbox();
  try {
    const issue = createTrackedIssue("ambiguous-001", "Ambiguous Titan issue");
    const tracker = new InMemoryScenarioTracker([issue]);

    const oracleResult = await runOracleStage(
      sandbox.projectRoot,
      tracker,
      issue,
      buildOraclePayload({
        estimated_complexity: "moderate",
        ready: true,
        files_affected: ["src/core/run-titan.ts"],
      }),
    );
    const titanResult = await runTitanStage(
      sandbox.projectRoot,
      tracker,
      issue,
      oracleResult.updatedRecord,
      buildTitanPayload({
        outcome: "clarification",
        summary: "Titan cannot safely continue without clarification",
        files_changed: [],
        blocking_question: "Should the policy preserve labor or fail closed here?",
        handoff_note: "Awaiting operator clarification before proceeding.",
      }),
    );

    if (!titanResult.clarificationIssue) {
      throw new Error("Clarification scenario must create a clarification issue");
    }

    return buildScenarioResult(context, {
      completionOutcomes: {
        "ambiguous-001": "paused_ambiguous",
      },
      mergeOutcomes: {
        "ambiguous-001": "not_attempted",
      },
    });
  } finally {
    sandbox.cleanup();
  }
};

const restartDuringImplementationRunner: MvpScenarioRunner = async (context) => {
  const sandbox = createScenarioSandbox();
  try {
    const issue = createTrackedIssue(
      "restart-impl-001",
      "Restart during implementation",
    );
    const tracker = new InMemoryScenarioTracker([issue]);

    await runCompletedIssue(sandbox.projectRoot, sandbox.eventBus, tracker, issue, {
      oraclePayload: buildOraclePayload({
        estimated_complexity: "moderate",
        ready: true,
        files_affected: ["src/core/recovery.ts"],
      }),
      titanPayload: buildTitanPayload({
        outcome: "success",
        summary: "Recovered Titan implementation after restart",
        files_changed: ["src/core/recovery.ts"],
      }),
      sentinelSummary: "Sentinel approved recovered Titan implementation",
      titanRecordOverride(record) {
        const implementingRecord = withRunningAgent(
          transitionStage(record, DispatchStage.Implementing),
          "titan",
        );
        saveDispatchState(sandbox.projectRoot, {
          schemaVersion: 1,
          records: {
            [issue.id]: implementingRecord,
          },
        });
        const reconciled = reconcileDispatchState(
          loadDispatchState(sandbox.projectRoot),
          "restarted-session",
        );
        return reconciled.records[issue.id];
      },
    });

    return buildScenarioResult(context, {
      completionOutcomes: {
        "restart-impl-001": "completed",
      },
      mergeOutcomes: {
        "restart-impl-001": "merged_clean",
      },
    });
  } finally {
    sandbox.cleanup();
  }
};

export const laneAScenarioRunners: Partial<Record<MvpScenarioId, MvpScenarioRunner>> = {
  "single-clean-issue": singleCleanIssueRunner,
  "complex-pause": complexPauseRunner,
  decomposition: decompositionRunner,
  clarification: clarificationRunner,
  "restart-during-implementation": restartDuringImplementationRunner,
};
