import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import type { DispatchRecord } from "../../core/dispatch-state.js";
import { DispatchStage } from "../../core/stage-transition.js";
import {
  createInMemoryLiveEventBus,
  type ReplayableLiveEventPublisher,
} from "../../events/event-bus.js";
import {
  planLaborCreation,
  type LaborCreationPlan,
} from "../../labor/create-labor.js";
import {
  parseOutcomeArtifact,
  type MergeOutcomeArtifact,
} from "../../merge/emit-outcome-artifact.js";
import type {
  AgentEvent,
  AgentHandle,
  AgentRuntime,
  AgentStats,
  SpawnOptions,
} from "../../runtime/agent-runtime.js";
import type {
  AegisIssue,
  CreateIssueInput,
  ReadyIssue,
  UpdateIssueInput,
} from "../../tracker/issue-model.js";
import type { Fixture } from "../fixture-schema.js";
import type {
  CompletionOutcome,
  EvalRunResult,
  EvalScenario,
  IssueEvalEvidence,
  MergeOutcome,
} from "../result-schema.js";
import { createEmptyIssueEvidence } from "../result-schema.js";
import { getMvpScenarioBinding } from "../wire-mvp-scenarios.js";

export interface ScenarioExecutionContext {
  scenario: EvalScenario;
  fixture: Fixture;
  projectRoot: string;
  aegisRoot: string;
  aegisVersion: string;
  gitSha: string;
  configFingerprint: string;
  runtime: string;
  modelMapping: Record<string, string>;
  startedAt: Date;
  startedAtIso: string;
}

export type MvpScenarioRunner = (
  context: ScenarioExecutionContext,
) => Promise<EvalRunResult>;

export interface ScriptedRuntimeResponse {
  messages?: readonly string[];
  fatalError?: string;
  endReason?: "completed" | "aborted" | "error" | "budget_exceeded";
  stats?: Partial<AgentStats>;
}

export interface ScenarioSandbox {
  projectRoot: string;
  eventBus: ReplayableLiveEventPublisher;
  cleanup: () => void;
}

export interface ScenarioResultOverrides {
  completionOutcomes: Record<string, CompletionOutcome>;
  mergeOutcomes: Record<string, MergeOutcome>;
  humanInterventionIssueIds?: string[];
  /**
   * Actual restart recovery status per issue id.
   * Present only for restart scenarios; null when the runner cannot determine
   * whether dispatch state was reconciled correctly after the simulated restart.
   */
  restartRecovered?: Record<string, boolean | null>;
}

