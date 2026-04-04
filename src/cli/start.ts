export const START_COMMAND_NAME = "start";

export const START_OVERRIDE_FLAGS = [
  "--port",
  "--concurrency",
  "--model",
  "--no-browser",
  "--verbose",
] as const;

export const CANONICAL_LAUNCH_SEQUENCE = [
  "load_config",
  "verify_tracker",
  "verify_git_repo",
  "recover_dispatch_state",
  "start_http_server",
  "open_browser",
  "enter_conversational_idle",
  "print_runtime_summary",
] as const;

export const CANONICAL_SHUTDOWN_SEQUENCE = [
  "stop_polling",
  "stop_active_agents",
  "wait_for_graceful_completion",
  "abort_stragglers",
  "reconcile_tracker_work",
  "cleanup_labors",
  "persist_runtime_state",
  "print_budget_summary",
] as const;

export type StartOverrideFlag = (typeof START_OVERRIDE_FLAGS)[number];
export type LaunchSequenceStep = (typeof CANONICAL_LAUNCH_SEQUENCE)[number];
export type ShutdownSequenceStep = (typeof CANONICAL_SHUTDOWN_SEQUENCE)[number];

export interface StartCommandOverrides {
  port?: number;
  concurrency?: number;
  model?: string;
  noBrowser?: boolean;
  verbose?: boolean;
}

export interface StartCommandContract {
  command: typeof START_COMMAND_NAME;
  overrides: readonly StartOverrideFlag[];
  launchSequence: readonly LaunchSequenceStep[];
  shutdownSequence: readonly ShutdownSequenceStep[];
}

export function createStartCommandContract(): StartCommandContract {
  return {
    command: START_COMMAND_NAME,
    overrides: START_OVERRIDE_FLAGS,
    launchSequence: CANONICAL_LAUNCH_SEQUENCE,
    shutdownSequence: CANONICAL_SHUTDOWN_SEQUENCE,
  };
}
