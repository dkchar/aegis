/**
 * Sentinel review dispatch orchestrator.
 *
 * SPECv2 §3.4, §10.3: Sentinel reviews merged code post-merge by default.
 * This module owns the dispatch flow for the Sentinel caste — spawning the
 * session, collecting the response, parsing the verdict, persisting the
 * artifact, and transitioning the dispatch record.
 *
 * Pattern modelled after run-oracle.ts and run-titan.ts.
 */

import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { BudgetLimit } from "../config/schema.js";
import {
  parseSentinelVerdict,
  type SentinelVerdict,
} from "../castes/sentinel/sentinel-parser.js";
import {
  buildSentinelPrompt,
  createSentinelPromptContract,
} from "../castes/sentinel/sentinel-prompt.js";
import type {
  AgentEvent,
  AgentRuntime,
} from "../runtime/agent-runtime.js";
import { DEFAULT_AEGIS_CONFIG } from "../config/defaults.js";
import type {
  AegisIssue,
  AegisIssue as CreatedIssue,
  CreateIssueInput,
} from "../tracker/issue-model.js";
import { createFixIssueInputs } from "../tracker/create-fix-issue.js";
import type { DispatchRecord } from "./dispatch-state.js";
import { DispatchStage, transitionStage } from "./stage-transition.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SentinelIssueCreator {
  createIssue(input: CreateIssueInput): Promise<CreatedIssue>;
  addBlocker(blockedId: string, blockerId: string): Promise<void>;
  closeIssue(id: string, reason?: string): Promise<CreatedIssue>;
}

export interface RunSentinelInput {
  issue: AegisIssue;
  record: DispatchRecord;
  runtime: AgentRuntime;
  tracker: SentinelIssueCreator;
  budget: BudgetLimit;
  projectRoot: string;
  model?: string;
}

