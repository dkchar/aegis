/**
 * S10 Lane B — Recovery implementation.
 *
 * Implements the Recovery interface defined in recovery.ts.
 * SPECv2 §6.3, §6.5:
 *   - reconstruct active or incomplete work from disk
 *   - in-progress stages survive process death and are reconciled
 *   - dead agents are reconciled
 *   - orphaned Labors are reconciled
 *   - produce a RecoveryReport for operator visibility
 */

import { existsSync } from "node:fs";
import type {
  Recovery,
  RecoveryReport,
  AgentReconciliation,
  AgentRecoveryStatus,
  LaborReconciliation,
  LaborRecoveryStatus,
} from "./recovery.js";
import {
  findInProgressRecords,
  summarizeRecovery,
  canRedispatchAfterRecovery,
} from "./recovery.js";
import type { DispatchState, DispatchRecord } from "./dispatch-state.js";
import { DispatchStage } from "./stage-transition.js";

// ---------------------------------------------------------------------------
// Recovery implementation
// ---------------------------------------------------------------------------

/**
 * Default Recovery implementation.
 *
 * The Recovery class performs actual inspection of sessions and labors.
 * It uses injectable probes for session liveness and filesystem checks
 * for labor inspection so it remains testable without real git processes.
 */
export class RecoveryImpl implements Recovery {
  private readonly sessionAliveCheck: (sessionId: string) => boolean;
  private readonly worktreeExistsCheck: (path: string) => boolean;
  private readonly branchExistsCheck: (branchName: string) => boolean;
  private readonly hasArtifactsCheck: (
    issueId: string,
    sessionId: string,
  ) => boolean;

  constructor(options?: {
    sessionAliveCheck?: (sessionId: string) => boolean;
    worktreeExistsCheck?: (path: string) => boolean;
    branchExistsCheck?: (branchName: string) => boolean;
    hasArtifactsCheck?: (issueId: string, sessionId: string) => boolean;
  }) {
    this.sessionAliveCheck =
      options?.sessionAliveCheck ?? (() => false);
    this.worktreeExistsCheck =
      options?.worktreeExistsCheck ?? ((p) => existsSync(p));
    this.branchExistsCheck =
      options?.branchExistsCheck ?? (() => false);
    this.hasArtifactsCheck =
      options?.hasArtifactsCheck ?? (() => false);
  }

  runRecovery(
    state: DispatchState,
    newSessionId: string,
  ): RecoveryReport {
    const inProgressRecords = findInProgressRecords(state);

    const agentReconciliations: AgentReconciliation[] = [];
    for (const record of inProgressRecords) {
      if (record.runningAgent !== null) {
        agentReconciliations.push(this.reconcileAgent(record));
      }
    }

    // Reconcile labors for all issues that were in implementing stage
    const laborReconciliations: LaborReconciliation[] = [];
    for (const record of Object.values(state.records)) {
      if (
        record.stage === DispatchStage.Implementing &&
        record.runningAgent !== null &&
        record.runningAgent.caste === "titan"
      ) {
        const laborPath = this.resolveLaborPath(record.issueId);
        const branchName = this.resolveBranchName(record.issueId);
        laborReconciliations.push(
          this.reconcileLabor(record.issueId, laborPath, branchName),
        );
      }
    }

    const dataLossDetected =
      agentReconciliations.some(
        (a) => a.status === "dead_no_artifacts",
      ) ||
      laborReconciliations.some((l) => l.status === "lost");

    const report: RecoveryReport = {
      timestamp: new Date().toISOString(),
      newSessionId,
      recordsReconciled: inProgressRecords.length,
      agentReconciliations,
      laborReconciliations,
      dataLossDetected,
      summary: "",
    };

    report.summary = summarizeRecovery(report);

    return report;
  }

  reconcileAgent(record: DispatchRecord): AgentReconciliation {
    if (record.runningAgent === null) {
      return {
        issueId: record.issueId,
        caste: "oracle",
        sessionId: "",
        status: "not_found",
        shouldFail: true,
        canRedispatch: canRedispatchAfterRecovery(record),
        summary: `No running agent found for ${record.issueId}`,
      };
    }

    const { caste, sessionId } = record.runningAgent;
    const isAlive = this.sessionAliveCheck(sessionId);

    let status: AgentRecoveryStatus;
    let shouldFail: boolean;

    if (isAlive) {
      status = "alive";
      shouldFail = false;
    } else {
      const hasArtifacts = this.hasArtifactsCheck(
        record.issueId,
        sessionId,
      );
      status = hasArtifacts ? "dead_with_artifacts" : "dead_no_artifacts";
      shouldFail = true;
    }

    return {
      issueId: record.issueId,
      caste,
      sessionId,
      status,
      shouldFail,
      canRedispatch: canRedispatchAfterRecovery(record),
      summary: `Agent ${caste} session ${sessionId} for ${record.issueId}: ${status}`,
    };
  }

  reconcileLabor(
    issueId: string,
    worktreePath: string,
    branchName: string,
  ): LaborReconciliation {
    const worktreeExists = this.worktreeExistsCheck(worktreePath);
    const branchExists = this.branchExistsCheck(branchName);

    let status: LaborRecoveryStatus;
    let recommendedAction: string;

    if (!worktreeExists && !branchExists) {
      status = "lost";
      recommendedAction = `Both worktree and branch missing for ${issueId}. Manual recovery required.`;
    } else if (!worktreeExists && branchExists) {
      status = "worktree_gone";
      recommendedAction = `Branch ${branchName} exists but worktree is missing. Recreate worktree with: git worktree add ${worktreePath} ${branchName}`;
    } else if (worktreeExists && !branchExists) {
      status = "branch_gone";
      recommendedAction = `Worktree exists but branch ${branchName} is missing. The labor may have been merged. Consider cleanup.`;
    } else {
      status = "intact";
      recommendedAction = `Labor for ${issueId} is intact at ${worktreePath}. No action needed.`;
    }

    return {
      issueId,
      worktreePath,
      branchName,
      status,
      recommendedAction,
    };
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private resolveLaborPath(issueId: string): string {
    return `.aegis/labors/labor-${issueId}`;
  }

  private resolveBranchName(issueId: string): string {
    return `aegis/${issueId}`;
  }
}
