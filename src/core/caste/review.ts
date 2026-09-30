import { parseSentinelVerdict, type SentinelFinding } from "../../castes/sentinel/sentinel-parser.js";
import {
  extractDeclaredFileScope,
  isPolicyCreatedBlockerDescription,
} from "../../castes/scope-markers.js";
import { loadConfig } from "../../config/load-config.js";
import { readTitanMergeCandidate } from "../../merge/merge-state.js";
import type { CasteRunInput } from "../../runtime/caste-runtime.js";
import { hasNewScope, hasScopeIntersection, normalizeScopeFile } from "../../shared/file-scope.js";
import type { AegisIssue } from "../../tracker/issue-model.js";
import { persistArtifact } from "../artifact-store.js";
import { applyMutationProposal, applyScopeExpansion } from "../control-plane-policy.js";
import { saveDispatchRecord, type DispatchRecord, type DispatchStage } from "../dispatch-state.js";
import { buildFailureSteeringPromptLines } from "../failure-steering.js";
import { writePhaseLog } from "../phase-log.js";
import { readTitanChangedFiles, readTitanReviewContext } from "./context.js";
import { buildSentinelPrompt } from "./prompts.js";
import {
  buildFindingFingerprint,
  buildSentinelRouterPolicyProposal,
  mergeFileScope,
} from "./proposals.js";
import { synthesizeSentinelVerdictFromDiagnostic } from "./recovery.js";
import {
  assertSuccessfulSession,
  clearDownstreamArtifactRefs,
  createSessionMetadata,
  offsetTimestamp,
  persistSessionArtifact,
  resolveCandidateWorkingDirectory,
} from "./session.js";
import type { CasteCommandResult, RunCasteCommandInput } from "./types.js";

// Gate issues own cross-lane integration, so their out-of-scope findings are real.
function isGateLikeIssue(issue: AegisIssue) {
  const labels = new Set(issue.labels.map((label) => label.toLowerCase()));
  return labels.has("gate") || labels.has("release") || labels.has("integration");
}

/**
 * A `create_blocker` finding whose required files touch neither the owner's
 * scope nor the candidate diff is ambient repository debt, not a blocker for
 * this candidate. Sentinel may not fail work for unrelated ambient debt.
 */
function isAmbientCrossScopeFinding(input: {
  root: string;
  issue: AegisIssue;
  record: DispatchRecord;
  finding: SentinelFinding;
}) {
  if (input.finding.route !== "create_blocker" || isGateLikeIssue(input.issue)) {
    return false;
  }

  const requiredFiles = input.finding.required_files.map((entry) => normalizeScopeFile(entry));
  if (requiredFiles.length === 0) {
    return false;
  }

  const ownerScope = input.record.fileScope?.files ?? extractDeclaredFileScope(input.issue.description);
  const changedFiles = readTitanChangedFiles(input.root, input.record.titanHandoffRef);
  return !hasScopeIntersection(requiredFiles, ownerScope)
    && !hasScopeIntersection(requiredFiles, changedFiles);
}

/**
 * Sentinel gates the candidate before merge. The verdict is typed; Aegis then
 * routes blocking findings deterministically: in-scope findings rework the
 * owner, out-of-scope findings become a policy blocker (or scope expansion for
 * policy-created blockers), and a pass queues the candidate for merge.
 */
