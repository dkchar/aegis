/**
 * S10 Lane B — Reaper implementation.
 *
 * Implements the Reaper interface defined in reaper.ts.
 * SPECv2 §9.7:
 *   - verify expected outputs exist
 *   - transition state to the next stage or `failed`
 *   - reset or increment failure counters
 *   - trigger Labor cleanup or preservation
 *   - queue merge candidates after Titan success
 *   - reclaim concurrency capacity
 *   - run Lethe pruning when appropriate
 *
 * This module owns the full Reaper class that implements the contract
 * interfaces from reaper.ts with actual verification and decision logic.
 */

import type { AgentEvent } from "../runtime/agent-events.js";
import type {
  Reaper,
  ReaperResult,
  ReaperOutcome,
  SessionEndReason,
  ArtifactVerification,
  ArtifactCheck,
  LaborCleanupInstruction,
  MergeCandidateInstruction,
} from "./reaper.js";
import {
  computeNextStage,
  determineLaborCleanup,
} from "./reaper.js";
import type { DispatchRecord } from "./dispatch-state.js";
import { DispatchStage } from "./stage-transition.js";
import type { MonitorEvent } from "./monitor.js";
import {
  recordFailure,
  resetFailures,
  shouldTriggerCooldown,
  computeCooldownUntil,
  COOLDOWN_FAILURE_THRESHOLD,
} from "./cooldown-policy.js";

// ---------------------------------------------------------------------------
// Reaper implementation
// ---------------------------------------------------------------------------

/**
 * Default Reaper implementation.
 *
 * The Reaper is pure decision logic — no I/O.  Side effects (stage
 * transitions, file writes, branch deletion, merge queue writes) are
 * executed by the caller using the instructions returned in ReaperResult.
 */
export class ReaperImpl implements Reaper {
  /**
   * Whether to run Lethe pruning after successful sessions.
   * Defaults to true; can be disabled for testing.
   */
  private readonly pruneOnSuccess: boolean;

  constructor(options?: { pruneOnSuccess?: boolean }) {
    this.pruneOnSuccess = options?.pruneOnSuccess ?? true;
  }

  reap(
    issueId: string,
    caste: string,
    endReason: SessionEndReason,
    events: AgentEvent[],
    currentRecord: DispatchRecord,
  ): ReaperResult {
    // 1. Determine the outcome category
    const outcome = this.determineOutcome(caste, endReason, events);

    // 2. Verify artifacts
    let artifacts: ArtifactVerification;
    switch (caste) {
      case "oracle":
        artifacts = this.verifyOracleArtifacts(issueId, events);
        break;
      case "titan":
        artifacts = this.verifyTitanArtifacts(issueId, events);
        break;
      case "sentinel":
        artifacts = this.verifySentinelArtifacts(issueId, events);
        break;
      default:
        artifacts = {
          issueId,
          caste,
          passed: false,
          checks: [{ name: "unknown_caste", passed: false, detail: `Unknown caste: ${caste}` }],
        };
    }

    // 3. If artifacts don't pass, override outcome to artifact_failure
    const finalOutcome = artifacts.passed ? outcome : "artifact_failure";

    // 4. Extract sentinel verdict if applicable and compute next stage
    const sentinelVerdict = caste === "sentinel"
      ? this.extractSentinelVerdict(events)
      : undefined;
    const nextStage = computeNextStage(caste, finalOutcome, currentRecord.stage, sentinelVerdict);

    // 5. Determine failure accounting
    // Sentinel "fail" verdict is a valid execution (the sentinel did its job and rejected the PR).
    // It transitions to Failed but does NOT count as an agent failure for cooldown purposes.
    // Sentinel crash/error DOES count as an agent failure.
    const isSentinelFailVerdict = caste === "sentinel" && sentinelVerdict === "fail";
    const incrementFailure = finalOutcome !== "success" || isSentinelFailVerdict;
    const resetFail = finalOutcome === "success" && !isSentinelFailVerdict;

    // 6. Labor cleanup
    const laborCleanup = determineLaborCleanup(caste, finalOutcome, issueId);

    // 7. Merge candidate (Titan success only)
    const mergeCandidate = this.computeMergeCandidate(
      caste,
      finalOutcome,
      issueId,
      events,
    );

    // 8. Monitor events — based on endReason, not finalOutcome.
    // When the monitor terminates a session (budget, stuck, etc.), we emit
    // events regardless of whether artifacts happen to be present.
    const monitorEvents = this.collectMonitorEvents(
      caste,
      outcome,
      endReason,
      issueId,
    );

    return {
      issueId,
      outcome: outcome, // Original outcome from session end reason
      endReason,
      nextStage,
      artifacts,
      incrementFailure,
      resetFailures: resetFail,
      laborCleanup,
      mergeCandidate,
      monitorEvents,
    };
  }

