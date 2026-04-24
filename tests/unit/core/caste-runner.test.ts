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

function createOracleOutput(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    files_affected: [],
    estimated_complexity: "moderate",
    risks: [],
    suggested_checks: [],
    scope_notes: [],
    ...overrides,
  });
}

function createSentinelPassOutput() {
  return JSON.stringify({
    verdict: "pass",
    reviewSummary: "looks good",
    blockingFindings: [],
    advisories: [],
    touchedFiles: [],
    contractChecks: [],
  });
}

function createSentinelFailOutput() {
  return JSON.stringify({
    verdict: "fail_blocking",
    reviewSummary: "needs fixes",
    blockingFindings: ["update tests", "tighten validation"],
    advisories: ["naming can improve later"],
    touchedFiles: ["src/index.ts"],
    contractChecks: ["issue contract"],
  });
}

describe("runCasteCommand", () => {
  it("tells Oracle not to decompose tracker-defined executable work", async () => {
    const root = createTempRoot();
    saveDispatchState(root, emptyDispatchState());

    await runCasteCommand({
      root,
      action: "scout",
      issueId: "aegis-guard",
      tracker: {
        getIssue: vi.fn(async () => createIssue("aegis-guard")),
      },
      runtime: new ScriptedCasteRuntime({
        oracle: () => ({
          output: createOracleOutput(),
        }),
      }),
    });

    const transcriptPath = path.join(root, ".aegis", "transcripts", "aegis-guard--oracle.json");
    expect(JSON.parse(readFileSync(transcriptPath, "utf8"))).toMatchObject({
      prompt: expect.stringContaining("Do not decide readiness"),
    });
  });

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
          output: createOracleOutput({ files_affected: ["src/index.ts"] }),
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
      files_affected: ["src/index.ts"],
      risks: [],
      suggested_checks: [],
      scope_notes: [],
      session: {
        transcriptRef: path.join(".aegis", "transcripts", "aegis-123--oracle.json"),
        prompt: expect.stringContaining("Scout aegis-123: Example"),
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
      prompt: expect.stringContaining("Scout aegis-123: Example"),
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
          content: expect.stringContaining("Scout aegis-123: Example"),
        },
        {
          role: "assistant",
          content: expect.stringContaining("\"scope_notes\""),
        },
      ],
      outputText: expect.stringContaining("\"scope_notes\""),
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
          output: createOracleOutput(),
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

  it("routes Titan clarification blockers through policy and blocks the parent", async () => {
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
      mutation_proposal: {
        proposal_type: "create_clarification_blocker",
        summary: "Which stack?",
        suggested_title: "Clarify stack for aegis-125",
        suggested_description: "Implementation needs stack choice before proceeding.",
        scope_evidence: ["Issue does not name the required stack."],
      },
    });
    const runtimeRun = vi
      .fn()
      .mockResolvedValueOnce(createTitanSessionResult(clarificationOutput, "session-1"));

    const createClarificationIssue = vi.fn(async () => "aegis-clarify-1");
    const linkBlockingIssue = vi.fn(async () => undefined);

    const result = await runCasteCommand({
      root,
      action: "implement",
      issueId: "aegis-125",
      tracker: {
        getIssue: vi.fn(async () => createIssue("aegis-125")),
        createIssue: createClarificationIssue,
        linkBlockingIssue,
      },
      runtime: {
        run: runtimeRun,
      },
      resolveBaseBranch: () => "main",
      resolveLaborBasePath: () => ".aegis/labors",
      ensureLabor: vi.fn(),
    });

    expect(runtimeRun).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      action: "implement",
      issueId: "aegis-125",
      stage: "blocked_on_child",
      artifactRefs: [
        path.join(".aegis", "titan", "aegis-125.json"),
        expect.stringContaining(path.join(".aegis", "policy")),
        path.join(".aegis", "transcripts", "aegis-125--titan.json"),
      ],
    });
    expect(createClarificationIssue).toHaveBeenCalledTimes(1);
    expect(linkBlockingIssue).toHaveBeenCalledWith({
      blockingIssueId: "aegis-clarify-1",
      blockedIssueId: "aegis-125",
    }, root);

    expect(JSON.parse(readFileSync(path.join(root, ".aegis", "titan", "aegis-125.json"), "utf8")))
      .toMatchObject({
        outcome: "clarification",
        summary: "workspace ambiguous",
        session: {
          transcriptRef: path.join(".aegis", "transcripts", "aegis-125--titan.json"),
          sessionId: "session-1",
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

  it("ignores legacy Oracle veto fields when running Titan implementation", async () => {
    const root = createTempRoot();
    saveDispatchState(root, {
      schemaVersion: 1,
      records: {
        "aegis-124b": {
          issueId: "aegis-124b",
          stage: "scouted",
          runningAgent: null,
          oracleAssessmentRef: path.join(".aegis", "oracle", "aegis-124b.json"),
          sentinelVerdictRef: null,
          fileScope: null,
          failureCount: 0,
          consecutiveFailures: 0,
          failureWindowStartMs: null,
          cooldownUntil: null,
          sessionProvenanceId: "test",
          updatedAt: "2026-04-14T12:00:00.000Z",
          oracleReady: false,
          oracleDecompose: true,
          oracleBlockers: ["missing scope"],
        } as any,
      },
    });

    await expect(runCasteCommand({
      root,
      action: "implement",
      issueId: "aegis-124b",
      tracker: {
        getIssue: vi.fn(async () => createIssue("aegis-124b")),
      },
      runtime: new ScriptedCasteRuntime({
        titan: () => ({
          output: JSON.stringify({
            outcome: "success",
            summary: "should not run",
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
    })).resolves.toMatchObject({
      action: "implement",
      issueId: "aegis-124b",
      stage: "implemented",
    });
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

  it("clears review-stage refs when implement reruns from same-parent rework", async () => {
    const root = createTempRoot();
    saveDispatchState(root, {
      schemaVersion: 1,
      records: {
        "aegis-123": {
          issueId: "aegis-123",
          stage: "rework_required",
          runningAgent: null,
          oracleAssessmentRef: path.join(".aegis", "oracle", "aegis-123.json"),
          titanHandoffRef: path.join(".aegis", "titan", "old.json"),
          titanClarificationRef: path.join(".aegis", "titan", "clarify.json"),
          sentinelVerdictRef: path.join(".aegis", "sentinel", "old.json"),
          reviewFeedbackRef: path.join(".aegis", "sentinel", "old.json"),
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

  it("runs Sentinel before merge queue admission after implementation", async () => {
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
      runtime: new ScriptedCasteRuntime({
        sentinel: () => ({
          output: createSentinelPassOutput(),
        }),
      }),
    });

    expect(result).toMatchObject({
      action: "process",
      issueId: "aegis-123",
      stage: "queued_for_merge",
    });
  });

  it("rejects review before implementation", async () => {
    const root = createTempRoot();
    saveDispatchState(root, {
      schemaVersion: 1,
      records: {
        "aegis-999": {
          issueId: "aegis-999",
          stage: "scouted",
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
            blockingFindings: [],
            advisories: [],
            touchedFiles: [],
            contractChecks: [],
          }),
        }),
      }),
    })).rejects.toThrow("Review requires an implemented issue.");
  });

  it("queues the candidate after a successful pre-merge Sentinel review without closing the tracker issue", async () => {
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
          output: createSentinelPassOutput(),
        }),
      }),
    });

    expect(result).toMatchObject({
      action: "review",
      issueId: "aegis-999",
      stage: "queued_for_merge",
    });
    expect(closeIssue).not.toHaveBeenCalled();
  });

  it("sends Sentinel blocking findings to same-parent rework without creating issues", async () => {
    const root = createTempRoot();
    saveDispatchState(root, {
      schemaVersion: 1,
      records: {
        "aegis-1001": {
          issueId: "aegis-1001",
          stage: "implemented",
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

    const createFollowUpIssue = vi.fn(async () => "should-not-create");
    const closeIssue = vi.fn(async () => undefined);

    const result = await runCasteCommand({
      root,
      action: "review",
      issueId: "aegis-1001",
      tracker: {
        getIssue: vi.fn(async () => createIssue("aegis-1001")),
        createIssue: createFollowUpIssue,
        closeIssue,
      },
      runtime: new ScriptedCasteRuntime({
        sentinel: () => ({
          output: createSentinelFailOutput(),
        }),
      }),
    });

    expect(result).toMatchObject({
      action: "review",
      issueId: "aegis-1001",
      stage: "rework_required",
    });
    expect(createFollowUpIssue).not.toHaveBeenCalled();
    expect(closeIssue).not.toHaveBeenCalled();

    expect(JSON.parse(
      readFileSync(path.join(root, ".aegis", "sentinel", "aegis-1001.json"), "utf8"),
    )).toMatchObject({
      verdict: "fail_blocking",
      blockingFindings: ["update tests", "tighten validation"],
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
    expect(phaseActions.some((entry) => entry.action === "sentinel_blocking_findings")).toBe(true);
    expect(phaseActions.some((entry) =>
      entry.action === "sentinel_review_completed" && entry.outcome === "rework_required",
    )).toBe(true);
  });

  it("does not create Sentinel follow-up issues on review rerun", async () => {
    const root = createTempRoot();
    mkdirSync(path.join(root, ".aegis", "sentinel"), { recursive: true });
    writeFileSync(
      path.join(root, ".aegis", "sentinel", "aegis-1002.json"),
      `${JSON.stringify({
        verdict: "fail_blocking",
        reviewSummary: "needs fixes",
        blockingFindings: ["update tests", "tighten validation"],
        advisories: ["coverage"],
        touchedFiles: ["src/index.ts"],
        contractChecks: ["issue contract"],
      }, null, 2)}\n`,
      "utf8",
    );
    saveDispatchState(root, {
      schemaVersion: 1,
      records: {
        "aegis-1002": {
          issueId: "aegis-1002",
          stage: "implemented",
          runningAgent: null,
          oracleAssessmentRef: path.join(".aegis", "oracle", "aegis-1002.json"),
          titanHandoffRef: path.join(".aegis", "titan", "aegis-1002.json"),
          titanClarificationRef: null,
          sentinelVerdictRef: path.join(".aegis", "sentinel", "aegis-1002.json"),
          janusArtifactRef: null,
          failureTranscriptRef: null,
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

    const createFollowUpIssue = vi.fn(async () => "should-not-create");

    const result = await runCasteCommand({
      root,
      action: "review",
      issueId: "aegis-1002",
      tracker: {
        getIssue: vi.fn(async () => createIssue("aegis-1002")),
        createIssue: createFollowUpIssue,
        closeIssue: vi.fn(async () => undefined),
      },
      runtime: new ScriptedCasteRuntime({
        sentinel: () => ({
          output: createSentinelFailOutput(),
        }),
      }),
    });

    expect(result).toMatchObject({
      action: "review",
      issueId: "aegis-1002",
      stage: "rework_required",
    });
    expect(createFollowUpIssue).not.toHaveBeenCalled();
    expect(JSON.parse(
      readFileSync(path.join(root, ".aegis", "sentinel", "aegis-1002.json"), "utf8"),
    )).toMatchObject({
      verdict: "fail_blocking",
      blockingFindings: ["update tests", "tighten validation"],
    });
  });

  it("rejects legacy Oracle decomposition fields at the tool-contract boundary", async () => {
    const root = createTempRoot();
    saveDispatchState(root, emptyDispatchState());

    await expect(runCasteCommand({
      root,
      action: "scout",
      issueId: "aegis-decompose",
      tracker: {
        getIssue: vi.fn(async () => createIssue("aegis-decompose")),
      },
      runtime: new ScriptedCasteRuntime({
        oracle: () => ({
          output: JSON.stringify({
            files_affected: ["src/index.ts"],
            estimated_complexity: "moderate",
            decompose: true,
            sub_issues: ["child-a", "child-b"],
            ready: true,
          }),
        }),
      }),
    })).rejects.toThrow("Oracle assessment contains an unexpected field: decompose");

    const state = JSON.parse(
      readFileSync(path.join(root, ".aegis", "dispatch-state.json"), "utf8"),
    ) as {
      records: Record<string, {
        stage: string;
        oracleAssessmentRef: string | null;
        oracleReady: boolean | null;
        oracleDecompose: boolean | null;
      }>;
    };

    expect(state.records["aegis-decompose"]).toBeUndefined();
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
            mutation_proposal: {
              proposal_type: "requeue_parent",
              summary: "Refresh parent candidate with integration context.",
              scope_evidence: ["Conflict is in touched parent scope."],
            },
          }),
        }),
      }),
    });

    expect(result).toMatchObject({
      action: "process",
      issueId: "aegis-janus-1",
      stage: "rework_required",
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
    expect(completed?.outcome).toBe("rework_required");

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
      mutationProposal: "requeue_parent",
    });
  });

  it("does not close tracker issue during passing pre-merge review", async () => {
    const root = createTempRoot();
    saveDispatchState(root, {
      schemaVersion: 1,
      records: {
        "aegis-1000": {
          issueId: "aegis-1000",
          stage: "implemented",
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

    const closeIssue = vi.fn(async () => {
      throw new Error("bd close failed");
    });

    await expect(runCasteCommand({
      root,
      action: "review",
      issueId: "aegis-1000",
      tracker: {
        getIssue: vi.fn(async () => createIssue("aegis-1000")),
        closeIssue,
      },
      runtime: new ScriptedCasteRuntime({
        sentinel: () => ({
          output: createSentinelPassOutput(),
        }),
      }),
    })).resolves.toMatchObject({
      issueId: "aegis-1000",
      stage: "queued_for_merge",
    });
    expect(closeIssue).not.toHaveBeenCalled();

    const state = JSON.parse(
      readFileSync(path.join(root, ".aegis", "dispatch-state.json"), "utf8"),
    ) as {
      records: Record<string, { stage: string }>;
    };

    expect(state.records["aegis-1000"]).toMatchObject({
      stage: "queued_for_merge",
    });
  });
});
