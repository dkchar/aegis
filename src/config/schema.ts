export const AEGIS_DIRECTORY = ".aegis";

export const CONFIG_TOP_LEVEL_KEYS = [
  "runtime",
  "auth",
  "models",
  "concurrency",
  "budgets",
  "thresholds",
  "economics",
  "janus",
  "mnemosyne",
  "labor",
  "olympus",
  "evals",
] as const;

export const AUTH_KEYS = ["provider", "mode", "plan"] as const;
export const MODEL_KEYS = [
  "oracle",
  "titan",
  "sentinel",
  "janus",
  "metis",
  "prometheus",
] as const;
export const CONCURRENCY_KEYS = [
  "max_agents",
  "max_oracles",
  "max_titans",
  "max_sentinels",
  "max_janus",
] as const;
export const BUDGET_KEYS = ["oracle", "titan", "sentinel", "janus"] as const;
export const BUDGET_LIMIT_KEYS = ["turns", "tokens"] as const;
export const THRESHOLD_KEYS = [
  "poll_interval_seconds",
  "stuck_warning_seconds",
  "stuck_kill_seconds",
  "allow_complex_auto_dispatch",
  "scope_overlap_threshold",
  "janus_retry_threshold",
] as const;
export const ECONOMICS_KEYS = [
  "metering_fallback",
  "per_issue_cost_warning_usd",
  "daily_cost_warning_usd",
  "daily_hard_stop_usd",
  "quota_warning_floor_pct",
  "quota_hard_stop_floor_pct",
  "credit_warning_floor",
  "credit_hard_stop_floor",
  "allow_exact_cost_estimation",
] as const;
export const JANUS_KEYS = ["enabled", "max_invocations_per_issue"] as const;
export const MNEMOSYNE_KEYS = ["max_records", "prompt_token_budget"] as const;
export const LABOR_KEYS = ["base_path"] as const;
export const OLYMPUS_KEYS = ["port", "open_browser"] as const;
export const EVAL_KEYS = [
  "enabled",
  "results_path",
  "benchmark_suite",
  "minimum_pass_rate",
  "max_human_interventions_per_10_issues",
] as const;

export const RUNTIME_STATE_FILES = [
  ".aegis/dispatch-state.json",
  ".aegis/merge-queue.json",
  ".aegis/mnemosyne.jsonl",
] as const;

export interface BudgetLimit {
  turns: number;
  tokens: number;
}

export interface AegisConfig {
  runtime: string;
  auth: {
    provider: string;
    mode: "api_key" | "subscription" | "workspace_subscription";
    plan: string | null;
  };
  models: {
    oracle: string;
    titan: string;
    sentinel: string;
    janus: string;
    metis: string;
    prometheus: string;
  };
  concurrency: {
    max_agents: number;
    max_oracles: number;
    max_titans: number;
    max_sentinels: number;
    max_janus: number;
  };
  budgets: {
    oracle: BudgetLimit;
    titan: BudgetLimit;
    sentinel: BudgetLimit;
    janus: BudgetLimit;
  };
  thresholds: {
    poll_interval_seconds: number;
    stuck_warning_seconds: number;
    stuck_kill_seconds: number;
    allow_complex_auto_dispatch: boolean;
    scope_overlap_threshold: number;
    janus_retry_threshold: number;
  };
  economics: {
    metering_fallback: "stats_only" | "exact_usd" | "quota" | "credits" | "unknown";
    per_issue_cost_warning_usd: number | null;
    daily_cost_warning_usd: number | null;
    daily_hard_stop_usd: number | null;
    quota_warning_floor_pct: number | null;
    quota_hard_stop_floor_pct: number | null;
    credit_warning_floor: number | null;
    credit_hard_stop_floor: number | null;
    allow_exact_cost_estimation: boolean;
  };
  janus: {
    enabled: boolean;
    max_invocations_per_issue: number;
  };
  mnemosyne: {
    max_records: number;
    prompt_token_budget: number;
  };
  labor: {
    base_path: string;
  };
  olympus: {
    port: number;
    open_browser: boolean;
  };
  evals: {
    enabled: boolean;
    results_path: string;
    benchmark_suite: string;
    minimum_pass_rate: number;
    max_human_interventions_per_10_issues: number;
  };
}
