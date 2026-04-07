/**
 * Agent card component contract.
 *
 * Lane B implements: agent ID, caste, model, assigned issue, turn count,
 * token count, elapsed time, spend/quota usage, and kill action.
 */

import type { JSX } from "react";
import type { ActiveAgentInfo } from "../types/dashboard-state";

export interface AgentCardProps extends ActiveAgentInfo {
  onKill: (agentId: string) => void;
}

export function AgentCard(_props: AgentCardProps): JSX.Element {
  // Lane B: implement full agent card with kill action
  return (
    <article data-testid="agent-card" className="agent-card">
      {/* Lane B: implement agent card content */}
    </article>
  );
}

/** Format seconds into human-readable duration. */
export function formatDuration(seconds: number): string {
  // Lane B: implement formatting
  return `${seconds}s`;
}

/** Format token count with appropriate suffix. */
export function formatTokens(count: number): string {
  // Lane B: implement formatting
  return `${count}`;
}

/** Format USD cost with appropriate precision. */
export function formatCost(usd?: number): string {
  // Lane B: implement formatting
  return usd !== undefined ? `$${usd.toFixed(2)}` : "N/A";
}
