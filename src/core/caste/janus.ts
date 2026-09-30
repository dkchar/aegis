import { parseJanusResolutionArtifact } from "../../castes/janus/janus-parser.js";
import type { CasteRunInput } from "../../runtime/caste-runtime.js";
import type { AegisIssue } from "../../tracker/issue-model.js";
import { persistArtifact } from "../artifact-store.js";
import { applyMutationProposal } from "../control-plane-policy.js";
import { saveDispatchRecord, type DispatchRecord } from "../dispatch-state.js";
import { buildFailureSteeringPromptLines } from "../failure-steering.js";
import { captureGitProofPair, completeGitProofPair, persistGitProofArtifacts } from "../git-proof.js";
import { writePhaseLog } from "../phase-log.js";
import { buildJanusPrompt } from "./prompts.js";
import { buildJanusPolicyProposal } from "./proposals.js";
import {
  assertSuccessfulSession,
  clearDownstreamArtifactRefs,
  createSessionMetadata,
  offsetTimestamp,
  persistSessionArtifact,
} from "./session.js";
import type { CasteCommandResult, RunCasteCommandInput } from "./types.js";

/**
 * Janus handles merge-boundary failures only. Its typed proposal either
 * requeues the same parent for integration rework or creates a blocking
 * integration child through mutation policy.
 */

export async function runJanus(
  input: RunCasteCommandInput,
  issue: AegisIssue,
  record: DispatchRecord,
  now: string,
): Promise<CasteCommandResult> {
  writePhaseLog(input.root, {
    timestamp: offsetTimestamp(now, 0),
    phase: "dispatch",
    issueId: issue.id,
    action: "janus_resolution_started",
    outcome: "running",
    detail: input.janusContext ? JSON.stringify(input.janusContext) : undefined,
  });

  const runInput = {
    caste: "janus",
    issueId: issue.id,
    root: input.root,
    workingDirectory: input.root,
    prompt: buildJanusPrompt(
      issue,
      input.janusContext,
      input.artifactEmissionMode,
      buildFailureSteeringPromptLines({
        root: input.root,
        caste: "janus",
        record,
        emissionMode: input.artifactEmissionMode,
      }),
    ),
    onActivity: input.onActivity,
  } satisfies CasteRunInput;
  const gitProofPair = captureGitProofPair(runInput.workingDirectory);
  const session = await input.runtime.run(runInput);
  const completedGitProof = completeGitProofPair(runInput.workingDirectory, gitProofPair);
  const transcriptRef = persistSessionArtifact(input.root, input.action, runInput, session);
  assertSuccessfulSession(runInput, session);
  const artifact = parseJanusResolutionArtifact(session.outputText);
  const gitProofRefs = persistGitProofArtifacts(
    input.root,
    "janus",
    issue.id,
    runInput.workingDirectory,
    completedGitProof,
  );
  const artifactRef = persistArtifact(input.root, {
    family: "janus",
    issueId: issue.id,
    artifact: {
      ...artifact,
      git_proof: {
        status_before_ref: gitProofRefs.statusBeforeRef,
        status_after_ref: gitProofRefs.statusAfterRef,
        changed_files_manifest_ref: gitProofRefs.changedFilesManifestRef,
        diff_ref: gitProofRefs.diffRef,
      },
      session: createSessionMetadata(transcriptRef, runInput, session),
    },
  });
  const policyResult = await applyMutationProposal({
    root: input.root,
    tracker: input.tracker,
    record,
    proposal: buildJanusPolicyProposal(issue.id, artifact),
    now,
  });
  saveDispatchRecord(input.root, {
    ...clearDownstreamArtifactRefs(record),
    stage: policyResult.parentStage,
    titanHandoffRef: record.titanHandoffRef ?? null,
    titanClarificationRef: record.titanClarificationRef ?? null,
    sentinelVerdictRef: record.sentinelVerdictRef,
    janusArtifactRef: artifactRef,
    reviewFeedbackRef: artifactRef,
    blockedByIssueId: policyResult.childIssueId,
    policyArtifactRef: policyResult.policyArtifactRef,
    updatedAt: now,
  });
  writePhaseLog(input.root, {
    timestamp: offsetTimestamp(now, 10),
    phase: "dispatch",
    issueId: issue.id,
    action: "janus_resolution_completed",
    outcome: policyResult.parentStage,
    sessionId: session.sessionId,
    detail: JSON.stringify({
      queueItemId: artifact.queueItemId,
      conflictSummary: artifact.conflictSummary,
      resolutionStrategy: artifact.resolutionStrategy,
      mutationProposal: artifact.mutation_proposal.proposal_type,
      mergeOutcome: input.janusContext?.mergeOutcome ?? null,
      mergeDetail: input.janusContext?.mergeDetail ?? null,
      attempt: input.janusContext?.attempt ?? null,
      tier: input.janusContext?.tier ?? null,
      janusInvocation: input.janusContext?.janusInvocation ?? null,
    }),
  });

  return {
    action: input.action,
    issueId: issue.id,
    stage: policyResult.parentStage,
    janusRecommendation: artifact.mutation_proposal.proposal_type,
    artifactRefs: [artifactRef, policyResult.policyArtifactRef, transcriptRef],
  };
}
