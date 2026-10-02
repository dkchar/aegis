import { createCasteConfig } from "./caste-config.js";
import type { AegisConfig } from "./schema.js";

export const DEFAULT_AEGIS_CONFIG: AegisConfig = {
  runtime: "scripted",
  models: createCasteConfig(() => "openai-codex:gpt-5.4-mini"),
  thinking: createCasteConfig(() => "medium"),
  concurrency: {
    max_agents: 3,
    max_oracles: 1,
    max_titans: 1,
    max_sentinels: 1,
    max_janus: 1,
  },
  thresholds: {
    poll_interval_seconds: 5,
    stuck_warning_seconds: 300,
    stuck_kill_seconds: 900,
    allow_complex_auto_dispatch: false,
    scope_overlap_threshold: 0,
    janus_retry_threshold: 2,
  },
  janus: {
    enabled: true,
    max_invocations_per_issue: 1,
  },
  labor: {
    base_path: ".aegis/labors",
  },
  git: {
    base_branch: "main",
  },
};
