import {
  buildTitanPrompt,
  createTitanPromptContract,
  type TitanPromptContext,
} from "../castes/titan/titan-prompt.js";
import type { BudgetLimit } from "../config/schema.js";
import type { DispatchRecord } from "./dispatch-state.js";
import type { FileScope } from "./scope-allocator.js";
import { DispatchStage, transitionStage } from "./stage-transition.js";
import type { LaborCreationPlan } from "../labor/create-labor.js";
import type { AgentRuntime, AgentEvent } from "../runtime/agent-runtime.js";
import type { AegisIssue, AegisIssue as CreatedIssue, CreateIssueInput } from "../tracker/issue-model.js";

export type TitanRunOutcome = "success" | "clarification" | "failure";

export interface TitanHandoffArtifact {
  issueId: string;
  laborPath: string;
  candidateBranch: string;
  baseBranch: string;
  filesChanged: string[];
  testsAndChecksRun: string[];
  knownRisks: string[];
  followUpWork: string[];
  learningsWrittenToMnemosyne: string[];
  /** The file scope that was claimed during this Titan's implementation. */
  fileScope: FileScope | null;
}

export interface TitanClarificationArtifact {
  originalIssueId: string;
  issueTitle: string;
  laborPath: string;
  candidateBranch: string;
  baseBranch: string;
  blockingQuestion: string;
  handoffNote: string;
  preserveLabor: boolean;
  linkedClarificationIssueId: string | null;
}

export interface TitanLifecycleRule {
  outcome: TitanRunOutcome;
  retainLabor: boolean;
  emitHandoffArtifact: boolean;
  emitClarificationArtifact: boolean;
}

export const TITAN_RUN_LIFECYCLE_RULES: Record<TitanRunOutcome, TitanLifecycleRule> = {
  success: {
    outcome: "success",
    retainLabor: true,
    emitHandoffArtifact: true,
    emitClarificationArtifact: false,
  },
  clarification: {
    outcome: "clarification",
    retainLabor: true,
    emitHandoffArtifact: true,
    emitClarificationArtifact: true,
  },
  failure: {
    outcome: "failure",
    retainLabor: true,
    emitHandoffArtifact: true,
    emitClarificationArtifact: false,
  },
};

export interface TitanRunContract {
  handoffArtifact: TitanHandoffArtifact;
  clarificationArtifact: TitanClarificationArtifact;
  lifecycleRules: Record<TitanRunOutcome, TitanLifecycleRule>;
}

interface TitanExecutionPayload {
  outcome: TitanRunOutcome;
  summary: string;
  files_changed: string[];
  tests_and_checks_run: string[];
  known_risks: string[];
  follow_up_work: string[];
  learnings_written_to_mnemosyne: string[];
  blocking_question?: string;
  handoff_note?: string;
}

export interface TitanIssueCreator {
  createIssue(input: CreateIssueInput): Promise<CreatedIssue>;
  addBlocker(blockedId: string, blockerId: string): Promise<void>;
  closeIssue(id: string, reason?: string): Promise<CreatedIssue>;
}

export interface RunTitanInput {
  issue: AegisIssue;
  record: DispatchRecord;
  labor: LaborCreationPlan;
  runtime: AgentRuntime;
  tracker: TitanIssueCreator;
  budget: BudgetLimit;
}

export interface RunTitanResult {
  prompt: string;
  outcome: TitanRunOutcome;
  updatedRecord: DispatchRecord;
  handoffArtifact: TitanHandoffArtifact;
  clarificationArtifact: TitanClarificationArtifact | null;
  clarificationIssue: CreatedIssue | null;
  failureReason: string | null;
}

