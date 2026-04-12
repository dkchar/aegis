/**
 * Backlog-sweep auto-loop contract for S07.
 *
 * Auto mode treats any ready issue as eligible while it is enabled, including
 * work that was already in bd ready before the toggle. Lane B owns the actual
 * polling/dispatch loop; this module only answers whether auto mode is active.
 */

export interface AutoLoopState {
  enabledAt: string | null;
}

export function createAutoLoopState(): AutoLoopState {
  return {
    enabledAt: null,
  };
}

export function enableAutoLoop(enabledAt: string): AutoLoopState {
  return {
    enabledAt,
  };
}

export function disableAutoLoop(): AutoLoopState {
  return {
    enabledAt: null,
  };
}

export function isAutoLoopEligible(state: AutoLoopState): boolean {
  return state.enabledAt !== null;
}
