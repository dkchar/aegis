import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { DEFAULT_AEGIS_CONFIG } from "../config/defaults.js";
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
  oracleDerivedDescription,
} from "../castes/oracle/oracle-parser.js";
import type {
  AgentEvent,
  AgentRuntime,
} from "../runtime/agent-runtime.js";
import type { LiveEventPublisher } from "../events/event-bus.js";
import {
  createLoopPhaseLog,
  createAgentSessionStarted,
  createAgentSessionEnded,
  createAgentSessionLog,
} from "../events/dashboard-events.js";
import type {
  AegisIssue,
  AegisIssue as CreatedIssue,
  CreateIssueInput,
  ReadyIssue,
} from "../tracker/issue-model.js";
import { createDerivedIssueInputs } from "../tracker/create-derived-issues.js";
import type { OperatingMode } from "./operating-mode.js";
import { buildRelevantLearningsPrompt } from "../memory/select-learnings.js";

export type OracleComplexityDisposition =
  | "allow"
  | "needs_human_approval"
  | "skip_auto_dispatch";

export interface OracleIssueCreator {
  getIssue(id: string): Promise<AegisIssue>;
  getReadyQueue(): Promise<ReadyIssue[]>;
  createIssue(input: CreateIssueInput): Promise<CreatedIssue>;
  linkIssue(parentId: string, childId: string): Promise<void>;
  unlinkIssue(parentId: string, childId: string): Promise<void>;
  addBlocker(blockedId: string, blockerId: string): Promise<void>;
  removeBlocker(blockedId: string, blockerId: string): Promise<void>;
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
  mnemosyne?: { prompt_token_budget: number };
  model?: string;
  eventPublisher?: LiveEventPublisher;
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
  readonly survivingIssues: CreatedIssue[];

  constructor(
    message: string,
    rolledBackIssues: CreatedIssue[],
    survivingIssues: CreatedIssue[],
  ) {
    super(message);
    this.name = "DerivedIssueMaterializationError";
    this.rolledBackIssues = rolledBackIssues;
    this.survivingIssues = survivingIssues;
  }
}

type CreatedIssueCarrier = Error & {
  createdIssue?: CreatedIssue;
};

function buildOracleAssessmentRef(issueId: string): string {
  return join(".aegis", "oracle", `${issueId}.json`);
}

