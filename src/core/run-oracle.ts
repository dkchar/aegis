import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { BudgetLimit } from "../config/schema.js";
import type { DispatchRecord } from "./dispatch-state.js";
import { DispatchStage, transitionStage } from "./stage-transition.js";
import {
  buildOraclePrompt,
  issueToOraclePromptIssue,
} from "../castes/oracle/oracle-prompt.js";
import {
  type OracleAssessment,
  parseOracleAssessment,
} from "../castes/oracle/oracle-parser.js";
import type {
  AgentEvent,
  AgentRuntime,
} from "../runtime/agent-runtime.js";
import type {
  AegisIssue,
  AegisIssue as CreatedIssue,
  CreateIssueInput,
} from "../tracker/issue-model.js";
import { createDerivedIssueInputs } from "../tracker/create-derived-issues.js";
import type { OperatingMode } from "./operating-mode.js";

export type OracleComplexityDisposition =
  | "allow"
  | "needs_human_approval"
  | "skip_auto_dispatch";

export interface OracleIssueCreator {
  createIssue(input: CreateIssueInput): Promise<CreatedIssue>;
  addBlocker(blockedId: string, blockerId: string): Promise<void>;
  closeIssue(id: string, reason?: string): Promise<CreatedIssue>;
}

export interface RunOracleInput {
  issue: AegisIssue;
  record: DispatchRecord;
  runtime: AgentRuntime;
  tracker: OracleIssueCreator;
  budget: BudgetLimit;
  projectRoot: string;
  operatingMode: OperatingMode;
  allowComplexAutoDispatch: boolean;
}

export interface RunOracleResult {
  prompt: string;
  assessment: OracleAssessment | null;
  derivedIssues: CreateIssueInput[];
  createdIssues: CreatedIssue[];
  rolledBackIssues: CreatedIssue[];
  updatedRecord: DispatchRecord;
  complexityDisposition: OracleComplexityDisposition;
  requiresComplexityGate: boolean;
  readyForImplementation: boolean;
  failureReason: string | null;
}

class DerivedIssueMaterializationError extends Error {
  readonly rolledBackIssues: CreatedIssue[];

  constructor(message: string, rolledBackIssues: CreatedIssue[]) {
    super(message);
    this.name = "DerivedIssueMaterializationError";
    this.rolledBackIssues = rolledBackIssues;
  }
}

function buildOracleAssessmentRef(issueId: string): string {
  return join(".aegis", "oracle", `${issueId}.json`);
}

function persistOracleAssessment(
  projectRoot: string,
  issueId: string,
  assessment: OracleAssessment,
): string {
  const assessmentRef = buildOracleAssessmentRef(issueId);
  const absolutePath = join(projectRoot, assessmentRef);
  mkdirSync(join(projectRoot, ".aegis", "oracle"), { recursive: true });
  writeFileSync(absolutePath, `${JSON.stringify(assessment, null, 2)}\n`, "utf8");
  return assessmentRef;
}

function determineComplexityDisposition(
  complexity: OracleAssessment["estimated_complexity"],
  operatingMode: OperatingMode,
  allowComplexAutoDispatch: boolean,
): OracleComplexityDisposition {
  if (complexity !== "complex") {
    return "allow";
  }

  if (operatingMode === "auto" && !allowComplexAutoDispatch) {
    return "skip_auto_dispatch";
  }

  if (operatingMode === "conversational") {
    return "needs_human_approval";
  }

  return "allow";
}

function findFinalOraclePayloadMessage(messages: readonly string[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const candidate = messages[index].trim();
    if (candidate === "") {
      continue;
    }
    return messages[index];
  }

  throw new Error("Oracle did not return a final message payload");
}

async function collectOracleResponse(
  runtime: AgentRuntime,
  issueId: string,
  projectRoot: string,
  budget: BudgetLimit,
  prompt: string,
): Promise<string> {
  const handle = await runtime.spawn({
    caste: "oracle",
    issueId,
    workingDirectory: projectRoot,
    toolRestrictions: [],
    budget,
  });

  const messages: string[] = [];

  await new Promise<void>((resolve, reject) => {
    const unsubscribe = handle.subscribe((event: AgentEvent) => {
      if (event.type === "message") {
        messages.push(event.text);
        return;
      }
      if (event.type === "error" && event.fatal) {
        unsubscribe();
        reject(new Error(event.message));
        return;
      }
      if (event.type === "session_ended") {
        unsubscribe();
        if (event.reason !== "completed") {
          reject(new Error(`Oracle session ended with reason=${event.reason}`));
          return;
        }
        resolve();
      }
    });

    void handle.prompt(prompt).catch((error: unknown) => {
      unsubscribe();
      reject(error);
    });
  });

  return findFinalOraclePayloadMessage(messages);
}

