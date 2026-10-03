import type { MergeTier } from "./merge-state.js";

export type MergeExecutionOutcome = "merged" | "stale_branch" | "conflict" | "verification_failed";
export type MergeTierAction = "merge" | "requeue" | "janus" | "fail";

export interface MergeTierInput {
  outcome: MergeExecutionOutcome;
  attempts: number;
  janusRetryThreshold: number;
  janusEnabled: boolean;
  janusInvocations: number;
  maxJanusInvocations: number;
}

export interface MergeTierDecision {
  tier: MergeTier;
  action: MergeTierAction;
}

export function classifyMergeTier(input: MergeTierInput): MergeTierDecision {
  if (input.outcome === "merged") {
    return {
      tier: "T1",
      action: "merge",
    };
  }

  if (input.attempts < input.janusRetryThreshold) {
    return {
      tier: "T2",
      action: "requeue",
    };
  }

  if (input.janusEnabled && input.janusInvocations < input.maxJanusInvocations) {
    return {
      tier: "T3",
      action: "janus",
    };
  }

  return {
    tier: "T3",
    action: "fail",
  };
}
