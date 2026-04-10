export type OrchestratorMode = "conversational" | "auto";

export interface OrchestratorStatus {
  mode: OrchestratorMode;
  isRunning: boolean;
  uptimeSeconds: number;
  activeAgents: number;
  queueDepth: number;
  paused: boolean;
}

export interface SpendObservation {
  metering: "exact_usd" | "credits" | "quota" | "stats_only" | "unknown";
  costUsd?: number;
  creditsUsed?: number;
  creditsRemaining?: number;
  quotaUsedPct?: number;
  quotaRemainingPct?: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

export interface ActiveAgentInfo {
  agentId: string;
  caste: "oracle" | "titan" | "sentinel" | "janus";
  model: string;
  issueId: string;
  stage: string;
  turnCount: number;
  inputTokens: number;
  outputTokens: number;
  elapsedSeconds: number;
  spendUsd?: number;
}

export interface OlympusConfig {
  runtime: string;
  pollIntervalSec: number;
  maxConcurrency: number;
  budgetLimitUsd: number | null;
  coerceReview: boolean;
  meteringFallback: string;
}

export interface ReadyIssueSummary {
  id: string;
  title: string;
  priority: number;
  issueClass?: string;
}

export interface EditableConcurrencyConfig {
  max_agents: number;
  max_oracles: number;
  max_titans: number;
  max_sentinels: number;
  max_janus: number;
}

export interface EditableBudgetLimit {
  turns: number;
  tokens: number;
}

export interface EditableBudgetsConfig {
  oracle: EditableBudgetLimit;
  titan: EditableBudgetLimit;
  sentinel: EditableBudgetLimit;
  janus: EditableBudgetLimit;
}

export interface EditableOlympusConfig {
  runtime: string;
  thresholds: {
    poll_interval_seconds: number;
  };
  economics: {
    metering_fallback: string;
    daily_hard_stop_usd: number | null;
  };
  concurrency: EditableConcurrencyConfig;
  budgets: EditableBudgetsConfig;
}

export interface EditableOlympusConfigPatch {
  concurrency: EditableConcurrencyConfig;
  budgets: EditableBudgetsConfig;
}

export interface DashboardState {
  status: OrchestratorStatus;
  spend: SpendObservation;
  agents: ActiveAgentInfo[];
  config?: OlympusConfig | null;
}
