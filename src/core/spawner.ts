/**
 * S09 spawner — runtime boundary owner (SPECv2 §9.5).
 *
 * Owns the full spawn lifecycle:
 *   1. Plan the labor (worktree + branch) when a write-capable caste is needed.
 *   2. Create the git worktree.
 *   3. Spawn a runtime session with the correct caste and tool restrictions.
 *   4. Return a SpawnResult with the AgentHandle, labor info, and dispatch record update.
 *
 * This module is the single place where git worktree commands are executed
 * for dispatch — no leakage into run-oracle/run-titan/run-sentinel.
 */

import { spawnSync } from "node:child_process";

import type { BudgetLimit } from "../config/schema.js";
import type { LaborCreationPlan, LaborGitCommand } from "../labor/create-labor.js";
import { planLaborCreation } from "../labor/create-labor.js";
import { planLaborCleanup, type LaborCleanupOutcome } from "../labor/cleanup-labor.js";
import type {
  AgentHandle,
  AgentRuntime,
  SpawnOptions,
} from "../runtime/agent-runtime.js";
import type { DispatchRecord } from "./dispatch-state.js";
import { DispatchStage, transitionStage } from "./stage-transition.js";
import type { ReadyIssue } from "../tracker/issue-model.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A named caste that the spawner accepts. */
export type SpawnCaste = "oracle" | "titan" | "sentinel";

/** Result returned by spawnForCaste. */
export interface SpawnResult {
  laborPath: string;
  branchName: string;
  handle: AgentHandle;
  updatedRecord: DispatchRecord;
}

// ---------------------------------------------------------------------------
// Tool-restriction policy by caste
// ---------------------------------------------------------------------------

/**
 * Caste → canonical tool-restriction list.
 *
 * An empty array means "no extra restrictions beyond the runtime's caste defaults."
 * A non-empty array is passed to SpawnOptions.toolRestrictions to narrow further.
 *
 * SPECv2 §8.4 + §9.5:
 *   oracle   → []  (adapter maps to readOnlyTools; spawner does not double-restrict)
 *   titan    → []  (adapter maps to codingTools)
 *   sentinel → []  (adapter maps to readOnlyTools)
 *
 * Callers that need stricter narrowing (e.g. "oracle must only read file X")
 * should pass explicit toolRestrictions to spawnForCaste.
 */
export function casteToolRestrictions(_caste: SpawnCaste): string[] {
  // The Pi adapter already enforces caste-appropriate tool sets.
  // The spawner defers to the adapter; return empty to let the adapter decide.
  return [];
}

// ---------------------------------------------------------------------------
// Working-directory policy
// ---------------------------------------------------------------------------

/**
 * Determine the working directory for a given caste.
 *
 * - oracle / sentinel → projectRoot (read-only castes work on the main tree)
 * - titan → the labor worktree path (write-capable caste needs isolation)
 */
export function resolveWorkingDirectory(
  caste: SpawnCaste,
  projectRoot: string,
  laborPlan: LaborCreationPlan | null,
): string {
  if (caste === "titan") {
    if (!laborPlan) {
      throw new Error("Titan spawn requires a labor plan");
    }
    return laborPlan.laborPath;
  }
  return projectRoot;
}

// ---------------------------------------------------------------------------
// Git execution helper
// ---------------------------------------------------------------------------

/**
 * Execute a git command synchronously, throwing on non-zero exit.
 *
 * Uses spawnSync for Windows-safe argument handling (no shell escaping).
 */
