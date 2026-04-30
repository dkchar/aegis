import path from "node:path";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";

import { initProject } from "../../../src/config/init-project.js";

const tempRoots: string[] = [];

function createTempRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "aegis-scripted-agent-runtime-"));
  tempRoots.push(root);
  return root;
}

async function waitForSession(
  runtime: { readSession(root: string, sessionId: string): Promise<{ status: string } | null> },
  root: string,
  sessionId: string,
) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const snapshot = await runtime.readSession(root, sessionId);
    if (snapshot && snapshot.status !== "running") {
      return snapshot;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
  }

  throw new Error(`Timed out waiting for session ${sessionId}`);
}

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();

  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("createAgentRuntime(scripted)", () => {
  it("persists the Oracle artifact ref before the background session reports success", async () => {
    const root = createTempRoot();
    initProject(root);
    writeFileSync(
      path.join(root, ".aegis", "config.json"),
      `${JSON.stringify({
        runtime: "scripted",
        models: {
          oracle: "openai-codex:gpt-5.4-mini",
          titan: "openai-codex:gpt-5.4-mini",
          sentinel: "openai-codex:gpt-5.4-mini",
          janus: "openai-codex:gpt-5.4-mini",
        },
        thinking: {
          oracle: "medium",
          titan: "medium",
          sentinel: "medium",
          janus: "medium",
        },
        concurrency: {
          max_agents: 1,
          max_oracles: 1,
          max_titans: 1,
          max_sentinels: 1,
          max_janus: 1,
        },
        thresholds: {
          poll_interval_seconds: 5,
          stuck_warning_seconds: 240,
          stuck_kill_seconds: 600,
          allow_complex_auto_dispatch: false,
          scope_overlap_threshold: 0,
          janus_retry_threshold: 2,
        },
        janus: {
          enabled: true,
          max_invocations_per_issue: 1,
        },
        labor: {
          base_path: ".aegis/labors",
        },
        git: {
          base_branch: "main",
        },
      }, null, 2)}\n`,
      "utf8",
    );

    vi.doMock("../../../src/tracker/beads-tracker.js", () => ({
      BeadsTrackerClient: class {
        async getIssue() {
          return {
            id: "ISSUE-1",
            title: "Example",
            description: "Desc",
            issueClass: "primary",
            status: "open",
            priority: 1,
            blockers: [],
            parentId: null,
            childIds: [],
            labels: [],
          };
        }
      },
    }));

    const { createAgentRuntime } = await import("../../../src/runtime/scripted-agent-runtime.js");
    const { saveDispatchState } = await import("../../../src/core/dispatch-state.js");
    const runtime = createAgentRuntime("scripted");

    const launched = await runtime.launch({
      root,
      issueId: "ISSUE-1",
      title: "Example",
      caste: "oracle",
      stage: "scouting",
    });

    saveDispatchState(root, {
      schemaVersion: 1,
      records: {
        "ISSUE-1": {
          issueId: "ISSUE-1",
          stage: "scouting",
          runningAgent: {
            caste: "oracle",
            sessionId: launched.sessionId,
            startedAt: launched.startedAt,
          },
          oracleAssessmentRef: null,
          sentinelVerdictRef: null,
          fileScope: null,
          failureCount: 0,
          consecutiveFailures: 0,
          failureWindowStartMs: null,
          cooldownUntil: null,
          sessionProvenanceId: "daemon-1",
          updatedAt: launched.startedAt,
        },
      },
    });

    const snapshot = await waitForSession(runtime, root, launched.sessionId);
    expect(snapshot?.status).toBe("succeeded");

    const state = JSON.parse(
      readFileSync(path.join(root, ".aegis", "dispatch-state.json"), "utf8"),
    ) as {
      records: Record<string, { oracleAssessmentRef: string | null }>;
    };

    expect(state.records["ISSUE-1"]?.oracleAssessmentRef).toBeTruthy();
  });
});

