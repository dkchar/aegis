import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";

import { runCasteCommand } from "../../../src/core/caste-runner.js";
import { loadDispatchState, saveDispatchState, type DispatchRecord } from "../../../src/core/dispatch-state.js";
import { reapFinishedWork } from "../../../src/core/reaper.js";
import { ScriptedCasteRuntime } from "../../../src/runtime/scripted-caste-runtime.js";
import type { AgentRuntime } from "../../../src/runtime/agent-runtime.js";
import type { AegisIssue } from "../../../src/tracker/issue-model.js";

const tempRoots: string[] = [];

function createTempRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "aegis-retry-accounting-"));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function createIssue(issueId: string): AegisIssue {
  return {
    id: issueId,
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

function scoutedRecord(issueId: string, overrides: Partial<DispatchRecord> = {}): DispatchRecord {
  return {
    issueId,
    stage: "scouted",
    runningAgent: null,
    oracleAssessmentRef: path.join(".aegis", "oracle", `${issueId}.json`),
    sentinelVerdictRef: null,
    fileScope: null,
    failureCount: 0,
    consecutiveFailures: 0,
    failureWindowStartMs: null,
    cooldownUntil: null,
    sessionProvenanceId: "test",
    updatedAt: "2026-05-01T09:00:00.000Z",
    ...overrides,
  };
}

describe("operational retry accounting", () => {
  it("counts a Titan failure outcome toward the retry ceiling", async () => {
    const root = createTempRoot();
    saveDispatchState(root, { schemaVersion: 1, records: { "AG-1": scoutedRecord("AG-1") } });

    const result = await runCasteCommand({
      root,
      action: "implement",
      issueId: "AG-1",
      tracker: { getIssue: vi.fn(async () => createIssue("AG-1")) },
      runtime: new ScriptedCasteRuntime({
        titan: () => ({
          output: JSON.stringify({
            outcome: "failure",
            summary: "build tooling is missing",
            files_changed: [],
            tests_and_checks_run: ["npm run build"],
            known_risks: [],
            follow_up_work: [],
          }),
        }),
      }),
      resolveBaseBranch: () => "main",
      resolveLaborBasePath: () => ".aegis/labors",
      ensureLabor: vi.fn(),
      now: "2026-05-01T10:00:00.000Z",
    });

    expect(result.stage).toBe("failed_operational");
    expect(loadDispatchState(root).records["AG-1"]).toMatchObject({
      stage: "failed_operational",
      failureCount: 1,
      consecutiveFailures: 1,
      operationalFailureKind: "runtime_failure",
      failureTranscriptRef: path.join(".aegis", "transcripts", "AG-1--titan.json"),
    });
    expect(loadDispatchState(root).records["AG-1"]?.cooldownUntil).toBeTruthy();
  });

  it("keeps failure accounting when the session succeeded but recorded a failure", async () => {
    const root = createTempRoot();
    const running = scoutedRecord("AG-2", {
      stage: "implementing",
      runningAgent: { caste: "titan", sessionId: "session-2", startedAt: "2026-05-01T09:00:00.000Z" },
    });
    saveDispatchState(root, {
      schemaVersion: 1,
      records: {
        "AG-2": {
          ...running,
          stage: "failed_operational",
          failureCount: 2,
          consecutiveFailures: 2,
          cooldownUntil: "2026-05-01T10:00:30.000Z",
        },
      },
    });
    const runtime: AgentRuntime = {
      launch: vi.fn(),
      terminate: vi.fn(),
      readSession: vi.fn(async () => ({ sessionId: "session-2", status: "succeeded" as const })),
    };

    const result = await reapFinishedWork({
      dispatchState: { schemaVersion: 1, records: { "AG-2": running } },
      runtime,
      issueIds: ["AG-2"],
      root,
      now: "2026-05-01T10:00:05.000Z",
    });

    expect(result.completed).toEqual([]);
    expect(result.failed).toEqual(["AG-2"]);
    expect(result.state.records["AG-2"]).toMatchObject({
      stage: "failed_operational",
      runningAgent: null,
      failureCount: 2,
      consecutiveFailures: 2,
      cooldownUntil: "2026-05-01T10:00:30.000Z",
    });
  });
});