async function rollbackDerivedIssues(
  issueId: string,
  tracker: OracleIssueCreator,
  createdIssues: readonly CreatedIssue[],
): Promise<CreatedIssue[]> {
  const cleanupErrors: string[] = [];
  const rolledBackIssues: CreatedIssue[] = [];

  for (const createdIssue of createdIssues) {
    try {
      const closedIssue = await tracker.closeIssue(
        createdIssue.id,
        `Failed to materialize derived issues for ${issueId}`,
      );
      rolledBackIssues.push(closedIssue);
    } catch (error) {
      cleanupErrors.push((error as Error).message);
      rolledBackIssues.push(createdIssue);
    }
  }

  if (cleanupErrors.length > 0) {
    throw new Error(
      `Failed to materialize derived issues for ${issueId}; cleanup errors: ${cleanupErrors.join("; ")}`,
    );
  }

  return rolledBackIssues;
}

async function materializeDerivedIssues(
  issue: AegisIssue,
  tracker: OracleIssueCreator,
  derivedIssues: readonly CreateIssueInput[],
) : Promise<CreatedIssue[]> {
  const createdIssues: CreatedIssue[] = [];

  try {
    for (const derivedIssue of derivedIssues) {
      const createdIssue = await tracker.createIssue(derivedIssue);
      createdIssues.push(createdIssue);
      await tracker.addBlocker(issue.id, createdIssue.id);
    }
  } catch (error) {
    let rolledBackIssues = createdIssues;
    try {
      rolledBackIssues = await rollbackDerivedIssues(issue.id, tracker, createdIssues);
    } catch (cleanupError) {
      throw new DerivedIssueMaterializationError(
        `${(error as Error).message}; ${(cleanupError as Error).message}`,
        rolledBackIssues,
      );
    }
    throw new DerivedIssueMaterializationError(
      (error as Error).message,
      rolledBackIssues,
    );
  }

  return createdIssues;
}

export async function runOracle(input: RunOracleInput): Promise<RunOracleResult> {
  if (input.record.stage !== DispatchStage.Scouting) {
    throw new Error(
      `runOracle requires a dispatch record in stage=${DispatchStage.Scouting}`,
    );
  }

  const prompt = buildOraclePrompt(issueToOraclePromptIssue(input.issue));
  let assessment: OracleAssessment | null = null;
  let derivedIssues: CreateIssueInput[] = [];
  let createdIssues: CreatedIssue[] = [];
  let rolledBackIssues: CreatedIssue[] = [];
  let oracleAssessmentRef: string | null = null;

  try {
    const raw = await collectOracleResponse(
      input.runtime,
      input.issue.id,
      input.projectRoot,
      input.budget,
      prompt,
    );
    assessment = parseOracleAssessment(raw);
    oracleAssessmentRef = persistOracleAssessment(
      input.projectRoot,
      input.issue.id,
      assessment,
    );
    derivedIssues = createDerivedIssueInputs(input.issue, assessment);
    createdIssues = await materializeDerivedIssues(
      input.issue,
      input.tracker,
      derivedIssues,
    );
    const complexityDisposition = determineComplexityDisposition(
      assessment.estimated_complexity,
      input.operatingMode,
      input.allowComplexAutoDispatch,
    );
    const requiresComplexityGate = complexityDisposition !== "allow";
    const readyForImplementation =
      assessment.ready &&
      !requiresComplexityGate &&
      createdIssues.length === 0;

    return {
      prompt,
      assessment,
      derivedIssues,
      createdIssues,
      rolledBackIssues: [],
      updatedRecord: {
        ...transitionStage(input.record, DispatchStage.Scouted),
        runningAgent: null,
        oracleAssessmentRef,
      },
      complexityDisposition,
      requiresComplexityGate,
      readyForImplementation,
      failureReason: null,
    };
  } catch (error) {
    if (error instanceof DerivedIssueMaterializationError) {
      rolledBackIssues = error.rolledBackIssues;
      createdIssues = [];
    }

    return {
      prompt,
      assessment,
      derivedIssues,
      createdIssues,
      rolledBackIssues,
      updatedRecord: {
        ...transitionStage(input.record, DispatchStage.Failed),
        runningAgent: null,
        oracleAssessmentRef,
      },
      complexityDisposition: "allow",
      requiresComplexityGate: false,
      readyForImplementation: false,
      failureReason: (error as Error).message,
    };
  }
}