function execGitCommand(
  cmd: LaborGitCommand,
  cwd?: string,
): void {
  const result = spawnSync(cmd.command, cmd.args as string[], {
    cwd: cwd ?? process.cwd(),
    stdio: "inherit",
    encoding: "utf-8",
  });

  if (result.error) {
    throw new Error(
      `Git command failed: ${cmd.command} ${cmd.args.join(" ")}: ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `Git command exited with status ${result.status}: ${cmd.command} ${cmd.args.join(" ")}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Worktree creation / removal
// ---------------------------------------------------------------------------

/**
 * Create a git worktree for a labor.
 *
 * Wraps planLaborCreation() and executes the git worktree add command.
 *
 * @param issueId   - Beads issue ID.
 * @param projectRoot - Absolute path to the project root.
 * @param baseBranch - Branch to base the worktree on (default: "main").
 * @returns The LaborCreationPlan that was executed.
 */
export function createLaborWorktree(
  issueId: string,
  projectRoot: string,
  baseBranch: string = "main",
): LaborCreationPlan {
  const plan = planLaborCreation({ issueId, projectRoot, baseBranch });
  execGitCommand(plan.createWorktreeCommand, projectRoot);
  return plan;
}

/**
 * Remove a git worktree and optionally its branch.
 *
 * Wraps planLaborCleanup() and executes each cleanup command.
 *
 * @param laborPath    - Absolute path to the labor worktree directory.
 * @param branchName   - Git branch name associated with the worktree.
 * @param removeBranch - Whether to delete the branch after removing the worktree.
 */
export function removeLaborWorktree(
  laborPath: string,
  branchName: string,
  removeBranch: boolean = true,
): void {
  const outcome: LaborCleanupOutcome = removeBranch ? "merged" : "manual_recovery";
  const cleanupPlan = planLaborCleanup({
    issueId: "", // Not needed for command generation
    laborPath,
    branchName,
    outcome,
  });

  for (const cmd of cleanupPlan.cleanupCommands) {
    execGitCommand(cmd);
  }
}

// ---------------------------------------------------------------------------
// Main spawn entry point
// ---------------------------------------------------------------------------

/**
 * Input to spawnForCaste.
 */
export interface SpawnForCasteInput {
  /** The Beads issue to work on. */
  issue: ReadyIssue;
  /** The agent caste to run. */
  caste: SpawnCaste;
  /** The AgentRuntime to spawn against. */
  runtime: AgentRuntime;
  /** Budget hard limits for this session. */
  budget: BudgetLimit;
  /** Absolute path to the project root. */
  projectRoot: string;
  /** Current dispatch record for this issue. */
  record: DispatchRecord;
  /** Optional override for tool restrictions. */
  toolRestrictions?: string[];
}

/**
 * Spawn a runtime session for a specific caste.
 *
 * Steps:
 *   1. Create a labor plan (for titan) or skip (for oracle/sentinel).
 *   2. Create the git worktree if needed.
 *   3. Determine the working directory.
 *   4. Spawn the runtime with the correct caste and tool restrictions.
 *   5. Transition the dispatch record to the appropriate stage.
 *
 * @param input - SpawnForCasteInput with all parameters.
 * @returns SpawnResult with the handle, labor info, and updated record.
 */
export async function spawnForCaste(input: SpawnForCasteInput): Promise<SpawnResult> {
  const { issue, caste, runtime, budget, projectRoot, record, toolRestrictions } = input;

  // Step 1 & 2: Create labor worktree for titan only.
  let laborPlan: LaborCreationPlan | null = null;
  if (caste === "titan") {
    laborPlan = createLaborWorktree(issue.id, projectRoot);
  }

  // Step 3: Determine working directory.
  const workingDirectory = resolveWorkingDirectory(caste, projectRoot, laborPlan);

  // Step 4: Spawn the runtime session.
  const effectiveToolRestrictions = toolRestrictions ?? casteToolRestrictions(caste);

  const spawnOptions: SpawnOptions = {
    caste,
    issueId: issue.id,
    workingDirectory,
    toolRestrictions: effectiveToolRestrictions,
    budget,
  };

  const handle = await runtime.spawn(spawnOptions);

  // Step 5: Transition the dispatch record.
  const nextStage = casteToStage(caste);
  const updatedRecord = transitionRecordToStage(record, nextStage);

  return {
    laborPath: laborPlan?.laborPath ?? projectRoot,
    branchName: laborPlan?.branchName ?? "main",
    handle,
    updatedRecord,
  };
}

/**
 * Map a caste to the dispatch stage it should transition to.
 *
 *   oracle   → scouting (SPECv2 §3.3 default workflow)
 *   titan    → implementing
 *   sentinel → reviewing
 */
export function casteToStage(caste: SpawnCaste): DispatchStage {
  switch (caste) {
    case "oracle":
      return DispatchStage.Scouting;
    case "titan":
      return DispatchStage.Implementing;
    case "sentinel":
      return DispatchStage.Reviewing;
  }
}

/**
 * Transition a dispatch record to a new stage.
 *
 * Returns a new record (no mutation). If the transition is invalid,
 * returns the original record with the stage set directly as a fallback.
 */
function transitionRecordToStage(
  record: DispatchRecord,
  stage: DispatchStage,
): DispatchRecord {
  try {
    return {
      ...transitionStage(record, stage),
      runningAgent: null,
    };
  } catch {
    // If the transition is invalid, return the record with the new stage
    // set directly. This is a fallback for cases where the record was
    // not in the expected stage.
    return {
      ...record,
      stage,
      runningAgent: null,
      updatedAt: new Date().toISOString(),
    };
  }
}