describe("createAgentRuntime(codex)", () => {
  it("terminates processes rooted in the issue labor workspace", async () => {
    const root = createTempRoot();
    initProject(root);
    const terminateCodexSessionProcesses = vi.fn();

    vi.doMock("../../../src/runtime/codex-caste-runtime.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../../../src/runtime/codex-caste-runtime.js")>();
      return {
        ...actual,
        terminateCodexSessionProcesses,
      };
    });

    const { createAgentRuntime } = await import("../../../src/runtime/scripted-agent-runtime.js");
    const runtime = createAgentRuntime("codex");
    const launched = await runtime.launch({
      root,
      issueId: "ISSUE-1",
      title: "Example",
      caste: "titan",
      stage: "implementing",
    });

    await runtime.terminate(root, launched.sessionId, "test kill");

    expect(terminateCodexSessionProcesses).toHaveBeenCalledWith(
      path.join(root, ".aegis", "labors", "ISSUE-1"),
    );
    expect(await runtime.readSession(root, launched.sessionId)).toMatchObject({
      status: "failed",
      error: "test kill",
    });
  });

  it("terminates Oracle sessions rooted at the repository", async () => {
    const root = createTempRoot();
    initProject(root);
    const terminateCodexSessionProcesses = vi.fn();

    vi.doMock("../../../src/runtime/codex-caste-runtime.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../../../src/runtime/codex-caste-runtime.js")>();
      return {
        ...actual,
        terminateCodexSessionProcesses,
      };
    });

    const { createAgentRuntime } = await import("../../../src/runtime/scripted-agent-runtime.js");
    const runtime = createAgentRuntime("codex");
    const launched = await runtime.launch({
      root,
      issueId: "ISSUE-1",
      title: "Example",
      caste: "oracle",
      stage: "scouting",
    });

    await runtime.terminate(root, launched.sessionId, "test kill");

    expect(terminateCodexSessionProcesses).toHaveBeenCalledWith(root);
  });

  it("terminates persisted Oracle sessions at the repository after daemon restart", async () => {
    const root = createTempRoot();
    initProject(root);
    const terminateCodexSessionProcesses = vi.fn();

    vi.doMock("../../../src/runtime/codex-caste-runtime.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../../../src/runtime/codex-caste-runtime.js")>();
      return {
        ...actual,
        terminateCodexSessionProcesses,
      };
    });

    const { createAgentRuntime } = await import("../../../src/runtime/scripted-agent-runtime.js");
    const { saveDispatchState } = await import("../../../src/core/dispatch-state.js");
    saveDispatchState(root, {
      schemaVersion: 1,
      records: {
        "ISSUE-1": {
          issueId: "ISSUE-1",
          stage: "scouting",
          runningAgent: {
            caste: "oracle",
            sessionId: "persisted-session",
            startedAt: "2026-04-29T10:00:00.000Z",
          },
          oracleAssessmentRef: null,
          sentinelVerdictRef: null,
          fileScope: null,
          failureCount: 0,
          consecutiveFailures: 0,
          failureWindowStartMs: null,
          cooldownUntil: null,
          sessionProvenanceId: "old-daemon",
          updatedAt: "2026-04-29T10:00:00.000Z",
        },
      },
    });

    const runtime = createAgentRuntime("codex");
    await runtime.terminate(root, "persisted-session", "test kill");

    expect(terminateCodexSessionProcesses).toHaveBeenCalledWith(root);
  });
});

describe("createAgentRuntime(pi)", () => {
  it("terminates Pi sessions rooted in the issue labor workspace", async () => {
    const root = createTempRoot();
    initProject(root);
    const terminateWorkspaceProcesses = vi.fn();

    vi.doMock("../../../src/runtime/pi-caste-runtime.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../../../src/runtime/pi-caste-runtime.js")>();
      return {
        ...actual,
        terminateWorkspaceProcesses,
      };
    });

    const { createAgentRuntime } = await import("../../../src/runtime/scripted-agent-runtime.js");
    const runtime = createAgentRuntime("pi");
    const launched = await runtime.launch({
      root,
      issueId: "ISSUE-1",
      title: "Example",
      caste: "titan",
      stage: "implementing",
    });

    await runtime.terminate(root, launched.sessionId, "test kill");

    expect(terminateWorkspaceProcesses).toHaveBeenCalledWith(
      path.join(root, ".aegis", "labors", "ISSUE-1"),
    );
  });
});
