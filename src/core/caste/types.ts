import type { RuntimeCasteAction } from "../../cli/runtime-command.js";
import type { LaborCreationPlan } from "../../labor/create-labor.js";
import type { MergeExecutionOutcome } from "../../merge/tier-policy.js";
import type { CasteRuntime } from "../../runtime/caste-runtime.js";
import type { ArtifactEmissionMode } from "../../runtime/runtime-registry.js";
import type { AegisIssue } from "../../tracker/issue-model.js";
import type { TrackerClient } from "../../tracker/tracker.js";

export type { ArtifactEmissionMode };

export interface TrackerLike extends Pick<TrackerClient, "closeIssue" | "createIssue" | "linkBlockingIssue" | "updateIssueScope"> {
  getIssue(id: string, root?: string): Promise<AegisIssue>;
}

/** Merge-boundary context handed to Janus by the merge queue. */
export interface JanusConflictContext {
  queueItemId: string;
  mergeOutcome: MergeExecutionOutcome;
  mergeDetail: string;
  attempt: number;
  tier: "T3";
  janusInvocation: number;
}

export interface RunCasteCommandInput {
  root: string;
  action: RuntimeCasteAction;
  issueId: string;
  tracker: TrackerLike;
  runtime: CasteRuntime;
  /** Defaults to tool-call emission (Pi); CLI adapters pass "json". */
  artifactEmissionMode?: ArtifactEmissionMode;
  janusContext?: JanusConflictContext;
  /** Receives live adapter activity lines for the session this command runs. */
  onActivity?: (line: string) => void;
  resolveBaseBranch?: () => string;
  resolveLaborBasePath?: () => string;
  ensureLabor?: (plan: LaborCreationPlan) => void;
  now?: string;
}

export interface CasteCommandResult {
  action: RuntimeCasteAction;
  issueId: string;
  stage: string;
  artifactRefs?: string[];
  queueItemId?: string;
  janusRecommendation?: "requeue_parent" | "create_integration_blocker";
  nextAction?: "merge_next";
}
