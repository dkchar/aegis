import { existsSync } from "node:fs";

import { parseTitanArtifact, type TitanArtifact } from "../../castes/titan/titan-parser.js";
import { loadConfig } from "../../config/load-config.js";
import {
  planLaborCreation,
  prepareLaborWorktree,
  type LaborCreationPlan,
} from "../../labor/create-labor.js";
import type { CasteRunInput, CasteSessionResult } from "../../runtime/caste-runtime.js";
import type { AegisIssue } from "../../tracker/issue-model.js";
import { persistArtifact } from "../artifact-store.js";
import { applyMutationProposal } from "../control-plane-policy.js";
import { saveDispatchRecord, type DispatchRecord } from "../dispatch-state.js";
import { applyOperationalFailure } from "../failure-policy.js";
import { buildFailureSteeringPromptLines } from "../failure-steering.js";
import {
  captureGitProofPair,
  completeGitProofPair,
  persistGitProofArtifacts,
} from "../git-proof.js";
import { assertTitanDispatchEligibility } from "../stage-invariants.js";
import {
  cleanupRejectedTitanRootDrift,
  materializeAdoptedRootCandidate,
  normalizeTitanArtifactChangedFiles,
  resolveRootCommitAdoption,
  validateTitanSessionOutcome,
} from "../titan-session-validation.js";
import { readOracleImplementationContext, readReviewFeedbackContext } from "./context.js";
import { buildTitanPrompt } from "./prompts.js";
import { buildTitanPolicyProposal } from "./proposals.js";
import {
  hasRecoverableDirtyTitanLabor,
  synthesizeTitanArtifactFromCommittedWork,
  synthesizeTitanArtifactFromDirtyWork,
} from "./recovery.js";
import {
  assertSuccessfulSession,
  clearDownstreamArtifactRefs,
  createSessionMetadata,
  persistSessionArtifact,
} from "./session.js";
import type { CasteCommandResult, RunCasteCommandInput } from "./types.js";

type GitProofPair = ReturnType<typeof completeGitProofPair>;

/**
 * Decides whether an existing labor worktree is reset to the base branch
 * before Titan runs. A candidate under review feedback is preserved so rework
 * builds on it; a failed fresh attempt starts clean.
 */
function shouldRefreshLabor(record: DispatchRecord, laborExists: boolean) {
  const preserveExistingCandidate = laborExists && record.titanHandoffRef !== null && (
    record.stage === "rework_required"
    || record.reviewFeedbackRef !== null
    || record.janusArtifactRef !== null
  );

  if (record.stage === "scouted") {
    return record.titanHandoffRef === null
      && record.reviewFeedbackRef === null
      && record.failureCount > 0;
  }
  if (record.stage === "rework_required") {
    return !preserveExistingCandidate;
  }
  if (record.stage === "implementing") {
    return (record.failureCount > 0 || record.reviewFeedbackRef !== null || record.titanHandoffRef === null)
      && !preserveExistingCandidate;
  }
  return false;
}

function prepareLabor(input: RunCasteCommandInput, issue: AegisIssue, record: DispatchRecord): LaborCreationPlan {
  const config = input.resolveBaseBranch && input.resolveLaborBasePath ? null : loadConfig(input.root);
  const basePlan = planLaborCreation({
    issueId: issue.id,
    projectRoot: input.root,
    baseBranch: input.resolveBaseBranch?.() ?? config!.git.base_branch,
    laborBasePath: input.resolveLaborBasePath?.() ?? config!.labor.base_path,
  });
  // In-scope uncommitted edits from a crashed session are recovered, not wiped.
  const refreshExisting = shouldRefreshLabor(record, existsSync(basePlan.laborPath))
    && !hasRecoverableDirtyTitanLabor(basePlan.laborPath, record.fileScope);
  const labor = { ...basePlan, refreshExisting };

  if (input.ensureLabor) {
    input.ensureLabor(labor);
  } else {
    prepareLaborWorktree(labor);
  }
  return labor;
}

/**
 * Resolves the Titan handoff: the emitted artifact when valid, otherwise an
 * artifact recovered from committed or in-scope dirty git state.
 */
