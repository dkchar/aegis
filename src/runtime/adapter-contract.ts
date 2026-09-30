import type { AegisThinkingLevel } from "../config/schema.js";

export type RuntimeAdapterMethod = "spawn" | "abort" | "status" | "finalResult";

export const RUNTIME_ADAPTER_CONTRACT_METHODS = [
  "spawn",
  "abort",
  "status",
  "finalResult",
] as const satisfies readonly RuntimeAdapterMethod[];

export type AdapterSessionStatus = "running" | "succeeded" | "failed";
export type AdapterFinalStatus = Exclude<AdapterSessionStatus, "running">;
export type AdapterCasteName = "oracle" | "titan" | "sentinel" | "janus";
export type AdapterSessionMessageRole = "user" | "assistant";

export interface AdapterArtifactRef {
  artifactId: string;
  path?: string;
}

export interface AdapterSessionMessage {
  role: AdapterSessionMessageRole;
  content: string;
}

export interface AdapterSpawnInput {
  root: string;
  issueId: string;
  caste: AdapterCasteName;
  prompt: string;
  workingDirectory: string;
  branch?: string;
  modelRef?: string;
  thinkingLevel?: AegisThinkingLevel;
}

export interface AdapterSpawnResult {
  sessionId: string;
  startedAt: string;
}

export interface AdapterSessionSnapshot {
  sessionId: string;
  status: AdapterSessionStatus;
  finishedAt?: string;
  error?: string;
}

/** Token and cost accounting reported by an adapter, when available. */
export interface AdapterUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  costUsd?: number;
  turns?: number;
  durationMs?: number;
}

export interface AdapterFinalResult {
  sessionId: string;
  caste: AdapterCasteName;
  modelRef: string;
  provider: string;
  modelId: string;
  thinkingLevel: AegisThinkingLevel;
  status: AdapterFinalStatus;
  outputText: string;
  toolsUsed: string[];
  messageLog: AdapterSessionMessage[];
  /** Human-readable adapter activity (tool calls, results) for operators. */
  terminalLog?: string[];
  usage?: AdapterUsage;
  artifactRefs: AdapterArtifactRef[];
  startedAt: string;
  finishedAt: string;
  error?: string;
}

// Canonical long-running adapter lifecycle used by daemon orchestration:
// spawn work, poll status for correctness, abort when needed, then read final refs.
export interface RuntimeAdapterContract {
  spawn(input: AdapterSpawnInput): Promise<AdapterSpawnResult>;
  abort(
    root: string,
    sessionId: string,
    reason: string,
  ): Promise<AdapterSessionSnapshot | null>;
  status(root: string, sessionId: string): Promise<AdapterSessionSnapshot | null>;
  finalResult(root: string, sessionId: string): Promise<AdapterFinalResult | null>;
}

// Direct caste execution uses the same final-result shape but collapses spawn and
// polling into one call for terminal commands and deterministic seam tests.
export interface DirectCasteAdapterContract {
  run(input: AdapterSpawnInput): Promise<AdapterFinalResult>;
}

export function toAdapterArtifactRefs(
  artifactRefs?: readonly AdapterArtifactRef[] | null,
): AdapterArtifactRef[] {
  return [...(artifactRefs ?? [])];
}
