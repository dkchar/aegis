/**
 * Operating mode state for the S07 deterministic command surface.
 *
 * This module owns the conversational vs auto mode flag plus the paused bit.
 * It intentionally stays separate from the auto-loop freshness contract.
 */

export const OPERATING_MODES = ["conversational", "auto"] as const;

export type OperatingMode = (typeof OPERATING_MODES)[number];

export interface OperatingModeState {
  mode: OperatingMode;
  paused: boolean;
}

export function createOperatingModeState(): OperatingModeState {
  return {
    mode: "conversational",
    paused: false,
  };
}

export function enableAutoMode(state: OperatingModeState): OperatingModeState {
  return {
    ...state,
    mode: "auto",
    paused: false,
  };
}

export function disableAutoMode(state: OperatingModeState): OperatingModeState {
  return {
    ...state,
    mode: "conversational",
    paused: false,
  };
}

export function pauseOperatingMode(state: OperatingModeState): OperatingModeState {
  return {
    ...state,
    paused: true,
  };
}

export function resumeOperatingMode(state: OperatingModeState): OperatingModeState {
  return {
    ...state,
    paused: false,
  };
}

export function isAutoModeActive(state: OperatingModeState): boolean {
  return state.mode === "auto" && !state.paused;
}
