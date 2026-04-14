import { randomUUID } from "node:crypto";

import type {
  AgentRuntime,
  RuntimeLaunchInput,
  RuntimeLaunchResult,
} from "./agent-runtime.js";
import { readSessionReport, writeSessionReport } from "./session-report.js";

export class PhaseDShellRuntime implements AgentRuntime {
  async launch(input: RuntimeLaunchInput): Promise<RuntimeLaunchResult> {
    const sessionId = randomUUID();
    const startedAt = new Date().toISOString();

    void input;
    writeSessionReport(input.root, {
      sessionId,
      status: "succeeded",
      finishedAt: startedAt,
    });

    return {
      sessionId,
      startedAt,
    };
  }

  async readSession(root: string, sessionId: string) {
    return readSessionReport(root, sessionId);
  }

  async terminate(root: string, sessionId: string, reason: string) {
    const finishedAt = new Date().toISOString();
    const snapshot = {
      sessionId,
      status: "failed" as const,
      finishedAt,
      error: reason,
    };

    writeSessionReport(root, snapshot);
    return snapshot;
  }
}

class UnsupportedPiRuntime implements AgentRuntime {
  async launch(_input: RuntimeLaunchInput): Promise<RuntimeLaunchResult> {
    throw new Error("The pi runtime dispatch path returns in Phase E. Use phase_d_shell for deterministic Phase D proof runs.");
  }

  async readSession() {
    return null;
  }

  async terminate(_root: string, sessionId: string, reason: string) {
    return {
      sessionId,
      status: "failed" as const,
      finishedAt: new Date().toISOString(),
      error: reason,
    };
  }
}

export function createAgentRuntime(runtime: string): AgentRuntime {
  if (runtime === "phase_d_shell") {
    return new PhaseDShellRuntime();
  }

  if (runtime === "pi") {
    return new UnsupportedPiRuntime();
  }

  throw new Error(`Unsupported runtime adapter: ${runtime}`);
}
