import type {
  AdapterCasteName,
  AdapterFinalResult,
  AdapterSessionMessage,
} from "./adapter-contract.js";

export type CasteName = AdapterCasteName;

export type CasteSessionMessage = AdapterSessionMessage;

export interface CasteRunInput {
  caste: CasteName;
  issueId: string;
  root: string;
  workingDirectory: string;
  prompt: string;
  /**
   * Live, human-readable adapter activity (`[tool] Bash npm test`) reported
   * while the session runs. Observability only: nothing routes on it.
   */
  onActivity?: (line: string) => void;
}

export type CasteSessionResult = Omit<AdapterFinalResult, "artifactRefs"> & {
  artifactRefs?: AdapterFinalResult["artifactRefs"];
};

// Direct caste runtimes collapse the canonical spawn/status/finalResult loop
// into one terminal command call. Daemon runtimes keep the steps separate.
export interface CasteRuntime {
  run(input: CasteRunInput): Promise<CasteSessionResult>;
}
