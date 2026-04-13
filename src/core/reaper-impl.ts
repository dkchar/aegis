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
      case "janus":
        artifacts = this.verifyJanusArtifacts(issueId, events);
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
    // Sentinel "fail" verdict IS a valid execution (the sentinel did its job
    // and rejected the PR), but it still counts as an agent failure for cooldown
    // purposes because the underlying issue remains unresolved.
    // Sentinel crash/error also counts as an agent failure.
    // Only Sentinel "pass" resets failures (success path).
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
      reclaimConcurrency: true, // SPECv2 §9.7: session always frees a concurrency slot
    };
  }

  verifyOracleArtifacts(
    issueId: string,
    events: AgentEvent[],
  ): ArtifactVerification {
    const checks: ArtifactCheck[] = [];

    // Check for submit_assessment tool call (structured output via custom tool)
    const assessmentCalls = events.filter(
      (e): e is AgentEvent & { type: "tool_use"; tool: string; args?: Record<string, unknown> } =>
        e.type === "tool_use" &&
        e.tool === "submit_assessment",
    );

    const hasAssessment = assessmentCalls.length > 0 && assessmentCalls[0]!.args !== undefined;
    checks.push({
      name: "oracle_assessment",
      passed: hasAssessment,
      detail: hasAssessment
        ? `Found submit_assessment tool call with validated args`
        : "No submit_assessment tool call found — Oracle did not produce structured assessment",
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

    // Check for submit_handoff tool call (structured output via custom tool)
    const handoffCalls = events.filter(
      (e): e is AgentEvent & { type: "tool_use"; tool: string; args?: Record<string, unknown> } =>
        e.type === "tool_use" &&
        e.tool === "submit_handoff",
    );

    const hasHandoff = handoffCalls.length > 0 && handoffCalls[0]!.args !== undefined;
    checks.push({
      name: "titan_handoff",
      passed: hasHandoff,
      detail: hasHandoff
        ? `Found submit_handoff tool call with validated args`
        : "No submit_handoff tool call found — Titan did not produce structured handoff",
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

    // Check for submit_verdict tool call (structured output via custom tool)
    const verdictCalls = events.filter(
      (e): e is AgentEvent & { type: "tool_use"; tool: string; args?: Record<string, unknown> } =>
        e.type === "tool_use" &&
        e.tool === "submit_verdict",
    );

    const hasVerdict = verdictCalls.length > 0 && verdictCalls[0]!.args !== undefined;
    checks.push({
      name: "sentinel_verdict",
      passed: hasVerdict,
      detail: hasVerdict
        ? `Found submit_verdict tool call with validated args`
        : "No submit_verdict tool call found — Sentinel did not produce structured verdict",
    });

    return {
      issueId,
      caste: "sentinel",
      passed: checks.every((c) => c.passed),
      checks,
    };
  }

  verifyJanusArtifacts(
    issueId: string,
    events: AgentEvent[],
  ): ArtifactVerification {
    const checks: ArtifactCheck[] = [];

    // Janus still uses message-based artifact detection (no custom tool yet)
    // but with strict matching only (no relaxed fallback)
    const resolutionMessages = events.filter(
      (e) =>
        e.type === "message" &&
        this.looksLikeJanusResolution(e.text),
    );

    const hasResolution = resolutionMessages.length > 0;
    checks.push({
      name: "janus_resolution_artifact",
      passed: hasResolution,
      detail: hasResolution
        ? `Found ${resolutionMessages.length} Janus resolution message(s)`
        : "No valid JanusResolutionArtifact found in session messages",
    });

    return {
      issueId,
      caste: "janus",
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

      // Strict check — exact field names and values
      if (
        typeof obj["files_affected"] === "object" &&
        Array.isArray(obj["files_affected"]) &&
        (obj["estimated_complexity"] === "trivial" ||
          obj["estimated_complexity"] === "moderate" ||
          obj["estimated_complexity"] === "complex") &&
        typeof obj["ready"] === "boolean"
      ) {
        return true;
      }

      // Relaxed check — accept snake_case or camelCase variants, partial matches
      const files = obj["files_affected"] ?? obj["filesAffected"] ?? obj["files_affected"] ?? obj["files"];
      const complexity = obj["estimated_complexity"] ?? obj["estimatedComplexity"] ?? obj["complexity"];
      const ready = obj["ready"] ?? obj["isReady"] ?? obj["ready_for_impl"];

      const hasFiles = typeof files === "object" && Array.isArray(files);
      const hasComplexity = typeof complexity === "string" &&
        (complexity === "trivial" || complexity === "moderate" || complexity === "complex");
      const hasReady = typeof ready === "boolean";

      // Accept if at least files + complexity or files + ready are present
      return hasFiles && (hasComplexity || hasReady);
    } catch {
      return false;
    }
  }

  private looksLikeTitanHandoff(text: string): boolean {
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed !== "object" || parsed === null) return false;
      const obj = parsed as Record<string, unknown>;

      // Strict check — exact field names
      if (
        typeof obj["issueId"] === "string" &&
        typeof obj["laborPath"] === "string" &&
        typeof obj["candidateBranch"] === "string" &&
        typeof obj["baseBranch"] === "string" &&
        Array.isArray(obj["filesChanged"])
      ) {
        return true;
      }

      // Relaxed check — accept variant field names, partial matches
      const issueId = obj["issueId"] ?? obj["issue_id"] ?? obj["issue"] ?? obj["id"];
      const laborPath = obj["laborPath"] ?? obj["labor_path"] ?? obj["labor"] ?? obj["worktree"];
      const candidateBranch = obj["candidateBranch"] ?? obj["candidate_branch"] ?? obj["branch"] ?? obj["branchName"] ?? obj["branch_name"];
      const baseBranch = obj["baseBranch"] ?? obj["base_branch"] ?? obj["target"] ?? obj["targetBranch"];
      const filesChanged = obj["filesChanged"] ?? obj["files_changed"] ?? obj["files"] ?? obj["changes"];

      const hasIssueId = typeof issueId === "string";
      const hasLaborPath = typeof laborPath === "string";
      const hasBranch = typeof candidateBranch === "string" || typeof baseBranch === "string";
      const hasFiles = typeof filesChanged === "object" && Array.isArray(filesChanged);

      // Accept if we have enough signal to identify a handoff:
      // must have some branch info + either files changed or issue/labor context
      return hasBranch && (hasFiles || (hasIssueId && hasLaborPath));
    } catch {
      return false;
    }
  }

  private looksLikeSentinelVerdict(text: string): boolean {
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed !== "object" || parsed === null) return false;
      const obj = parsed as Record<string, unknown>;

      // Strict check — exact field names
      if (
        (obj["verdict"] === "pass" || obj["verdict"] === "fail") &&
        typeof obj["reviewSummary"] === "string" &&
        typeof obj["issuesFound"] === "boolean" &&
        Array.isArray(obj["followUpIssueIds"]) &&
        Array.isArray(obj["riskAreas"])
      ) {
        return true;
      }

      // Relaxed check — accept variant field names, partial matches
      const verdict = obj["verdict"] ?? obj["status"] ?? obj["result"] ?? obj["approval"];
      const reviewSummary = obj["reviewSummary"] ?? obj["review_summary"] ?? obj["summary"] ?? obj["review"] ?? obj["description"];
      const issuesFound = obj["issuesFound"] ?? obj["issues_found"] ?? obj["hasIssues"] ?? obj["has_issues"];
      const followUpIds = obj["followUpIssueIds"] ?? obj["followUpIssueIds"] ?? obj["follow_up_ids"] ?? obj["follow_up_issues"] ?? obj["blocking_issues"];
      const riskAreas = obj["riskAreas"] ?? obj["risk_areas"] ?? obj["risks"] ?? obj["concerns"] ?? obj["issues"];

      const hasVerdict = typeof verdict === "string" &&
        (verdict === "pass" || verdict === "fail" ||
          verdict === "approved" || verdict === "rejected" ||
          verdict === "accept" || verdict === "reject");
      const hasSummary = typeof reviewSummary === "string";

      // Accept if we have a clear verdict + some review content
      return hasVerdict && (hasSummary || typeof followUpIds === "object" || typeof riskAreas === "object");
    } catch {
      return false;
    }
  }

  private looksLikeJanusResolution(text: string): boolean {
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed !== "object" || parsed === null) return false;
      const obj = parsed as Record<string, unknown>;

      // Strict check — exact field names
      if (
        typeof obj["originatingIssueId"] === "string" &&
        typeof obj["queueItemId"] === "string" &&
        typeof obj["preservedLaborPath"] === "string" &&
        typeof obj["conflictSummary"] === "string" &&
        typeof obj["resolutionStrategy"] === "string" &&
        Array.isArray(obj["filesTouched"]) &&
        (obj["recommendedNextAction"] === "requeue" ||
          obj["recommendedNextAction"] === "manual_decision" ||
          obj["recommendedNextAction"] === "fail")
      ) {
        return true;
      }

      // Relaxed check — accept variant field names, partial matches
      const originatingIssueId = obj["originatingIssueId"] ?? obj["originating_issue_id"] ?? obj["originIssue"] ?? obj["origin_issue"];
      const queueItemId = obj["queueItemId"] ?? obj["queue_item_id"] ?? obj["queueItem"] ?? obj["queue_item"];
      const laborPath = obj["preservedLaborPath"] ?? obj["preserved_labor_path"] ?? obj["laborPath"] ?? obj["labor_path"];
      const conflictSummary = obj["conflictSummary"] ?? obj["conflict_summary"] ?? obj["conflict"] ?? obj["summary"];
      const resolutionStrategy = obj["resolutionStrategy"] ?? obj["resolution_strategy"] ?? obj["strategy"] ?? obj["resolution"];
      const filesTouched = obj["filesTouched"] ?? obj["files_touched"] ?? obj["files"] ?? obj["changes"];
      const nextAction = obj["recommendedNextAction"] ?? obj["recommended_next_action"] ?? obj["nextAction"] ?? obj["next_action"] ?? obj["action"];

      const hasOrigin = typeof originatingIssueId === "string";
      const hasQueue = typeof queueItemId === "string";
      const hasLabor = typeof laborPath === "string";
      const hasConflict = typeof conflictSummary === "string";
      const hasStrategy = typeof resolutionStrategy === "string";
      const hasFiles = typeof filesTouched === "object" && Array.isArray(filesTouched);
      const hasAction = typeof nextAction === "string";

      // Accept if we have enough signal: origin/queue + conflict/strategy info
      return (hasOrigin || hasQueue) && (hasConflict || hasStrategy || hasFiles || hasAction);
    } catch {
      return false;
    }
  }

  /**
   * Extract the sentinel verdict ("pass" or "fail") from session events.
   * Reads from submit_verdict tool call args (structured output).
   * Returns undefined if no valid verdict is found.
   */
  private extractSentinelVerdict(events: AgentEvent[]): "pass" | "fail" | undefined {
    for (const event of events) {
      if (event.type === "tool_use" && event.tool === "submit_verdict") {
        const args = event.args as Record<string, unknown> | undefined;
        const verdict = args?.["verdict"];
        if (verdict === "pass" || verdict === "fail") {
          return verdict;
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

    // Extract handoff artifact from submit_handoff tool call
    for (const event of events) {
      if (event.type === "tool_use" && event.tool === "submit_handoff") {
        const args = event.args as Record<string, unknown> | undefined;
        if (!args) continue;

        const candidateBranch = args["candidateBranch"];
        const baseBranch = args["baseBranch"];
        if (typeof candidateBranch === "string") {
          return {
            issueId,
            candidateBranch,
            targetBranch: typeof baseBranch === "string" ? baseBranch : "main",
            handoffArtifactPath: "", // Caller must resolve to actual file path
          };
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
 * Failure window tracking (SPECv2 §6.4):
 *   - The first failure in a new sequence starts the 10-minute window.
 *   - We store the window start implicitly: when consecutiveFailures is 0,
 *     the next failure starts the window at nowMs.
 *   - When consecutiveFailures > 0 and no cooldown is active, the window
 *     started at the time of the first failure in the current sequence.
 *     We estimate this by backtracking: if consecutiveFailures is N, the
 *     window started approximately (N-1) * avg_interval ago. Since we don't
 *     store exact timestamps per failure, we use a conservative approach:
 *     if consecutiveFailures was 0 before this call, start the window now.
 *     Otherwise, preserve the existing window start via cooldownUntil proxy.
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
    // Success — reset consecutive failures, window, and cooldown, but preserve
    // cumulative failureCount for analytics (SPECv2 §6.4).
    return {
      ...record,
      failureCount: record.failureCount, // cumulative is NOT reset on success
      consecutiveFailures: 0,
      failureWindowStartMs: null,
      cooldownUntil: null,
    };
  }

  if (incrementFailure) {
    const newConsecutive = record.consecutiveFailures + 1;

    // Determine the failure window start using the persisted field
    // in DispatchRecord (SPECv2 §6.4).
    // - If this is the first failure in a new sequence, the window starts now.
    // - If the existing window has expired, reset it to now.
    const windowExpired =
      record.failureWindowStartMs !== null &&
      (nowMs - record.failureWindowStartMs) > 10 * 60 * 1000;

    const windowStartMs: number | null =
      record.consecutiveFailures === 0 || windowExpired
        ? nowMs
        : record.failureWindowStartMs;

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
      failureWindowStartMs: windowStartMs,
      cooldownUntil: newCooldownUntil,
    };
  }

  // No change
  return { ...record };
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
