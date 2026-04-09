/**
 * Canonical dashboard state model for Olympus MVP.
 *
 * These types define the server payload contract that the UI consumes.
 * They mirror what the orchestrator's GET /api/state endpoint returns.
 */

/** Current operating mode of the orchestrator. */
export type OrchestratorMode = "conversational" | "auto";

/** High-level orchestr status. */
export interface OrchestratorStatus {
  mode: OrchestratorMode;
  isRunning: boolean;
  uptimeSeconds: number;
  activeAgents: number;
  queueDepth: number;
  paused: boolean;
}

/** Budget/spend observation — matches SPECv2 metering capabilities. */
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

/** A running agent as seen by the orchestrator. */
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

/** Top-level state payload returned by GET /api/state. */
export interface DashboardState {
  status: OrchestratorStatus;
  spend: SpendObservation;
  agents: ActiveAgentInfo[];
}