  verifyOracleArtifacts(
    issueId: string,
    events: AgentEvent[],
  ): ArtifactVerification {
    const checks: ArtifactCheck[] = [];

    // Check for OracleAssessment in messages
    const assessmentMessages = events.filter(
      (e) =>
        e.type === "message" &&
        this.looksLikeOracleAssessment(e.text),
    );

    const hasAssessment = assessmentMessages.length > 0;
    checks.push({
      name: "oracle_assessment",
      passed: hasAssessment,
      detail: hasAssessment
        ? `Found ${assessmentMessages.length} assessment message(s)`
        : "No valid OracleAssessment found in session messages",
    });

    // Check no write events (Oracle is read-only)
    const writeEvents = events.filter(
      (e) =>
        e.type === "tool_use" &&
        (e.tool === "write_file" || e.tool === "edit"),
    );
    checks.push({
      name: "no_write_violations",
      passed: writeEvents.length === 0,
      detail:
        writeEvents.length === 0
          ? "No write tool violations detected"
          : `Oracle used write tools ${writeEvents.length} time(s)`,
    });

    return {
      issueId,
      caste: "oracle",
      passed: checks.every((c) => c.passed),
      checks,
    };
  }

  verifyTitanArtifacts(
    issueId: string,
    events: AgentEvent[],
  ): ArtifactVerification {
    const checks: ArtifactCheck[] = [];

    // Check for Titan handoff artifact in messages
    const handoffMessages = events.filter(
      (e) =>
        e.type === "message" &&
        this.looksLikeTitanHandoff(e.text),
    );

    const hasHandoff = handoffMessages.length > 0;
    checks.push({
      name: "titan_handoff",
      passed: hasHandoff,
      detail: hasHandoff
        ? `Found ${handoffMessages.length} handoff message(s)`
        : "No valid TitanHandoffArtifact found in session messages",
    });

    // Check for meaningful diff (at least one file changed)
    const fileChangeEvents = events.filter(
      (e) =>
        e.type === "tool_use" &&
        (e.tool === "write_file" || e.tool === "edit"),
    );
    checks.push({
      name: "meaningful_diff",
      passed: fileChangeEvents.length > 0,
      detail:
        fileChangeEvents.length > 0
          ? `${fileChangeEvents.length} file modification(s) detected`
          : "No file modifications detected — Titan produced no meaningful diff",
    });

    return {
      issueId,
      caste: "titan",
      passed: checks.every((c) => c.passed),
      checks,
    };
  }

