import { randomUUID } from "node:crypto";
import path from "node:path";

import type {
  AgentRuntime,
  RuntimeLaunchInput,
  RuntimeLaunchResult,
} from "./agent-runtime.js";
import {
  terminateCodexSessionProcesses,
} from "./codex-caste-runtime.js";
import { terminateWorkspaceProcesses as terminatePiWorkspaceProcesses } from "./pi-caste-runtime.js";
import { loadConfig } from "../config/load-config.js";
import { loadDispatchState } from "../core/dispatch-state.js";
import { readSessionReport, writeSessionReport } from "./session-report.js";
import { runCasteCommand } from "../core/caste-runner.js";
import { createCasteRuntime } from "./create-caste-runtime.js";
import { BeadsTrackerClient } from "../tracker/beads-tracker.js";

type DispatchRuntimeMode = "scripted" | "pi" | "codex";
type DispatchAction = "scout" | "implement" | "review";

const TERMINATED_SESSIONS = new Set<string>();
const SESSION_CONTEXTS = new Map<string, {
  root: string;
  issueId: string;
  caste: RuntimeLaunchInput["caste"];
  mode: DispatchRuntimeMode;
}>();

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

class CasteDispatchRuntime implements AgentRuntime {
  constructor(private readonly mode: DispatchRuntimeMode) {}

  async launch(input: RuntimeLaunchInput): Promise<RuntimeLaunchResult> {
    const sessionId = randomUUID();
    const startedAt = new Date().toISOString();

    SESSION_CONTEXTS.set(sessionId, {
      root: input.root,
      issueId: input.issueId,
      caste: input.caste,
      mode: this.mode,
    });
    writeSessionReport(input.root, {
      sessionId,
      status: "running",
    });

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

    try {
      const action = resolveDispatchAction(input);
      await runCasteCommand({
        root: input.root,
        action,
        issueId: input.issueId,
        tracker: new BeadsTrackerClient(),
        runtime: createCasteRuntime(this.mode, {}, {
          root: input.root,
          issueId: input.issueId,
        }),
        artifactEmissionMode: this.mode === "pi" ? "tool" : "json",
      });

      if (TERMINATED_SESSIONS.has(sessionId)) {
        return;
      }

      writeSessionReport(input.root, {
        sessionId,
        status: "succeeded",
        finishedAt: new Date().toISOString(),
      });
    } catch (error) {
      if (TERMINATED_SESSIONS.has(sessionId)) {
        return;
      }

      const detail = error instanceof Error ? error.message : String(error);
      writeSessionReport(input.root, toFailureSnapshot(sessionId, detail));
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
    terminateAdapterSessionProcesses({
      root,
      sessionId,
      mode: this.mode,
    });
    const snapshot = toFailureSnapshot(sessionId, reason);
    writeSessionReport(root, snapshot);
    return snapshot;
  }
}

function resolveSessionRecord(root: string, sessionId: string) {
  const state = loadDispatchState(root);
  return Object.values(state.records)
    .find((record) => record.runningAgent?.sessionId === sessionId)
    ?? null;
}

function resolveSessionIssueId(root: string, sessionId: string) {
  const context = SESSION_CONTEXTS.get(sessionId);
  if (context && context.root === root) {
    return context.issueId;
  }

  return resolveSessionRecord(root, sessionId)?.issueId ?? null;
}

function resolveCodexSessionWorkspace(root: string, sessionId: string) {
  const context = SESSION_CONTEXTS.get(sessionId);
  if (context?.root === root && context.caste === "oracle") {
    return root;
  }

  const record = resolveSessionRecord(root, sessionId);
  if (record?.runningAgent?.caste === "oracle") {
    return root;
  }

  const issueId = resolveSessionIssueId(root, sessionId);
  if (!issueId) {
    return null;
  }

  const config = loadConfig(root);
  return path.join(root, config.labor.base_path, issueId);
}

function terminateAdapterSessionProcesses(input: {
  root: string;
  sessionId: string;
  mode: DispatchRuntimeMode;
}) {
  if (input.mode !== "codex" && input.mode !== "pi") {
    return;
  }

  const workspace = resolveCodexSessionWorkspace(input.root, input.sessionId);
  if (!workspace) {
    return;
  }

  const terminateWorkspaceProcesses = input.mode === "pi"
    ? terminatePiWorkspaceProcesses
    : terminateCodexSessionProcesses;
  terminateWorkspaceProcesses(workspace);
}

export class ScriptedAgentRuntime implements AgentRuntime {
  private readonly runtime = new CasteDispatchRuntime("scripted");

  async launch(input: RuntimeLaunchInput) {
    return this.runtime.launch(input);
  }

  async readSession(root: string, sessionId: string) {
    return this.runtime.readSession(root, sessionId);
  }

  async terminate(root: string, sessionId: string, reason: string) {
    return this.runtime.terminate(root, sessionId, reason);
  }
}

class PiAgentRuntime implements AgentRuntime {
  private readonly runtime = new CasteDispatchRuntime("pi");

  async launch(input: RuntimeLaunchInput) {
    return this.runtime.launch(input);
  }

  async readSession(root: string, sessionId: string) {
    return this.runtime.readSession(root, sessionId);
  }

  async terminate(root: string, sessionId: string, reason: string) {
    return this.runtime.terminate(root, sessionId, reason);
  }
}

class CodexAgentRuntime implements AgentRuntime {
  private readonly runtime = new CasteDispatchRuntime("codex");

  async launch(input: RuntimeLaunchInput) {
    return this.runtime.launch(input);
  }

  async readSession(root: string, sessionId: string) {
    return this.runtime.readSession(root, sessionId);
  }

  async terminate(root: string, sessionId: string, reason: string) {
    return this.runtime.terminate(root, sessionId, reason);
  }
}

export function createAgentRuntime(runtime: string): AgentRuntime {
  if (runtime === "scripted") {
    return new ScriptedAgentRuntime();
  }

  if (runtime === "pi") {
    return new PiAgentRuntime();
  }

  if (runtime === "codex") {
    return new CodexAgentRuntime();
  }

  throw new Error(`Unsupported runtime adapter: ${runtime}`);
}