function resolveTitanArtifact(input: {
  issueId: string;
  session: CasteSessionResult;
  runInput: CasteRunInput;
  laborPath: string;
  proofPair: GitProofPair;
  fileScope: DispatchRecord["fileScope"];
}): { artifact: TitanArtifact; proofPair: GitProofPair } {
  let parseError: unknown = null;
  if (input.session.status === "succeeded") {
    try {
      return { artifact: parseTitanArtifact(input.session.outputText), proofPair: input.proofPair };
    } catch (error) {
      parseError = error;
    }
  }

  const committed = synthesizeTitanArtifactFromCommittedWork({
    issueId: input.issueId,
    session: input.session,
    workingDirectory: input.laborPath,
    proofPair: input.proofPair,
  });
  if (committed) {
    return { artifact: committed, proofPair: input.proofPair };
  }

  const dirty = synthesizeTitanArtifactFromDirtyWork({
    issueId: input.issueId,
    session: input.session,
    workingDirectory: input.laborPath,
    proofPair: input.proofPair,
    fileScope: input.fileScope,
  });
  if (dirty) {
    return dirty;
  }

  if (input.session.status !== "succeeded") {
    assertSuccessfulSession(input.runInput, input.session);
  }
  if (parseError) {
    throw parseError;
  }
  throw new Error(`Titan session for ${input.issueId} did not produce a usable artifact.`);
}

/**
 * Titan implements inside its labor worktree. Aegis captures git proof around
 * the session, validates scope, candidate advancement and root cleanliness,
 * then routes the artifact: implemented, blocked on a policy child, or failed.
 */
