/**
 * Agent grid component.
 *
 * Lane A implements: responsive grid layout using CSS grid, empty state
 * when no agents are active, and mapping over agents to render AgentCard
 * components (implemented by lane B).
 *
 * This bridges lane A (layout) with lane B's AgentCard component.
 */

import type { JSX } from "react";
import type { ActiveAgentInfo } from "../types/dashboard-state";
import { AgentCard } from "./agent-card";

export interface AgentGridProps {
  agents: ActiveAgentInfo[];
  onKill: (agentId: string) => void;
}

export function AgentGrid(props: AgentGridProps): JSX.Element {
  const { agents, onKill } = props;

  if (agents.length === 0) {
    return (
      <section data-testid="agent-grid" aria-label="Active Agents" className="agent-grid">
        <div className="empty-state" data-testid="empty-state">
          <div className="empty-state-icon" aria-hidden="true">{"\u{1F916}"}</div>
          <div className="empty-state-text">No active agents</div>
          <div className="empty-state-subtext">
            Agents will appear here when dispatched by the orchestrator.
          </div>
        </div>
      </section>
    );
  }

  return (
    <section data-testid="agent-grid" aria-label="Active Agents" className="agent-grid">
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
    </section>
  );
}
