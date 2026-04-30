import path from "node:path";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

import { afterEach, describe, expect, it, vi } from "vitest";

import { emptyDispatchState, loadDispatchState, saveDispatchState } from "../../../src/core/dispatch-state.js";
import { runCasteCommand } from "../../../src/core/caste-runner.js";
import { persistArtifact } from "../../../src/core/artifact-store.js";
import { ScriptedCasteRuntime } from "../../../src/runtime/scripted-caste-runtime.js";
import type { CasteSessionResult } from "../../../src/runtime/caste-runtime.js";
import type { AegisIssue } from "../../../src/tracker/issue-model.js";
import { DEFAULT_AEGIS_CONFIG } from "../../../src/config/defaults.js";

const tempRoots: string[] = [];

function createTempRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "aegis-caste-runner-"));
  tempRoots.push(root);
  return root;
}

function writeConfig(root: string, config = DEFAULT_AEGIS_CONFIG) {
  mkdirSync(path.join(root, ".aegis"), { recursive: true });
  writeFileSync(path.join(root, ".aegis", "config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function allowComplexAutoDispatch(root: string) {
  writeConfig(root, {
    ...DEFAULT_AEGIS_CONFIG,
    thresholds: {
      ...DEFAULT_AEGIS_CONFIG.thresholds,
      allow_complex_auto_dispatch: true,
    },
  });
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

function initializeGitRepository(root: string) {
  writeFileSync(path.join(root, "README.md"), "# baseline\n", "utf8");
  runGit(root, ["init"]);
  runGit(root, ["config", "user.email", "test@aegis.local"]);
  runGit(root, ["config", "user.name", "Aegis Test"]);
  runGit(root, ["add", "--all"]);
  runGit(root, ["commit", "-m", "baseline"]);
  runGit(root, ["branch", "-M", "main"]);
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
    blockingFindings: [
      {
        finding_kind: "contract_gap",
        summary: "update tests",
        required_files: ["tests/unit/core/caste-runner.test.ts"],
        owner_issue: "aegis-1001",
        route: "rework_owner",
      },
      {
        finding_kind: "regression",
        summary: "tighten validation",
        required_files: ["src/core/caste-runner.ts"],
        owner_issue: "aegis-1001",
        route: "rework_owner",
      },
    ],
    advisories: ["naming can improve later"],
    touchedFiles: ["src/index.ts"],
    contractChecks: ["issue contract"],
  });
}

function createSentinelOutOfScopeBlockerOutput() {
  return JSON.stringify({
    verdict: "fail_blocking",
    reviewSummary: "blocked outside parent scope",
    blockingFindings: [
      {
        finding_kind: "out_of_scope_blocker",
        summary: "package manifest change required before parent can pass",
        required_files: ["package.json"],
        owner_issue: "aegis-1003",
        route: "create_blocker",
      },
    ],
    advisories: [],
    touchedFiles: ["src/index.ts"],
    contractChecks: ["package manifest required"],
  });
}

function writeTitanArtifact(root: string, issueId: string, laborPath = `.aegis/labors/${issueId}`) {
  mkdirSync(path.join(root, ".aegis", "titan"), { recursive: true });
  writeFileSync(
    path.join(root, ".aegis", "titan", `${issueId}.json`),
    `${JSON.stringify({
      outcome: "success",
      summary: "done",
      files_changed: ["src/index.ts"],
      tests_and_checks_run: ["npm test"],
      known_risks: [],
      follow_up_work: [],
      labor_path: laborPath,
      candidate_branch: `aegis/${issueId}`,
      base_branch: "main",
    }, null, 2)}\n`,
    "utf8",
  );
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
    expect(JSON.parse(readFileSync(transcriptPath, "utf8")).prompt).toContain(
      "estimated_complexity allowed values: trivial, moderate, complex.",
    );
    expect(JSON.parse(readFileSync(transcriptPath, "utf8")).prompt).toContain(
      "files_affected must be an array of path strings, not objects.",
    );
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

    const state = JSON.parse(
      readFileSync(path.join(root, ".aegis", "dispatch-state.json"), "utf8"),
    ) as {
      records: Record<string, { fileScope: { files: string[] } | null }>;
    };

    expect(state.records["aegis-123"]?.fileScope).toEqual({
      files: ["src/index.ts"],
    });
  });

  it("uses explicit issue file ownership as the enforced Titan scope", async () => {
    const root = createTempRoot();
    saveDispatchState(root, emptyDispatchState());

    const issue = {
      ...createIssue("aegis-owned"),
      description: [
        "Create setup contract only.",
        "Aegis file ownership: docs/setup-contract.md, docs/setup-gate.md",
      ].join("\n"),
    };

    await runCasteCommand({
      root,
      action: "scout",
      issueId: "aegis-owned",
      tracker: {
        getIssue: vi.fn(async () => issue),
      },
      runtime: new ScriptedCasteRuntime({
        oracle: () => ({
          output: createOracleOutput({
            files_affected: ["package.json", "src/App.tsx"],
          }),
        }),
      }),
    });

    const state = JSON.parse(
      readFileSync(path.join(root, ".aegis", "dispatch-state.json"), "utf8"),
    ) as {
      records: Record<string, { fileScope: { files: string[] } | null }>;
    };
    const transcript = JSON.parse(
      readFileSync(path.join(root, ".aegis", "transcripts", "aegis-owned--oracle.json"), "utf8"),
    ) as { prompt: string };

    expect(state.records["aegis-owned"]?.fileScope).toEqual({
      files: ["docs/setup-contract.md", "docs/setup-gate.md"],
    });
    expect(transcript.prompt).toContain("Declared file ownership: docs/setup-contract.md, docs/setup-gate.md");
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

  it("clears the active agent assignment when Titan saves completion", async () => {
    const root = createTempRoot();
    saveDispatchState(root, {
      schemaVersion: 1,
      records: {
        "aegis-running-titan": {
          issueId: "aegis-running-titan",
          stage: "implementing",
          runningAgent: {
            caste: "titan",
            sessionId: "session-running",
            startedAt: "2026-04-14T12:00:00.000Z",
          },
          lastCompletedCaste: "oracle",
          oracleAssessmentRef: path.join(".aegis", "oracle", "aegis-running-titan.json"),
          titanHandoffRef: null,
          titanClarificationRef: null,
          sentinelVerdictRef: null,
          janusArtifactRef: null,
          failureTranscriptRef: null,
          fileScope: null,
          failureCount: 0,
          consecutiveFailures: 0,
          failureWindowStartMs: null,
          cooldownUntil: null,
          sessionProvenanceId: "daemon",
          updatedAt: "2026-04-14T12:00:00.000Z",
        },
      },
    });

    await runCasteCommand({
      root,
      action: "implement",
      issueId: "aegis-running-titan",
      tracker: {
        getIssue: vi.fn(async () => createIssue("aegis-running-titan")),
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
          }),
        }),
      }),
      resolveBaseBranch: () => "main",
      resolveLaborBasePath: () => ".aegis/labors",
      ensureLabor: vi.fn(),
    });

    const state = loadDispatchState(root);
    expect(state.records["aegis-running-titan"]).toMatchObject({
      stage: "implemented",
      runningAgent: null,
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
          runGit(input.workingDirectory, ["add", "phase-i-proof.txt"]);
          runGit(input.workingDirectory, ["commit", "-m", "phase i"]);
          return {
            output: JSON.stringify({
              outcome: "success",
              summary: "implemented in worktree",
              files_changed: ["phase-i-proof.txt"],
              tests_and_checks_run: [],
              known_risks: [],
              follow_up_work: [],
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

    const changedFiles = JSON.parse(
      readFileSync(path.join(root, artifact.git_proof.changed_files_manifest_ref!), "utf8"),
    ) as { files: string[] };
    const gitDiff = JSON.parse(
      readFileSync(path.join(root, artifact.git_proof.diff_ref!), "utf8"),
    ) as { diff: string };

    expect(changedFiles.files).toEqual(["phase-i-proof.txt"]);
    expect(gitDiff.diff).toContain("phase-i-proof.txt");
  });

  it("recovers a scoped Titan commit when the session times out before artifact emission", async () => {
    const root = createTempRoot();
    saveDispatchState(root, {
      schemaVersion: 1,
      records: {
        "aegis-timeout-commit": {
          issueId: "aegis-timeout-commit",
          stage: "scouted",
          runningAgent: null,
          oracleAssessmentRef: path.join(".aegis", "oracle", "aegis-timeout-commit.json"),
          sentinelVerdictRef: null,
          fileScope: {
            files: ["phase-i-proof.txt"],
          },
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
      issueId: "aegis-timeout-commit",
      tracker: {
        getIssue: vi.fn(async () => createIssue("aegis-timeout-commit")),
      },
      runtime: new ScriptedCasteRuntime({
        titan: (input) => {
          writeFileSync(path.join(input.workingDirectory, "phase-i-proof.txt"), "proof\n", "utf8");
          runGit(input.workingDirectory, ["add", "phase-i-proof.txt"]);
          runGit(input.workingDirectory, ["commit", "-m", "phase i"]);
          return {
            output: "committed but no artifact",
            error: "Pi titan session timed out after 300000ms.",
          };
        },
      }),
      resolveBaseBranch: () => "main",
      resolveLaborBasePath: () => "scratchpad",
    });

    expect(result).toMatchObject({
      action: "implement",
      issueId: "aegis-timeout-commit",
      stage: "implemented",
    });

    const artifact = JSON.parse(
      readFileSync(path.join(root, ".aegis", "titan", "aegis-timeout-commit.json"), "utf8"),
    ) as {
      outcome: string;
      files_changed: string[];
      summary: string;
      known_risks: string[];
      session: { status: string };
    };

    expect(artifact).toMatchObject({
      outcome: "success",
      files_changed: ["phase-i-proof.txt"],
      session: { status: "failed" },
    });
    expect(artifact.summary).toContain("Recovered committed Titan work");
    expect(artifact.known_risks.join("\n")).toContain("Pi titan session timed out");
  });

  it("tells Titan to stage and commit labor changes before emitting the artifact", async () => {
    const root = createTempRoot();
    saveDispatchState(root, {
      schemaVersion: 1,
      records: {
        "aegis-commit-contract": {
          issueId: "aegis-commit-contract",
          stage: "scouted",
          runningAgent: null,
          oracleAssessmentRef: path.join(".aegis", "oracle", "aegis-commit-contract.json"),
          sentinelVerdictRef: null,
          fileScope: {
            files: ["src/App.jsx", "src/index.css"],
          },
          failureCount: 0,
          consecutiveFailures: 0,
          failureWindowStartMs: null,
          cooldownUntil: null,
          sessionProvenanceId: "test",
          updatedAt: "2026-04-14T12:00:00.000Z",
        },
      },
    });

    initializeGitRepository(root);

    let prompt = "";
    await runCasteCommand({
      root,
      action: "implement",
      issueId: "aegis-commit-contract",
      tracker: {
        getIssue: vi.fn(async () => createIssue("aegis-commit-contract")),
      },
      runtime: new ScriptedCasteRuntime({
        titan: (input) => {
          prompt = input.prompt;
          mkdirSync(path.join(input.workingDirectory, "src"), { recursive: true });
          writeFileSync(path.join(input.workingDirectory, "src", "App.jsx"), "export default function App() { return null; }\n", "utf8");
          runGit(input.workingDirectory, ["add", "src/App.jsx"]);
          runGit(input.workingDirectory, ["commit", "-m", "phase i"]);
          return {
            output: JSON.stringify({
              outcome: "success",
              summary: "implemented in worktree",
              files_changed: ["src/App.jsx"],
              tests_and_checks_run: [],
              known_risks: [],
              follow_up_work: [],
            }),
            toolsUsed: ["write_file"],
          };
        },
      }),
      resolveBaseBranch: () => "main",
      resolveLaborBasePath: () => "scratchpad",
    });

    expect(prompt).toContain("Stage and commit all intended changes in the labor worktree before you call");
    expect(prompt).toContain("Do not leave required implementation changes uncommitted.");
    expect(prompt).toContain("Allowed file scope: src/App.jsx, src/index.css");
    expect(prompt).toContain("Stay within the allowed file scope.");
    expect(prompt).toContain("Current allowed file scope is authoritative for this issue.");
    expect(prompt).toContain("You are a dispatched Aegis caste subagent");
    expect(prompt).toContain("skip those skills and follow this Aegis prompt directly");
    expect(prompt).toContain("Preserve existing Aegis/Beads operational files and ignore rules.");
    expect(prompt).toContain("run package-manager commands as npm.cmd");
    expect(prompt).toContain("Do not use GUI/open/start/invoke-item/Start-Process");
    expect(prompt).toContain("Do not run long-running dev, preview, watcher, or server commands.");
    expect(prompt).toContain("Guard optional file reads and probes so missing paths do not exit nonzero");
    expect(prompt).toContain("PowerShell `rg` no-match exits 1 and fails the adapter");
    expect(prompt).toContain("Report files_changed as paths relative to the working directory, never as absolute paths.");
    expect(prompt).toContain("Allowed mutation_proposal.proposal_type values: create_clarification_blocker, create_prerequisite_blocker, create_out_of_scope_blocker.");
  });

  it("normalizes absolute Titan files_changed paths inside the labor worktree", async () => {
    const root = createTempRoot();
    saveDispatchState(root, {
      schemaVersion: 1,
      records: {
        "aegis-absolute-paths": {
          issueId: "aegis-absolute-paths",
          stage: "scouted",
          runningAgent: null,
          oracleAssessmentRef: path.join(".aegis", "oracle", "aegis-absolute-paths.json"),
          sentinelVerdictRef: null,
          fileScope: {
            files: ["docs/setup-contract.md"],
          },
          failureCount: 0,
          consecutiveFailures: 0,
          failureWindowStartMs: null,
          cooldownUntil: null,
          sessionProvenanceId: "test",
          updatedAt: "2026-04-14T12:00:00.000Z",
        },
      },
    });

    initializeGitRepository(root);

    await runCasteCommand({
      root,
      action: "implement",
      issueId: "aegis-absolute-paths",
      tracker: {
        getIssue: vi.fn(async () => createIssue("aegis-absolute-paths")),
      },
      runtime: new ScriptedCasteRuntime({
        titan: (input) => {
          const changedPath = path.join(input.workingDirectory, "docs", "setup-contract.md");
          mkdirSync(path.dirname(changedPath), { recursive: true });
          writeFileSync(changedPath, "contract\n", "utf8");
          runGit(input.workingDirectory, ["add", "docs/setup-contract.md"]);
          runGit(input.workingDirectory, ["commit", "-m", "contract"]);
          return {
            output: JSON.stringify({
              outcome: "success",
              summary: "implemented in worktree",
              files_changed: [changedPath],
              tests_and_checks_run: [],
              known_risks: [],
              follow_up_work: [],
            }),
            toolsUsed: ["write_file"],
          };
        },
      }),
      resolveBaseBranch: () => "main",
      resolveLaborBasePath: () => "scratchpad",
    });

    const artifact = JSON.parse(
      readFileSync(
        path.join(root, ".aegis", "titan", "aegis-absolute-paths.json"),
        "utf8",
      ),
    ) as { files_changed: string[] };

    expect(artifact.files_changed).toEqual(["docs/setup-contract.md"]);
  });

  it("rejects Titan success when the candidate branch head does not advance", async () => {
    const root = createTempRoot();
    saveDispatchState(root, {
      schemaVersion: 1,
      records: {
        "aegis-235": {
          issueId: "aegis-235",
          stage: "scouted",
          runningAgent: null,
          oracleAssessmentRef: path.join(".aegis", "oracle", "aegis-235.json"),
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

    initializeGitRepository(root);

    await expect(runCasteCommand({
      root,
      action: "implement",
      issueId: "aegis-235",
      tracker: {
        getIssue: vi.fn(async () => createIssue("aegis-235")),
      },
      runtime: new ScriptedCasteRuntime({
        titan: (input) => {
          writeFileSync(path.join(input.workingDirectory, "phase-i-proof.txt"), "proof\n", "utf8");
          return {
            output: JSON.stringify({
              outcome: "success",
              summary: "left changes uncommitted",
              files_changed: ["phase-i-proof.txt"],
              tests_and_checks_run: [],
              known_risks: [],
              follow_up_work: [],
            }),
            toolsUsed: ["write_file"],
          };
        },
      }),
      resolveBaseBranch: () => "main",
      resolveLaborBasePath: () => "scratchpad",
    })).rejects.toThrow("did not advance candidate branch");

    const state = JSON.parse(
      readFileSync(path.join(root, ".aegis", "dispatch-state.json"), "utf8"),
    ) as {
      records: Record<string, { stage: string }>;
    };

    expect(state.records["aegis-235"]?.stage).toBe("scouted");
  });

  it("accepts Titan already-satisfied handoff without branch advancement", async () => {
    const root = createTempRoot();
    saveDispatchState(root, {
      schemaVersion: 1,
      records: {
        "aegis-237": {
          issueId: "aegis-237",
          stage: "scouted",
          runningAgent: null,
          oracleAssessmentRef: path.join(".aegis", "oracle", "aegis-237.json"),
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

    initializeGitRepository(root);

    const result = await runCasteCommand({
      root,
      action: "implement",
      issueId: "aegis-237",
      tracker: {
        getIssue: vi.fn(async () => createIssue("aegis-237")),
      },
      runtime: new ScriptedCasteRuntime({
        titan: () => ({
          output: JSON.stringify({
            outcome: "already_satisfied",
            summary: "Issue contract already satisfied by prior merged work.",
            files_changed: [],
            tests_and_checks_run: ["npm run build"],
            known_risks: [],
            follow_up_work: [],
          }),
        }),
      }),
      resolveBaseBranch: () => "main",
      resolveLaborBasePath: () => "scratchpad",
    });

    const state = JSON.parse(
      readFileSync(path.join(root, ".aegis", "dispatch-state.json"), "utf8"),
    ) as {
      records: Record<string, { stage: string; titanHandoffRef: string | null }>;
    };

    expect(result).toMatchObject({
      action: "implement",
      issueId: "aegis-237",
      stage: "implemented",
    });
    expect(state.records["aegis-237"]).toMatchObject({
      stage: "implemented",
      titanHandoffRef: expect.stringContaining(path.join(".aegis", "titan")),
    });
  });

  it("rejects Titan success when implementation dirties the project root", async () => {
    const root = createTempRoot();
    saveDispatchState(root, {
      schemaVersion: 1,
      records: {
        "aegis-236": {
          issueId: "aegis-236",
          stage: "scouted",
          runningAgent: null,
          oracleAssessmentRef: path.join(".aegis", "oracle", "aegis-236.json"),
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

    initializeGitRepository(root);

    await expect(runCasteCommand({
      root,
      action: "implement",
      issueId: "aegis-236",
      tracker: {
        getIssue: vi.fn(async () => createIssue("aegis-236")),
      },
      runtime: new ScriptedCasteRuntime({
        titan: (input) => {
          writeFileSync(path.join(input.workingDirectory, "phase-i-proof.txt"), "proof\n", "utf8");
          runGit(input.workingDirectory, ["add", "phase-i-proof.txt"]);
          runGit(input.workingDirectory, ["commit", "-m", "phase i"]);
          writeFileSync(path.join(root, "root-leak.txt"), "leak\n", "utf8");
          return {
            output: JSON.stringify({
              outcome: "success",
              summary: "committed work but leaked into root",
              files_changed: ["phase-i-proof.txt"],
              tests_and_checks_run: [],
              known_risks: [],
              follow_up_work: [],
            }),
            toolsUsed: ["write_file"],
          };
        },
      }),
      resolveBaseBranch: () => "main",
      resolveLaborBasePath: () => "scratchpad",
    })).rejects.toThrow("dirtied the project root");

    const state = JSON.parse(
      readFileSync(path.join(root, ".aegis", "dispatch-state.json"), "utf8"),
    ) as {
      records: Record<string, { stage: string }>;
    };

    expect(state.records["aegis-236"]?.stage).toBe("scouted");
  });

  it("rejects Titan success when the project root head changes during implementation", async () => {
    const root = createTempRoot();
    saveDispatchState(root, {
      schemaVersion: 1,
      records: {
        "aegis-root-head": {
          issueId: "aegis-root-head",
          stage: "scouted",
          runningAgent: null,
          oracleAssessmentRef: path.join(".aegis", "oracle", "aegis-root-head.json"),
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

    initializeGitRepository(root);

    await expect(runCasteCommand({
      root,
      action: "implement",
      issueId: "aegis-root-head",
      tracker: {
        getIssue: vi.fn(async () => createIssue("aegis-root-head")),
      },
      runtime: new ScriptedCasteRuntime({
        titan: (input) => {
          writeFileSync(path.join(input.workingDirectory, "candidate.txt"), "candidate\n", "utf8");
          runGit(input.workingDirectory, ["add", "candidate.txt"]);
          runGit(input.workingDirectory, ["commit", "-m", "candidate commit"]);
          writeFileSync(path.join(root, "root-commit.txt"), "root\n", "utf8");
          runGit(root, ["add", "root-commit.txt"]);
          runGit(root, ["commit", "-m", "root commit"]);
          return {
            output: JSON.stringify({
              outcome: "success",
              summary: "committed candidate and root branch",
              files_changed: ["candidate.txt"],
              tests_and_checks_run: [],
              known_risks: [],
              follow_up_work: [],
            }),
            toolsUsed: ["bash"],
          };
        },
      }),
      resolveBaseBranch: () => "main",
      resolveLaborBasePath: () => "scratchpad",
    })).rejects.toThrow("changed the project root HEAD");
  });

  it("adopts a clean in-scope root commit when Titan commits the root instead of labor", async () => {
    const root = createTempRoot();
    saveDispatchState(root, {
      schemaVersion: 1,
      records: {
        "aegis-root-adopt": {
          issueId: "aegis-root-adopt",
          stage: "scouted",
          runningAgent: null,
          oracleAssessmentRef: path.join(".aegis", "oracle", "aegis-root-adopt.json"),
          sentinelVerdictRef: null,
          fileScope: {
            files: ["package-lock.json", "package.json"],
          },
          failureCount: 0,
          consecutiveFailures: 0,
          failureWindowStartMs: null,
          cooldownUntil: null,
          sessionProvenanceId: "test",
          updatedAt: "2026-04-14T12:00:00.000Z",
        },
      },
    });

    initializeGitRepository(root);

    const result = await runCasteCommand({
      root,
      action: "implement",
      issueId: "aegis-root-adopt",
      tracker: {
        getIssue: vi.fn(async () => createIssue("aegis-root-adopt")),
      },
      runtime: new ScriptedCasteRuntime({
        titan: (input) => {
          writeFileSync(path.join(input.workingDirectory, "package.json"), "{\"private\":true}\n", "utf8");
          writeFileSync(path.join(root, "package.json"), "{\"private\":true}\n", "utf8");
          writeFileSync(path.join(root, "package-lock.json"), "{\"lockfileVersion\":3}\n", "utf8");
          runGit(root, ["add", "package.json", "package-lock.json"]);
          runGit(root, ["commit", "-m", "install core dependencies"]);
          return {
            output: JSON.stringify({
              outcome: "success",
              summary: "committed root manifests",
              files_changed: ["package-lock.json", "package.json"],
              tests_and_checks_run: ["npm install"],
              known_risks: [],
              follow_up_work: [],
            }),
            toolsUsed: ["bash"],
          };
        },
      }),
      resolveBaseBranch: () => "main",
      resolveLaborBasePath: () => "scratchpad",
    });

    const artifact = JSON.parse(
      readFileSync(path.join(root, ".aegis", "titan", "aegis-root-adopt.json"), "utf8"),
    ) as {
      candidate_branch: string;
      base_branch: string;
      labor_path: string;
      adoption?: { mode: string };
    };

    expect(result).toMatchObject({
      action: "implement",
      issueId: "aegis-root-adopt",
      stage: "implemented",
    });
    expect(artifact).toMatchObject({
      candidate_branch: "main",
      base_branch: "main",
      labor_path: root,
      adoption: {
        mode: "root_commit",
      },
    });
  });

  it("tells resumed Titan work that the blocking child already closed", async () => {
    const root = createTempRoot();
    saveDispatchState(root, {
      schemaVersion: 1,
      records: {
        "aegis-resume-parent": {
          issueId: "aegis-resume-parent",
          stage: "implementing",
          runningAgent: null,
          lastCompletedCaste: "titan",
          blockedByIssueId: "aegis-child-done",
          reviewFeedbackRef: null,
          policyArtifactRef: path.join(".aegis", "policy", "aegis-resume-parent.json"),
          oracleAssessmentRef: path.join(".aegis", "oracle", "aegis-resume-parent.json"),
          titanHandoffRef: path.join(".aegis", "titan", "aegis-resume-parent.json"),
          titanClarificationRef: path.join(".aegis", "titan", "aegis-resume-parent.json"),
          sentinelVerdictRef: null,
          janusArtifactRef: null,
          failureTranscriptRef: null,
          fileScope: {
            files: ["vite.config.ts"],
          },
          failureCount: 0,
          consecutiveFailures: 0,
          failureWindowStartMs: null,
          cooldownUntil: null,
          sessionProvenanceId: "test",
          updatedAt: "2026-04-14T12:00:00.000Z",
        },
      },
    });
    persistArtifact(root, {
      family: "oracle",
      issueId: "aegis-resume-parent",
      artifact: {
        files_affected: ["vite.config.ts"],
        estimated_complexity: "moderate",
        risks: [],
        suggested_checks: [],
        scope_notes: [],
      },
    });
    initializeGitRepository(root);

    let titanPrompt = "";
    const result = await runCasteCommand({
      root,
      action: "implement",
      issueId: "aegis-resume-parent",
      tracker: {
        getIssue: vi.fn(async () => createIssue("aegis-resume-parent")),
      },
      runtime: new ScriptedCasteRuntime({
        titan: (input) => {
          titanPrompt = input.prompt;
          return {
            output: JSON.stringify({
              outcome: "already_satisfied",
              summary: "Closed child already handled the package work.",
              files_changed: [],
              tests_and_checks_run: ["git status --short"],
              known_risks: [],
              follow_up_work: [],
            }),
            toolsUsed: ["bash"],
          };
        },
      }),
      resolveBaseBranch: () => "main",
      resolveLaborBasePath: () => "scratchpad",
    });

    expect(titanPrompt).toContain("Previously blocked by child issue aegis-child-done");
    expect(result.stage).toBe("implemented");
    expect(loadDispatchState(root).records["aegis-resume-parent"]?.blockedByIssueId).toBeNull();
  });

  it("rejects already_satisfied for policy-created blocker issues", async () => {
    const root = createTempRoot();
    saveDispatchState(root, {
      schemaVersion: 1,
      records: {
        "aegis-policy-child": {
          issueId: "aegis-policy-child",
          stage: "scouted",
          runningAgent: null,
          lastCompletedCaste: "oracle",
          blockedByIssueId: null,
          reviewFeedbackRef: null,
          policyArtifactRef: null,
          oracleAssessmentRef: path.join(".aegis", "oracle", "aegis-policy-child.json"),
          titanHandoffRef: null,
          titanClarificationRef: null,
          sentinelVerdictRef: null,
          janusArtifactRef: null,
          failureTranscriptRef: null,
          fileScope: {
            files: ["package.json"],
          },
          failureCount: 0,
          consecutiveFailures: 0,
          failureWindowStartMs: null,
          cooldownUntil: null,
          sessionProvenanceId: "test",
          updatedAt: "2026-04-14T12:00:00.000Z",
        },
      },
    });
    persistArtifact(root, {
      family: "oracle",
      issueId: "aegis-policy-child",
      artifact: {
        files_affected: ["package.json"],
        estimated_complexity: "moderate",
        risks: [],
        suggested_checks: ["npm run format:check"],
        scope_notes: [],
      },
    });
    initializeGitRepository(root);

    const issue = createIssue("aegis-policy-child");
    issue.description = [
      "Fix package formatting.",
      "Policy proposal: create_out_of_scope_blocker",
      "Fingerprint: abc123",
      "Scope evidence:",
      "- package.json was failing format check.",
    ].join("\n");

    let titanPrompt = "";
    await expect(runCasteCommand({
      root,
      action: "implement",
      issueId: "aegis-policy-child",
      tracker: {
        getIssue: vi.fn(async () => issue),
      },
      runtime: new ScriptedCasteRuntime({
        titan: (input) => {
          titanPrompt = input.prompt;
          return {
          output: JSON.stringify({
            outcome: "already_satisfied",
            summary: "No changes needed.",
            files_changed: [],
            tests_and_checks_run: ["npm run format:check"],
            known_risks: [],
            follow_up_work: [],
          }),
          };
        },
      }),
      resolveBaseBranch: () => "main",
      resolveLaborBasePath: () => "scratchpad",
    })).rejects.toThrow("policy-created blocker");
    expect(titanPrompt).toContain("Policy-created blocker issue");
    expect(titanPrompt).toContain("Do not resolve this blocker with already_satisfied");
  });

  it("rejects mutation proposals from policy-created blocker issues", async () => {
    const root = createTempRoot();
    saveDispatchState(root, {
      schemaVersion: 1,
      records: {
        "aegis-policy-child": {
          issueId: "aegis-policy-child",
          stage: "scouted",
          runningAgent: null,
          lastCompletedCaste: "oracle",
          blockedByIssueId: null,
          reviewFeedbackRef: null,
          policyArtifactRef: null,
          oracleAssessmentRef: path.join(".aegis", "oracle", "aegis-policy-child.json"),
          titanHandoffRef: null,
          titanClarificationRef: null,
          sentinelVerdictRef: null,
          janusArtifactRef: null,
          failureTranscriptRef: null,
          fileScope: {
            files: ["package.json"],
          },
          failureCount: 0,
          consecutiveFailures: 0,
          failureWindowStartMs: null,
          cooldownUntil: null,
          sessionProvenanceId: "test",
          updatedAt: "2026-04-14T12:00:00.000Z",
        },
      },
    });
    persistArtifact(root, {
      family: "oracle",
      issueId: "aegis-policy-child",
      artifact: {
        files_affected: ["package.json"],
        estimated_complexity: "moderate",
        risks: [],
        suggested_checks: ["npm run format:check"],
        scope_notes: [],
      },
    });
    initializeGitRepository(root);

    const issue = createIssue("aegis-policy-child");
    issue.description = [
      "Fix package formatting.",
      "Policy proposal: create_out_of_scope_blocker",
      "Fingerprint: abc123",
      "Scope evidence:",
      "- package.json was failing format check.",
    ].join("\n");

    await expect(runCasteCommand({
      root,
      action: "implement",
      issueId: "aegis-policy-child",
      tracker: {
        getIssue: vi.fn(async () => issue),
        createIssue: vi.fn(async () => "aegis-next-child"),
        linkBlockingIssue: vi.fn(async () => undefined),
      },
      runtime: new ScriptedCasteRuntime({
        titan: () => ({
          output: JSON.stringify({
            outcome: "failure",
            summary: "Need another file.",
            files_changed: [],
            tests_and_checks_run: ["npm run format:check"],
            known_risks: [],
            follow_up_work: [],
            mutation_proposal: {
              proposal_type: "create_out_of_scope_blocker",
              summary: "Need config change.",
              suggested_title: "Fix config",
              suggested_description: "Fix config before package formatting.",
              scope_evidence: ["config file is outside package scope"],
            },
          }),
        }),
      }),
      resolveBaseBranch: () => "main",
      resolveLaborBasePath: () => "scratchpad",
    })).rejects.toThrow("policy-created blocker");
  });

  it("uses JSON artifact instructions instead of tool-call instructions in JSON emission mode", async () => {
    const root = createTempRoot();
    initializeGitRepository(root);
    persistArtifact(root, {
      family: "titan",
      issueId: "aegis-json-review",
      artifact: {
        labor_path: root,
        candidate_branch: "main",
        base_branch: "main",
      },
    });
    saveDispatchState(root, {
      schemaVersion: 1,
      records: {
        "aegis-json-review": {
          issueId: "aegis-json-review",
          stage: "implemented",
          runningAgent: null,
          lastCompletedCaste: "titan",
          blockedByIssueId: null,
          reviewFeedbackRef: null,
          policyArtifactRef: null,
          oracleAssessmentRef: path.join(".aegis", "oracle", "aegis-json-review.json"),
          titanHandoffRef: path.join(".aegis", "titan", "aegis-json-review.json"),
          titanClarificationRef: null,
          sentinelVerdictRef: null,
          janusArtifactRef: null,
          failureTranscriptRef: null,
          fileScope: { files: ["docs/setup-contract.md"] },
          failureCount: 0,
          consecutiveFailures: 0,
          failureWindowStartMs: null,
          cooldownUntil: null,
          sessionProvenanceId: "test",
          updatedAt: "2026-04-14T12:00:00.000Z",
        },
      },
    });

    let sentinelPrompt = "";
    await runCasteCommand({
      root,
      action: "review",
      issueId: "aegis-json-review",
      artifactEmissionMode: "json",
      tracker: {
        getIssue: vi.fn(async () => createIssue("aegis-json-review")),
      },
      runtime: new ScriptedCasteRuntime({
        sentinel: (input) => {
          sentinelPrompt = input.prompt;
          return {
            output: JSON.stringify({
              verdict: "pass",
              reviewSummary: "ok",
              blockingFindings: [],
              advisories: [],
              touchedFiles: [],
              contractChecks: ["reviewed"],
            }),
          };
        },
      }),
      resolveBaseBranch: () => "main",
      resolveLaborBasePath: () => "scratchpad",
    });

    expect(sentinelPrompt).not.toContain("Call tool 'emit_sentinel_verdict'");
    expect(sentinelPrompt).toContain("Return the final artifact as the JSON object itself");
  });

  it("includes Sentinel blocking feedback in Titan rework prompts", async () => {
    const root = createTempRoot();
    const sentinelRef = persistArtifact(root, {
      family: "sentinel",
      issueId: "aegis-rework",
      artifact: {
        verdict: "fail_blocking",
        reviewSummary: "store persistence boundary violated",
        blockingFindings: [
          {
            finding_kind: "contract_gap",
            summary: "src/state/todo-store.ts persists filter state outside the core contract.",
            required_files: ["src/state/todo-store.ts"],
            owner_issue: "aegis-rework",
            route: "rework_owner",
          },
        ],
        advisories: [
          "Add a focused persistence regression test.",
        ],
        touchedFiles: ["src/state/todo-store.ts"],
        contractChecks: ["core gate"],
      },
    });
    saveDispatchState(root, {
      schemaVersion: 1,
      records: {
        "aegis-rework": {
          issueId: "aegis-rework",
          stage: "rework_required",
          runningAgent: null,
          lastCompletedCaste: "sentinel",
          blockedByIssueId: null,
          reviewFeedbackRef: sentinelRef,
          policyArtifactRef: null,
          oracleAssessmentRef: path.join(".aegis", "oracle", "aegis-rework.json"),
          titanHandoffRef: path.join(".aegis", "titan", "aegis-rework.json"),
          titanClarificationRef: null,
          sentinelVerdictRef: sentinelRef,
          janusArtifactRef: null,
          failureTranscriptRef: null,
          fileScope: {
            files: ["docs/core-gate.md"],
          },
          failureCount: 0,
          consecutiveFailures: 0,
          failureWindowStartMs: null,
          cooldownUntil: null,
          sessionProvenanceId: "test",
          updatedAt: "2026-04-14T12:00:00.000Z",
        },
      },
    });
    persistArtifact(root, {
      family: "oracle",
      issueId: "aegis-rework",
      artifact: {
        files_affected: ["docs/core-gate.md"],
        estimated_complexity: "moderate",
        risks: [],
        suggested_checks: ["npm test"],
        scope_notes: [],
      },
    });
    initializeGitRepository(root);

    let titanPrompt = "";
    await runCasteCommand({
      root,
      action: "implement",
      issueId: "aegis-rework",
      tracker: {
        getIssue: vi.fn(async () => createIssue("aegis-rework")),
      },
      runtime: new ScriptedCasteRuntime({
        titan: (input) => {
          titanPrompt = input.prompt;
          mkdirSync(path.join(input.workingDirectory, "docs"), { recursive: true });
          writeFileSync(path.join(input.workingDirectory, "docs", "core-gate.md"), "core gate\n", "utf8");
          runGit(input.workingDirectory, ["add", "docs/core-gate.md"]);
          runGit(input.workingDirectory, ["commit", "-m", "address rework"]);
          return {
            output: JSON.stringify({
              outcome: "success",
              summary: "updated gate evidence",
              files_changed: ["docs/core-gate.md"],
              tests_and_checks_run: ["npm test"],
              known_risks: [],
              follow_up_work: [],
            }),
          };
        },
      }),
      resolveBaseBranch: () => "main",
      resolveLaborBasePath: () => "scratchpad",
    });

    expect(titanPrompt).toContain("Prior Sentinel or Janus feedback:");
    expect(titanPrompt).toContain("src/state/todo-store.ts persists filter state outside the core contract.");
    expect(titanPrompt).toContain("If resolving this feedback requires files outside the allowed file scope, emit a blocking mutation_proposal");
  });

  it("fails closed instead of creating repeated blockers after a resolved child", async () => {
    const root = createTempRoot();
    saveDispatchState(root, {
      schemaVersion: 1,
      records: {
        "aegis-resume-parent": {
          issueId: "aegis-resume-parent",
          stage: "implementing",
          runningAgent: null,
          lastCompletedCaste: "titan",
          blockedByIssueId: "aegis-child-done",
          reviewFeedbackRef: null,
          policyArtifactRef: path.join(".aegis", "policy", "aegis-resume-parent.json"),
          oracleAssessmentRef: path.join(".aegis", "oracle", "aegis-resume-parent.json"),
          titanHandoffRef: null,
          titanClarificationRef: path.join(".aegis", "titan", "aegis-resume-parent.json"),
          sentinelVerdictRef: null,
          janusArtifactRef: null,
          failureTranscriptRef: null,
          fileScope: {
            files: ["docs/setup-gate.md"],
          },
          failureCount: 0,
          consecutiveFailures: 0,
          failureWindowStartMs: null,
          cooldownUntil: null,
          sessionProvenanceId: "test",
          updatedAt: "2026-04-14T12:00:00.000Z",
        },
      },
    });
    persistArtifact(root, {
      family: "oracle",
      issueId: "aegis-resume-parent",
      artifact: {
        files_affected: ["docs/setup-gate.md"],
        estimated_complexity: "moderate",
        risks: [],
        suggested_checks: ["npm run format:check"],
        scope_notes: [],
      },
    });
    initializeGitRepository(root);

    const createIssueSpy = vi.fn();
    await expect(runCasteCommand({
      root,
      action: "implement",
      issueId: "aegis-resume-parent",
      tracker: {
        getIssue: vi.fn(async () => createIssue("aegis-resume-parent")),
        createIssue: createIssueSpy,
      },
      runtime: new ScriptedCasteRuntime({
        titan: () => ({
          output: JSON.stringify({
            outcome: "failure",
            summary: "Still blocked.",
            files_changed: [],
            tests_and_checks_run: ["npm run format:check"],
            known_risks: [],
            follow_up_work: [],
            mutation_proposal: {
              proposal_type: "create_out_of_scope_blocker",
              summary: "Same formatting blocker remains.",
              suggested_title: "Format config",
              suggested_description: "Format config files.",
              scope_evidence: ["format:check still failed"],
            },
          }),
        }),
      }),
      resolveBaseBranch: () => "main",
      resolveLaborBasePath: () => "scratchpad",
      now: "2026-04-14T12:00:00.000Z",
    })).rejects.toThrow("avoid blocker amplification");

    const record = loadDispatchState(root).records["aegis-resume-parent"];
    expect(record?.stage).toBe("failed_operational");
    expect(record?.failureCount).toBe(1);
    expect(createIssueSpy).not.toHaveBeenCalled();
  });

  it("rejects Titan artifact file links instead of treating them as changed paths", async () => {
    const root = createTempRoot();
    saveDispatchState(root, {
      schemaVersion: 1,
      records: {
        "aegis-file-link": {
          issueId: "aegis-file-link",
          stage: "scouted",
          runningAgent: null,
          oracleAssessmentRef: path.join(".aegis", "oracle", "aegis-file-link.json"),
          sentinelVerdictRef: null,
          fileScope: {
            files: ["src/index.ts"],
          },
          failureCount: 0,
          consecutiveFailures: 0,
          failureWindowStartMs: null,
          cooldownUntil: null,
          sessionProvenanceId: "test",
          updatedAt: "2026-04-14T12:00:00.000Z",
        },
      },
    });

    initializeGitRepository(root);

    await expect(runCasteCommand({
      root,
      action: "implement",
      issueId: "aegis-file-link",
      tracker: {
        getIssue: vi.fn(async () => createIssue("aegis-file-link")),
      },
      runtime: new ScriptedCasteRuntime({
        titan: (input) => {
          mkdirSync(path.join(input.workingDirectory, "src"), { recursive: true });
          writeFileSync(path.join(input.workingDirectory, "src", "index.ts"), "export {};\n", "utf8");
          runGit(input.workingDirectory, ["add", "src/index.ts"]);
          runGit(input.workingDirectory, ["commit", "-m", "add index"]);
          return {
            output: JSON.stringify({
              outcome: "success",
              summary: "reported markdown link path",
              files_changed: [`[src/index.ts](file://${path.join(root, "src", "index.ts")})`],
              tests_and_checks_run: [],
              known_risks: [],
              follow_up_work: [],
            }),
            toolsUsed: ["bash"],
          };
        },
      }),
      resolveBaseBranch: () => "main",
      resolveLaborBasePath: () => "scratchpad",
    })).rejects.toThrow("invalid files_changed path");
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
    writeTitanArtifact(root, "aegis-999");
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

  it("runs Sentinel when daemon pre-marked an implemented issue as reviewing", async () => {
    const root = createTempRoot();
    writeTitanArtifact(root, "aegis-reviewing");
    saveDispatchState(root, {
      schemaVersion: 1,
      records: {
        "aegis-reviewing": {
          issueId: "aegis-reviewing",
          stage: "reviewing",
          runningAgent: null,
          oracleAssessmentRef: path.join(".aegis", "oracle", "aegis-reviewing.json"),
          titanHandoffRef: path.join(".aegis", "titan", "aegis-reviewing.json"),
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
      action: "review",
      issueId: "aegis-reviewing",
      tracker: {
        getIssue: vi.fn(async () => createIssue("aegis-reviewing")),
      },
      runtime: new ScriptedCasteRuntime({
        sentinel: () => ({
          output: createSentinelPassOutput(),
        }),
      }),
    });

    expect(result).toMatchObject({
      action: "review",
      issueId: "aegis-reviewing",
      stage: "queued_for_merge",
    });
  });

  it("sends Sentinel blocking findings to same-parent rework without creating issues", async () => {
    const root = createTempRoot();
    writeTitanArtifact(root, "aegis-1001");
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
      blockingFindings: [
        expect.objectContaining({
          summary: "update tests",
          route: "rework_owner",
        }),
        expect.objectContaining({
          summary: "tighten validation",
          route: "rework_owner",
        }),
      ],
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

  it("routes Sentinel out-of-scope findings through deterministic blocker policy", async () => {
    const root = createTempRoot();
    allowComplexAutoDispatch(root);
    writeTitanArtifact(root, "aegis-1003");
    saveDispatchState(root, {
      schemaVersion: 1,
      records: {
        "aegis-1003": {
          issueId: "aegis-1003",
          stage: "implemented",
          runningAgent: null,
          oracleAssessmentRef: path.join(".aegis", "oracle", "aegis-1003.json"),
          titanHandoffRef: path.join(".aegis", "titan", "aegis-1003.json"),
          sentinelVerdictRef: null,
          fileScope: { files: ["src/index.ts"] },
          failureCount: 0,
          consecutiveFailures: 0,
          failureWindowStartMs: null,
          cooldownUntil: null,
          sessionProvenanceId: "test",
          updatedAt: "2026-04-14T12:00:00.000Z",
        },
      },
    });

    const createBlockerIssue = vi.fn(async () => "aegis-blocker-1");
    const linkBlockingIssue = vi.fn(async () => undefined);

    const result = await runCasteCommand({
      root,
      action: "review",
      issueId: "aegis-1003",
      tracker: {
        getIssue: vi.fn(async () => ({
          ...createIssue("aegis-1003"),
          labels: ["gate"],
        })),
        createIssue: createBlockerIssue,
        linkBlockingIssue,
      },
      runtime: new ScriptedCasteRuntime({
        sentinel: () => ({
          output: createSentinelOutOfScopeBlockerOutput(),
        }),
      }),
    });

    expect(result).toMatchObject({
      action: "review",
      issueId: "aegis-1003",
      stage: "blocked_on_child",
    });
    expect(createBlockerIssue).toHaveBeenCalledWith(expect.objectContaining({
      title: "Resolve Sentinel out-of-scope blocker for aegis-1003",
    }), root);
    expect(linkBlockingIssue).toHaveBeenCalledWith({
      blockingIssueId: "aegis-blocker-1",
      blockedIssueId: "aegis-1003",
    }, root);

    const record = loadDispatchState(root).records["aegis-1003"];
    expect(record?.blockedByIssueId).toBe("aegis-blocker-1");
    expect(record?.reviewFeedbackRef).toBe(path.join(".aegis", "sentinel", "aegis-1003.json"));
    expect(record?.policyArtifactRef).toContain(path.join(".aegis", "policy"));
  });

  it("returns Sentinel create-blocker findings to owner rework when complex auto-dispatch is disabled", async () => {
    const root = createTempRoot();
    writeConfig(root);
    writeTitanArtifact(root, "aegis-no-amplify");
    saveDispatchState(root, {
      schemaVersion: 1,
      records: {
        "aegis-no-amplify": {
          issueId: "aegis-no-amplify",
          stage: "implemented",
          runningAgent: null,
          oracleAssessmentRef: path.join(".aegis", "oracle", "aegis-no-amplify.json"),
          titanHandoffRef: path.join(".aegis", "titan", "aegis-no-amplify.json"),
          sentinelVerdictRef: null,
          fileScope: { files: ["src/index.ts"] },
          failureCount: 0,
          consecutiveFailures: 0,
          failureWindowStartMs: null,
          cooldownUntil: null,
          sessionProvenanceId: "test",
          updatedAt: "2026-04-14T12:00:00.000Z",
        },
      },
    });

    const createBlockerIssue = vi.fn(async () => "aegis-blocker-disabled");
    const linkBlockingIssue = vi.fn(async () => undefined);

    const result = await runCasteCommand({
      root,
      action: "review",
      issueId: "aegis-no-amplify",
      tracker: {
        getIssue: vi.fn(async () => ({
          ...createIssue("aegis-no-amplify"),
          labels: ["gate"],
        })),
        createIssue: createBlockerIssue,
        linkBlockingIssue,
      },
      runtime: new ScriptedCasteRuntime({
        sentinel: () => ({
          output: createSentinelOutOfScopeBlockerOutput(),
        }),
      }),
    });

    expect(result).toMatchObject({
      action: "review",
      issueId: "aegis-no-amplify",
      stage: "rework_required",
    });
    expect(createBlockerIssue).not.toHaveBeenCalled();
    expect(linkBlockingIssue).not.toHaveBeenCalled();

    const record = loadDispatchState(root).records["aegis-no-amplify"];
    expect(record).toMatchObject({
      stage: "rework_required",
      blockedByIssueId: null,
      policyArtifactRef: null,
      sentinelVerdictRef: path.join(".aegis", "sentinel", "aegis-no-amplify.json"),
      reviewFeedbackRef: path.join(".aegis", "sentinel", "aegis-no-amplify.json"),
    });
  });

  it("ignores ambient cross-scope Sentinel findings for normal slice reviews", async () => {
    const root = createTempRoot();
    writeTitanArtifact(root, "aegis-ambient");
    saveDispatchState(root, {
      schemaVersion: 1,
      records: {
        "aegis-ambient": {
          issueId: "aegis-ambient",
          stage: "implemented",
          runningAgent: null,
          oracleAssessmentRef: path.join(".aegis", "oracle", "aegis-ambient.json"),
          titanHandoffRef: path.join(".aegis", "titan", "aegis-ambient.json"),
          sentinelVerdictRef: null,
          fileScope: { files: ["src/index.ts"] },
          failureCount: 0,
          consecutiveFailures: 0,
          failureWindowStartMs: null,
          cooldownUntil: null,
          sessionProvenanceId: "test",
          updatedAt: "2026-04-14T12:00:00.000Z",
        },
      },
    });

    const createBlockerIssue = vi.fn(async () => "aegis-blocker-ambient");
    const linkBlockingIssue = vi.fn(async () => undefined);

    const result = await runCasteCommand({
      root,
      action: "review",
      issueId: "aegis-ambient",
      tracker: {
        getIssue: vi.fn(async () => createIssue("aegis-ambient")),
        createIssue: createBlockerIssue,
        linkBlockingIssue,
      },
      runtime: new ScriptedCasteRuntime({
        sentinel: () => ({
          output: createSentinelOutOfScopeBlockerOutput(),
        }),
      }),
    });

    expect(result).toMatchObject({
      action: "review",
      issueId: "aegis-ambient",
      stage: "queued_for_merge",
    });
    expect(createBlockerIssue).not.toHaveBeenCalled();
    expect(linkBlockingIssue).not.toHaveBeenCalled();

    const record = loadDispatchState(root).records["aegis-ambient"];
    expect(record?.blockedByIssueId ?? null).toBeNull();
    expect(record?.policyArtifactRef).toBeUndefined();
    const sentinelArtifact = JSON.parse(readFileSync(path.join(root, ".aegis", "sentinel", "aegis-ambient.json"), "utf8")) as {
      verdict: string;
      blockingFindings: unknown[];
      ignoredBlockingFindings: unknown[];
    };
    expect(sentinelArtifact.verdict).toBe("pass");
    expect(sentinelArtifact.blockingFindings).toEqual([]);
    expect(sentinelArtifact.ignoredBlockingFindings).toHaveLength(1);
  });

  it("does not create Sentinel follow-up issues on review rerun", async () => {
    const root = createTempRoot();
    writeTitanArtifact(root, "aegis-1002");
    mkdirSync(path.join(root, ".aegis", "sentinel"), { recursive: true });
    writeFileSync(
      path.join(root, ".aegis", "sentinel", "aegis-1002.json"),
      `${JSON.stringify({
        verdict: "fail_blocking",
        reviewSummary: "needs fixes",
        blockingFindings: [
          {
            finding_kind: "contract_gap",
            summary: "update tests",
            required_files: ["tests/unit/core/caste-runner.test.ts"],
            owner_issue: "aegis-1002",
            route: "rework_owner",
          },
          {
            finding_kind: "regression",
            summary: "tighten validation",
            required_files: ["src/core/caste-runner.ts"],
            owner_issue: "aegis-1002",
            route: "rework_owner",
          },
        ],
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
      blockingFindings: [
        expect.objectContaining({
          summary: "update tests",
          route: "rework_owner",
        }),
        expect.objectContaining({
          summary: "tighten validation",
          route: "rework_owner",
        }),
      ],
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
    writeTitanArtifact(root, "aegis-1000");
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

  it("runs Sentinel review in the candidate labor path instead of the project root", async () => {
    const root = createTempRoot();
    const laborPath = path.join(root, "scratchpad", "aegis-1003");
    mkdirSync(path.join(root, ".aegis", "titan"), { recursive: true });
    mkdirSync(laborPath, { recursive: true });
    writeFileSync(
      path.join(root, ".aegis", "titan", "aegis-1003.json"),
      `${JSON.stringify({
        outcome: "success",
        summary: "done",
        files_changed: ["src/index.ts"],
        tests_and_checks_run: ["npm test"],
        known_risks: [],
        follow_up_work: [],
        labor_path: "scratchpad/aegis-1003",
        candidate_branch: "aegis/aegis-1003",
        base_branch: "main",
      }, null, 2)}\n`,
      "utf8",
    );
    saveDispatchState(root, {
      schemaVersion: 1,
      records: {
        "aegis-1003": {
          issueId: "aegis-1003",
          stage: "implemented",
          runningAgent: null,
          oracleAssessmentRef: path.join(".aegis", "oracle", "aegis-1003.json"),
          titanHandoffRef: path.join(".aegis", "titan", "aegis-1003.json"),
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

    let reviewWorkingDirectory: string | undefined;
    const result = await runCasteCommand({
      root,
      action: "review",
      issueId: "aegis-1003",
      tracker: {
        getIssue: vi.fn(async () => createIssue("aegis-1003")),
      },
      runtime: new ScriptedCasteRuntime({
        sentinel: (input) => {
          reviewWorkingDirectory = input.workingDirectory;
          return {
            output: createSentinelPassOutput(),
          };
        },
      }),
    });

    expect(result).toMatchObject({
      action: "review",
      issueId: "aegis-1003",
      stage: "queued_for_merge",
    });
    expect(reviewWorkingDirectory).toBe(laborPath);
  });
});
