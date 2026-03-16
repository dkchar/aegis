// src/types.ts
// Shared type definitions for Aegis

export type Caste = "oracle" | "titan" | "sentinel";

export interface AegisConfig {
  version: number;
  auth: {
    anthropic: string | null;
    openai: string | null;
    google: string | null;
  };
  models: {
    oracle: string;
    titan: string;
    sentinel: string;
    metis: string;
    prometheus: string;
  };
  concurrency: {
    max_agents: number;
    max_oracles: number;
    max_titans: number;
    max_sentinels: number;
  };
  budgets: {
    oracle_turns: number;
    oracle_tokens: number;
    titan_turns: number;
    titan_tokens: number;
    sentinel_turns: number;
    sentinel_tokens: number;
  };
  timing: {
    poll_interval_seconds: number;
    stuck_warning_seconds: number;
    stuck_kill_seconds: number;
  };
  mnemosyne: {
    max_records: number;
    context_budget_tokens: number;
  };
  labors: {
    base_path: string;
  };
  olympus: {
    port: number;
    open_browser: boolean;
  };
}

export type IssueStatus = "open" | "ready" | "in_progress" | "closed" | "deferred";

export interface BeadsIssue {
  id: string;
  title: string;
  description: string;
  type: string;
  priority: number;
  status: IssueStatus;
  comments: BeadsComment[];
}

export interface BeadsComment {
  id: string;
  body: string;
  author: string;
  created_at: string;
}

export interface MnemosyneRecord {
  id: string;
  type: "convention" | "pattern" | "failure";
  domain: string;
  text: string;
  source: string;
  issue: string | null;
  ts: number;
}

export interface AgentState {
  id: string;
  caste: Caste;
  issue_id: string;
  issue_title: string;
  model: string;
  turns: number;
  max_turns: number;
  tokens: number;
  max_tokens: number;
  cost_usd: number;
  started_at: number;
  last_tool_call_at: number;
  status: "running" | "completed" | "killed" | "failed";
  labor_path: string | null;
}

export type SteerAction =
  | { type: "pause" }
  | { type: "resume" }
  | { type: "scale"; concurrency: number }
  | { type: "focus"; filter: string }
  | { type: "clear_focus" }
  | { type: "rush"; issue_id: string }
  | { type: "kill"; agent_id: string }
  | { type: "restart"; issue_id: string }
  | { type: "tell_agent"; agent_id: string; message: string }
  | { type: "tell_all"; message: string }
  | { type: "add_learning"; domain: string; text: string }
  | { type: "dispatch_oracle"; target: string; note: string }
  | { type: "reprioritize"; issue_id: string; priority: number }
  | { type: "summarize" }
  | { type: "noop"; explanation: string };

export interface SSEEvent {
  type: string;
  data: unknown;
  timestamp: number;
}

export interface SwarmState {
  status: "running" | "paused" | "stopping";
  agents: AgentState[];
  queue_depth: number;
  total_cost_usd: number;
  uptime_seconds: number;
  focus_filter: string | null;
}