import {
  createTitanPromptContract,
  type TitanPromptContext,
} from "../castes/titan/titan-prompt.js";

export type TitanRunOutcome = "success" | "clarification" | "failure";

export interface TitanHandoffArtifact {
  issueId: string;
  laborPath: string;
  candidateBranch: string;
  baseBranch: string;
  filesChanged: string[];
  testsAndChecksRun: string[];
  knownRisks: string[];
  followUpWork: string[];
  learningsWrittenToMnemosyne: string[];
}

export interface TitanClarificationArtifact {
  originalIssueId: string;
  issueTitle: string;
  laborPath: string;
  candidateBranch: string;
  baseBranch: string;
  blockingQuestion: string;
  handoffNote: string;
  preserveLabor: boolean;
  linkedClarificationIssueId: string | null;
}

export interface TitanLifecycleRule {
  outcome: TitanRunOutcome;
  retainLabor: boolean;
  emitHandoffArtifact: boolean;
  emitClarificationArtifact: boolean;
}

export const TITAN_RUN_LIFECYCLE_RULES: Record<TitanRunOutcome, TitanLifecycleRule> = {
  success: {
    outcome: "success",
    retainLabor: true,
    emitHandoffArtifact: true,
    emitClarificationArtifact: false,
  },
  clarification: {
    outcome: "clarification",
    retainLabor: true,
    emitHandoffArtifact: true,
    emitClarificationArtifact: true,
  },
  failure: {
    outcome: "failure",
    retainLabor: true,
    emitHandoffArtifact: true,
    emitClarificationArtifact: false,
  },
};

export interface TitanRunContract {
  handoffArtifact: TitanHandoffArtifact;
  clarificationArtifact: TitanClarificationArtifact;
  lifecycleRules: Record<TitanRunOutcome, TitanLifecycleRule>;
}

export function createTitanRunContract(
  context: TitanPromptContext,
): TitanRunContract {
  const prompt = createTitanPromptContract(context);

  return {
    handoffArtifact: {
      issueId: prompt.issueId,
      laborPath: prompt.laborPath,
      candidateBranch: prompt.branchName,
      baseBranch: prompt.baseBranch,
      filesChanged: [],
      testsAndChecksRun: [],
      knownRisks: [],
      followUpWork: [],
      learningsWrittenToMnemosyne: [],
    },
    clarificationArtifact: {
      originalIssueId: prompt.issueId,
      issueTitle: prompt.issueTitle,
      laborPath: prompt.laborPath,
      candidateBranch: prompt.branchName,
      baseBranch: prompt.baseBranch,
      blockingQuestion: "",
      handoffNote: "",
      preserveLabor: true,
      linkedClarificationIssueId: null,
    },
    lifecycleRules: TITAN_RUN_LIFECYCLE_RULES,
  };
}
