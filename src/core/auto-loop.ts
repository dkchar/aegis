/**
 * Fresh-ready auto-loop contract for S07.
 *
 * Auto mode may only process work that became ready after auto was enabled.
 * Lane B will own the actual polling/dispatch loop; this module provides the
 * time-based gate used to keep that loop deterministic.
 */

export interface AutoLoopState {
  enabledAt: string | null;
}

export interface ReadyIssueObservation {
  id: string;
  readyAt: string;
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

function parseTimestamp(value: string, fieldName: string): number {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid timestamp for ${fieldName}: ${value}`);
  }

  return parsed;
}

export function isNewReadyIssue(
  issue: ReadyIssueObservation,
  state: AutoLoopState,
): boolean {
  if (state.enabledAt === null) {
    return false;
  }

  return parseTimestamp(issue.readyAt, "issue.readyAt") >
    parseTimestamp(state.enabledAt, "state.enabledAt");
}
