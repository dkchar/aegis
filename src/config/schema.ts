import type { CasteConfigKey } from "./caste-config.js";
import { CASTE_CONFIG_KEYS } from "./caste-config.js";

export const AEGIS_DIRECTORY = ".aegis";

export const CONFIG_TOP_LEVEL_KEYS = [
  "runtime",
  "models",
  "thinking",
  "concurrency",
  "thresholds",
  "janus",
  "labor",
  "git",
  "merge",
] as const;

export const MODEL_KEYS = CASTE_CONFIG_KEYS;
export const THINKING_KEYS = CASTE_CONFIG_KEYS;

export const THINKING_LEVELS = [
  "off",
  "low",
  "medium",
  "high",
] as const;

export type AegisThinkingLevel = (typeof THINKING_LEVELS)[number];

export const CONCURRENCY_KEYS = [
  "max_agents",
  "max_oracles",
  "max_titans",
  "max_sentinels",
  "max_janus",
] as const;

export const THRESHOLD_KEYS = [
  "poll_interval_seconds",
  "stuck_warning_seconds",
  "stuck_kill_seconds",
  "allow_complex_auto_dispatch",
  "scope_overlap_threshold",
  "janus_retry_threshold",
] as const;

export const JANUS_KEYS = ["enabled", "max_invocations_per_issue"] as const;
export const LABOR_KEYS = ["base_path"] as const;
export const GIT_KEYS = ["base_branch"] as const;
export const MERGE_KEYS = ["verify_command", "verify_idle_timeout_seconds"] as const;

export const RUNTIME_STATE_FILES = [
  ".aegis/dispatch-state.json",
  ".aegis/merge-queue.json",
] as const;

export interface AegisConfig {
  runtime: string;
  models: {
    [key in CasteConfigKey]: string;
  };
  thinking: {
    [key in CasteConfigKey]: AegisThinkingLevel;
  };
  concurrency: {
    max_agents: number;
    max_oracles: number;
    max_titans: number;
    max_sentinels: number;
    max_janus: number;
  };
  thresholds: {
    poll_interval_seconds: number;
    stuck_warning_seconds: number;
    stuck_kill_seconds: number;
    allow_complex_auto_dispatch: boolean;
    scope_overlap_threshold: number;
    janus_retry_threshold: number;
  };
  janus: {
    enabled: boolean;
    max_invocations_per_issue: number;
  };
  labor: {
    base_path: string;
  };
  git: {
    base_branch: string;
  };
  merge: {
    /** Shell command run on each merge result before the target advances; empty disables it. */
    verify_command: string;
    verify_idle_timeout_seconds: number;
  };
}
