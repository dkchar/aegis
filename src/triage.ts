// src/triage.ts
// Triage -- deterministic dispatch rules for the Layer 1 loop.
// Pure function: given a BeadsIssue (with comments loaded) and the current
// agent state, returns a TriageAction. No I/O -- no bd, no filesystem.

import type { BeadsIssue, AgentState, AegisConfig } from "./types.js";

export type TriageAction =
  | { type: "dispatch_oracle"; issue: BeadsIssue }
  | { type: "dispatch_titan"; issue: BeadsIssue; scoutComment: string }
  | { type: "dispatch_sentinel"; issue: BeadsIssue; scoutComment: string }
  | { type: "skip"; issue: BeadsIssue; reason: string };

function findComment(issue: BeadsIssue, prefix: string): string | null {
  for (const comment of issue.comments ?? []) {
    if (comment.body.startsWith(prefix)) {
      return comment.body;
    }
  }
  return null;
}

function countByCaste(running: Map<string, AgentState>, caste: AgentState["caste"]): number {
  let n = 0;
  for (const agent of running.values()) {
    if (agent.caste === caste) n++;
  }
  return n;
}

export function triage(
  issue: BeadsIssue,
  runningAgents: Map<string, AgentState>,
  concurrencyLimits: AegisConfig["concurrency"]
): TriageAction {
  const totalRunning = runningAgents.size;

  if (totalRunning >= concurrencyLimits.max_agents) {
    return { type: "skip", issue, reason: "concurrency limit" };
  }

  const scoutedComment = findComment(issue, "SCOUTED:");
  const reviewedComment = findComment(issue, "REVIEWED:");

  if (scoutedComment === null) {
    if (countByCaste(runningAgents, "oracle") >= concurrencyLimits.max_oracles) {
      return { type: "skip", issue, reason: "concurrency limit" };
    }
    return { type: "dispatch_oracle", issue };
  }

  const status = issue.status;

  if (status === "open" || status === "ready") {
    if (countByCaste(runningAgents, "titan") >= concurrencyLimits.max_titans) {
      return { type: "skip", issue, reason: "concurrency limit" };
    }
    return { type: "dispatch_titan", issue, scoutComment: scoutedComment };
  }

  if (status === "closed") {
    if (reviewedComment === null) {
      if (countByCaste(runningAgents, "sentinel") >= concurrencyLimits.max_sentinels) {
        return { type: "skip", issue, reason: "concurrency limit" };
      }
      return { type: "dispatch_sentinel", issue, scoutComment: scoutedComment };
    }
    if (reviewedComment.startsWith("REVIEWED: PASS")) {
      return { type: "skip", issue, reason: "complete" };
    }
    return { type: "skip", issue, reason: "review failed, fix issues filed" };
  }

  if (status === "in_progress") {
    return { type: "skip", issue, reason: "already in progress" };
  }

  if (status === "deferred") {
    return { type: "skip", issue, reason: "deferred" };
  }

  // TypeScript exhaustiveness guard — should be unreachable with IssueStatus union
  const _exhaustive: never = status;
  return { type: "skip", issue, reason: `unknown status: ${_exhaustive}` };
}