export interface RunSentinelResult {
  prompt: string;
  verdict: SentinelVerdict | null;
  createdFixIssues: CreatedIssue[];
  updatedRecord: DispatchRecord;
  failureReason: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildSentinelVerdictRef(issueId: string): string {
  return join(".aegis", "sentinel", `${issueId}.json`);
}

function persistSentinelVerdict(
  projectRoot: string,
  issueId: string,
  verdict: SentinelVerdict,
): string {
  const verdictRef = buildSentinelVerdictRef(issueId);
  const verdictDirectory = join(projectRoot, ".aegis", "sentinel");
  const absolutePath = join(projectRoot, verdictRef);
  const temporaryPath = `${absolutePath}.tmp`;
  mkdirSync(verdictDirectory, { recursive: true });
  writeFileSync(temporaryPath, `${JSON.stringify(verdict, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, absolutePath);
  return verdictRef;
}

function isSentinelVerdictJson(text: string): boolean {
  try {
    const parsed = JSON.parse(text);
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      "verdict" in parsed &&
      "reviewSummary" in parsed &&
      "issuesFound" in parsed &&
      "followUpIssueIds" in parsed &&
      "riskAreas" in parsed
    );
  } catch {
    return false;
  }
}

function findFinalSentinelPayloadMessage(messages: readonly string[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const candidate = messages[index].trim();
    if (candidate === "") {
      continue;
    }
    // Validate that the message looks like a verdict artifact, matching the
    // Titan pattern of scanning for the latest valid payload.
    if (isSentinelVerdictJson(candidate)) {
      return messages[index];
    }
  }
  throw new Error("Sentinel did not return a final message payload");
}

async function collectSentinelResponse(
  runtime: AgentRuntime,
  issueId: string,
  projectRoot: string,
  budget: BudgetLimit,
  model: string,
  prompt: string,
): Promise<string> {
  const handle = await runtime.spawn({
    caste: "sentinel",
    issueId,
    workingDirectory: projectRoot,
    toolRestrictions: ["read", "read-only shell", "tracker commands"],
    model,
    budget,
  });

  const messages: string[] = [];

  const sessionPromise = new Promise<void>((resolve, reject) => {
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
          reject(new Error(`Sentinel session ended with reason=${event.reason}`));
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

  // Fail closed if the runtime crashes without emitting session_ended.
  const timeoutMs = 10 * 60 * 1000; // 10 minutes — generous upper bound
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`Sentinel session timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  try {
    await Promise.race([sessionPromise, timeoutPromise]);
  } catch (error) {
    // Attempt to abort the runtime session to free resources, then re-throw.
    try {
      await handle.abort();
    } catch {
      // Best-effort cleanup; the original error is more important.
    }
    throw error;
  } finally {
    clearTimeout(timeoutId!);
  }

  return findFinalSentinelPayloadMessage(messages);
}

async function materializeFixIssues(
  issue: AegisIssue,
  tracker: SentinelIssueCreator,
  verdict: SentinelVerdict,
): Promise<CreatedIssue[]> {
  const fixInputs = createFixIssueInputs(issue, verdict);
  const createdIssues: CreatedIssue[] = [];
  const issuesWithAddedBlockers: CreatedIssue[] = [];

  try {
    for (const fixInput of fixInputs) {
      const createdIssue = await tracker.createIssue(fixInput);
      createdIssues.push(createdIssue);
      await tracker.addBlocker(issue.id, createdIssue.id);
      issuesWithAddedBlockers.push(createdIssue);
    }
  } catch (error) {
    // Best-effort cleanup: close any fix issues that were created but failed
    // to have their blockers linked, following the Oracle rollback pattern.
    for (const createdIssue of createdIssues) {
      if (issuesWithAddedBlockers.some((i) => i.id === createdIssue.id)) {
        // Blocker was already linked for this issue; skip cleanup.
        continue;
      }
      // This issue was created but addBlocker was never called or threw.
      try {
        await tracker.closeIssue(
          createdIssue.id,
          `Sentinel review for ${issue.id} failed during fix-issue materialization`,
        );
      } catch {
        // Swallow close errors; the original error is more important.
      }
    }
    throw error;
  }

  return createdIssues;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function runSentinel(input: RunSentinelInput): Promise<RunSentinelResult> {
  if (input.record.stage !== DispatchStage.Reviewing) {
    throw new Error(
      `runSentinel requires a dispatch record in stage=${DispatchStage.Reviewing}`,
    );
  }

  const promptContract = createSentinelPromptContract({
    issueId: input.issue.id,
    issueTitle: input.issue.title,
    issueDescription: input.issue.description,
    targetBranch: "main",
    baseBranch: "main",
  });
  const prompt = buildSentinelPrompt(promptContract);
  let verdict: SentinelVerdict | null = null;
  let verdictRef: string | null = null;
  const createdFixIssues: CreatedIssue[] = [];

  try {
    const raw = await collectSentinelResponse(
      input.runtime,
      input.issue.id,
      input.projectRoot,
      input.budget,
      input.model ?? DEFAULT_AEGIS_CONFIG.models.sentinel,
      prompt,
    );

    verdict = parseSentinelVerdict(raw);
    verdictRef = persistSentinelVerdict(
      input.projectRoot,
      input.issue.id,
      verdict,
    );

    if (verdict.verdict === "pass") {
      return {
        prompt,
        verdict,
        createdFixIssues: [],
        updatedRecord: {
          ...transitionStage(input.record, DispatchStage.Complete),
          runningAgent: null,
          sentinelVerdictRef: verdictRef,
        },
        failureReason: null,
      };
    }

    // Fail verdict — create corrective work
    const fixIssues = await materializeFixIssues(
      input.issue,
      input.tracker,
      verdict,
    );
    createdFixIssues.push(...fixIssues);

    return {
      prompt,
      verdict,
      createdFixIssues,
      updatedRecord: {
        ...transitionStage(input.record, DispatchStage.Failed),
        runningAgent: null,
        sentinelVerdictRef: verdictRef,
      },
      failureReason: verdict.reviewSummary,
    };
  } catch (error) {
    // Fail closed: parse errors, runtime crashes, and session aborts all
    // land the record in the failed stage.
    return {
      prompt,
      verdict,
      createdFixIssues,
      updatedRecord: {
        ...transitionStage(input.record, DispatchStage.Failed),
        runningAgent: null,
        sentinelVerdictRef: verdictRef,
      },
      failureReason: (error as Error).message,
    };
  }
}