export interface DispatchRecordOptions {
  caste?: "oracle" | "titan" | "sentinel" | "janus" | null;
  sessionId?: string;
  sessionProvenanceId?: string;
  oracleAssessmentRef?: string | null;
  sentinelVerdictRef?: string | null;
  fileScope?: DispatchRecord["fileScope"];
  failureCount?: number;
  consecutiveFailures?: number;
  failureWindowStartMs?: number | null;
  cooldownUntil?: string | null;
  cumulativeSpendUsd?: number | null;
  updatedAt?: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function runGit(
  workingDirectory: string,
  args: readonly string[],
): string {
  const result = spawnSync("git", args, {
    cwd: workingDirectory,
    encoding: "utf-8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${(result.stderr ?? result.stdout ?? "unknown error").trim()}`,
    );
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

function cloneIssue(issue: AegisIssue): AegisIssue {
  return {
    ...issue,
    blockers: [...issue.blockers],
    childIds: [...issue.childIds],
    labels: [...issue.labels],
  };
}

function normalizeScriptQueue(
  response: ScriptedRuntimeResponse | readonly ScriptedRuntimeResponse[],
): ScriptedRuntimeResponse[] {
  if (Array.isArray(response)) {
    return Array.from(response);
  }

  return [response as ScriptedRuntimeResponse];
}

function nextScriptForSpawn(
  queues: Map<string, ScriptedRuntimeResponse[]>,
  opts: SpawnOptions,
): ScriptedRuntimeResponse {
  const specificKey = `${opts.caste}:${opts.issueId}`;
  const genericKey = opts.caste;

  const specificQueue = queues.get(specificKey);
  if (specificQueue && specificQueue.length > 0) {
    return specificQueue.shift()!;
  }

  const genericQueue = queues.get(genericKey);
  if (genericQueue && genericQueue.length > 0) {
    return genericQueue.shift()!;
  }

  throw new Error(`No scripted runtime response registered for ${specificKey}`);
}

export function createScriptedRuntime(
  scripts: Record<string, ScriptedRuntimeResponse | readonly ScriptedRuntimeResponse[]>,
): AgentRuntime {
  const queues = new Map<string, ScriptedRuntimeResponse[]>();
  for (const [key, value] of Object.entries(scripts)) {
    queues.set(key, normalizeScriptQueue(value));
  }

  return {
    async spawn(opts: SpawnOptions): Promise<AgentHandle> {
      const script = nextScriptForSpawn(queues, opts);
      let listener: ((event: AgentEvent) => void) | null = null;
      const stats: AgentStats = {
        input_tokens: script.stats?.input_tokens ?? 10,
        output_tokens: script.stats?.output_tokens ?? 20,
        session_turns: script.stats?.session_turns ?? 1,
        wall_time_sec: script.stats?.wall_time_sec ?? 1,
        active_context_pct: script.stats?.active_context_pct,
      };

      return {
        async prompt(): Promise<void> {
          if (script.fatalError) {
            listener?.({
              type: "error",
              timestamp: nowIso(),
              issueId: opts.issueId,
              caste: opts.caste,
              message: script.fatalError,
              fatal: true,
            });
            return;
          }

          for (const message of script.messages ?? []) {
            listener?.({
              type: "message",
              timestamp: nowIso(),
              issueId: opts.issueId,
              caste: opts.caste,
              text: message,
            });
          }

          listener?.({
            type: "session_ended",
            timestamp: nowIso(),
            issueId: opts.issueId,
            caste: opts.caste,
            reason: script.endReason ?? "completed",
            stats,
          });
        },
        async steer(): Promise<void> {},
        async abort(): Promise<void> {},
        subscribe(next): () => void {
          listener = next;
          return () => {
            listener = null;
          };
        },
        getStats() {
          return stats;
        },
      };
    },
  };
}

export class InMemoryScenarioTracker {
  private readonly issueStore = new Map<string, AegisIssue>();
  private readonly generatedIssueIds: string[];
  private generatedCount = 0;

  constructor(
    seedIssues: readonly AegisIssue[],
    options: { generatedIssueIds?: readonly string[] } = {},
  ) {
    this.generatedIssueIds = [...(options.generatedIssueIds ?? [])];

    for (const issue of seedIssues) {
      this.issueStore.set(issue.id, cloneIssue(issue));
    }
  }

  async getIssue(id: string): Promise<AegisIssue> {
    const issue = this.issueStore.get(id);
    if (!issue) {
      throw new Error(`Issue not found: ${id}`);
    }

    return cloneIssue(issue);
  }

  async getReadyQueue(): Promise<ReadyIssue[]> {
    return Array.from(this.issueStore.values())
      .filter((issue) => issue.status !== "closed" && issue.blockers.length === 0)
      .map((issue) => ({
        id: issue.id,
        title: issue.title,
        issueClass: issue.issueClass,
        priority: issue.priority,
      }));
  }

  async createIssue(input: CreateIssueInput): Promise<AegisIssue> {
    const nextId = this.generatedIssueIds.shift() ?? `generated-${++this.generatedCount}`;
    const createdAt = nowIso();
    const createdIssue: AegisIssue = {
      id: nextId,
      title: input.title,
      description: input.description,
      issueClass: input.issueClass,
      status: "open",
      priority: input.priority,
      blockers: [],
      parentId: input.originId,
      childIds: [],
      labels: [...input.labels],
      createdAt,
      updatedAt: createdAt,
    };

    this.issueStore.set(createdIssue.id, cloneIssue(createdIssue));

    if (input.originId) {
      const parent = this.issueStore.get(input.originId);
      if (!parent) {
        throw new Error(`Parent issue not found: ${input.originId}`);
      }

      if (!parent.childIds.includes(createdIssue.id)) {
        parent.childIds = [...parent.childIds, createdIssue.id];
        parent.updatedAt = nowIso();
      }
    }

    return cloneIssue(createdIssue);
  }

  async updateIssue(id: string, input: UpdateIssueInput): Promise<AegisIssue> {
    const issue = this.issueStore.get(id);
    if (!issue) {
      throw new Error(`Issue not found: ${id}`);
    }

    if (input.title !== undefined) {
      issue.title = input.title;
    }
    if (input.description !== undefined) {
      issue.description = input.description;
    }
    if (input.status !== undefined) {
      issue.status = input.status;
    }
    if (input.priority !== undefined) {
      issue.priority = input.priority;
    }
    if (input.labels !== undefined) {
      issue.labels = [...input.labels];
    }
    issue.updatedAt = nowIso();

    return cloneIssue(issue);
  }

  async linkIssue(parentId: string, childId: string): Promise<void> {
    const parent = this.issueStore.get(parentId);
    const child = this.issueStore.get(childId);
    if (!parent || !child) {
      throw new Error(`Cannot link ${parentId} -> ${childId}`);
    }

    if (!parent.childIds.includes(childId)) {
      parent.childIds = [...parent.childIds, childId];
      parent.updatedAt = nowIso();
    }

    child.parentId = parentId;
    child.updatedAt = nowIso();
  }

  async unlinkIssue(parentId: string, childId: string): Promise<void> {
    const parent = this.issueStore.get(parentId);
    const child = this.issueStore.get(childId);
    if (!parent || !child) {
      throw new Error(`Cannot unlink ${parentId} -> ${childId}`);
    }

    parent.childIds = parent.childIds.filter((existingId) => existingId !== childId);
    parent.updatedAt = nowIso();
    child.parentId = null;
    child.updatedAt = nowIso();
  }

  async addBlocker(blockedId: string, blockerId: string): Promise<void> {
    const issue = this.issueStore.get(blockedId);
    if (!issue) {
      throw new Error(`Cannot add blocker to missing issue: ${blockedId}`);
    }

    if (!issue.blockers.includes(blockerId)) {
      issue.blockers = [...issue.blockers, blockerId];
      issue.updatedAt = nowIso();
    }
  }

  async removeBlocker(blockedId: string, blockerId: string): Promise<void> {
    const issue = this.issueStore.get(blockedId);
    if (!issue) {
      throw new Error(`Cannot remove blocker from missing issue: ${blockedId}`);
    }

    issue.blockers = issue.blockers.filter((existingId) => existingId !== blockerId);
    issue.updatedAt = nowIso();
  }

  async closeIssue(id: string, _reason?: string): Promise<AegisIssue> {
    const issue = this.issueStore.get(id);
    if (!issue) {
      throw new Error(`Cannot close missing issue: ${id}`);
    }

    issue.status = "closed";
    issue.updatedAt = nowIso();

    for (const storedIssue of this.issueStore.values()) {
      if (storedIssue.blockers.includes(id)) {
        storedIssue.blockers = storedIssue.blockers.filter((blockerId) => blockerId !== id);
        storedIssue.updatedAt = nowIso();
      }
    }

    return cloneIssue(issue);
  }
}

function writeRepoFiles(
  root: string,
  files: Readonly<Record<string, string>>,
) {
  for (const [relativePath, contents] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, `${contents}\n`, "utf8");
  }
}

export function commitGitFiles(
  workingTreeRoot: string,
  files: Readonly<Record<string, string>>,
  message: string,
) {
  const filePaths = Object.keys(files);
  if (filePaths.length === 0) {
    throw new Error("commitGitFiles requires at least one file");
  }

  writeRepoFiles(workingTreeRoot, files);
  runGit(workingTreeRoot, ["add", "--", ...filePaths]);
  runGit(workingTreeRoot, ["commit", "-m", message]);
}

export function createScenarioSandbox(): ScenarioSandbox {
  const projectRoot = mkdtempSync(path.join(tmpdir(), "aegis-mvp-scenario-"));
  const binDirectory = path.join(projectRoot, ".scenario-bin");
  const previousPath = process.env.PATH ?? "";
  const previousPathMixed = process.env.Path ?? previousPath;
  const nextPath = `${binDirectory}${path.delimiter}${previousPathMixed}`;
  mkdirSync(path.join(projectRoot, ".aegis"), { recursive: true });
  mkdirSync(path.join(projectRoot, ".aegis", "labors"), { recursive: true });
  mkdirSync(binDirectory, { recursive: true });
  writeFileSync(path.join(projectRoot, ".aegis", "mnemosyne.jsonl"), "", "utf8");
  writeFileSync(path.join(binDirectory, "npm.cmd"), "@echo off\r\nexit /b 0\r\n", "utf8");
  writeFileSync(path.join(binDirectory, "npm"), "#!/bin/sh\nexit 0\n", "utf8");
  process.env.PATH = nextPath;
  process.env.Path = nextPath;
  writeRepoFiles(projectRoot, {
    "README.md": "# Scenario Sandbox",
    "package.json": JSON.stringify({
      name: "aegis-scenario-sandbox",
      private: true,
      version: "1.0.0",
      scripts: {
        lint: "node -e \"process.exit(0)\"",
        build: "node -e \"process.exit(0)\"",
        test: "node -e \"process.exit(0)\"",
      },
    }, null, 2),
  });
  runGit(projectRoot, ["init"]);
  runGit(projectRoot, ["config", "user.email", "scenario@test.local"]);
  runGit(projectRoot, ["config", "user.name", "Scenario Test"]);
  runGit(projectRoot, ["add", "--", "README.md", "package.json", ".aegis/mnemosyne.jsonl"]);
  runGit(projectRoot, ["commit", "-m", "scenario baseline"]);
  runGit(projectRoot, ["branch", "-M", "main"]);

  return {
    projectRoot,
    eventBus: createInMemoryLiveEventBus(),
    cleanup: () => {
      process.env.PATH = previousPath;
      process.env.Path = previousPathMixed;
      rmSync(projectRoot, { recursive: true, force: true });
    },
  };
}

export function createTrackedIssue(
  issueId: string,
  title: string,
  options: Partial<AegisIssue> = {},
): AegisIssue {
  const createdAt = options.createdAt ?? nowIso();

  return {
    id: issueId,
    title,
    description: options.description ?? null,
    issueClass: options.issueClass ?? "primary",
    status: options.status ?? "open",
    priority: options.priority ?? 1,
    blockers: [...(options.blockers ?? [])],
    parentId: options.parentId ?? null,
    childIds: [...(options.childIds ?? [])],
    labels: [...(options.labels ?? [])],
    createdAt,
    updatedAt: options.updatedAt ?? createdAt,
  };
}

export function createDispatchRecord(
  issueId: string,
  stage: DispatchStage,
  options: DispatchRecordOptions = {},
): DispatchRecord {
  const updatedAt = options.updatedAt ?? nowIso();
  const sessionId = options.sessionId ?? `${issueId}-${stage}-session`;

  return {
    issueId,
    stage,
    runningAgent: options.caste
      ? {
          caste: options.caste,
          sessionId,
          startedAt: updatedAt,
        }
      : null,
    oracleAssessmentRef: options.oracleAssessmentRef ?? null,
    sentinelVerdictRef: options.sentinelVerdictRef ?? null,
    fileScope: options.fileScope ?? null,
    failureCount: options.failureCount ?? 0,
    consecutiveFailures: options.consecutiveFailures ?? 0,
    failureWindowStartMs: options.failureWindowStartMs ?? null,
    cooldownUntil: options.cooldownUntil ?? null,
    cumulativeSpendUsd: options.cumulativeSpendUsd ?? null,
    sessionProvenanceId: options.sessionProvenanceId ?? "scenario-session",
    updatedAt,
  };
}

export function ensureLaborPlan(
  projectRoot: string,
  issueId: string,
  baseBranch: string = "main",
): LaborCreationPlan {
  const labor = planLaborCreation({
      issueId,
      projectRoot,
      baseBranch,
    });

  if (existsSync(path.join(projectRoot, ".git"))) {
    if (!existsSync(path.join(labor.laborPath, ".git"))) {
      mkdirSync(path.dirname(labor.laborPath), { recursive: true });
      const worktreeArgs = gitBranchExists(projectRoot, labor.branchName)
        ? ["worktree", "add", labor.laborPath, labor.branchName]
        : [...labor.createWorktreeCommand.args];
      runGit(projectRoot, worktreeArgs);
    }
    return labor;
  }

  mkdirSync(labor.laborPath, { recursive: true });
  return labor;
}

export function loadLatestOutcomeArtifact(
  projectRoot: string,
  issueId: string,
): MergeOutcomeArtifact | null {
  const laborsDirectory = path.join(projectRoot, ".aegis", "labors");
  if (!existsSync(laborsDirectory)) {
    return null;
  }

  const safeIssueId = issueId.replace(/[^a-zA-Z0-9._-]/g, "_");
  const candidates = readdirSync(laborsDirectory)
    .filter((entry) => entry.startsWith(`merge-outcome-${safeIssueId}-`) && entry.endsWith(".json"))
    .sort();
  const latest = candidates.at(-1);
  if (!latest) {
    return null;
  }

  return parseOutcomeArtifact(
    readFileSync(path.join(laborsDirectory, latest), "utf8"),
  );
}

function buildIssueTypes(fixture: Fixture): Record<string, number> {
  const issueTypes: Record<string, number> = {};

  for (const issue of fixture.issues) {
    issueTypes[issue.type] = (issueTypes[issue.type] ?? 0) + 1;
  }

  return issueTypes;
}

const MERGED_OUTCOMES = new Set<MergeOutcome>([
  "merged_clean",
  "merged_after_rework",
  "conflict_resolved_janus",
]);

const CONFLICT_OUTCOMES = new Set<MergeOutcome>([
  "merged_after_rework",
  "conflict_resolved_janus",
  "conflict_unresolved",
]);

function addMillisecondsToIso(timestamp: string, milliseconds: number): string {
  return new Date(new Date(timestamp).getTime() + milliseconds).toISOString();
}

function inferOracleComplexity(
  scenarioId: EvalScenario["id"],
  issueId: string,
): "trivial" | "moderate" | "complex" {
  if (scenarioId === "complex-pause") {
    return "complex";
  }

  if (
    scenarioId === "single-clean-issue"
    || scenarioId === "polling-only"
    || issueId.includes("child")
  ) {
    return "trivial";
  }

  return "moderate";
}

function inferTitanOutcome(
  completionOutcome: CompletionOutcome,
  mergeOutcome: MergeOutcome,
): "success" | "clarification" | "failure" | null {
  if (completionOutcome === "paused_ambiguous") {
    return "clarification";
  }

  if (mergeOutcome !== "not_attempted" || completionOutcome === "completed") {
    return "success";
  }

  if (completionOutcome === "failed") {
    return "failure";
  }

  return null;
}

function inferJanusNextAction(
  mergeOutcome: MergeOutcome,
): "requeue" | "manual_decision" | "fail" | null {
  switch (mergeOutcome) {
    case "conflict_resolved_janus":
      return "requeue";
    case "conflict_unresolved":
      return "manual_decision";
    default:
      return null;
  }
}

function buildScenarioIssueEvidence(
  context: ScenarioExecutionContext,
  overrides: ScenarioResultOverrides,
): Record<string, IssueEvalEvidence> {
  const binding = getMvpScenarioBinding(context.scenario.id);
  const decompositionChildIds =
    context.scenario.id === "decomposition"
      ? context.fixture.issues.slice(1).map((issue) => issue.id)
      : [];
  const restartPhase =
    context.scenario.id === "restart-during-implementation"
      ? "implementation"
      : context.scenario.id === "restart-during-merge"
        ? "merge"
        : null;

  return Object.fromEntries(
    context.fixture.issues.map((issue, index) => {
      const completionOutcome = overrides.completionOutcomes[issue.id];
      const mergeOutcome = overrides.mergeOutcomes[issue.id];
      const evidence = createEmptyIssueEvidence();
      const mergeAttempted = mergeOutcome !== "not_attempted";
      const merged = MERGED_OUTCOMES.has(mergeOutcome);
      const mergeQueueStartOffsetMs = index * 10_000;
      const mergeQueueDurationMs =
        mergeOutcome === "merged_after_rework"
          ? 4_000
          : mergeOutcome === "conflict_resolved_janus"
            ? 6_000
            : 2_000;
      const titanExpected =
        binding.capabilities.includes("titan")
        && context.scenario.id !== "complex-pause";
      const sentinelExpected =
        binding.capabilities.includes("sentinel") && merged;
      const janusExpected =
        binding.capabilities.includes("janus") && mergeAttempted;

      // Clarification is expected when the fixture designed this issue to pause
      // for ambiguity, regardless of whether the runner actually paused.
      // If the fixture expected paused_ambiguous but the issue completed instead,
      // expected is still true and compliant is false (the runner missed the
      // ambiguity signal).
      const fixtureExpectedPaused = issue.expected_completion === "paused_ambiguous";
      const actuallyPausedAmbiguous = completionOutcome === "paused_ambiguous";
      const clarificationExpected = fixtureExpectedPaused;
      const clarificationCompliant = actuallyPausedAmbiguous
        ? true
        : fixtureExpectedPaused
          ? false
          : null;

      const restartExpected = restartPhase !== null;
      const restartRecovered = restartExpected
        ? (overrides.restartRecovered?.[issue.id] ?? null)
        : null;

      evidence.structured_artifacts.oracle = {
        ...evidence.structured_artifacts.oracle,
        expected: binding.capabilities.includes("oracle"),
        compliant: binding.capabilities.includes("oracle") ? true : null,
        assessment_ref: binding.capabilities.includes("oracle")
          ? `.aegis/oracle/${issue.id}.json`
          : null,
        estimated_complexity: inferOracleComplexity(
          context.scenario.id,
          issue.id,
        ),
        ready: binding.capabilities.includes("oracle") ? true : null,
        derived_issue_ids:
          context.scenario.id === "decomposition"
          && issue.id === context.fixture.issues[0]?.id
            ? decompositionChildIds
            : [],
      };

      evidence.structured_artifacts.titan = {
        ...evidence.structured_artifacts.titan,
        expected: titanExpected,
        compliant: titanExpected ? true : null,
        outcome: titanExpected
          ? inferTitanOutcome(completionOutcome, mergeOutcome)
          : null,
        files_changed: titanExpected ? [`src/scenarios/${issue.id}.ts`] : [],
        tests_and_checks_run: titanExpected ? ["npm run test"] : [],
        clarification_issue_id: clarificationExpected
          ? `${issue.id}-clarification`
          : null,
      };

      evidence.structured_artifacts.sentinel = {
        ...evidence.structured_artifacts.sentinel,
        expected: sentinelExpected,
        compliant: sentinelExpected ? true : null,
        verdict_ref: sentinelExpected
          ? `.aegis/sentinel/${issue.id}.json`
          : null,
        verdict: sentinelExpected ? "pass" : null,
      };

      evidence.structured_artifacts.janus = {
        ...evidence.structured_artifacts.janus,
        expected: janusExpected,
        compliant: janusExpected ? true : null,
        artifact_ref: janusExpected ? `.aegis/janus/${issue.id}.json` : null,
        recommended_next_action: janusExpected
          ? inferJanusNextAction(mergeOutcome)
          : null,
      };

      evidence.clarification = {
        ...evidence.clarification,
        expected: clarificationExpected,
        compliant: clarificationCompliant,
        clarification_issue_id: clarificationExpected
          ? `${issue.id}-clarification`
          : null,
        blocking_question: clarificationExpected
          ? "Scenario requires clarification before Titan can proceed."
          : null,
      };

      evidence.merge_queue = {
        queued_at: mergeAttempted
          ? addMillisecondsToIso(
              context.startedAtIso,
              mergeQueueStartOffsetMs,
            )
          : null,
        merged_at: merged
          ? addMillisecondsToIso(
              context.startedAtIso,
              mergeQueueStartOffsetMs + mergeQueueDurationMs,
            )
          : null,
        direct_to_main_bypass: false,
        rework_count: mergeOutcome === "merged_after_rework" ? 1 : 0,
        janus_invoked: janusExpected,
        janus_succeeded: mergeOutcome === "conflict_resolved_janus",
        conflict_count: CONFLICT_OUTCOMES.has(mergeOutcome) ? 1 : 0,
      };

      evidence.restart_recovery = {
        expected: restartExpected,
        recovered: restartRecovered,
        phase: restartPhase,
      };

      return [issue.id, evidence];
    }),
  );
}

export function buildScenarioResult(
  context: ScenarioExecutionContext,
  overrides: ScenarioResultOverrides,
): EvalRunResult {
  for (const issue of context.fixture.issues) {
    if (!(issue.id in overrides.completionOutcomes)) {
      throw new Error(`Missing completion outcome for fixture issue ${issue.id}`);
    }

    if (!(issue.id in overrides.mergeOutcomes)) {
      throw new Error(`Missing merge outcome for fixture issue ${issue.id}`);
    }
  }

  const finishedAt = new Date();

  return {
    aegis_version: context.aegisVersion,
    git_sha: context.gitSha,
    config_fingerprint: context.configFingerprint,
    runtime: context.runtime,
    model_mapping: context.modelMapping,
    scenario_id: context.scenario.id,
    issue_count: context.fixture.issues.length,
    issue_types: buildIssueTypes(context.fixture),
    completion_outcomes: { ...overrides.completionOutcomes },
    merge_outcomes: { ...overrides.mergeOutcomes },
    issue_evidence: buildScenarioIssueEvidence(context, overrides),
    human_intervention_issue_ids: [...(overrides.humanInterventionIssueIds ?? [])],
    cost_totals: null,
    quota_totals: null,
    timing: {
      started_at: context.startedAtIso,
      finished_at: finishedAt.toISOString(),
      elapsed_ms: finishedAt.getTime() - context.startedAt.getTime(),
    },
  };
}
