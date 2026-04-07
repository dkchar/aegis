/**
 * Agent card component — Lane B implementation.
 *
 * Displays a single active agent's status including:
 * - Agent ID (monospace font)
 * - Caste badge (color-coded: oracle=cyan, titan=blue, sentinel=amber, janus=red/coral)
 * - Model name display
 * - Assigned issue ID
 * - Turn count display
 * - Token count (input + output, formatted with K/M suffixes)
 * - Elapsed time (live updating, formatted as HH:MM:SS or MM:SS)
 * - Spend/quota usage (handle all metering modes)
 * - Kill button (styled as danger/red)
 */

import { useEffect, useState, useCallback } from "react";
import type { JSX } from "react";
import type { ActiveAgentInfo } from "../types/dashboard-state";
import { colors } from "../theme/tokens";

export interface AgentCardProps extends ActiveAgentInfo {
  onKill: (agentId: string) => void;
}

const CASTE_LABELS: Record<ActiveAgentInfo["caste"], string> = {
  oracle: "Oracle",
  titan: "Titan",
  sentinel: "Sentinel",
  janus: "Janus",
};

const CASTE_CLASS: Record<ActiveAgentInfo["caste"], string> = {
  oracle: "oracle",
  titan: "titan",
  sentinel: "sentinel",
  janus: "janus",
};

const CASTE_COLORS: Record<ActiveAgentInfo["caste"], string> = {
  oracle: colors.casteOracle,
  titan: colors.casteTitan,
  sentinel: colors.casteSentinel,
  janus: colors.casteJanus,
};

/** Format seconds into human-readable duration (HH:MM:SS or MM:SS). */
export function formatDuration(seconds: number): string {
  if (seconds < 0) seconds = 0;
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hrs > 0) {
    return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

/** Format token count with K/M suffixes. */
export function formatTokens(count: number): string {
  if (count < 0) return "0";
  if (count < 1_000) return String(count);
  if (count < 1_000_000) return `${(count / 1_000).toFixed(1)}K`;
  return `${(count / 1_000_000).toFixed(2)}M`;
}

/** Format USD cost with appropriate precision. */
export function formatCost(usd?: number): string {
  if (usd === undefined || usd < 0) return "N/A";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

/** Format a spend observation based on the metering mode. */
function formatSpendInfo(agent: ActiveAgentInfo): string {
  if (agent.spendUsd !== undefined) {
    return `Spend: ${formatCost(agent.spendUsd)}`;
  }
  const totalTokens = agent.inputTokens + agent.outputTokens;
  return `Tokens: ${formatTokens(totalTokens)}`;
}

/** Live elapsed time display that updates every second. */
function LiveElapsed({ elapsedSeconds }: { elapsedSeconds: number }): JSX.Element {
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const base = Date.now();
    const startElapsed = elapsedSeconds;

    const interval = setInterval(() => {
      setOffset(Math.floor((Date.now() - base) / 1000));
    }, 1000);

    return () => clearInterval(interval);
  }, [elapsedSeconds]);

  const total = elapsedSeconds + offset;
  return <>{formatDuration(total)}</>;
}

export function AgentCard(props: AgentCardProps): JSX.Element {
  const { agentId, caste, model, issueId, turnCount, inputTokens, outputTokens, elapsedSeconds, onKill } = props;

  const handleKill = useCallback(() => {
    onKill(agentId);
  }, [agentId, onKill]);

  const totalTokens = inputTokens + outputTokens;
  const casteLabel = CASTE_LABELS[caste];
  const casteClass = CASTE_CLASS[caste];

  return (
    <article
      data-testid="agent-card"
      className="agent-card"
      style={{ borderLeftColor: CASTE_COLORS[caste], borderLeftWidth: "3px", borderLeftStyle: "solid" }}
    >
      <div className="agent-card-header">
        <span className={`agent-card-caste ${casteClass}`}>{casteLabel}</span>
        <button
          className="kill-btn"
          onClick={handleKill}
          aria-label={`Kill agent ${agentId}`}
          title="Kill this agent"
        >
          Kill
        </button>
      </div>

      <div className="agent-card-id" title={agentId}>{agentId}</div>

      <div className="agent-card-issue" title={`Issue: ${issueId}`}>
        Issue: <strong>{issueId}</strong>
      </div>

      <div className="agent-card-issue" title={`Model: ${model}`}>
        Model: <strong>{model}</strong>
      </div>

      <div className="agent-card-stats">
        <div className="agent-card-stat">
          <span className="agent-card-stat-label">Turns</span>
          <span className="agent-card-stat-value">{turnCount}</span>
        </div>
        <div className="agent-card-stat">
          <span className="agent-card-stat-label">Elapsed</span>
          <span className="agent-card-stat-value">
            <LiveElapsed elapsedSeconds={elapsedSeconds} />
          </span>
        </div>
        <div className="agent-card-stat">
          <span className="agent-card-stat-label">Input tokens</span>
          <span className="agent-card-stat-value">{formatTokens(inputTokens)}</span>
        </div>
        <div className="agent-card-stat">
          <span className="agent-card-stat-label">Output tokens</span>
          <span className="agent-card-stat-value">{formatTokens(outputTokens)}</span>
        </div>
        <div className="agent-card-stat">
          <span className="agent-card-stat-label">Total tokens</span>
          <span className="agent-card-stat-value">{formatTokens(totalTokens)}</span>
        </div>
        <div className="agent-card-stat">
          <span className="agent-card-stat-label">Spend</span>
          <span className="agent-card-stat-value">{formatSpendInfo(props)}</span>
        </div>
      </div>
    </article>
  );
}
