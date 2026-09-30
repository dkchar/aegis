import { parseOracleAssessment } from "../../castes/oracle/oracle-parser.js";
import { extractDeclaredFileScope } from "../../castes/scope-markers.js";
import type { CasteRunInput } from "../../runtime/caste-runtime.js";
import { normalizeFileScope } from "../../shared/file-scope.js";
import type { AegisIssue } from "../../tracker/issue-model.js";
import { persistArtifact } from "../artifact-store.js";
import { saveDispatchRecord, type DispatchRecord } from "../dispatch-state.js";
import { buildFailureSteeringPromptLines } from "../failure-steering.js";
import { buildOraclePrompt } from "./prompts.js";
import { synthesizeOracleAssessmentFromDiagnostic } from "./recovery.js";
import {
  assertSuccessfulSession,
  clearDownstreamArtifactRefs,
  createSessionMetadata,
  persistSessionArtifact,
} from "./session.js";
import type { CasteCommandResult, RunCasteCommandInput } from "./types.js";

/**
 * Oracle scouts from the project root and records advisory context. The owned
 * file scope comes from the tracker first, then the declared ownership line,
 * and only then from Oracle's own estimate.
 */
export async function runScout(
  input: RunCasteCommandInput,
  issue: AegisIssue,
  record: DispatchRecord,
  now: string,
): Promise<CasteCommandResult> {
  const runInput = {
    caste: "oracle",
    issueId: issue.id,
    root: input.root,
    workingDirectory: input.root,
    prompt: buildOraclePrompt(
      issue,
      input.artifactEmissionMode,
      buildFailureSteeringPromptLines({
        root: input.root,
        caste: "oracle",
        record,
        emissionMode: input.artifactEmissionMode,
      }),
    ),
    onActivity: input.onActivity,
  } satisfies CasteRunInput;
  const session = await input.runtime.run(runInput);
  const transcriptRef = persistSessionArtifact(input.root, input.action, runInput, session);
  const assessment = session.status === "succeeded"
    ? parseOracleAssessment(session.outputText)
    : synthesizeOracleAssessmentFromDiagnostic({ issue, session });
  if (!assessment) {
    assertSuccessfulSession(runInput, session);
    throw new Error(`Oracle session for ${issue.id} did not produce a usable assessment.`);
  }
  const artifactRef = persistArtifact(input.root, {
    family: "oracle",
    issueId: issue.id,
    artifact: {
      ...assessment,
      session: createSessionMetadata(transcriptRef, runInput, session),
    },
  });
  saveDispatchRecord(input.root, {
    ...clearDownstreamArtifactRefs(record),
    stage: "scouted",
    oracleAssessmentRef: artifactRef,
    fileScope: normalizeFileScope(issue.fileScope ?? [])
      ?? normalizeFileScope(extractDeclaredFileScope(issue.description))
      ?? normalizeFileScope(assessment.files_affected),
    oracleReady: null,
    oracleDecompose: null,
    oracleBlockers: null,
    updatedAt: now,
  });

  return {
    action: input.action,
    issueId: issue.id,
    stage: "scouted",
    artifactRefs: [artifactRef, transcriptRef],
  };
}