  verifySentinelArtifacts(
    issueId: string,
    events: AgentEvent[],
  ): ArtifactVerification {
    const checks: ArtifactCheck[] = [];

    // Check for Sentinel verdict in messages
    const verdictMessages = events.filter(
      (e) =>
        e.type === "message" &&
        this.looksLikeSentinelVerdict(e.text),
    );

    const hasVerdict = verdictMessages.length > 0;
    checks.push({
      name: "sentinel_verdict",
      passed: hasVerdict,
      detail: hasVerdict
        ? `Found ${verdictMessages.length} verdict message(s)`
        : "No valid SentinelVerdict found in session messages",
    });

    return {
      issueId,
      caste: "sentinel",
      passed: checks.every((c) => c.passed),
      checks,
    };
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private determineOutcome(
    _caste: string,
    endReason: SessionEndReason,
    _events: AgentEvent[],
  ): ReaperOutcome {
    switch (endReason) {
      case "completed":
        return "success";
      case "aborted":
        return "monitor_termination";
      case "budget_exceeded":
        return "monitor_termination";
      case "stuck_killed":
        return "monitor_termination";
      case "monitor_aborted":
        return "monitor_termination";
      case "error":
        return "crash";
      default:
        return "crash";
    }
  }

  private looksLikeOracleAssessment(text: string): boolean {
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed !== "object" || parsed === null) return false;
      const obj = parsed as Record<string, unknown>;
      return (
        typeof obj["files_affected"] === "object" &&
        Array.isArray(obj["files_affected"]) &&
        (obj["estimated_complexity"] === "trivial" ||
          obj["estimated_complexity"] === "moderate" ||
          obj["estimated_complexity"] === "complex") &&
        typeof obj["ready"] === "boolean"
      );
    } catch {
      return false;
    }
  }

  private looksLikeTitanHandoff(text: string): boolean {
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed !== "object" || parsed === null) return false;
      const obj = parsed as Record<string, unknown>;
      return (
        typeof obj["issueId"] === "string" &&
        typeof obj["laborPath"] === "string" &&
        typeof obj["candidateBranch"] === "string" &&
        typeof obj["baseBranch"] === "string" &&
        Array.isArray(obj["filesChanged"])
      );
    } catch {
      return false;
    }
  }

  private looksLikeSentinelVerdict(text: string): boolean {
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed !== "object" || parsed === null) return false;
      const obj = parsed as Record<string, unknown>;
      return (
        (obj["verdict"] === "pass" || obj["verdict"] === "fail") &&
        typeof obj["reviewSummary"] === "string" &&
        typeof obj["issuesFound"] === "boolean" &&
        Array.isArray(obj["followUpIssueIds"]) &&
        Array.isArray(obj["riskAreas"])
      );
    } catch {
      return false;
    }
  }

  /**
   * Extract the sentinel verdict ("pass" or "fail") from session events.
   * Returns undefined if no valid verdict is found.
   */
  private extractSentinelVerdict(events: AgentEvent[]): "pass" | "fail" | undefined {
    for (const event of events) {
      if (event.type === "message" && this.looksLikeSentinelVerdict(event.text)) {
        try {
          const parsed = JSON.parse(event.text) as Record<string, unknown>;
          const verdict = parsed["verdict"];
          if (verdict === "pass" || verdict === "fail") {
            return verdict;
          }
        } catch {
          // Continue scanning
        }
      }
    }
    return undefined;
  }

  private computeMergeCandidate(
    caste: string,
    outcome: ReaperOutcome,
    issueId: string,
    events: AgentEvent[],
  ): MergeCandidateInstruction | null {
    if (caste !== "titan" || outcome !== "success") {
      return null;
    }

    // Extract handoff artifact details from events
    for (const event of events) {
      if (event.type === "message" && this.looksLikeTitanHandoff(event.text)) {
        try {
          const parsed = JSON.parse(event.text) as Record<string, unknown>;
          return {
            issueId,
            candidateBranch: parsed["candidateBranch"] as string,
            targetBranch: (parsed["baseBranch"] as string) || "main",
            handoffArtifactPath: "", // Caller must resolve to actual file path
          };
        } catch {
          // Continue scanning
        }
      }
    }

    // If we can't extract from events, return a placeholder — the caller
    // (orchestrator) should have the handoff artifact from runTitan.
    return null;
  }

  private collectMonitorEvents(
    caste: string,
    outcome: ReaperOutcome,
    endReason: SessionEndReason,
    issueId: string,
  ): MonitorEvent[] {
    const events: MonitorEvent[] = [];

    if (outcome === "monitor_termination") {
      events.push({
        type: "session_aborted_by_monitor",
        timestamp: new Date().toISOString(),
        issueId,
        message: `Session for ${caste} on ${issueId} was aborted by monitor (${endReason})`,
        details: { endReason, caste },
      });
    }

    if (outcome === "crash") {
      events.push({
        type: "session_aborted_by_monitor",
        timestamp: new Date().toISOString(),
        issueId,
        message: `Session for ${caste} on ${issueId} crashed unexpectedly`,
        details: { endReason, caste },
      });
    }

    return events;
  }
}

