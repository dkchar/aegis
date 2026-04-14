export type CasteName = "oracle" | "titan" | "sentinel" | "janus";

export interface CasteRunInput {
  caste: CasteName;
  issueId: string;
  root: string;
  workingDirectory: string;
  prompt: string;
}

export interface CasteSessionResult {
  sessionId: string;
  caste: CasteName;
  status: "succeeded" | "failed";
  outputText: string;
  toolsUsed: string[];
  startedAt: string;
  finishedAt: string;
  error?: string;
}

export interface CasteRuntime {
  run(input: CasteRunInput): Promise<CasteSessionResult>;
}
