import path from "node:path";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";

import { emptyDispatchState, saveDispatchState } from "../../../src/core/dispatch-state.js";
import { runCasteCommand } from "../../../src/core/caste-runner.js";
import { ScriptedCasteRuntime } from "../../../src/runtime/scripted-caste-runtime.js";
import type { AegisIssue } from "../../../src/tracker/issue-model.js";

const tempRoots: string[] = [];

function createTempRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "aegis-caste-runner-"));
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

describe("runCasteCommand", () => {
  it("writes an oracle artifact and advances the issue to scouted", async () => {
    const root = createTempRoot();
    saveDispatchState(root, emptyDispatchState());

    const result = await runCasteCommand({
      root,
      action: "scout",
      issueId: "aegis-123",
      tracker: {
        getIssue: vi.fn(async () => createIssue("aegis-123")),
      },
      runtime: new ScriptedCasteRuntime({
        oracle: () => ({
          output: JSON.stringify({
            files_affected: ["src/index.ts"],
            estimated_complexity: "moderate",
            decompose: false,
            ready: true,
          }),
          toolsUsed: ["read_file"],
        }),
      }),
    });

    const artifactPath = path.join(root, ".aegis", "oracle", "aegis-123.json");

    expect(result).toMatchObject({
      action: "scout",
      issueId: "aegis-123",
      stage: "scouted",
      artifactRefs: [path.join(".aegis", "oracle", "aegis-123.json")],
    });
    expect(JSON.parse(readFileSync(artifactPath, "utf8"))).toMatchObject({
      ready: true,
    });
  });

  it("clears downstream artifact refs when scout rewinds an issue", async () => {
    const root = createTempRoot();
    saveDispatchState(root, {
      schemaVersion: 1,
      records: {
        "aegis-123": {
          issueId: "aegis-123",
          stage: "implemented",
          runningAgent: null,
          oracleAssessmentRef: path.join(".aegis", "oracle", "old.json"),
          titanHandoffRef: path.join(".aegis", "titan", "old.json"),
          titanClarificationRef: path.join(".aegis", "titan", "clarify.json"),
          sentinelVerdictRef: path.join(".aegis", "sentinel", "old.json"),
          janusArtifactRef: path.join(".aegis", "janus", "old.json"),
          failureTranscriptRef: path.join(".aegis", "transcripts", "old.log"),
          fileScope: null,
          failureCount: 0,
          consecutiveFailures: 0,
          failureWindowStartMs: null,
          cooldownUntil: null,
          sessionProvenanceId: "test",
          updatedAt: "2026-04-14T12:00:00.000Z",
        },
      },
    });

    await runCasteCommand({
      root,
      action: "scout",
      issueId: "aegis-123",
      tracker: {
        getIssue: vi.fn(async () => createIssue("aegis-123")),
      },
      runtime: new ScriptedCasteRuntime({
        oracle: () => ({
          output: JSON.stringify({
            files_affected: [],
            estimated_complexity: "moderate",
            decompose: false,
            ready: true,
          }),
        }),
      }),
    });

    const state = JSON.parse(
      readFileSync(path.join(root, ".aegis", "dispatch-state.json"), "utf8"),
    ) as {
      records: Record<string, {
        stage: string;
        titanHandoffRef: string | null;
        titanClarificationRef: string | null;
        sentinelVerdictRef: string | null;
        janusArtifactRef: string | null;
        failureTranscriptRef: string | null;
      }>;
    };

    expect(state.records["aegis-123"]).toMatchObject({
      stage: "scouted",
      titanHandoffRef: null,
      titanClarificationRef: null,
      sentinelVerdictRef: null,
      janusArtifactRef: null,
      failureTranscriptRef: null,
    });
  });

  it("writes a titan handoff artifact and advances the issue to implemented", async () => {
    const root = createTempRoot();
    saveDispatchState(root, {
      schemaVersion: 1,
      records: {
        "aegis-123": {
          issueId: "aegis-123",
          stage: "scouted",
          runningAgent: null,
          oracleAssessmentRef: path.join(".aegis", "oracle", "aegis-123.json"),
          sentinelVerdictRef: null,
          fileScope: null,
          failureCount: 0,
          consecutiveFailures: 0,
          failureWindowStartMs: null,
          cooldownUntil: null,
          sessionProvenanceId: "test",
          updatedAt: "2026-04-14T12:00:00.000Z",
        },
      },
    });

    const result = await runCasteCommand({
      root,
      action: "implement",
      issueId: "aegis-123",
      tracker: {
        getIssue: vi.fn(async () => createIssue("aegis-123")),
      },
      runtime: new ScriptedCasteRuntime({
        titan: () => ({
          output: JSON.stringify({
            outcome: "success",
            summary: "done",
            files_changed: ["src/index.ts"],
            tests_and_checks_run: ["npm test"],
            known_risks: [],
            follow_up_work: [],
            learnings_written_to_mnemosyne: [],
          }),
          toolsUsed: ["write_file"],
        }),
      }),
      resolveBaseBranch: () => "main",
      ensureLabor: vi.fn(),
    });

    expect(result).toMatchObject({
      action: "implement",
      issueId: "aegis-123",
      stage: "implemented",
      artifactRefs: [path.join(".aegis", "titan", "aegis-123.json")],
    });
  });

  it("clears review-stage refs when implement reruns from a later record", async () => {
    const root = createTempRoot();
    saveDispatchState(root, {
      schemaVersion: 1,
      records: {
        "aegis-123": {
          issueId: "aegis-123",
          stage: "reviewed",
          runningAgent: null,
          oracleAssessmentRef: path.join(".aegis", "oracle", "aegis-123.json"),
          titanHandoffRef: path.join(".aegis", "titan", "old.json"),
          titanClarificationRef: path.join(".aegis", "titan", "clarify.json"),
          sentinelVerdictRef: path.join(".aegis", "sentinel", "old.json"),
          janusArtifactRef: path.join(".aegis", "janus", "old.json"),
          failureTranscriptRef: path.join(".aegis", "transcripts", "old.log"),
          fileScope: null,
          failureCount: 0,
          consecutiveFailures: 0,
          failureWindowStartMs: null,
          cooldownUntil: null,
          sessionProvenanceId: "test",
          updatedAt: "2026-04-14T12:00:00.000Z",
        },
      },
    });

    await runCasteCommand({
      root,
      action: "implement",
      issueId: "aegis-123",
      tracker: {
        getIssue: vi.fn(async () => createIssue("aegis-123")),
      },
      runtime: new ScriptedCasteRuntime({
        titan: () => ({
          output: JSON.stringify({
            outcome: "success",
            summary: "done",
            files_changed: [],
            tests_and_checks_run: [],
            known_risks: [],
            follow_up_work: [],
            learnings_written_to_mnemosyne: [],
          }),
        }),
      }),
      resolveBaseBranch: () => "main",
      ensureLabor: vi.fn(),
    });

    const state = JSON.parse(
      readFileSync(path.join(root, ".aegis", "dispatch-state.json"), "utf8"),
    ) as {
      records: Record<string, {
        stage: string;
        sentinelVerdictRef: string | null;
        janusArtifactRef: string | null;
        failureTranscriptRef: string | null;
      }>;
    };

    expect(state.records["aegis-123"]).toMatchObject({
      stage: "implemented",
      sentinelVerdictRef: null,
      janusArtifactRef: null,
      failureTranscriptRef: null,
    });
  });

  it("stops process at the Phase F queue boundary after implementation", async () => {
    const root = createTempRoot();
    mkdirSync(path.join(root, ".aegis", "titan"), { recursive: true });
    writeFileSync(
      path.join(root, ".aegis", "titan", "aegis-123.json"),
      `${JSON.stringify({
        outcome: "success",
        summary: "done",
        files_changed: ["src/index.ts"],
        tests_and_checks_run: ["npm test"],
        known_risks: [],
        follow_up_work: [],
        learnings_written_to_mnemosyne: [],
        labor_path: ".aegis/labors/labor-aegis-123",
        candidate_branch: "aegis/aegis-123",
        base_branch: "main",
      }, null, 2)}\n`,
      "utf8",
    );
    saveDispatchState(root, {
      schemaVersion: 1,
      records: {
        "aegis-123": {
          issueId: "aegis-123",
          stage: "implemented",
          runningAgent: null,
          oracleAssessmentRef: path.join(".aegis", "oracle", "aegis-123.json"),
          titanHandoffRef: path.join(".aegis", "titan", "aegis-123.json"),
          sentinelVerdictRef: null,
          fileScope: null,
          failureCount: 0,
          consecutiveFailures: 0,
          failureWindowStartMs: null,
          cooldownUntil: null,
          sessionProvenanceId: "test",
          updatedAt: "2026-04-14T12:00:00.000Z",
        },
      },
    });

    const result = await runCasteCommand({
      root,
      action: "process",
      issueId: "aegis-123",
      tracker: {
        getIssue: vi.fn(async () => createIssue("aegis-123")),
      },
      runtime: new ScriptedCasteRuntime(),
    });

    expect(result).toEqual({
      action: "process",
      issueId: "aegis-123",
      stage: "queued_for_merge",
      queueItemId: "queue-aegis-123",
      nextAction: "merge_next",
    });
  });

  it("rejects review before merge so Sentinel stays strictly post-merge", async () => {
    const root = createTempRoot();
    saveDispatchState(root, {
      schemaVersion: 1,
      records: {
        "aegis-999": {
          issueId: "aegis-999",
          stage: "implemented",
          runningAgent: null,
          oracleAssessmentRef: path.join(".aegis", "oracle", "aegis-999.json"),
          titanHandoffRef: path.join(".aegis", "titan", "aegis-999.json"),
          sentinelVerdictRef: null,
          fileScope: null,
          failureCount: 0,
          consecutiveFailures: 0,
          failureWindowStartMs: null,
          cooldownUntil: null,
          sessionProvenanceId: "test",
          updatedAt: "2026-04-14T12:00:00.000Z",
        },
      },
    });

    await expect(runCasteCommand({
      root,
      action: "review",
      issueId: "aegis-999",
      tracker: {
        getIssue: vi.fn(async () => createIssue("aegis-999")),
      },
      runtime: new ScriptedCasteRuntime({
        sentinel: () => ({
          output: JSON.stringify({
            verdict: "pass",
            reviewSummary: "should not run yet",
            issuesFound: [],
            followUpIssueIds: [],
            riskAreas: [],
          }),
        }),
      }),
    })).rejects.toThrow("Review requires a merged issue.");
  });

  it("closes the tracker issue after a successful Sentinel review", async () => {
    const root = createTempRoot();
    saveDispatchState(root, {
      schemaVersion: 1,
      records: {
        "aegis-999": {
          issueId: "aegis-999",
          stage: "merged",
          runningAgent: null,
          oracleAssessmentRef: path.join(".aegis", "oracle", "aegis-999.json"),
          titanHandoffRef: path.join(".aegis", "titan", "aegis-999.json"),
          sentinelVerdictRef: null,
          fileScope: null,
          failureCount: 0,
          consecutiveFailures: 0,
          failureWindowStartMs: null,
          cooldownUntil: null,
          sessionProvenanceId: "test",
          updatedAt: "2026-04-14T12:00:00.000Z",
        },
      },
    });

    const closeIssue = vi.fn(async () => undefined);

    const result = await runCasteCommand({
      root,
      action: "review",
      issueId: "aegis-999",
      tracker: {
        getIssue: vi.fn(async () => createIssue("aegis-999")),
        closeIssue,
      },
      runtime: new ScriptedCasteRuntime({
        sentinel: () => ({
          output: JSON.stringify({
            verdict: "pass",
            reviewSummary: "looks good",
            issuesFound: [],
            followUpIssueIds: [],
            riskAreas: [],
          }),
        }),
      }),
    });

    expect(result).toMatchObject({
      action: "review",
      issueId: "aegis-999",
      stage: "reviewed",
    });
    expect(closeIssue).toHaveBeenCalledWith("aegis-999", root);
  });

  it("does not persist reviewed when tracker close fails after a passing review", async () => {
    const root = createTempRoot();
    saveDispatchState(root, {
      schemaVersion: 1,
      records: {
        "aegis-1000": {
          issueId: "aegis-1000",
          stage: "merged",
          runningAgent: null,
          oracleAssessmentRef: path.join(".aegis", "oracle", "aegis-1000.json"),
          titanHandoffRef: path.join(".aegis", "titan", "aegis-1000.json"),
          sentinelVerdictRef: null,
          fileScope: null,
          failureCount: 0,
          consecutiveFailures: 0,
          failureWindowStartMs: null,
          cooldownUntil: null,
          sessionProvenanceId: "test",
          updatedAt: "2026-04-14T12:00:00.000Z",
        },
      },
    });

    await expect(runCasteCommand({
      root,
      action: "review",
      issueId: "aegis-1000",
      tracker: {
        getIssue: vi.fn(async () => createIssue("aegis-1000")),
        closeIssue: vi.fn(async () => {
          throw new Error("bd close failed");
        }),
      },
      runtime: new ScriptedCasteRuntime({
        sentinel: () => ({
          output: JSON.stringify({
            verdict: "pass",
            reviewSummary: "looks good",
            issuesFound: [],
            followUpIssueIds: [],
            riskAreas: [],
          }),
        }),
      }),
    })).rejects.toThrow("bd close failed");

    const state = JSON.parse(
      readFileSync(path.join(root, ".aegis", "dispatch-state.json"), "utf8"),
    ) as {
      records: Record<string, { stage: string }>;
    };

    expect(state.records["aegis-1000"]).toMatchObject({
      stage: "merged",
    });
  });
});