export function createTitanRunContract(
  context: TitanPromptContext,
): TitanRunContract {
  const prompt = createTitanPromptContract(context);

  return {
    handoffArtifact: {
      issueId: prompt.issueId,
      laborPath: prompt.laborPath,
      candidateBranch: prompt.branchName,
      baseBranch: prompt.baseBranch,
      filesChanged: [],
      testsAndChecksRun: [],
      knownRisks: [],
      followUpWork: [],
      learningsWrittenToMnemosyne: [],
      fileScope: null,
    },
    clarificationArtifact: {
      originalIssueId: prompt.issueId,
      issueTitle: prompt.issueTitle,
      laborPath: prompt.laborPath,
      candidateBranch: prompt.branchName,
      baseBranch: prompt.baseBranch,
      blockingQuestion: "",
      handoffNote: "",
      preserveLabor: true,
      linkedClarificationIssueId: null,
    },
    lifecycleRules: TITAN_RUN_LIFECYCLE_RULES,
  };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function parseTitanExecutionPayload(raw: string): TitanExecutionPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Titan output must be valid JSON: ${(error as Error).message}`);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Titan output must be a JSON object");
  }

  const candidate = parsed as Record<string, unknown>;
  const allowedKeys = new Set([
    "outcome",
    "summary",
    "files_changed",
    "tests_and_checks_run",
    "known_risks",
    "follow_up_work",
    "learnings_written_to_mnemosyne",
    "blocking_question",
    "handoff_note",
  ]);
  const unexpectedKeys = Object.keys(candidate).filter((key) => !allowedKeys.has(key));
  if (unexpectedKeys.length > 0) {
    throw new Error(
      `Titan output contains unexpected keys: ${unexpectedKeys.join(", ")}`,
    );
  }
  const outcome = candidate["outcome"];
  if (
    outcome !== "success" &&
    outcome !== "clarification" &&
    outcome !== "failure"
  ) {
    throw new Error("Titan output must include outcome=success|clarification|failure");
  }
  if (typeof candidate["summary"] !== "string") {
    throw new Error("Titan output must include summary");
  }
  if (
    !isStringArray(candidate["files_changed"]) ||
    !isStringArray(candidate["tests_and_checks_run"]) ||
    !isStringArray(candidate["known_risks"]) ||
    !isStringArray(candidate["follow_up_work"]) ||
    !isStringArray(candidate["learnings_written_to_mnemosyne"])
  ) {
    throw new Error("Titan output must include string array artifact fields");
  }

  if (
    outcome === "clarification" &&
    typeof candidate["blocking_question"] !== "string"
  ) {
    throw new Error("Titan clarification output must include blocking_question");
  }
  if (
    outcome === "clarification" &&
    typeof candidate["handoff_note"] !== "string"
  ) {
    throw new Error("Titan clarification output must include handoff_note");
  }

  return {
    outcome,
    summary: candidate["summary"],
    files_changed: candidate["files_changed"],
    tests_and_checks_run: candidate["tests_and_checks_run"],
    known_risks: candidate["known_risks"],
    follow_up_work: candidate["follow_up_work"],
    learnings_written_to_mnemosyne: candidate["learnings_written_to_mnemosyne"],
    blocking_question:
      typeof candidate["blocking_question"] === "string" ? candidate["blocking_question"] : undefined,
    handoff_note: typeof candidate["handoff_note"] === "string" ? candidate["handoff_note"] : undefined,
  };
}

function buildClarificationIssueInput(
  issue: AegisIssue,
  payload: TitanExecutionPayload,
): CreateIssueInput {
  return {
    title: `Clarification needed for ${issue.title}`,
    description: [
      `Titan could not complete ${issue.id} without clarification.`,
      "",
      `Blocking question: ${payload.blocking_question ?? ""}`,
      `Summary: ${payload.summary}`,
      `Handoff note: ${payload.handoff_note}`,
    ].join("\n"),
    issueClass: "clarification",
    priority: issue.priority,
    originId: issue.id,
    labels: ["clarification", "titan"],
  };
}

function findLastTitanPayloadMessage(messages: readonly string[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const candidate = messages[index].trim();
    if (candidate === "") {
      continue;
    }
    try {
      parseTitanExecutionPayload(candidate);
      return messages[index];
    } catch {
      // Keep scanning for the latest valid Titan artifact payload.
    }
  }

  const fallback = messages.at(-1);
  if (!fallback) {
    throw new Error("Titan did not return a final message payload");
  }
  return fallback;
}

async function collectTitanResponse(
  runtime: AgentRuntime,
  issueId: string,
  workingDirectory: string,
  budget: BudgetLimit,
  prompt: string,
): Promise<string> {
  const handle = await runtime.spawn({
    caste: "titan",
    issueId,
    workingDirectory,
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
          reject(new Error(`Titan session ended with reason=${event.reason}`));
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

  return findLastTitanPayloadMessage(messages);
}

export async function runTitan(input: RunTitanInput): Promise<RunTitanResult> {
  if (input.record.stage !== DispatchStage.Implementing) {
    throw new Error(
      `runTitan requires a dispatch record in stage=${DispatchStage.Implementing}`,
    );
  }
  const promptContract = createTitanPromptContract({
    issueId: input.issue.id,
    issueTitle: input.issue.title,
    issueDescription: input.issue.description,
    laborPath: input.labor.laborPath,
    branchName: input.labor.branchName,
    baseBranch: input.labor.baseBranch,
  });
  const contract = createTitanRunContract(promptContract);
  const prompt = buildTitanPrompt(promptContract);

  try {
    const raw = await collectTitanResponse(
      input.runtime,
      input.issue.id,
      input.labor.laborPath,
      input.budget,
      prompt,
    );
    const payload = parseTitanExecutionPayload(raw);

    const handoffArtifact: TitanHandoffArtifact = {
      ...contract.handoffArtifact,
      filesChanged: payload.files_changed,
      testsAndChecksRun: payload.tests_and_checks_run,
      knownRisks: payload.known_risks,
      followUpWork: payload.follow_up_work,
      learningsWrittenToMnemosyne: payload.learnings_written_to_mnemosyne,
      fileScope: input.record.fileScope,
    };

    if (payload.outcome === "success") {
      return {
        prompt,
        outcome: "success",
        updatedRecord: {
          ...transitionStage(input.record, DispatchStage.Implemented),
          runningAgent: null,
          fileScope: null,
        },
        handoffArtifact,
        clarificationArtifact: null,
        clarificationIssue: null,
        failureReason: null,
      };
    }

    let clarificationIssue: CreatedIssue | null = null;
    let clarificationArtifact: TitanClarificationArtifact | null = null;

    if (payload.outcome === "clarification") {
      const blockingQuestion = payload.blocking_question;
      const handoffNote = payload.handoff_note;
      if (blockingQuestion === undefined || handoffNote === undefined) {
        throw new Error("Titan clarification output must include blocking_question and handoff_note");
      }
      clarificationIssue = await input.tracker.createIssue(
        buildClarificationIssueInput(input.issue, payload),
      );
      try {
        await input.tracker.addBlocker(input.issue.id, clarificationIssue.id);
      } catch (error) {
        await input.tracker.closeIssue(
          clarificationIssue.id,
          `Failed to block ${input.issue.id} on clarification issue`,
        );
        throw error;
      }
      clarificationArtifact = {
        ...contract.clarificationArtifact,
        blockingQuestion,
        handoffNote,
        linkedClarificationIssueId: clarificationIssue.id,
      };
    }

    // Clarification or failure ends the current Titan attempt; the origin issue
    // remains open in Beads and clarification work can block its redispatch.
    return {
      prompt,
      outcome: payload.outcome,
      updatedRecord: {
        ...transitionStage(input.record, DispatchStage.Failed),
        runningAgent: null,
        fileScope: null,
      },
      handoffArtifact,
      clarificationArtifact,
      clarificationIssue,
      failureReason: payload.outcome === "failure" ? payload.summary : null,
    };
  } catch (error) {
    return {
      prompt,
      outcome: "failure",
      updatedRecord: {
        ...transitionStage(input.record, DispatchStage.Failed),
        runningAgent: null,
        fileScope: null,
      },
      handoffArtifact: contract.handoffArtifact,
      clarificationArtifact: null,
      clarificationIssue: null,
      failureReason: (error as Error).message,
    };
  }
}