function persistOracleAssessment(
  projectRoot: string,
  issueId: string,
  assessment: OracleAssessment,
): string {
  const assessmentRef = buildOracleAssessmentRef(issueId);
  const assessmentDirectory = join(projectRoot, ".aegis", "oracle");
  const absolutePath = join(projectRoot, assessmentRef);
  const temporaryPath = `${absolutePath}.tmp`;
  mkdirSync(assessmentDirectory, { recursive: true });
  writeFileSync(temporaryPath, `${JSON.stringify(assessment, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, absolutePath);
  return assessmentRef;
}

function getCreatedIssueFromError(error: unknown): CreatedIssue | null {
  if (!(error instanceof Error)) {
    return null;
  }

  const createdIssue = (error as CreatedIssueCarrier).createdIssue;
  return createdIssue ?? null;
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

function buildLearningQuery(issue: Pick<AegisIssue, "title" | "description" | "labels">): string {
  return [issue.title, issue.description ?? "", issue.labels.join(" ")].join(" ");
}

function buildOraclePromptWithLearnings(
  issue: AegisIssue,
  projectRoot: string,
  mnemosyne: { prompt_token_budget: number },
): string {
  const relevantLearnings = buildRelevantLearningsPrompt(
    join(projectRoot, ".aegis", "mnemosyne.jsonl"),
    buildLearningQuery(issue),
    mnemosyne,
  );

  return buildOraclePrompt({
    ...issueToOraclePromptIssue(issue),
    relevantLearnings,
  });
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
  sessionId: string,
  projectRoot: string,
  budget: BudgetLimit,
  model: string,
  prompt: string,
  eventPublisher: LiveEventPublisher | undefined,
): Promise<string> {
  const handle = await runtime.spawn({
    caste: "oracle",
    issueId,
    workingDirectory: projectRoot,
    toolRestrictions: [],
    model,
    budget,
  });

  const messages: string[] = [];

  const sessionPromise = new Promise<void>((resolve, reject) => {
    const unsubscribe = handle.subscribe((event: AgentEvent) => {
      if (event.type === "message") {
        messages.push(event.text);
        eventPublisher?.publish(createAgentSessionLog(
          sessionId, "oracle", issueId, event.text,
        ));
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

  // Fail closed if the runtime crashes without emitting session_ended.
  const timeoutMs = 10 * 60 * 1000; // 10 minutes -- generous upper bound
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`Oracle session timed out after ${timeoutMs}ms`)), timeoutMs);
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

  return findFinalOraclePayloadMessage(messages);
}

async function rollbackDerivedIssues(
  issueId: string,
  tracker: OracleIssueCreator,
  createdIssues: readonly CreatedIssue[],
): Promise<{
  rolledBackIssues: CreatedIssue[];
  survivingIssues: CreatedIssue[];
  cleanupErrors: string[];
}> {
  const cleanupErrors: string[] = [];
  const rolledBackIssues: CreatedIssue[] = [];
  const survivingIssues: CreatedIssue[] = [];

  for (const createdIssue of createdIssues) {
    try {
      const closedIssue = await tracker.closeIssue(
        createdIssue.id,
        `Failed to materialize derived issues for ${issueId}`,
      );
      rolledBackIssues.push(closedIssue);
    } catch (error) {
      cleanupErrors.push((error as Error).message);
      survivingIssues.push(createdIssue);
    }
  }

  return {
    rolledBackIssues,
    survivingIssues,
    cleanupErrors,
  };
}

function groupReusableDerivedIssues(
  issues: readonly CreatedIssue[],
): Map<string, CreatedIssue[]> {
  const grouped = new Map<string, CreatedIssue[]>();
  for (const issue of issues) {
    const existing = grouped.get(issue.title) ?? [];
    grouped.set(issue.title, [...existing, issue]);
  }
  return grouped;
}

function isIssueNotFound(error: unknown): boolean {
  return error instanceof Error && /not found/i.test(error.message);
}

async function loadExistingIssues(
  issueIds: readonly string[],
  tracker: OracleIssueCreator,
): Promise<CreatedIssue[]> {
  const loadedIssues: CreatedIssue[] = [];
  for (const issueId of issueIds) {
    try {
      loadedIssues.push(await tracker.getIssue(issueId));
    } catch (error) {
      if (!isIssueNotFound(error)) {
        throw error;
      }
    }
  }
  return loadedIssues;
}

async function loadRecoverableOrphanedIssues(
  issueId: string,
  tracker: OracleIssueCreator,
  derivedIssues: readonly CreateIssueInput[],
): Promise<Map<string, CreatedIssue[]>> {
  if (derivedIssues.length === 0) {
    return new Map();
  }

  const desiredTitles = new Set(derivedIssues.map((derivedIssue) => derivedIssue.title));
  const readyCandidates = await tracker.getReadyQueue();
  const matchingReadyIssues = readyCandidates.filter(
    (readyIssue) =>
      readyIssue.issueClass === "sub" &&
      desiredTitles.has(readyIssue.title),
  );
  const loadedIssues = await loadExistingIssues(
    matchingReadyIssues.map((readyIssue) => readyIssue.id),
    tracker,
  );

  return groupReusableDerivedIssues(loadedIssues.filter(
    (loadedIssue) =>
      loadedIssue.status !== "closed" &&
      loadedIssue.parentId === null &&
      loadedIssue.description === oracleDerivedDescription(issueId),
  ));
}

async function loadReusableDerivedIssues(
  issue: AegisIssue,
  tracker: OracleIssueCreator,
  derivedIssues: readonly CreateIssueInput[],
): Promise<{
  blockerIds: Set<string>;
  derivedIssuesByTitle: Map<string, CreatedIssue[]>;
  orphanedIssuesByTitle: Map<string, CreatedIssue[]>;
}> {
  const openChildIssues = (await loadExistingIssues(issue.childIds, tracker)).filter(
    (childIssue) =>
      childIssue.status !== "closed" &&
      childIssue.parentId === issue.id &&
      childIssue.issueClass === "sub" &&
      childIssue.description === oracleDerivedDescription(issue.id),
  );

  return {
    blockerIds: new Set(issue.blockers),
    derivedIssuesByTitle: groupReusableDerivedIssues(openChildIssues),
    orphanedIssuesByTitle: await loadRecoverableOrphanedIssues(
      issue.id,
      tracker,
      derivedIssues,
    ),
  };
}

async function materializeDerivedIssues(
  issue: AegisIssue,
  tracker: OracleIssueCreator,
  derivedIssues: readonly CreateIssueInput[],
) : Promise<{
  liveIssues: CreatedIssue[];
  blockerIds: Set<string>;
}> {
  if (derivedIssues.length === 0) {
    return {
      liveIssues: [],
      blockerIds: new Set(issue.blockers),
    };
  }

  const {
    blockerIds,
    derivedIssuesByTitle,
    orphanedIssuesByTitle,
  } = await loadReusableDerivedIssues(issue, tracker, derivedIssues);

  const liveIssues: CreatedIssue[] = [];
  const newlyCreatedIssues: CreatedIssue[] = [];
  const issuesWithAddedBlockers: CreatedIssue[] = [];
  const recoveredOrphanedIssues: CreatedIssue[] = [];

  try {
    for (const derivedIssue of derivedIssues) {
      const reusableIssues = derivedIssuesByTitle.get(derivedIssue.title);
      const reusableIssue =
        reusableIssues && reusableIssues.length > 0 ? reusableIssues.shift() ?? null : null;

      if (reusableIssue) {
        liveIssues.push(reusableIssue);
        if (!blockerIds.has(reusableIssue.id)) {
          issuesWithAddedBlockers.push(reusableIssue);
          await tracker.addBlocker(issue.id, reusableIssue.id);
          blockerIds.add(reusableIssue.id);
        }
        continue;
      }

      const orphanedIssues = orphanedIssuesByTitle.get(derivedIssue.title);
      const orphanedIssue =
        orphanedIssues && orphanedIssues.length > 0 ? orphanedIssues.shift() ?? null : null;

      if (orphanedIssue) {
        liveIssues.push(orphanedIssue);
        recoveredOrphanedIssues.push(orphanedIssue);
        await tracker.linkIssue(issue.id, orphanedIssue.id);
        issuesWithAddedBlockers.push(orphanedIssue);
        await tracker.addBlocker(issue.id, orphanedIssue.id);
        blockerIds.add(orphanedIssue.id);
        continue;
      }

      const createdIssue = await tracker.createIssue(derivedIssue);
      newlyCreatedIssues.push(createdIssue);
      liveIssues.push(createdIssue);
      await tracker.addBlocker(issue.id, createdIssue.id);
      blockerIds.add(createdIssue.id);
    }
  } catch (error) {
    const blockerCleanupErrors: string[] = [];
    const removedBlockerIds = new Set<string>();
    for (const issueWithAddedBlocker of issuesWithAddedBlockers) {
      try {
        await tracker.removeBlocker(issue.id, issueWithAddedBlocker.id);
        blockerIds.delete(issueWithAddedBlocker.id);
        removedBlockerIds.add(issueWithAddedBlocker.id);
      } catch (cleanupError) {
        blockerCleanupErrors.push((cleanupError as Error).message);
      }
    }
    const unlinkCleanupErrors: string[] = [];
    const fullyRestoredRecoveredOrphans = new Set<string>();
    for (const recoveredOrphanedIssue of recoveredOrphanedIssues) {
      try {
        await tracker.unlinkIssue(issue.id, recoveredOrphanedIssue.id);
        if (removedBlockerIds.has(recoveredOrphanedIssue.id)) {
          fullyRestoredRecoveredOrphans.add(recoveredOrphanedIssue.id);
        }
      } catch (cleanupError) {
        unlinkCleanupErrors.push((cleanupError as Error).message);
      }
    }
    const createdIssue = getCreatedIssueFromError(error);
    if (
      createdIssue &&
      !newlyCreatedIssues.some((existingIssue) => existingIssue.id === createdIssue.id)
    ) {
      newlyCreatedIssues.push(createdIssue);
      liveIssues.push(createdIssue);
    }
    const rollbackOutcome = await rollbackDerivedIssues(issue.id, tracker, newlyCreatedIssues);
    const reusedIssues = liveIssues.filter(
      (liveIssue) =>
        !newlyCreatedIssues.some((createdIssue) => createdIssue.id === liveIssue.id) &&
        !fullyRestoredRecoveredOrphans.has(liveIssue.id),
    );
    const failureParts = [(error as Error).message];
    if (rollbackOutcome.cleanupErrors.length > 0) {
      failureParts.push(
        `cleanup errors: ${rollbackOutcome.cleanupErrors.join("; ")}`,
      );
    }
    if (blockerCleanupErrors.length > 0) {
      failureParts.push(
        `blocker cleanup errors: ${blockerCleanupErrors.join("; ")}`,
      );
    }
    if (unlinkCleanupErrors.length > 0) {
      failureParts.push(
        `unlink cleanup errors: ${unlinkCleanupErrors.join("; ")}`,
      );
    }
    throw new DerivedIssueMaterializationError(
      failureParts.join("; "),
      rollbackOutcome.rolledBackIssues,
      [...reusedIssues, ...rollbackOutcome.survivingIssues],
    );
  }

  return {
    liveIssues,
    blockerIds,
  };
}

export async function runOracle(input: RunOracleInput): Promise<RunOracleResult> {
  if (input.record.stage !== DispatchStage.Scouting) {
    throw new Error(
      `runOracle requires a dispatch record in stage=${DispatchStage.Scouting}`,
    );
  }

  const ep = input.eventPublisher;
  const sessionId = input.record.runningAgent?.sessionId ?? `oracle-${input.issue.id}`;

  ep?.publish(createLoopPhaseLog("dispatch", `oracle -> ${input.issue.id}`, input.issue.id));
  ep?.publish(createAgentSessionStarted(
    sessionId,
    "oracle",
    input.issue.id,
    input.record.stage,
    input.model ?? DEFAULT_AEGIS_CONFIG.models.oracle,
  ));

  const mnemosyneConfig = input.mnemosyne ?? DEFAULT_AEGIS_CONFIG.mnemosyne;
  let prompt = buildOraclePromptWithLearnings(
    input.issue,
    input.projectRoot,
    mnemosyneConfig,
  );
  let assessment: OracleAssessment | null = null;
  let derivedIssues: CreateIssueInput[] = [];
  let createdIssues: CreatedIssue[] = [];
  let rolledBackIssues: CreatedIssue[] = [];
  let oracleAssessmentRef: string | null = null;

  try {
    const promptIssue = await input.tracker.getIssue(input.issue.id);
    prompt = buildOraclePromptWithLearnings(
      promptIssue,
      input.projectRoot,
      mnemosyneConfig,
    );
    const raw = await collectOracleResponse(
      input.runtime,
      input.issue.id,
      sessionId,
      input.projectRoot,
      input.budget,
      input.model ?? DEFAULT_AEGIS_CONFIG.models.oracle,
      prompt,
      ep,
    );
    assessment = parseOracleAssessment(raw);
    oracleAssessmentRef = persistOracleAssessment(
      input.projectRoot,
      input.issue.id,
      assessment,
    );
    const trackedIssue = await input.tracker.getIssue(input.issue.id);
    if (trackedIssue.status !== "open") {
      throw new Error(`Oracle target ${trackedIssue.id} is no longer open`);
    }
    derivedIssues = createDerivedIssueInputs(trackedIssue, assessment);
    const materialization = await materializeDerivedIssues(
      trackedIssue,
      input.tracker,
      derivedIssues,
    );
    createdIssues = materialization.liveIssues;
    const complexityDisposition = determineComplexityDisposition(
      assessment.estimated_complexity,
      input.operatingMode,
      input.allowComplexAutoDispatch,
    );
    const requiresComplexityGate = complexityDisposition !== "allow";
    const readyForImplementation =
      assessment.ready &&
      !requiresComplexityGate &&
      materialization.blockerIds.size === 0 &&
      (assessment.blockers?.length ?? 0) === 0;

    ep?.publish(createAgentSessionEnded(sessionId, "oracle", input.issue.id, "completed"));

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
      createdIssues = error.survivingIssues;
    }

    ep?.publish(createAgentSessionEnded(sessionId, "oracle", input.issue.id, "failed"));

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