export async function runImplement(
  input: RunCasteCommandInput,
  issue: AegisIssue,
  record: DispatchRecord,
  now: string,
): Promise<CasteCommandResult> {
  if (record.stage !== "implementing") {
    assertTitanDispatchEligibility(record);
  } else if (!record.oracleAssessmentRef) {
    throw new Error(`Issue ${record.issueId} requires an Oracle assessment artifact.`);
  }

  const labor = prepareLabor(input, issue, record);
  const oracleContext = readOracleImplementationContext(input.root, record.oracleAssessmentRef);
  const requiresIntegrationRework = typeof record.janusArtifactRef === "string";
  const runInput = {
    caste: "titan",
    issueId: issue.id,
    root: input.root,
    workingDirectory: labor.laborPath,
    prompt: buildTitanPrompt(issue, labor.laborPath, {
      fileScope: record.fileScope,
      suggestedChecks: oracleContext?.suggestedChecks,
      scopeNotes: oracleContext?.scopeNotes,
      reviewFeedback: readReviewFeedbackContext(input.root, record.reviewFeedbackRef ?? null),
      failureSteering: buildFailureSteeringPromptLines({
        root: input.root,
        caste: "titan",
        record,
        emissionMode: input.artifactEmissionMode,
      }),
      requiresIntegrationRework,
      resolvedBlockerIssueId: record.blockedByIssueId ?? null,
      artifactEmissionMode: input.artifactEmissionMode,
    }),
    onActivity: input.onActivity,
  } satisfies CasteRunInput;

  const laborProofBefore = captureGitProofPair(labor.laborPath);
  const rootProofBefore = captureGitProofPair(input.root);
  const session = await input.runtime.run(runInput);
  const transcriptRef = persistSessionArtifact(input.root, input.action, runInput, session, {
    artifactId: runInput.caste,
  });
  const rootProof = completeGitProofPair(input.root, rootProofBefore);
  const resolved = resolveTitanArtifact({
    issueId: issue.id,
    session,
    runInput,
    laborPath: labor.laborPath,
    proofPair: completeGitProofPair(labor.laborPath, laborProofBefore),
    fileScope: record.fileScope,
  });

  // A clean, in-scope commit made directly on the root may be adopted as the candidate.
  const rootAdoption = resolveRootCommitAdoption({
    issueId: issue.id,
    root: input.root,
    artifact: resolved.artifact,
    fileScope: record.fileScope,
    rootProofPair: rootProof,
  });
  const candidateWorkingDirectory = rootAdoption ? input.root : labor.laborPath;
  const candidateProofPair = rootAdoption ? rootProof : resolved.proofPair;
  const candidateBranch = rootAdoption
    ? materializeAdoptedRootCandidate({
      issueId: issue.id,
      root: input.root,
      adoptedHeadCommit: rootAdoption.adoptedHeadCommit,
    })
    : labor.branchName;
  const artifact = {
    ...resolved.artifact,
    files_changed: normalizeTitanArtifactChangedFiles(
      issue.id,
      resolved.artifact.files_changed,
      candidateWorkingDirectory,
    ),
  };
  const gitProofRefs = persistGitProofArtifacts(
    input.root,
    "titan",
    issue.id,
    candidateWorkingDirectory,
    candidateProofPair,
  );
  const artifactRef = persistArtifact(input.root, {
    family: "titan",
    issueId: issue.id,
    artifact: {
      ...artifact,
      labor_path: candidateWorkingDirectory,
      candidate_branch: candidateBranch,
      base_branch: rootAdoption?.baseBranch ?? labor.baseBranch,
      ...(rootAdoption
        ? {
          adoption: {
            mode: "root_commit",
            original_labor_path: labor.laborPath,
          },
        }
        : {}),
      git_proof: {
        status_before_ref: gitProofRefs.statusBeforeRef,
        status_after_ref: gitProofRefs.statusAfterRef,
        changed_files_manifest_ref: gitProofRefs.changedFilesManifestRef,
        diff_ref: gitProofRefs.diffRef,
      },
      session: createSessionMetadata(transcriptRef, runInput, session),
    },
  });
  const validationError = validateTitanSessionOutcome({
    root: input.root,
    issueId: issue.id,
    issueDescription: issue.description ?? "",
    artifact,
    candidateBranch,
    fileScope: record.fileScope,
    candidateWorkingDirectory,
    candidateProofPair,
    rootProofPair: rootProof,
    adoptedRootCommit: rootAdoption !== null,
    requiresIntegrationRework,
  });
  if (validationError) {
    cleanupRejectedTitanRootDrift(input.root, rootProof);
    throw new Error(validationError);
  }

  const result = (stage: string, extraRefs: string[] = []): CasteCommandResult => ({
    action: input.action,
    issueId: issue.id,
    stage,
    artifactRefs: [artifactRef, ...extraRefs, transcriptRef],
  });

  if (artifact.mutation_proposal) {
    if (record.blockedByIssueId) {
      saveDispatchRecord(input.root, {
        ...applyOperationalFailure(record, { timestamp: now }),
        titanClarificationRef: artifactRef,
        failureTranscriptRef: transcriptRef,
      });
      throw new Error(
        `Titan for ${issue.id} proposed another blocker after resolved child ${record.blockedByIssueId}; failing closed to avoid blocker amplification.`,
      );
    }

    const policyResult = await applyMutationProposal({
      root: input.root,
      tracker: input.tracker,
      record,
      proposal: buildTitanPolicyProposal(issue.id, artifact),
      now,
    });
    if (
      policyResult.outcome === "rejected"
      && policyResult.rejectionReason === "blocker_chain_not_allowed"
    ) {
      // The origin already had an accepted child; rescout instead of chaining blockers.
      saveDispatchRecord(input.root, {
        ...clearDownstreamArtifactRefs(record),
        stage: "scouted",
        reviewFeedbackRef: null,
        blockedByIssueId: null,
        policyArtifactRef: policyResult.policyArtifactRef,
        cooldownUntil: null,
        updatedAt: now,
      });
      return result("scouted", [policyResult.policyArtifactRef]);
    }

    saveDispatchRecord(input.root, {
      ...clearDownstreamArtifactRefs(record),
      stage: policyResult.parentStage,
      titanClarificationRef: artifactRef,
      blockedByIssueId: policyResult.childIssueId,
      policyArtifactRef: policyResult.policyArtifactRef,
      updatedAt: now,
    });
    return result(policyResult.parentStage, [policyResult.policyArtifactRef]);
  }

  if (artifact.outcome === "success" || artifact.outcome === "already_satisfied") {
    saveDispatchRecord(input.root, {
      ...clearDownstreamArtifactRefs(record),
      stage: "implemented",
      blockedByIssueId: null,
      titanHandoffRef: artifactRef,
      updatedAt: now,
    });
    return result("implemented");
  }

  // `failure` or an unrouted `clarification`: count it toward the retry ceiling.
  // The summary is agent prose, so it is not used to classify provider limits.
  saveDispatchRecord(input.root, {
    ...applyOperationalFailure(clearDownstreamArtifactRefs(record), {
      timestamp: now,
      failureTranscriptRef: transcriptRef,
    }),
    blockedByIssueId: null,
    titanClarificationRef: artifact.outcome === "clarification" ? artifactRef : null,
  });
  return result("failed_operational");
}
