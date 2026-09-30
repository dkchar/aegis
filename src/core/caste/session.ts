import path from "node:path";

import type { RuntimeCasteAction } from "../../cli/runtime-command.js";
import type { CasteRunInput, CasteSessionResult } from "../../runtime/caste-runtime.js";
import { persistArtifact } from "../artifact-store.js";
import type { DispatchRecord } from "../dispatch-state.js";

/** Session bookkeeping shared by every caste runner. */

/**
 * Phase-log timestamps offset from the command start so events inside one
 * caste command sort in the order they happened.
 */
export function offsetTimestamp(baseTimestamp: string, offsetMilliseconds: number) {
  const baseTime = Date.parse(baseTimestamp);
  if (!Number.isFinite(baseTime)) {
    return new Date().toISOString();
  }

  return new Date(baseTime + offsetMilliseconds).toISOString();
}

/** A new caste attempt invalidates artifacts produced after this stage. */
export function clearDownstreamArtifactRefs(record: DispatchRecord): DispatchRecord {
  return {
    ...record,
    runningAgent: null,
    titanHandoffRef: null,
    titanClarificationRef: null,
    sentinelVerdictRef: null,
    janusArtifactRef: null,
    failureTranscriptRef: null,
  };
}

export function resolveCandidateWorkingDirectory(root: string, laborPath: string) {
  return path.isAbsolute(laborPath)
    ? laborPath
    : path.join(path.resolve(root), laborPath);
}

/** Persists the full session transcript (prompt, messages, output) for audit. */
export function persistSessionArtifact(
  root: string,
  action: RuntimeCasteAction,
  runInput: CasteRunInput,
  session: CasteSessionResult,
  options: { artifactId?: string } = {},
) {
  return persistArtifact(root, {
    family: "transcripts",
    issueId: runInput.issueId,
    artifactId: options.artifactId ?? runInput.caste,
    artifact: {
      issueId: runInput.issueId,
      caste: runInput.caste,
      action,
      prompt: runInput.prompt,
      workingDirectory: runInput.workingDirectory,
      modelRef: session.modelRef,
      provider: session.provider,
      modelId: session.modelId,
      thinkingLevel: session.thinkingLevel,
      sessionId: session.sessionId,
      toolsUsed: session.toolsUsed,
      messageLog: session.messageLog,
      ...(session.terminalLog?.length ? { terminalLog: session.terminalLog } : {}),
      ...(session.usage ? { usage: session.usage } : {}),
      outputText: session.outputText,
      status: session.status,
      error: session.error ?? null,
      startedAt: session.startedAt,
      finishedAt: session.finishedAt,
    },
  });
}

export function createSessionMetadata(
  transcriptRef: string,
  runInput: CasteRunInput,
  session: CasteSessionResult,
) {
  return {
    transcriptRef,
    prompt: runInput.prompt,
    workingDirectory: runInput.workingDirectory,
    modelRef: session.modelRef,
    provider: session.provider,
    modelId: session.modelId,
    thinkingLevel: session.thinkingLevel,
    sessionId: session.sessionId,
    toolsUsed: session.toolsUsed,
    ...(session.usage ? { usage: session.usage } : {}),
    status: session.status,
  };
}

export function assertSuccessfulSession(
  runInput: CasteRunInput,
  session: CasteSessionResult,
) {
  if (session.status === "succeeded") {
    return;
  }

  const casteLabel = `${runInput.caste[0].toUpperCase()}${runInput.caste.slice(1)}`;
  const detail = session.error?.trim().length
    ? session.error
    : `Runtime returned status=${session.status}.`;
  throw new Error(`${casteLabel} session failed for ${runInput.issueId}: ${detail}`);
}
