import { randomUUID } from "node:crypto";
import path from "node:path";

import type {
  AgentRuntime,
  RuntimeLaunchInput,
  RuntimeLaunchResult,
} from "./agent-runtime.js";
import { terminateClaudeSessionProcesses } from "./claude-caste-runtime.js";
import { terminateCodexSessionProcesses } from "./codex-caste-runtime.js";
import { terminatePiSessionProcesses } from "./pi-caste-runtime.js";
import {
  assertRuntimeAdapterName,
  resolveArtifactEmissionMode,
  type RuntimeAdapterName,
} from "./runtime-registry.js";
import { loadConfig } from "../config/load-config.js";
import { loadDispatchState } from "../core/dispatch-state.js";
import { appendSessionStream, readSessionReport, writeSessionReport } from "./session-report.js";
import { runCasteCommand } from "../core/caste-runner.js";
import { createCasteRuntime } from "./create-caste-runtime.js";
import { createTrackerClient } from "../tracker/create-tracker.js";

type DispatchAction = "scout" | "implement" | "review";

interface SessionContext {
  root: string;
  issueId: string;
  caste: RuntimeLaunchInput["caste"];
}

// Sessions run inside the daemon process, so abort bookkeeping stays in memory.
// Persisted dispatch state covers sessions from a previous daemon.
const TERMINATED_SESSIONS = new Set<string>();
const SESSION_CONTEXTS = new Map<string, SessionContext>();

const SESSION_PROCESS_TERMINATORS: Partial<Record<RuntimeAdapterName, (workspace: string) => void>> = {
  pi: terminatePiSessionProcesses,
  codex: terminateCodexSessionProcesses,
  claude: terminateClaudeSessionProcesses,
};

function resolveDispatchAction(input: RuntimeLaunchInput): DispatchAction {
  if (input.caste === "oracle" && input.stage === "scouting") {
    return "scout";
  }

  if (input.caste === "titan" && input.stage === "implementing") {
    return "implement";
  }

  if (input.caste === "sentinel" && input.stage === "reviewing") {
    return "review";
  }

  throw new Error(
    `Unsupported dispatch launch tuple caste=${input.caste} stage=${input.stage}.`,
  );
}

function toFailureSnapshot(sessionId: string, reason: string) {
  return {
    sessionId,
    status: "failed" as const,
    finishedAt: new Date().toISOString(),
    error: reason,
  };
}

function findSessionRecord(root: string, sessionId: string) {
  return Object.values(loadDispatchState(root).records)
    .find((record) => record.runningAgent?.sessionId === sessionId)
    ?? null;
}

/** Oracle scouts the project root; every other caste works in its labor. */
function resolveSessionWorkspace(root: string, sessionId: string) {
  const context = SESSION_CONTEXTS.get(sessionId);
  const liveContext = context?.root === root ? context : null;
  const record = liveContext ? null : findSessionRecord(root, sessionId);
  const caste = liveContext?.caste ?? record?.runningAgent?.caste ?? null;
  const issueId = liveContext?.issueId ?? record?.issueId ?? null;

  if (caste === "oracle") {
    return root;
  }
  if (!issueId) {
    return null;
  }

  return path.join(root, loadConfig(root).labor.base_path, issueId);
}

/**
 * Daemon-facing runtime: `launch` returns immediately with a session id and
 * runs the caste command in the background; `readSession` reports the
 * durable session report written when the command settles. Adapter activity
 * streams to `.aegis/logs/session-streams/<id>.log` while the session runs.
 */
export class CasteDispatchRuntime implements AgentRuntime {
  constructor(private readonly mode: RuntimeAdapterName) {}

  async launch(input: RuntimeLaunchInput): Promise<RuntimeLaunchResult> {
    const sessionId = randomUUID();
    const startedAt = new Date().toISOString();

    SESSION_CONTEXTS.set(sessionId, {
      root: input.root,
      issueId: input.issueId,
      caste: input.caste,
    });
    writeSessionReport(input.root, {
      sessionId,
      status: "running",
    });
    appendSessionStream(
      input.root,
      sessionId,
      `[session] start issue=${input.issueId} caste=${input.caste} stage=${input.stage} runtime=${this.mode}`,
    );

    setImmediate(() => {
      void this.executeLaunch(input, sessionId);
    });

    return {
      sessionId,
      startedAt,
    };
  }

  private async executeLaunch(input: RuntimeLaunchInput, sessionId: string) {
    if (TERMINATED_SESSIONS.has(sessionId)) {
      return;
    }

    const isLive = () => !TERMINATED_SESSIONS.has(sessionId);
    try {
      const result = await runCasteCommand({
        root: input.root,
        action: resolveDispatchAction(input),
        issueId: input.issueId,
        tracker: createTrackerClient(),
        runtime: createCasteRuntime(this.mode, {}, {
          root: input.root,
          issueId: input.issueId,
        }),
        artifactEmissionMode: resolveArtifactEmissionMode(this.mode),
        onActivity: (line) => {
          if (isLive()) {
            appendSessionStream(input.root, sessionId, line);
          }
        },
      });

      if (isLive()) {
        appendSessionStream(input.root, sessionId, `[session] succeeded stage=${result.stage}`);
        writeSessionReport(input.root, {
          sessionId,
          status: "succeeded",
          finishedAt: new Date().toISOString(),
        });
      }
    } catch (error) {
      if (isLive()) {
        const detail = error instanceof Error ? error.message : String(error);
        appendSessionStream(input.root, sessionId, `[session] failed ${detail}`);
        writeSessionReport(input.root, toFailureSnapshot(sessionId, detail));
      }
    } finally {
      TERMINATED_SESSIONS.delete(sessionId);
      SESSION_CONTEXTS.delete(sessionId);
    }
  }

  async readSession(root: string, sessionId: string) {
    return readSessionReport(root, sessionId);
  }

  async terminate(root: string, sessionId: string, reason: string) {
    TERMINATED_SESSIONS.add(sessionId);
    const terminateProcesses = SESSION_PROCESS_TERMINATORS[this.mode];
    const workspace = terminateProcesses ? resolveSessionWorkspace(root, sessionId) : null;
    if (terminateProcesses && workspace) {
      terminateProcesses(workspace);
    }

    const snapshot = toFailureSnapshot(sessionId, reason);
    appendSessionStream(root, sessionId, `[session] terminated ${reason}`);
    writeSessionReport(root, snapshot);
    return snapshot;
  }
}

export function createAgentRuntime(runtime: string): AgentRuntime {
  return new CasteDispatchRuntime(assertRuntimeAdapterName(runtime));
}
