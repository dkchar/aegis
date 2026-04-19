import path from "node:path";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

import { afterEach, describe, expect, it, vi } from "vitest";

import { emptyDispatchState, saveDispatchState } from "../../../src/core/dispatch-state.js";
import { runCasteCommand } from "../../../src/core/caste-runner.js";
import { ScriptedCasteRuntime } from "../../../src/runtime/scripted-caste-runtime.js";
import type { CasteSessionResult } from "../../../src/runtime/caste-runtime.js";
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

function runGit(root: string, args: string[]) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
}

function createTitanSessionResult(
  outputText: string,
  sessionId: string,
): CasteSessionResult {
  return {
    sessionId,
    caste: "titan",
    modelRef: "openai-codex:gpt-5.4-mini",
    provider: "openai-codex",
    modelId: "gpt-5.4-mini",
    thinkingLevel: "medium",
    status: "succeeded",
    outputText,
    toolsUsed: ["read"],
    messageLog: [
      {
        role: "user",
        content: "prompt",
      },
      {
        role: "assistant",
        content: outputText,
      },
    ],
    startedAt: "2026-04-19T00:00:00.000Z",
    finishedAt: "2026-04-19T00:00:01.000Z",
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
      runtime: new ScriptedCasteRuntime(
        {
          oracle: {
            reference: "openai-codex:gpt-5.4-mini",
            provider: "openai-codex",
            modelId: "gpt-5.4-mini",
            thinkingLevel: "medium",
          },
        },
        {
          oracle: () => ({
          output: JSON.stringify({
            files_affected: ["src/index.ts"],
            estimated_complexity: "moderate",
            decompose: false,
            ready: true,
          }),
          toolsUsed: ["read_file"],
          }),
        },
      ),
    });

    const artifactPath = path.join(root, ".aegis", "oracle", "aegis-123.json");
    const transcriptPath = path.join(root, ".aegis", "transcripts", "aegis-123--oracle.json");

    expect(result).toMatchObject({
      action: "scout",
      issueId: "aegis-123",
      stage: "scouted",
      artifactRefs: [
        path.join(".aegis", "oracle", "aegis-123.json"),
        path.join(".aegis", "transcripts", "aegis-123--oracle.json"),
      ],
    });
    expect(JSON.parse(readFileSync(artifactPath, "utf8"))).toMatchObject({
      ready: true,
      session: {
        transcriptRef: path.join(".aegis", "transcripts", "aegis-123--oracle.json"),
        prompt: "Scout aegis-123: Example",
        workingDirectory: root,
        modelRef: "openai-codex:gpt-5.4-mini",
        provider: "openai-codex",
        modelId: "gpt-5.4-mini",
        thinkingLevel: "medium",
        sessionId: expect.any(String),
        toolsUsed: ["read_file"],
        status: "succeeded",
      },
    });
    expect(JSON.parse(readFileSync(transcriptPath, "utf8"))).toMatchObject({
      issueId: "aegis-123",
      caste: "oracle",
      action: "scout",
      prompt: "Scout aegis-123: Example",
      workingDirectory: root,
      modelRef: "openai-codex:gpt-5.4-mini",
      provider: "openai-codex",
      modelId: "gpt-5.4-mini",
      thinkingLevel: "medium",
      sessionId: expect.any(String),
      toolsUsed: ["read_file"],
      messageLog: [
        {
          role: "user",
          content: "Scout aegis-123: Example",
        },
        {
          role: "assistant",
          content: expect.stringContaining("\"ready\":true"),
        },
      ],
      outputText: expect.stringContaining("\"ready\":true"),
      status: "succeeded",
      error: null,
      startedAt: expect.any(String),
      finishedAt: expect.any(String),
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
      resolveLaborBasePath: () => ".aegis/labors",
      ensureLabor: vi.fn(),
    });

    expect(result).toMatchObject({
      action: "implement",
      issueId: "aegis-123",
      stage: "implemented",
      artifactRefs: [
        path.join(".aegis", "titan", "aegis-123.json"),
        path.join(".aegis", "transcripts", "aegis-123--titan.json"),
      ],
    });

    expect(JSON.parse(readFileSync(path.join(root, ".aegis", "titan", "aegis-123.json"), "utf8")))
      .toMatchObject({
        session: {
          transcriptRef: path.join(".aegis", "transcripts", "aegis-123--titan.json"),
          status: "succeeded",
        },
        git_proof: {
          status_before_ref: null,
          status_after_ref: null,
          changed_files_manifest_ref: null,
          diff_ref: null,
        },
      });
  });

  it("retries Titan once when first artifact is clarification", async () => {
    const root = createTempRoot();
    saveDispatchState(root, {
      schemaVersion: 1,
      records: {
        "aegis-125": {
          issueId: "aegis-125",
          stage: "scouted",
          runningAgent: null,
          oracleAssessmentRef: path.join(".aegis", "oracle", "aegis-125.json"),
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

    const clarificationOutput = JSON.stringify({
      outcome: "clarification",
      summary: "workspace ambiguous",
      files_changed: [],
      tests_and_checks_run: [],
      known_risks: [],
      follow_up_work: [],
      learnings_written_to_mnemosyne: [],
      blocking_question: "Which stack?",
      handoff_note: "Need defaults.",
    });
    const successOutput = JSON.stringify({
      outcome: "success",
      summary: "implemented on retry",
      files_changed: ["src/index.ts"],
      tests_and_checks_run: [],
      known_risks: [],
      follow_up_work: [],
      learnings_written_to_mnemosyne: [],
    });

    const runtimeRun = vi
      .fn()
      .mockResolvedValueOnce(createTitanSessionResult(clarificationOutput, "session-1"))
      .mockResolvedValueOnce(createTitanSessionResult(successOutput, "session-2"));

    const result = await runCasteCommand({
      root,
      action: "implement",
      issueId: "aegis-125",
      tracker: {
        getIssue: vi.fn(async () => createIssue("aegis-125")),
      },
      runtime: {
        run: runtimeRun,
      },
      resolveBaseBranch: () => "main",
      resolveLaborBasePath: () => ".aegis/labors",
      ensureLabor: vi.fn(),
    });

    expect(runtimeRun).toHaveBeenCalledTimes(2);
    const retryPrompt = (runtimeRun.mock.calls[1]?.[0] as { prompt: string }).prompt;
    expect(retryPrompt).toContain("AUTOMATIC RETRY CONTEXT");
    expect(result).toMatchObject({
      action: "implement",
      issueId: "aegis-125",
      stage: "implemented",
      artifactRefs: [
        path.join(".aegis", "titan", "aegis-125.json"),
        path.join(".aegis", "transcripts", "aegis-125--titan.json"),
        path.join(".aegis", "transcripts", "aegis-125--titan-retry-1.json"),
      ],
    });

    expect(JSON.parse(readFileSync(path.join(root, ".aegis", "titan", "aegis-125.json"), "utf8")))
      .toMatchObject({
        outcome: "success",
        summary: "implemented on retry",
        session: {
          transcriptRef: path.join(".aegis", "transcripts", "aegis-125--titan-retry-1.json"),
          sessionId: "session-2",
        },
      });
  });

  it("does not advance implementation when Titan runtime session failed", async () => {
    const root = createTempRoot();
    saveDispatchState(root, {
      schemaVersion: 1,
      records: {
        "aegis-124": {
          issueId: "aegis-124",
          stage: "scouted",
          runningAgent: null,
          oracleAssessmentRef: path.join(".aegis", "oracle", "aegis-124.json"),
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
      action: "implement",
      issueId: "aegis-124",
      tracker: {
        getIssue: vi.fn(async () => createIssue("aegis-124")),
      },
      runtime: new ScriptedCasteRuntime({
        titan: () => ({
          output: JSON.stringify({
            outcome: "success",
            summary: "json present but runtime flagged failed",
            files_changed: ["src/index.ts"],
            tests_and_checks_run: [],
            known_risks: [],
            follow_up_work: [],
            learnings_written_to_mnemosyne: [],
          }),
          error: "Titan tool contract violation: missing emit_titan_artifact output",
        }),
      }),
      resolveBaseBranch: () => "main",
      resolveLaborBasePath: () => ".aegis/labors",
      ensureLabor: vi.fn(),
    })).rejects.toThrow("Titan session failed for aegis-124");

    const state = JSON.parse(
      readFileSync(path.join(root, ".aegis", "dispatch-state.json"), "utf8"),
    ) as {
      records: Record<string, { stage: string; titanHandoffRef?: string | null }>;
    };

    expect(state.records["aegis-124"]?.stage).toBe("scouted");
    expect(state.records["aegis-124"]?.titanHandoffRef ?? null).toBeNull();
    expect(existsSync(path.join(root, ".aegis", "titan", "aegis-124.json"))).toBe(false);
  });

  it("captures git proof refs when Titan runs in a real labor worktree", async () => {
    const root = createTempRoot();
    saveDispatchState(root, {
      schemaVersion: 1,
      records: {
        "aegis-234": {
          issueId: "aegis-234",
          stage: "scouted",
          runningAgent: null,
          oracleAssessmentRef: path.join(".aegis", "oracle", "aegis-234.json"),
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

    writeFileSync(path.join(root, "README.md"), "# baseline\n", "utf8");
    runGit(root, ["init"]);
    runGit(root, ["config", "user.email", "test@aegis.local"]);
    runGit(root, ["config", "user.name", "Aegis Test"]);
    runGit(root, ["add", "--all"]);
    runGit(root, ["commit", "-m", "baseline"]);
    runGit(root, ["branch", "-M", "main"]);

    const result = await runCasteCommand({
      root,
      action: "implement",
      issueId: "aegis-234",
      tracker: {
        getIssue: vi.fn(async () => createIssue("aegis-234")),
      },
      runtime: new ScriptedCasteRuntime({
        titan: (input) => {
          writeFileSync(path.join(input.workingDirectory, "phase-i-proof.txt"), "proof\n", "utf8");
          return {
            output: JSON.stringify({
              outcome: "success",
              summary: "implemented in worktree",
              files_changed: ["phase-i-proof.txt"],
              tests_and_checks_run: [],
              known_risks: [],
              follow_up_work: [],
              learnings_written_to_mnemosyne: [],
            }),
            toolsUsed: ["write_file"],
          };
        },
      }),
      resolveBaseBranch: () => "main",
      resolveLaborBasePath: () => "scratchpad",
    });

    expect(result).toMatchObject({
      action: "implement",
      issueId: "aegis-234",
      stage: "implemented",
    });

    const artifact = JSON.parse(
      readFileSync(path.join(root, ".aegis", "titan", "aegis-234.json"), "utf8"),
    ) as {
      labor_path: string;
      git_proof: {
        status_before_ref: string | null;
        status_after_ref: string | null;
        changed_files_manifest_ref: string | null;
        diff_ref: string | null;
      };
    };

    expect(artifact.labor_path).toBe(path.join(root, "scratchpad", "aegis-234"));
    expect(artifact.git_proof.status_before_ref).toBeTruthy();
    expect(artifact.git_proof.status_after_ref).toBeTruthy();
    expect(artifact.git_proof.changed_files_manifest_ref).toBeTruthy();
    expect(artifact.git_proof.diff_ref).toBeTruthy();
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
      resolveLaborBasePath: () => ".aegis/labors",
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
        labor_path: ".aegis/labors/aegis-123",
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

  it("auto-creates follow-up issues when Sentinel fails without pre-registered IDs", async () => {
    const root = createTempRoot();
    saveDispatchState(root, {
      schemaVersion: 1,
      records: {
        "aegis-1001": {
          issueId: "aegis-1001",
          stage: "merged",
          runningAgent: null,
          oracleAssessmentRef: path.join(".aegis", "oracle", "aegis-1001.json"),
          titanHandoffRef: path.join(".aegis", "titan", "aegis-1001.json"),
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

    const createFollowUpIssue = vi
      .fn()
      .mockResolvedValueOnce("aegis-2001")
      .mockResolvedValueOnce("aegis-2002");

    const result = await runCasteCommand({
      root,
      action: "review",
      issueId: "aegis-1001",
      tracker: {
        getIssue: vi.fn(async () => createIssue("aegis-1001")),
        createIssue: createFollowUpIssue,
      },
      runtime: new ScriptedCasteRuntime({
        sentinel: () => ({
          output: JSON.stringify({
            verdict: "fail",
            reviewSummary: "needs fixes",
            issuesFound: ["update tests", "tighten validation"],
            followUpIssueIds: [],
            riskAreas: ["coverage", "runtime checks"],
          }),
        }),
      }),
    });

    expect(result).toMatchObject({
      action: "review",
      issueId: "aegis-1001",
      stage: "failed",
    });
    expect(createFollowUpIssue).toHaveBeenCalledTimes(2);
    expect(createFollowUpIssue).toHaveBeenNthCalledWith(1, {
      title: "[sentinel][aegis-1001] update tests",
      description: [
        "Auto-created from Sentinel review for aegis-1001.",
        "Review summary: needs fixes",
        "Finding: update tests",
        "Risk areas: coverage, runtime checks",
      ].join("\n"),
      dependencies: ["discovered-from:aegis-1001"],
    }, root);
    expect(createFollowUpIssue).toHaveBeenNthCalledWith(2, {
      title: "[sentinel][aegis-1001] tighten validation",
      description: [
        "Auto-created from Sentinel review for aegis-1001.",
        "Review summary: needs fixes",
        "Finding: tighten validation",
        "Risk areas: coverage, runtime checks",
      ].join("\n"),
      dependencies: ["discovered-from:aegis-1001"],
    }, root);

    expect(JSON.parse(
      readFileSync(path.join(root, ".aegis", "sentinel", "aegis-1001.json"), "utf8"),
    )).toMatchObject({
      verdict: "fail",
      followUpIssueIds: ["aegis-2001", "aegis-2002"],
    });

    const phaseLogDirectory = path.join(root, ".aegis", "logs", "phases");
    const phaseActions = readdirSync(phaseLogDirectory)
      .map((fileName) =>
        JSON.parse(readFileSync(path.join(phaseLogDirectory, fileName), "utf8")) as {
          issueId: string;
          action: string;
          outcome: string;
          detail?: string;
        })
      .filter((entry) => entry.issueId === "aegis-1001");

    expect(phaseActions.some((entry) => entry.action === "sentinel_review_started")).toBe(true);
    expect(phaseActions.some((entry) => entry.action === "sentinel_issues_discovered")).toBe(true);
    expect(phaseActions.filter((entry) => entry.action === "sentinel_followup_created")).toHaveLength(2);
    expect(phaseActions.some((entry) =>
      entry.action === "sentinel_review_completed" && entry.outcome === "failed",
    )).toBe(true);
  });

  it("writes janus start and completion phase logs during integration resolution", async () => {
    const root = createTempRoot();
    saveDispatchState(root, {
      schemaVersion: 1,
      records: {
        "aegis-janus-1": {
          issueId: "aegis-janus-1",
          stage: "resolving_integration",
          runningAgent: null,
          oracleAssessmentRef: path.join(".aegis", "oracle", "aegis-janus-1.json"),
          titanHandoffRef: path.join(".aegis", "titan", "aegis-janus-1.json"),
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
      issueId: "aegis-janus-1",
      janusContext: {
        queueItemId: "queue-aegis-janus-1",
        mergeOutcome: "conflict",
        mergeDetail: "Merge conflict in src/index.ts",
        attempt: 3,
        tier: "T3",
        janusInvocation: 1,
      },
      tracker: {
        getIssue: vi.fn(async () => createIssue("aegis-janus-1")),
      },
      runtime: new ScriptedCasteRuntime({
        janus: () => ({
          output: JSON.stringify({
            originatingIssueId: "aegis-janus-1",
            queueItemId: "queue-aegis-janus-1",
            preservedLaborPath: ".aegis/labors/aegis-janus-1",
            conflictSummary: "deterministic conflict context",
            resolutionStrategy: "keep both changes",
            filesTouched: ["src/index.ts"],
            validationsRun: ["npm test"],
            residualRisks: [],
            recommendedNextAction: "requeue",
          }),
        }),
      }),
    });

    expect(result).toMatchObject({
      action: "process",
      issueId: "aegis-janus-1",
      stage: "queued_for_merge",
    });

    const phaseLogDirectory = path.join(root, ".aegis", "logs", "phases");
    const phaseActions = readdirSync(phaseLogDirectory)
      .map((fileName) =>
        JSON.parse(readFileSync(path.join(phaseLogDirectory, fileName), "utf8")) as {
          issueId: string;
          action: string;
          outcome: string;
          detail?: string;
        })
      .filter((entry) => entry.issueId === "aegis-janus-1");
    const started = phaseActions.find((entry) => entry.action === "janus_resolution_started");
    const completed = phaseActions.find((entry) => entry.action === "janus_resolution_completed");
    expect(started).toBeTruthy();
    expect(completed).toBeTruthy();
    expect(completed?.outcome).toBe("queued_for_merge");

    const startedDetail = JSON.parse(started?.detail ?? "{}") as Record<string, unknown>;
    expect(startedDetail).toMatchObject({
      queueItemId: "queue-aegis-janus-1",
      mergeOutcome: "conflict",
      mergeDetail: "Merge conflict in src/index.ts",
      attempt: 3,
      tier: "T3",
      janusInvocation: 1,
    });

    const completedDetail = JSON.parse(completed?.detail ?? "{}") as Record<string, unknown>;
    expect(completedDetail).toMatchObject({
      queueItemId: "queue-aegis-janus-1",
      conflictSummary: "deterministic conflict context",
      resolutionStrategy: "keep both changes",
      recommendedNextAction: "requeue",
    });
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
