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
  updatedRecord: DispatchRecord;
  complexityDisposition: OracleComplexityDisposition;
  requiresComplexityGate: boolean;
  readyForImplementation: boolean;
  failureReason: string | null;
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

function findLastOraclePayloadMessage(messages: readonly string[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const candidate = messages[index].trim();
    if (candidate === "") {
      continue;
    }
    try {
      parseOracleAssessment(candidate);
      return messages[index];
    } catch {
      // Continue scanning for the latest valid Oracle payload.
    }
  }

  const fallback = messages.at(-1);
  if (!fallback) {
    throw new Error("Oracle did not return a final message payload");
  }
  return fallback;
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

  return findLastOraclePayloadMessage(messages);
}

async function materializeDerivedIssues(
  issue: AegisIssue,
  tracker: OracleIssueCreator,
  derivedIssues: readonly CreateIssueInput[],
): Promise<CreatedIssue[]> {
  const createdIssues: CreatedIssue[] = [];

  for (const derivedIssue of derivedIssues) {
    const createdIssue = await tracker.createIssue(derivedIssue);
    try {
      await tracker.addBlocker(issue.id, createdIssue.id);
    } catch (error) {
      await tracker.closeIssue(
        createdIssue.id,
        `Failed to block ${issue.id} on derived issue ${createdIssue.id}`,
      );
      throw error;
    }
    createdIssues.push(createdIssue);
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

  try {
    const raw = await collectOracleResponse(
      input.runtime,
      input.issue.id,
      input.projectRoot,
      input.budget,
      prompt,
    );
    const assessment = parseOracleAssessment(raw);
    const derivedIssues = createDerivedIssueInputs(input.issue, assessment);
    const createdIssues = await materializeDerivedIssues(
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
      updatedRecord: {
        ...transitionStage(input.record, DispatchStage.Scouted),
        runningAgent: null,
        oracleAssessmentRef: `oracle/${input.issue.id}.json`,
      },
      complexityDisposition,
      requiresComplexityGate,
      readyForImplementation,
      failureReason: null,
    };
  } catch (error) {
    return {
      prompt,
      assessment: null,
      derivedIssues: [],
      createdIssues: [],
      updatedRecord: {
        ...transitionStage(input.record, DispatchStage.Failed),
        runningAgent: null,
      },
      complexityDisposition: "allow",
      requiresComplexityGate: false,
      readyForImplementation: false,
      failureReason: (error as Error).message,
    };
  }
}