export async function runReview(
  input: RunCasteCommandInput,
  issue: AegisIssue,
  record: DispatchRecord,
  now: string,
): Promise<CasteCommandResult> {
  if (record.stage !== "implemented" && record.stage !== "reviewing") {
    throw new Error("Review requires an implemented issue.");
  }

  writePhaseLog(input.root, {
    timestamp: offsetTimestamp(now, 0),
    phase: "dispatch",
    issueId: issue.id,
    action: "sentinel_review_started",
    outcome: "running",
  });

  const runInput = {
    caste: "sentinel",
    issueId: issue.id,
    root: input.root,
    workingDirectory: resolveCandidateWorkingDirectory(
      input.root,
      readTitanMergeCandidate(input.root, record.titanHandoffRef!).labor_path,
    ),
    prompt: buildSentinelPrompt(issue, {
      fileScope: record.fileScope,
      titanReviewContext: readTitanReviewContext(input.root, record.titanHandoffRef),
      failureSteering: buildFailureSteeringPromptLines({
        root: input.root,
        caste: "sentinel",
        record,
        emissionMode: input.artifactEmissionMode,
      }),
      emissionMode: input.artifactEmissionMode,
    }),
  } satisfies CasteRunInput;
  const session = await input.runtime.run(runInput);
  const transcriptRef = persistSessionArtifact(input.root, input.action, runInput, session);
  const verdict = session.status === "succeeded"
    ? parseSentinelVerdict(session.outputText)
    : synthesizeSentinelVerdictFromDiagnostic({
      issue,
      record,
      session,
      workingDirectory: runInput.workingDirectory,
    });
  if (!verdict) {
    assertSuccessfulSession(runInput, session);
    throw new Error(`Sentinel session for ${issue.id} did not produce a usable verdict.`);
  }

  const ambientFindings = verdict.blockingFindings.filter((finding) => isAmbientCrossScopeFinding({
    root: input.root,
    issue,
    record,
    finding,
  }));
  const effectiveBlockingFindings = verdict.blockingFindings.filter((finding) => !ambientFindings.includes(finding));
  const effectiveVerdict = verdict.verdict === "pass" || effectiveBlockingFindings.length === 0
    ? "pass"
    : "fail_blocking";
  const effectiveAdvisories = [
    ...verdict.advisories,
    ...ambientFindings.map((finding) =>
      `Ambient cross-scope finding ignored by deterministic router: ${finding.summary}`),
  ];

  if (verdict.blockingFindings.length > 0) {
    writePhaseLog(input.root, {
      timestamp: offsetTimestamp(now, 10),
      phase: "dispatch",
      issueId: issue.id,
      action: "sentinel_blocking_findings",
      outcome: "found",
      detail: JSON.stringify({
        count: verdict.blockingFindings.length,
        effectiveCount: effectiveBlockingFindings.length,
        ambientIgnoredCount: ambientFindings.length,
      }),
    });
  }

  const artifactRef = persistArtifact(input.root, {
    family: "sentinel",
    issueId: issue.id,
    artifact: {
      ...verdict,
      verdict: effectiveVerdict,
      blockingFindings: effectiveBlockingFindings,
      advisories: effectiveAdvisories,
      ignoredBlockingFindings: ambientFindings,
      session: createSessionMetadata(transcriptRef, runInput, session),
    },
  });

  const findingCounts = {
    blockingFindingCount: verdict.blockingFindings.length,
    effectiveBlockingFindingCount: effectiveBlockingFindings.length,
    ambientIgnoredCount: ambientFindings.length,
  };

  // Every exit persists the verdict as review feedback and logs the routed stage.
  const completeReview = (
    stage: DispatchStage,
    recordPatch: Partial<DispatchRecord>,
    logDetail: Record<string, unknown>,
    extraRefs: string[] = [],
  ): CasteCommandResult => {
    saveDispatchRecord(input.root, {
      ...clearDownstreamArtifactRefs(record),
      stage,
      titanHandoffRef: record.titanHandoffRef ?? null,
      titanClarificationRef: record.titanClarificationRef ?? null,
      sentinelVerdictRef: artifactRef,
      reviewFeedbackRef: artifactRef,
      ...recordPatch,
      updatedAt: now,
    });
    writePhaseLog(input.root, {
      timestamp: offsetTimestamp(now, 50),
      phase: "dispatch",
      issueId: issue.id,
      action: "sentinel_review_completed",
      outcome: stage,
      sessionId: session.sessionId,
      detail: JSON.stringify({
        ...findingCounts,
        ...logDetail,
        advisoryCount: effectiveAdvisories.length,
      }),
    });

    return {
      action: input.action,
      issueId: issue.id,
      stage,
      artifactRefs: [artifactRef, ...extraRefs, transcriptRef],
    };
  };

  const blockerFinding = effectiveBlockingFindings.find((finding) => finding.route === "create_blocker");
  if (!blockerFinding) {
    return completeReview(effectiveVerdict === "pass" ? "queued_for_merge" : "rework_required", {}, {});
  }

  const routedFinding = {
    routedFindingKind: blockerFinding.finding_kind,
    originalFindingRoute: blockerFinding.route,
  };

  // Policy-created blockers cannot spawn further blockers; widen their scope instead.
  const expandedFileScope = mergeFileScope(record.fileScope, blockerFinding.required_files);
  if (
    isPolicyCreatedBlockerDescription(issue.description)
    && expandedFileScope
    && hasNewScope(record.fileScope?.files ?? [], expandedFileScope.files)
  ) {
    const policyResult = await applyScopeExpansion({
      root: input.root,
      tracker: input.tracker,
      issueId: issue.id,
      originCaste: "router",
      findingKind: blockerFinding.finding_kind,
      summary: blockerFinding.summary,
      previousScope: record.fileScope?.files ?? issue.fileScope ?? extractDeclaredFileScope(issue.description),
      expandedScope: expandedFileScope.files,
      fingerprint: buildFindingFingerprint(
        issue.id,
        `scope_expansion:${blockerFinding.finding_kind}:${blockerFinding.summary}:${blockerFinding.required_files.join(",")}`,
      ),
      now,
    });

    return completeReview(policyResult.parentStage, {
      blockedByIssueId: null,
      policyArtifactRef: policyResult.policyArtifactRef,
      fileScope: policyResult.fileScope,
    }, {
      ...routedFinding,
      routedFindingRoute: "rework_owner",
      routeOverride: "policy_child_scope_expanded",
      policyArtifactRef: policyResult.policyArtifactRef,
    }, [policyResult.policyArtifactRef]);
  }

  if (!loadConfig(input.root).thresholds.allow_complex_auto_dispatch) {
    return completeReview("rework_required", {
      blockedByIssueId: null,
      policyArtifactRef: null,
    }, {
      ...routedFinding,
      routedFindingRoute: "rework_owner",
      routeOverride: "complex_auto_dispatch_disabled",
    });
  }

  const policyResult = await applyMutationProposal({
    root: input.root,
    tracker: input.tracker,
    record,
    proposal: buildSentinelRouterPolicyProposal(issue.id, blockerFinding),
    now,
  });
  return completeReview(policyResult.parentStage, {
    blockedByIssueId: policyResult.childIssueId,
    policyArtifactRef: policyResult.policyArtifactRef,
  }, {
    ...routedFinding,
    routedFindingRoute: blockerFinding.route,
  }, [policyResult.policyArtifactRef]);
}
