/**
 * Agent grid component — Lane B implementation.
 *
 * Renders a responsive grid of agent cards with an empty state
 * when no agents are active.
 */

import type { JSX } from "react";
import { AgentCard } from "./agent-card";
import type { ActiveAgentInfo } from "../types/dashboard-state";

export interface AgentGridProps {
  agents: ActiveAgentInfo[];
  onKill: (agentId: string) => void;
}

export function AgentGrid(props: AgentGridProps): JSX.Element {
  const { agents, onKill } = props;

  if (agents.length === 0) {
    return (
      <section data-testid="agent-grid" aria-label="Active Agents">
        <div className="empty-state">
          <div className="empty-state-icon">&#9881;</div>
          <div className="empty-state-text">No active agents</div>
          <div className="empty-state-subtext">
            Agents will appear here when the orchestrator launches them.
          </div>
        </div>
      </section>
    );
  }

  return (
    <section data-testid="agent-grid" aria-label="Active Agents">
      <div className="agent-grid">
        {agents.map((agent) => (
          <AgentCard
            key={agent.agentId}
            agentId={agent.agentId}
            caste={agent.caste}
            model={agent.model}
            issueId={agent.issueId}
            stage={agent.stage}
            turnCount={agent.turnCount}
            inputTokens={agent.inputTokens}
            outputTokens={agent.outputTokens}
            elapsedSeconds={agent.elapsedSeconds}
            spendUsd={agent.spendUsd}
            onKill={onKill}
          />
        ))}
      </div>
    </section>
  );
}