// ---------------------------------------------------------------------------
// Failure accounting helper — updates dispatch record with failure state
// ---------------------------------------------------------------------------

/**
 * Apply failure accounting to a dispatch record based on ReaperResult.
 *
 * Returns a new DispatchRecord with updated failure counters and cooldown.
 * The original record is never mutated.
 *
 * @param record - Current dispatch record.
 * @param incrementFailure - Whether to increment the failure counter.
 * @param resetFailures - Whether to reset failure counters (success).
 * @param nowMs - Current epoch milliseconds (injected for testability).
 * @returns Updated DispatchRecord.
 */
export function applyFailureAccounting(
  record: DispatchRecord,
  incrementFailure: boolean,
  resetFailures: boolean,
  nowMs: number = Date.now(),
): DispatchRecord {
  if (resetFailures) {
    // Success — reset all failure state
    return {
      ...record,
      failureCount: record.failureCount, // cumulative is NOT reset on success
      consecutiveFailures: 0,
      cooldownUntil: null,
    };
  }

  if (incrementFailure) {
    const newConsecutive = record.consecutiveFailures + 1;

    // Determine if we should trigger cooldown
    const windowStartMs = newConsecutive === 1
      ? nowMs
      : computeFailureWindowStart(record);

    const shouldCooldown = shouldTriggerCooldown(
      newConsecutive,
      windowStartMs,
      nowMs,
    );

    const newCooldownUntil = shouldCooldown
      ? computeCooldownUntil(nowMs)
      : record.cooldownUntil;

    return {
      ...record,
      failureCount: record.failureCount + 1,
      consecutiveFailures: newConsecutive,
      cooldownUntil: newCooldownUntil,
    };
  }

  // No change
  return { ...record };
}

/**
 * Derive the failure window start from the current consecutive failure count.
 * This is a best-effort estimate since we don't store the window start
 * separately in the dispatch record — we use the cooldown timestamp as
 * a proxy when available, otherwise use now.
 */
function computeFailureWindowStart(record: DispatchRecord): number | null {
  if (record.cooldownUntil !== null) {
    // If there was a previous cooldown, the window is likely expired.
    return null;
  }
  if (record.consecutiveFailures > 0) {
    // Estimate: window started some time ago. We use null to let the
    // cooldown policy use the counter alone.
    return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Record update — combines reaper result with dispatch record
// ---------------------------------------------------------------------------

/**
 * Update a DispatchRecord based on a ReaperResult.
 *
 * Applies:
 *   - stage transition to nextStage
 *   - failure accounting
 *   - runningAgent cleared (session is finished)
 *
 * @param record - Current dispatch record.
 * @param result - ReaperResult from reap().
 * @param nowMs - Current epoch milliseconds (injected for testability).
 * @returns Updated DispatchRecord.
 */
export function updateRecordFromReaper(
  record: DispatchRecord,
  result: ReaperResult,
  nowMs: number = Date.now(),
): DispatchRecord {
  // First apply the stage transition
  let updated: DispatchRecord = {
    ...record,
    stage: result.nextStage,
    runningAgent: null,
    updatedAt: new Date(nowMs).toISOString(),
  };

  // Then apply failure accounting
  updated = applyFailureAccounting(
    updated,
    result.incrementFailure,
    result.resetFailures,
    nowMs,
  );

  return updated;
}

// ---------------------------------------------------------------------------
// Lethe pruning trigger
// ---------------------------------------------------------------------------

/**
 * Determine whether Lethe pruning should run after this reaper outcome.
 *
 * SPECv2 §9.7: "run Lethe pruning when appropriate"
 * Pruning is appropriate after successful sessions that may have added
 * new learnings to Mnemosyne.
 *
 * @param outcome - The reaper outcome.
 * @param pruneOnSuccess - Whether pruning is enabled.
 * @returns `true` if Lethe pruning should run.
 */
export function shouldRunLethePruning(
  outcome: ReaperOutcome,
  pruneOnSuccess: boolean = true,
): boolean {
  return outcome === "success" && pruneOnSuccess;
}
