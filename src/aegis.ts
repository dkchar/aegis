// src/aegis.ts
// Aegis — core orchestrator class.
// Implements the Layer 1 deterministic dispatch loop:
//   POLL → TRIAGE → DISPATCH → MONITOR → REAP → POLL

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import * as poller from "./poller.js";
import { triage } from "./triage.js";
import * as spawner from "./spawner.js";
import * as monitor from "./monitor.js";
import * as mnemo from "./mnemosyne.js";
import { prune, shouldPrune } from "./lethe.js";
import * as labors from "./labors.js";
import * as beads from "./beads.js";

import type {
  AgentHandle,
  AgentState,
  AegisConfig,
  SSEEvent,
  SwarmState,
  BeadsIssue,
  MnemosyneRecord,
} from "./types.js";

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface RunningAgent {
  state: AgentState;
  /**
   * Null during the brief window between slot pre-registration and a
   * successful runtime spawn. All code that uses session must
   * guard against null.
   */
  session: AgentHandle | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Aegis class
// ---------------------------------------------------------------------------

export class Aegis {
  private readonly config: AegisConfig;
  private readonly projectRoot: string;
  private readonly agentsMd: string;

  // Runtime state
  private _running = false;
  private _paused = false;
  private _stopping = false;
  private startedAt = 0;
  private agentCounter = 0;

  /** Active agents keyed by agent ID */
  private agents = new Map<string, RunningAgent>();

  /** Agent IDs that have already been reaped (prevents double-reap) */
  private reaped = new Set<string>();

  /**
   * Agent IDs whose session spawn failed.  These stay in this.agents with
   * status "running" for the remainder of the current tick so they continue
   * to occupy a concurrency slot (preventing over-spawning when all spawns
   * fail in the same tick).  reapCompleted() sets their status to "failed"
   * and reaps them.
   */
  private spawnPendingReap = new Set<string>();

  /** SSE event listeners registered via onEvent() */
  private eventListeners: ((event: SSEEvent) => void)[] = [];

  /**
   * Per-agent ring-buffer of the last 3 tool call fingerprints
   * ("toolName:argsJson"). Used for SPEC §10.2 repeated-tool-call detection.
   */
  private recentToolCalls = new Map<string, string[]>();

  /** Cumulative cost of all reaped agents (prevents totalCost() dropping to 0 after reap) */
  private cumulativeCostUsd = 0;

  /** Optional text filter — only dispatch issues whose title/description match */
  private focusFilter: string | null = null;

  /** Cached depth of the beads ready queue */
  private queueDepth = 0;

  /**
   * Consecutive spawn-failure counts per issue ID.
   * After MAX_DISPATCH_FAILURES failures within DISPATCH_FAILURE_WINDOW_MS,
   * the issue is skipped until the window expires so the loop does not
   * re-dispatch an unspawnable issue on every poll tick.
   */
  private dispatchFailures = new Map<string, { count: number; since: number }>();
  private static readonly MAX_DISPATCH_FAILURES = 3;
  private static readonly DISPATCH_FAILURE_WINDOW_MS = 10 * 60_000; // 10 min

  /** Handle for the poll interval timer */
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  /** Whether a tick is currently in progress (prevents re-entrant ticks) */
  private ticking = false;

  /**
   * Whether the autonomous poll loop is active (opt-in per SPEC §3.1).
   * Starts false; activated via autoOn() / "auto on" command.
   */
  private autoMode = false;

  /**
   * Issue IDs for which a Titan was dispatched in this session.
   * findClosedUnreviewed() only checks these issues so Sentinels are not
   * dispatched for issues closed outside the current session (SPEC §3.1).
   */
  private titanDispatchedIssues = new Set<string>();

  /**
   * Issue IDs being processed through the full Oracle → Titan → Sentinel
   * cycle via the process() command.  reap() auto-advances these.
   */
  private processQueue = new Set<string>();

  /**
   * Issue IDs that were in the ready queue when auto mode was activated.
   * These are excluded from automatic dispatch per SPEC §3.1 (conversational-first).
   * Cleared on autoOff().
   */
  private autoModeIgnoreSet = new Set<string>();

  constructor(config: AegisConfig, projectRoot: string = process.cwd()) {
    this.config = config;
    this.projectRoot = projectRoot;
    this.agentsMd = this.loadAgentsMd();
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  /**
   * Start the orchestrator in conversational-first (idle) mode per SPEC §3.1.
   * Performs crash recovery, then waits for user direction.
   * The autonomous poll loop does NOT start here — use autoOn() / "auto on".
   */
  async start(): Promise<void> {
    this._running = true;
    this._paused = false;
    this._stopping = false;
    this.startedAt = Date.now();

    this.emit({ type: "orchestrator.started", data: {}, timestamp: Date.now() });

    // Crash recovery: reset any orphaned in_progress issues and clean up
    // stale labors left over from a previous crash (SPEC §2.3).
    await this.recover();

    // Aegis is now idle — awaiting user commands or autoOn().
  }

  /**
   * Graceful shutdown per SPEC §9.2.
   * Stops polling, injects wrap-up messages, waits 60 s, kills stragglers,
   * marks in-progress issues back to open, cleans up Labors.
   */
  async stop(): Promise<void> {
    if (this._stopping) return;
    this._stopping = true;
    this._running = false;

    // Stop the poll timer
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    this.emit({ type: "orchestrator.stopping", data: {}, timestamp: Date.now() });

    // Inject wrap-up message to all active agents
    const wrapMsg =
      "Wrap up your current action and stop. Complete whatever step you are mid-way through, then stop.";
    for (const { session } of this.agents.values()) {
      if (!session) continue; // pre-registered but spawn not yet complete
      try {
        await session.steer(wrapMsg);
      } catch {
        // ignore — agent may already be done
      }
    }

    // Wait up to 60 s for agents to finish
    const deadline = Date.now() + 60_000;
    while (this.agents.size > 0 && Date.now() < deadline) {
      await sleep(1_000);
      await this.reapCompleted();
    }

    // Kill any still running
    for (const [agentId, { session, state }] of this.agents) {
      state.status = "killed";
      if (session) {
        try {
          await session.abort();
        } catch {
          // ignore
        }
      }
      await this.reap(agentId);
    }

    // Mark any remaining in_progress issues back to open (SPEC §9.2 step 5, aegis-xp2).
    // This catches issues claimed by agents that crashed without being reaped.
    try {
      const allIssues = await beads.list();
      for (const issue of allIssues) {
        if (issue.status === "in_progress") {
          try {
            await beads.reopen(issue.id);
          } catch {
            // best-effort
          }
        }
      }
    } catch {
      // beads unavailable — skip
    }

    // Clean up any remaining Labors (SPEC §9.2 step 6, aegis-xp2).
    try {
      const remainingLabors = await labors.list(this.config, this.projectRoot);
      for (const issueId of remainingLabors) {
        try {
          await labors.cleanup(issueId, this.config, this.projectRoot);
        } catch {
          // best-effort
        }
      }
    } catch {
      // labors unavailable — skip
    }

    const totalCost = this.totalCost();
    console.log(`\nAegis stopped. Total cost: $${totalCost.toFixed(4)}`);
    this.emit({
      type: "orchestrator.stopped",
      data: { total_cost_usd: totalCost },
      timestamp: Date.now(),
    });
  }

  /**
   * Crash recovery per SPEC §2.3.
   * On startup there are no running agents, so any in_progress issue in beads
   * is orphaned from a previous crash. Reset each to open so they re-enter
   * the dispatch queue. Also clean up any stale git worktrees in .aegis/labors/.
   */
  private async recover(): Promise<void> {
    // Reset orphaned in_progress issues
    let allIssues: import("./types.js").BeadsIssue[];
    try {
      allIssues = await beads.list();
    } catch {
      return; // bd unavailable — skip recovery silently
    }

    const orphaned = allIssues.filter((i) => i.status === "in_progress");

    for (const issue of orphaned) {
      try {
        await beads.reopen(issue.id);
        this.emit({
          type: "orchestrator.recovered_issue",
          data: { issue_id: issue.id, issue_title: issue.title },
          timestamp: Date.now(),
        });
      } catch {
        // Best-effort — log but don't crash startup
      }
    }

    // Clean up any orphaned labors (worktrees without a running agent)
    let orphanedLabors: string[];
    try {
      orphanedLabors = await labors.list(this.config, this.projectRoot);
    } catch {
      return;
    }

    for (const issueId of orphanedLabors) {
      try {
        await labors.cleanup(issueId, this.config, this.projectRoot);
        this.emit({
          type: "labor.orphan_cleaned",
          data: { issue_id: issueId },
          timestamp: Date.now(),
        });
      } catch {
        // ignore — best effort
      }
    }
  }

  pause(): void {
    this._paused = true;
    this.emit({ type: "orchestrator.paused", data: {}, timestamp: Date.now() });
  }

  resume(): void {
    this._paused = false;
    this.emit({ type: "orchestrator.resumed", data: {}, timestamp: Date.now() });
  }

  // --------------------------------------------------------------------------
  // State
  // --------------------------------------------------------------------------

  getState(): SwarmState {
    const status = this._stopping
      ? "stopping"
      : this._paused
        ? "paused"
        : "running";

    return {
      status,
      agents: Array.from(this.agents.values()).map((a) => ({ ...a.state })),
      queue_depth: this.queueDepth,
      total_cost_usd: this.totalCost(),
      uptime_seconds: this.startedAt > 0
        ? Math.floor((Date.now() - this.startedAt) / 1000)
        : 0,
      focus_filter: this.focusFilter,
      auto_mode: this.autoMode,
    };
  }

  onEvent(handler: (event: SSEEvent) => void): () => void {
    this.eventListeners.push(handler);
    return () => {
      const idx = this.eventListeners.indexOf(handler);
      if (idx !== -1) this.eventListeners.splice(idx, 1);
    };
  }

  // --------------------------------------------------------------------------
  // Steering actions (called by Metis or direct commands)
  // --------------------------------------------------------------------------

  scale(concurrency: number): void {
    this.config.concurrency.max_agents = concurrency;
    this.emit({ type: "orchestrator.scaled", data: { concurrency }, timestamp: Date.now() });
  }

  focus(filter: string): void {
    this.focusFilter = filter;
    this.emit({ type: "orchestrator.focused", data: { filter }, timestamp: Date.now() });
  }

  clearFocus(): void {
    this.focusFilter = null;
    this.emit({ type: "orchestrator.focus_cleared", data: {}, timestamp: Date.now() });
  }

  /** Rush an issue: bypass Oracle, dispatch Titan immediately */
  async rush(issueId: string): Promise<void> {
    const issue = await beads.show(issueId);
    await this.dispatchTitan(issue, "(rushed — no oracle assessment)");
    this.emit({ type: "orchestrator.rushed", data: { issue_id: issueId }, timestamp: Date.now() });
  }

  /** Scout: dispatch an Oracle for the given issue (conversational mode) */
  async scout(issueId: string): Promise<void> {
    const issue = await beads.show(issueId);
    await this.dispatchOracle(issue);
  }

  /** Implement: dispatch a Titan for the given issue (conversational mode) */
  async implement(issueId: string): Promise<void> {
    const issue = await beads.show(issueId);
    await this.dispatchTitan(issue, "");
  }

  /** Review: dispatch a Sentinel for the given issue (conversational mode) */
  async review(issueId: string): Promise<void> {
    const issue = await beads.show(issueId);
    await this.dispatchSentinel(issue, "");
  }

  /**
   * Process: run the full Oracle → Titan → Sentinel cycle for one issue.
   * Dispatches the appropriate agent for the current stage; reap() auto-advances
   * to the next stage on completion (SPEC §3.1).
   */
  async process(issueId: string): Promise<void> {
    this.processQueue.add(issueId);
    await this.advanceProcess(issueId);
    this.emit({ type: "orchestrator.processing", data: { issue_id: issueId }, timestamp: Date.now() });
  }

  /**
   * Activate the autonomous poll loop (SPEC §3.1 auto mode).
   * Snapshots the current ready queue so pre-existing issues are excluded
   * from automatic dispatch (conversational-first principle).
   * Runs the first tick immediately, then on the configured interval.
   */
  async autoOn(): Promise<void> {
    if (this.autoMode) return; // already active
    this.autoMode = true;

    // Snapshot current ready queue so pre-existing issues are excluded (SPEC §3.1).
    try {
      const currentReady = await poller.poll();
      for (const issue of currentReady) {
        this.autoModeIgnoreSet.add(issue.id);
      }
    } catch {
      // If poll fails, proceed without a snapshot — all issues will be processed.
    }

    void this.tick();
    this.pollTimer = setInterval(() => {
      if (!this._paused && !this._stopping && !this.ticking) {
        void this.tick();
      }
    }, this.config.timing.poll_interval_seconds * 1000);
    this.emit({ type: "orchestrator.auto_on", data: {}, timestamp: Date.now() });
  }

  /**
   * Deactivate the autonomous poll loop, returning to conversational mode.
   */
  autoOff(): void {
    if (!this.autoMode) return; // already inactive
    this.autoMode = false;
    this.autoModeIgnoreSet.clear();
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.emit({ type: "orchestrator.auto_off", data: {}, timestamp: Date.now() });
  }

  async kill(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    agent.state.status = "killed";
    if (agent.session) {
      try {
        await agent.session.abort();
      } catch {
        // ignore
      }
    }
    await this.reap(agentId);
  }

  async restart(issueId: string): Promise<void> {
    // Kill any agent currently working on this issue
    for (const [agentId, { state }] of this.agents) {
      if (state.issue_id === issueId) {
        await this.kill(agentId);
        break;
      }
    }
    // Re-triage and dispatch
    const issue = await beads.show(issueId);
    const action = triage(issue, this.runningByIssueId(), this.config.concurrency);
    await this.dispatch(action);
  }

  /** Reprioritize a beads issue (SPEC §3.2, aegis-dgs). */
  async reprioritize(issueId: string, priority: number): Promise<void> {
    await beads.update(issueId, { priority });
    this.emit({
      type: "orchestrator.reprioritized",
      data: { issue_id: issueId, priority },
      timestamp: Date.now(),
    });
  }

  /** Return a summary of the current swarm state (SPEC §3.2, aegis-dgs). */
  summarize(): SwarmState {
    return this.getState();
  }

  /** Add a learning to the Mnemosyne store (SPEC §3.2, aegis-dgs). */
  addLearning(domain: string, text: string): void {
    mnemo.append(
      { type: "convention", domain, text, source: "human", issue: null },
      this.projectRoot
    );
    this.emit({
      type: "mnemosyne.learning_added",
      data: { domain, text },
      timestamp: Date.now(),
    });
  }

  async tellAgent(agentId: string, message: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (agent?.session) {
      await agent.session.steer(message);
    }
  }

  async tellAll(message: string): Promise<void> {
    for (const { session } of this.agents.values()) {
      if (!session) continue; // pre-registered but not yet spawned
      try {
        await session.steer(message);
      } catch {
        // ignore — individual agent may have finished
      }
    }
  }

  // --------------------------------------------------------------------------
  // Layer 1 tick
  // --------------------------------------------------------------------------

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.runTick();
    } catch (err) {
      this.emit({
        type: "orchestrator.error",
        data: { message: `Tick error: ${String(err)}` },
        timestamp: Date.now(),
      });
    } finally {
      this.ticking = false;
    }
  }

  private async runTick(): Promise<void> {
    // REAP completed agents first to free concurrency slots
    await this.reapCompleted();

    if (this._paused || this._stopping) return;

    // ----- POLL -----
    // Fetch ready issues from beads
    let readyRaw: BeadsIssue[] = [];
    try {
      readyRaw = await poller.poll();
    } catch (err) {
      this.emit({
        type: "orchestrator.error",
        data: { message: `Poll failed: ${String(err)}` },
        timestamp: Date.now(),
      });
      return;
    }

    this.queueDepth = readyRaw.length;

    // Fetch full issue details (with comments) for each ready issue
    const readyFull = await this.fetchFullIssues(readyRaw.map((i) => i.id));

    // Also scan for closed issues needing a Sentinel (cold-start recovery +
    // issues closed outside the current process lifetime)
    const closedNeedingSentinel = await this.findClosedUnreviewed();

    // Combine and deduplicate
    const allActionable = this.dedupById([...readyFull, ...closedNeedingSentinel]);

    // ----- DIFF -----
    const runningByIssue = this.runningByIssueId();
    const newIssues = poller.diff(allActionable, runningByIssue);

    // ----- FILTER -----
    // In auto mode, exclude issues that were already in the ready queue
    // when auto mode was activated (SPEC §3.1 conversational-first).
    const autoFiltered = this.autoMode && this.autoModeIgnoreSet.size > 0
      ? newIssues.filter((i) => !this.autoModeIgnoreSet.has(i.id))
      : newIssues;

    const filtered = this.focusFilter
      ? autoFiltered.filter((i) => {
          const text = `${i.title} ${i.description}`.toLowerCase();
          return text.includes(this.focusFilter!.toLowerCase());
        })
      : autoFiltered;

    // ----- TRIAGE + DISPATCH -----
    for (const issue of filtered) {
      // Skip issues that have hit the consecutive spawn-failure limit.
      if (this.isDispatchBlocked(issue.id)) continue;

      const action = triage(issue, this.runningByIssueId(), this.config.concurrency);
      await this.dispatch(action);
    }

    // ----- MONITOR -----
    for (const [agentId, agent] of this.agents) {
      if (agent.state.status !== "running") continue;

      // Check stuck
      const stuck = monitor.checkStuck(agent, this.config);
      if (stuck.stuck) {
        this.emit({
          type: "agent.stuck",
          data: {
            agent_id: agentId,
            severity: stuck.severity,
            reason: stuck.reason,
          },
          timestamp: Date.now(),
        });
        if (stuck.severity === "warning") {
          if (agent.session) {
            try {
              await agent.session.steer(
                "You appear stuck. Summarize your current state and what is blocking you, then try a different approach."
              );
            } catch {
              // ignore
            }
          }
        } else {
          // kill threshold exceeded
          agent.state.status = "killed";
          if (agent.session) {
            try {
              await agent.session.abort();
            } catch {
              // ignore
            }
          }
        }
      }

      // Check for repeated tool calls (SPEC §10.2)
      const toolBuf = this.recentToolCalls.get(agentId) ?? [];
      const repeated = monitor.checkRepeatedToolCall(toolBuf);
      if (repeated.repeated) {
        this.emit({
          type: "agent.repeated_tool_call",
          data: {
            agent_id: agentId,
            tool_name: repeated.toolName,
            count: repeated.count,
          },
          timestamp: Date.now(),
        });
        if (agent.session) {
          try {
            await agent.session.steer(
              "You are repeating the same tool call. Try a different approach to make progress."
            );
          } catch {
            // ignore
          }
        }
        // Reset the buffer so we don't steer on every subsequent tick
        this.recentToolCalls.set(agentId, []);
      }

      // Check budget
      const budget = monitor.checkBudget(agent, this.config);
      if (budget.exceeded) {
        this.emit({
          type: "agent.budget_exceeded",
          data: {
            agent_id: agentId,
            resource: budget.resource,
            current: budget.current,
            limit: budget.limit,
          },
          timestamp: Date.now(),
        });
        agent.state.status = "killed";
        if (agent.session) {
          try {
            await agent.session.abort();
          } catch {
            // ignore
          }
        }
      }
    }

    // REAP again after monitor may have killed agents
    await this.reapCompleted();
  }

  // --------------------------------------------------------------------------
  // Dispatch failure tracking
  // --------------------------------------------------------------------------

  /**
   * Returns true if this issue should be skipped because it has hit the
   * consecutive spawn-failure limit within the backoff window.
   * Automatically clears stale entries whose window has expired.
   */
  private isDispatchBlocked(issueId: string): boolean {
    const f = this.dispatchFailures.get(issueId);
    if (!f) return false;
    if (Date.now() - f.since > Aegis.DISPATCH_FAILURE_WINDOW_MS) {
      this.dispatchFailures.delete(issueId);
      return false;
    }
    return f.count >= Aegis.MAX_DISPATCH_FAILURES;
  }

  private recordDispatchFailure(issueId: string): void {
    const existing = this.dispatchFailures.get(issueId);
    if (!existing) {
      this.dispatchFailures.set(issueId, { count: 1, since: Date.now() });
    } else {
      this.dispatchFailures.set(issueId, { count: existing.count + 1, since: existing.since });
    }
  }

  private resetDispatchFailures(issueId: string): void {
    this.dispatchFailures.delete(issueId);
  }

  // --------------------------------------------------------------------------
  // Dispatch
  // --------------------------------------------------------------------------

  private async dispatch(
    action: ReturnType<typeof triage>
  ): Promise<void> {
    switch (action.type) {
      case "dispatch_oracle":
        await this.dispatchOracle(action.issue);
        break;
      case "dispatch_titan":
        await this.dispatchTitan(action.issue, action.scoutComment);
        break;
      case "dispatch_sentinel":
        await this.dispatchSentinel(action.issue, action.scoutComment);
        break;
      case "skip":
        // Nothing to do — already running, complete, or concurrency limit reached
        break;
    }
  }

  private async dispatchOracle(issue: BeadsIssue): Promise<void> {
    const agentId = this.nextAgentId();
    const learnings = this.getRelevantLearnings(issue);

    // Pre-register with session=null to claim the concurrency slot BEFORE the
    // async spawn.  runningByIssueId() counts this agent immediately, so
    // subsequent iterations of the dispatch loop see an accurate running count
    // even when all spawns fail synchronously (e.g. auth error).
    const state = this.makeAgentState({
      id: agentId,
      caste: "oracle",
      issue,
      model: this.config.models.oracle,
      maxTurns: this.config.budgets.oracle_turns,
      maxTokens: this.config.budgets.oracle_tokens,
    });
    this.agents.set(agentId, { state, session: null });

    let session: AgentHandle;
    try {
      session = await spawner.spawnOracle(issue, learnings, this.config, this.agentsMd);
    } catch (err) {
      this.emit({
        type: "agent.spawn_failed",
        data: { caste: "oracle", issue_id: issue.id, error: String(err) },
        timestamp: Date.now(),
      });
      // Keep state.status as "running" so this slot continues to count in
      // runningByIssueId() for the rest of the current tick's dispatch loop.
      // reapCompleted() will mark it "failed" and clean it up.
      this.spawnPendingReap.add(agentId);
      return;
    }

    this.registerAgent(agentId, state, session);
    this.emit({
      type: "agent.spawned",
      data: { id: agentId, caste: "oracle", issue_id: issue.id, issue_title: issue.title, model: state.model },
      timestamp: Date.now(),
    });

    this.runSession(agentId, state, session, "Begin your assessment. Work through your instructions step by step.");
  }

  private async dispatchTitan(issue: BeadsIssue, _scoutComment: string): Promise<void> {
    const agentId = this.nextAgentId();
    const learnings = this.getRelevantLearnings(issue);

    // Pre-register to claim the concurrency slot before any async work.
    const state = this.makeAgentState({
      id: agentId,
      caste: "titan",
      issue,
      model: this.config.models.titan,
      maxTurns: this.config.budgets.titan_turns,
      maxTokens: this.config.budgets.titan_tokens,
    });
    this.agents.set(agentId, { state, session: null });

    // Create the git worktree Labor
    let laborPath: string;
    try {
      laborPath = await labors.create(issue.id, this.config, this.projectRoot);
    } catch (err) {
      this.emit({
        type: "labor.create_failed",
        data: { issue_id: issue.id, error: String(err) },
        timestamp: Date.now(),
      });
      this.spawnPendingReap.add(agentId);
      return;
    }

    // Update the pre-registered state with the labor path now that we have it.
    state.labor_path = laborPath;

    // Track that a Titan was dispatched for this issue so findClosedUnreviewed()
    // can limit Sentinel dispatch to session-dispatched issues (SPEC §3.1).
    this.titanDispatchedIssues.add(issue.id);

    let session: AgentHandle;
    try {
      session = await spawner.spawnTitan(issue, learnings, laborPath, this.config, this.agentsMd);
    } catch (err) {
      this.emit({
        type: "agent.spawn_failed",
        data: { caste: "titan", issue_id: issue.id, error: String(err) },
        timestamp: Date.now(),
      });
      this.spawnPendingReap.add(agentId);
      // Clean up the Labor we just created
      await labors.cleanup(issue.id, this.config, this.projectRoot).catch(() => undefined);
      return;
    }

    this.registerAgent(agentId, state, session);
    this.emit({
      type: "agent.spawned",
      data: {
        id: agentId,
        caste: "titan",
        issue_id: issue.id,
        issue_title: issue.title,
        model: state.model,
        labor_path: laborPath,
      },
      timestamp: Date.now(),
    });

    this.runSession(agentId, state, session, "Begin implementation. Work through your instructions step by step.");
  }

  private async dispatchSentinel(issue: BeadsIssue, _scoutComment: string): Promise<void> {
    const agentId = this.nextAgentId();
    const learnings = this.getRelevantLearnings(issue);

    // Pre-register to claim the concurrency slot before any async work.
    const state = this.makeAgentState({
      id: agentId,
      caste: "sentinel",
      issue,
      model: this.config.models.sentinel,
      maxTurns: this.config.budgets.sentinel_turns,
      maxTokens: this.config.budgets.sentinel_tokens,
    });
    this.agents.set(agentId, { state, session: null });

    let session: AgentHandle;
    try {
      session = await spawner.spawnSentinel(issue, learnings, this.config, this.agentsMd);
    } catch (err) {
      this.emit({
        type: "agent.spawn_failed",
        data: { caste: "sentinel", issue_id: issue.id, error: String(err) },
        timestamp: Date.now(),
      });
      this.spawnPendingReap.add(agentId);
      return;
    }

    this.registerAgent(agentId, state, session);
    this.emit({
      type: "agent.spawned",
      data: { id: agentId, caste: "sentinel", issue_id: issue.id, issue_title: issue.title, model: state.model },
      timestamp: Date.now(),
    });

    this.runSession(agentId, state, session, "Begin your review. Work through your instructions step by step.");
  }

  // --------------------------------------------------------------------------
  // Session management
  // --------------------------------------------------------------------------

  private registerAgent(agentId: string, state: AgentState, session: AgentHandle): void {
    // Update the pre-registered entry (session was null) with the live session.
    this.agents.set(agentId, { state, session });

    // Initialise the per-agent tool-call ring-buffer for §10.2 repeated detection.
    this.recentToolCalls.set(agentId, []);

    // Subscribe to session events to update turn counts and forward to SSE
    session.subscribe((event) => {
      // Track tool call fingerprints for SPEC §10.2 repeated-tool-call detection.
      if (event.type === "tool_execution_start") {
        const fingerprint = `${event.toolName}:${JSON.stringify(event.args)}`;
        const buf = this.recentToolCalls.get(agentId) ?? [];
        buf.push(fingerprint);
        // Keep only the last 3 entries (threshold for repeated detection).
        if (buf.length > 3) buf.shift();
        this.recentToolCalls.set(agentId, buf);
      }

      // Update turn counter and token stats on each completed turn
      if (event.type === "turn_end") {
        state.turns++;
        state.last_tool_call_at = Date.now();
        // Refresh cumulative cost and token usage
        try {
          const stats = session.getStats();
          state.tokens = stats.tokens.total;
          state.cost_usd = stats.cost;
        } catch {
          // getStats() may fail if session is shutting down
        }

        // Real-time budget enforcement — kill immediately on the turn boundary
        // rather than waiting for the next poll tick (which may never arrive if
        // the session has already completed between ticks).
        if (state.status === "running") {
          const budget = monitor.checkBudget({ state }, this.config);
          if (budget.exceeded) {
            state.status = "killed";
            this.emit({
              type: "agent.budget_exceeded",
              data: {
                agent_id: agentId,
                resource: budget.resource,
                current: budget.current,
                limit: budget.limit,
              },
              timestamp: Date.now(),
            });
            void session.abort().catch(() => undefined);
          }
        }
      }

      // Forward events to the SSE bus
      this.emit({
        type: `agent.session.${event.type}`,
        data: { agent_id: agentId, issue_id: state.issue_id },
        timestamp: Date.now(),
      });
    });

    // Emit monitor tracking started
    monitor.track({ state }, this.config, (ev) => this.emit(ev));
  }

  /**
   * Fire-and-forget: kick off the agent's initial prompt.
   * Marks the state as completed/failed when the promise settles.
   */
  private runSession(
    agentId: string,
    state: AgentState,
    session: AgentHandle,
    initialPrompt: string
  ): void {
    void session
      .prompt(initialPrompt)
      .then(() => {
        if (state.status === "running") {
          state.status = "completed";
        }
      })
      .catch((err: unknown) => {
        if (state.status === "running") {
          state.status = "failed";
          console.error(`[aegis] Agent ${agentId} (${state.caste}) error:`, err);
        }
      });
  }

  // --------------------------------------------------------------------------
  // REAP
  // --------------------------------------------------------------------------

  private async reapCompleted(): Promise<void> {
    const toReap: string[] = [];
    for (const [agentId, { state }] of this.agents) {
      if (this.reaped.has(agentId)) continue;
      // Normal completion / kill / budget-exceeded
      if (state.status !== "running") {
        toReap.push(agentId);
        continue;
      }
      // Spawn failed — held as "running" to preserve the concurrency slot
      // for the tick; now mark failed and schedule for reap.
      if (this.spawnPendingReap.has(agentId)) {
        state.status = "failed";
        toReap.push(agentId);
      }
    }
    for (const agentId of toReap) {
      await this.reap(agentId);
    }
  }

  private async reap(agentId: string): Promise<void> {
    if (this.reaped.has(agentId)) return;
    this.reaped.add(agentId);
    this.spawnPendingReap.delete(agentId);

    const agent = this.agents.get(agentId);
    if (!agent) return;
    const { state } = agent;

    this.emit({
      type: "agent.reaped",
      data: {
        id: agentId,
        caste: state.caste,
        issue_id: state.issue_id,
        status: state.status,
        cost_usd: state.cost_usd,
        turns: state.turns,
        tokens: state.tokens,
      },
      timestamp: Date.now(),
    });

    // Verify agent completion criteria per SPEC §4.2/§4.3/§4.4 (aegis-qgm).
    // If the agent "completed" but didn't achieve its expected outcome, mark as failed.
    if (state.status === "completed") {
      try {
        const issue = await beads.show(state.issue_id);
        if (state.caste === "oracle") {
          const hasScouted = issue.comments.some((c) => c.body.startsWith("SCOUTED:"));
          if (!hasScouted) {
            state.status = "failed";
          }
        } else if (state.caste === "titan") {
          if (issue.status !== "closed") {
            state.status = "failed";
          }
        } else if (state.caste === "sentinel") {
          const hasReviewed = issue.comments.some((c) => c.body.startsWith("REVIEWED:"));
          if (!hasReviewed) {
            state.status = "failed";
          }
        }
      } catch {
        // beads unavailable — skip verification
      }
    }

    // Update dispatch failure tracking (aegis-0in).
    // Consolidating here (instead of per-spawn-path) ensures budget-killed and
    // stuck-killed agents also count toward the backoff window.
    if (state.status === "killed" || state.status === "failed") {
      this.recordDispatchFailure(state.issue_id);
    } else if (state.status === "completed") {
      this.resetDispatchFailures(state.issue_id);
    }

    // Mark failed/killed agent issues back to open so they re-enter the
    // dispatch queue (SPEC §3.1 REAP — aegis-dos).
    if (state.status === "killed" || state.status === "failed") {
      try {
        await beads.reopen(state.issue_id);
      } catch {
        // Best-effort — issue may already be open or beads unavailable
      }
    }

    // For Titans: merge Labor back into main
    if (state.caste === "titan" && state.labor_path !== null) {
      await this.reapTitanLabor(state);
    }

    // Handle failure: record a learning so future agents know
    if (state.status === "killed" || state.status === "failed") {
      try {
        mnemo.append(
          {
            type: "failure",
            domain: state.caste,
            text: `Agent ${agentId} (${state.caste}) on ${state.issue_id} ended with status "${state.status}". May need investigation.`,
            source: agentId,
            issue: state.issue_id,
          },
          this.projectRoot
        );
      } catch {
        // ignore mnemosyne write failures
      }
    }

    // Post-process any raw Mnemosyne entries the agent wrote during the session
    await this.postProcessMnemosyne(agentId, state.issue_id);

    // Prune Mnemosyne if over budget
    try {
      const records = mnemo.load(this.projectRoot);
      if (shouldPrune(records, this.config.mnemosyne.max_records)) {
        const pruned = prune(records, this.config.mnemosyne.max_records);
        this.saveMnemosyne(pruned);
      }
    } catch {
      // ignore
    }

    // Accumulate cost before removing from active map so totalCost() never drops
    this.cumulativeCostUsd += state.cost_usd;

    // Remove agent from active map (slot is now free)
    this.agents.delete(agentId);
    this.recentToolCalls.delete(agentId);

    // Auto-advance process() cycle if this issue is being processed.
    if (state.status === "completed" && this.processQueue.has(state.issue_id)) {
      void this.advanceProcess(state.issue_id).catch(() => {
        this.processQueue.delete(state.issue_id);
      });
    }
  }

  private async reapTitanLabor(state: AgentState): Promise<void> {
    let mergeResult: { success: boolean; conflict?: string };
    try {
      mergeResult = await labors.merge(state.issue_id, this.config, this.projectRoot);
    } catch (err) {
      mergeResult = { success: false, conflict: String(err) };
    }

    if (mergeResult.success) {
      this.emit({
        type: "labor.merged",
        data: { issue_id: state.issue_id },
        timestamp: Date.now(),
      });
      // Clean up worktree + branch
      await labors.cleanup(state.issue_id, this.config, this.projectRoot).catch(() => undefined);
    } else {
      this.emit({
        type: "labor.conflict",
        data: { issue_id: state.issue_id, conflict: mergeResult.conflict },
        timestamp: Date.now(),
      });
      // File a beads issue so the conflict can be resolved
      try {
        await beads.create({
          title: `Merge conflict: aegis/${state.issue_id}`,
          description:
            `Merge conflict integrating Titan's changes for ${state.issue_id}.\n\n` +
            `Conflict details: ${mergeResult.conflict ?? "unknown"}\n\n` +
            `Branch aegis/${state.issue_id} has been preserved for manual resolution.`,
          type: "bug",
          priority: 1,
        });
      } catch {
        // ignore — beads may be unavailable
      }
    }
  }

  // --------------------------------------------------------------------------
  // Mnemosyne helpers
  // --------------------------------------------------------------------------

  private async postProcessMnemosyne(agentId: string, issueId: string): Promise<void> {
    try {
      const records = mnemo.load(this.projectRoot);
      const incomplete = records.filter((r) => !r.id || !r.source);
      if (incomplete.length === 0) return;

      const processed = mnemo.postProcess(incomplete, agentId, issueId);

      // Rebuild: swap out incomplete records for their processed versions
      const processedByText = new Map(processed.map((p) => [`${p.domain}:${p.text}`, p]));
      const updated = records.map((r) => {
        if (!r.id || !r.source) {
          return processedByText.get(`${r.domain}:${r.text}`) ?? r;
        }
        return r;
      });

      this.saveMnemosyne(updated);
    } catch {
      // Non-fatal — Mnemosyne write failures should not crash the orchestrator
    }
  }

  private saveMnemosyne(records: MnemosyneRecord[]): void {
    const filePath = join(this.projectRoot, ".aegis/mnemosyne.jsonl");
    const content =
      records.map((r) => JSON.stringify(r)).join("\n") +
      (records.length > 0 ? "\n" : "");
    writeFileSync(filePath, content, "utf8");
  }

  private getRelevantLearnings(issue: BeadsIssue): MnemosyneRecord[] {
    const records = mnemo.load(this.projectRoot);
    const text = `${issue.title} ${issue.description}`.toLowerCase();
    const domain = this.extractDomain(text);
    return mnemo.filter(records, domain, this.config.mnemosyne.context_budget_tokens);
  }

  private extractDomain(text: string): string {
    const keywords = [
      "test", "auth", "config", "server", "api", "database", "db",
      "ui", "monitor", "beads", "labor", "triage", "poller", "mnemosyne",
      "lethe", "spawner", "typescript", "react", "vite",
    ];
    for (const kw of keywords) {
      if (text.includes(kw)) return kw;
    }
    return "";
  }

  // --------------------------------------------------------------------------
  // Polling helpers
  // --------------------------------------------------------------------------

  /**
   * Fetch full issue details (with comments) for a list of issue IDs.
   * Calls bd show for each; skips issues that fail to fetch.
   */
  private async fetchFullIssues(ids: string[]): Promise<BeadsIssue[]> {
    const settled = await Promise.allSettled(ids.map((id) => beads.show(id)));
    return settled
      .filter((r): r is PromiseFulfilledResult<BeadsIssue> => r.status === "fulfilled")
      .map((r) => r.value);
  }

  /**
   * Find closed issues that need a Sentinel review.
   * Only checks issues whose Titan was dispatched by this session (SPEC §3.1)
   * to avoid dispatching Sentinels for issues closed manually or outside Aegis.
   */
  private async findClosedUnreviewed(): Promise<BeadsIssue[]> {
    if (this.titanDispatchedIssues.size === 0) return [];

    const candidates = await this.fetchFullIssues([...this.titanDispatchedIssues]);
    return candidates.filter(
      (i) =>
        i.status === "closed" &&
        !i.comments.some((c) => c.body.startsWith("REVIEWED:"))
    );
  }

  /**
   * Advance a process()-managed issue to its next dispatch stage.
   * Called from reap() when an agent for the issue completes successfully.
   */
  private async advanceProcess(issueId: string): Promise<void> {
    const issue = await beads.show(issueId);
    const action = triage(issue, this.runningByIssueId(), this.config.concurrency);
    if (action.type !== "skip") {
      await this.dispatch(action);
    } else if (
      issue.status === "closed" &&
      issue.comments.some((c) => c.body.startsWith("REVIEWED:"))
    ) {
      // Full cycle complete — remove from process queue
      this.processQueue.delete(issueId);
    }
    // Otherwise: still waiting (e.g., concurrency limit hit). Will retry on next reap.
  }

  private dedupById(issues: BeadsIssue[]): BeadsIssue[] {
    const seen = new Set<string>();
    return issues.filter((i) => {
      if (seen.has(i.id)) return false;
      seen.add(i.id);
      return true;
    });
  }

  // --------------------------------------------------------------------------
  // Utility
  // --------------------------------------------------------------------------

  private runningByIssueId(): Map<string, AgentState> {
    const m = new Map<string, AgentState>();
    for (const { state } of this.agents.values()) {
      if (state.status === "running") {
        m.set(state.issue_id, state);
      }
    }
    return m;
  }

  private makeAgentState(opts: {
    id: string;
    caste: AgentState["caste"];
    issue: BeadsIssue;
    model: string;
    maxTurns: number;
    maxTokens: number;
    laborPath?: string;
  }): AgentState {
    return {
      id: opts.id,
      caste: opts.caste,
      issue_id: opts.issue.id,
      issue_title: opts.issue.title,
      model: opts.model,
      turns: 0,
      max_turns: opts.maxTurns,
      tokens: 0,
      max_tokens: opts.maxTokens,
      cost_usd: 0,
      started_at: Date.now(),
      last_tool_call_at: Date.now(),
      status: "running",
      labor_path: opts.laborPath ?? null,
    };
  }

  private nextAgentId(): string {
    return `agent-${++this.agentCounter}`;
  }

  private totalCost(): number {
    let total = this.cumulativeCostUsd;
    for (const { state } of this.agents.values()) {
      total += state.cost_usd;
    }
    return total;
  }

  private emit(event: SSEEvent): void {
    for (const handler of this.eventListeners) {
      try {
        handler(event);
      } catch {
        // Never let a handler crash the orchestrator
      }
    }
  }

  private loadAgentsMd(): string {
    const p = join(this.projectRoot, "AGENTS.md");
    return existsSync(p) ? readFileSync(p, "utf8") : "";
  }
}
