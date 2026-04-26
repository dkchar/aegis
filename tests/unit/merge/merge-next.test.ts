import path from "node:path";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_AEGIS_CONFIG } from "../../../src/config/defaults.js";
import { loadDispatchState, saveDispatchState, type DispatchRecord, type DispatchState } from "../../../src/core/dispatch-state.js";
import { runDaemonCycle } from "../../../src/core/loop-runner.js";
import { runMergeNext } from "../../../src/merge/merge-next.js";
import { loadMergeQueueState, saveMergeQueueState, type MergeQueueItem } from "../../../src/merge/merge-state.js";
import { ScriptedCasteRuntime } from "../../../src/runtime/scripted-caste-runtime.js";
import type { AgentRuntime } from "../../../src/runtime/agent-runtime.js";
import { BeadsTrackerClient } from "../../../src/tracker/beads-tracker.js";
import type { AegisIssue } from "../../../src/tracker/issue-model.js";

const tempRoots: string[] = [];

function runGit(root: string, args: string[]) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
}

function initializeGitRepository(root: string) {
  runGit(root, ["init"]);
  runGit(root, ["config", "user.email", "test@aegis.local"]);
  runGit(root, ["config", "user.name", "Aegis Test"]);
  writeFileSync(path.join(root, "README.md"), "baseline\n", "utf8");
  runGit(root, ["add", "--all"]);
  runGit(root, ["commit", "-m", "baseline"]);
  runGit(root, ["branch", "-M", "main"]);
}

function createTempRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "aegis-merge-next-"));
  tempRoots.push(root);
  mkdirSync(path.join(root, ".aegis"), { recursive: true });
  writeFileSync(
    path.join(root, ".aegis", "config.json"),
    `${JSON.stringify(DEFAULT_AEGIS_CONFIG, null, 2)}\n`,
    "utf8",
  );
  return root;
}

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

function createRecord(issueId: string, stage: DispatchRecord["stage"]): DispatchRecord {
  return {
    issueId,
    stage,
    runningAgent: null,
    oracleAssessmentRef: path.join(".aegis", "oracle", `${issueId}.json`),
    titanHandoffRef: path.join(".aegis", "titan", `${issueId}.json`),
    titanClarificationRef: null,
    sentinelVerdictRef: path.join(".aegis", "sentinel", `${issueId}.json`),
    janusArtifactRef: null,
    failureTranscriptRef: null,
    fileScope: null,
    failureCount: 0,
    consecutiveFailures: 0,
    failureWindowStartMs: null,
    cooldownUntil: null,
    sessionProvenanceId: "test",
    updatedAt: "2026-04-14T12:00:00.000Z",
  };
}

function createJanusRequeueOutput(issueId: string) {
  return JSON.stringify({
    originatingIssueId: issueId,
    queueItemId: `queue-${issueId}`,
    preservedLaborPath: `labors/${issueId}`,
    conflictSummary: "Needs integration retry",
    resolutionStrategy: "Refresh merge candidate",
    filesTouched: [],
    validationsRun: [],
    residualRisks: [],
    mutation_proposal: {
      proposal_type: "requeue_parent",
      summary: "Refresh parent candidate with integration context.",
      scope_evidence: ["Conflict remains in parent scope."],
    },
  });
}

function createQueueItem(issueId: string, attempts = 0): MergeQueueItem {
  return {
    queueItemId: `queue-${issueId}`,
    issueId,
    candidateBranch: `aegis/${issueId}`,
    targetBranch: "main",
    laborPath: `labors/${issueId}`,
    status: "queued",
    attempts,
    janusInvocations: 0,
    lastTier: null,
    lastError: null,
    enqueuedAt: "2026-04-14T12:00:00.000Z",
    updatedAt: "2026-04-14T12:00:00.000Z",
  };
}

function writeTitanArtifact(root: string, issueId: string) {
  mkdirSync(path.join(root, ".aegis", "titan"), { recursive: true });
  writeFileSync(
    path.join(root, ".aegis", "titan", `${issueId}.json`),
    `${JSON.stringify({
      labor_path: `labors/${issueId}`,
      candidate_branch: `aegis/${issueId}`,
      base_branch: "main",
    }, null, 2)}\n`,
    "utf8",
  );
}

function writeState(root: string, issueId: string, attempts = 0) {
  const dispatchState: DispatchState = {
    schemaVersion: 1,
    records: {
      [issueId]: createRecord(issueId, "queued_for_merge"),
    },
  };

  saveDispatchState(root, dispatchState);
  saveMergeQueueState(root, {
    schemaVersion: 1,
    items: [createQueueItem(issueId, attempts)],
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("runMergeNext", () => {
  it("does not run Sentinel during merge execution and completes clean merges", async () => {
    const root = createTempRoot();
    writeState(root, "aegis-777");

    const result = await runMergeNext(root, {
      tracker: {
        getIssue: vi.fn(async () => createIssue("aegis-777")),
      },
      runtime: new ScriptedCasteRuntime({
        sentinel: () => ({
          output: JSON.stringify({
            verdict: "fail_blocking",
            reviewSummary: "contract regression",
            blockingFindings: ["missing required acceptance check"],
            advisories: ["tighten naming later"],
            touchedFiles: ["src/core/example.ts"],
            contractChecks: ["acceptance check present"],
          }),
        }),
      }),
      executor: {
        execute: vi.fn(async () => ({
          outcome: "merged" as const,
          detail: "Merged cleanly.",
        })),
      },
      now: "2026-04-24T10:30:00.000Z",
    });

    expect(result).toMatchObject({
      action: "merge_next",
      issueId: "aegis-777",
      status: "merged",
      stage: "complete",
    });
  });

  it("uses real git merge execution when runtime is pi", async () => {
    const root = createTempRoot();
    writeFileSync(
      path.join(root, ".aegis", "config.json"),
      `${JSON.stringify({
        ...DEFAULT_AEGIS_CONFIG,
        runtime: "pi",
      }, null, 2)}\n`,
      "utf8",
    );

    initializeGitRepository(root);

    runGit(root, ["checkout", "-b", "aegis/aegis-900"]);
    writeFileSync(path.join(root, "README.md"), "phase-i merge change\n", "utf8");
    runGit(root, ["add", "README.md"]);
    runGit(root, ["commit", "-m", "candidate change"]);
    runGit(root, ["checkout", "main"]);

    writeState(root, "aegis-900");

    const result = await runMergeNext(root, {
      tracker: {
        getIssue: vi.fn(async () => createIssue("aegis-900")),
      },
      runtime: new ScriptedCasteRuntime({
        sentinel: () => ({
          output: "{}",
        }),
      }),
      now: "2026-04-14T12:30:00.000Z",
    });

    expect(result).toMatchObject({
      action: "merge_next",
      status: "merged",
      issueId: "aegis-900",
      tier: "T1",
      stage: "complete",
    });
    expect(readFileSync(path.join(root, "README.md"), "utf8")).toContain("phase-i merge change");
  });

  it("fail-closes merge execution when the repo root has non-Aegis dirty files", async () => {
    const root = createTempRoot();
    writeFileSync(
      path.join(root, ".aegis", "config.json"),
      `${JSON.stringify({
        ...DEFAULT_AEGIS_CONFIG,
        runtime: "pi",
      }, null, 2)}\n`,
      "utf8",
    );

    initializeGitRepository(root);

    runGit(root, ["checkout", "-b", "aegis/aegis-902"]);
    writeFileSync(path.join(root, "README.md"), "phase-i merge change\n", "utf8");
    runGit(root, ["add", "README.md"]);
    runGit(root, ["commit", "-m", "candidate change"]);
    runGit(root, ["checkout", "main"]);

    writeState(root, "aegis-902");
    writeFileSync(path.join(root, "root-leak.txt"), "dirty\n", "utf8");

    const result = await runMergeNext(root, {
      tracker: {
        getIssue: vi.fn(async () => createIssue("aegis-902")),
      },
      now: "2026-04-14T12:30:00.000Z",
    });

    expect(result).toMatchObject({
      action: "merge_next",
      status: "requeued",
      issueId: "aegis-902",
      tier: "T2",
      stage: "queued_for_merge",
    });
    expect(result.detail).toContain("non-Aegis working tree changes");
    expect(result.detail).toContain("root-leak.txt");
  });

  it("uses scripted merge outcomes when a scripted merge plan override is provided under pi runtime", async () => {
    const root = createTempRoot();
    writeFileSync(
      path.join(root, ".aegis", "config.json"),
      `${JSON.stringify({
        ...DEFAULT_AEGIS_CONFIG,
        runtime: "pi",
      }, null, 2)}\n`,
      "utf8",
    );
    writeState(root, "aegis-901");

    const previousPlan = process.env.AEGIS_SCRIPTED_MERGE_PLAN;
    process.env.AEGIS_SCRIPTED_MERGE_PLAN = JSON.stringify({
      rules: [
        {
          issueId: "aegis-901",
          candidateBranch: "aegis/aegis-901",
          outcomes: [
            { outcome: "conflict", detail: "forced-conflict-attempt-0" },
          ],
        },
      ],
    });

    try {
      const result = await runMergeNext(root, {
        tracker: {
          getIssue: vi.fn(async () => createIssue("aegis-901")),
        },
        runtime: new ScriptedCasteRuntime({
          janus: () => ({
            output: JSON.stringify({
            ...JSON.parse(createJanusRequeueOutput("aegis-901")),
          }),
          }),
        }),
      });

      expect(result).toMatchObject({
        action: "merge_next",
        issueId: "aegis-901",
        tier: "T2",
        status: "requeued",
        stage: "queued_for_merge",
        detail: "forced-conflict-attempt-0",
      });
    } finally {
      if (previousPlan === undefined) {
        delete process.env.AEGIS_SCRIPTED_MERGE_PLAN;
      } else {
        process.env.AEGIS_SCRIPTED_MERGE_PLAN = previousPlan;
      }
    }
  });

  it("merges queued work without post-merge Sentinel and advances the issue to complete", async () => {
    const root = createTempRoot();
    writeState(root, "aegis-123");

    const result = await runMergeNext(root, {
      tracker: {
        getIssue: vi.fn(async () => createIssue("aegis-123")),
      },
      runtime: new ScriptedCasteRuntime({
        sentinel: () => ({
          output: "{}",
        }),
      }),
      executor: {
        execute: vi.fn(async () => ({
          outcome: "merged" as const,
          detail: "Merged cleanly.",
        })),
      },
      now: "2026-04-14T12:30:00.000Z",
    });

    expect(result).toMatchObject({
      action: "merge_next",
      issueId: "aegis-123",
      queueItemId: "queue-aegis-123",
      tier: "T1",
      stage: "complete",
      status: "merged",
    });
  });

  it("requeues T2 work without invoking Janus", async () => {
    const root = createTempRoot();
    writeState(root, "aegis-456");

    const runtime = new ScriptedCasteRuntime();
    const result = await runMergeNext(root, {
      tracker: {
        getIssue: vi.fn(async () => createIssue("aegis-456")),
      },
      runtime,
      executor: {
        execute: vi.fn(async () => ({
          outcome: "stale_branch" as const,
          detail: "Branch needs refresh.",
        })),
      },
      now: "2026-04-14T12:30:00.000Z",
    });

    expect(result).toMatchObject({
      action: "merge_next",
      issueId: "aegis-456",
      queueItemId: "queue-aegis-456",
      tier: "T2",
      stage: "queued_for_merge",
      status: "requeued",
    });

    expect(JSON.parse(
      readFileSync(path.join(root, ".aegis", "dispatch-state.json"), "utf8"),
    ).records["aegis-456"].stage).toBe("queued_for_merge");
  });

  it("dispatches Janus on T3 and sends in-scope integration feedback to rework", async () => {
    const root = createTempRoot();
    writeState(root, "aegis-789", 2);

    const result = await runMergeNext(root, {
      tracker: {
        getIssue: vi.fn(async () => createIssue("aegis-789")),
      },
      runtime: new ScriptedCasteRuntime({
        janus: () => ({
          output: createJanusRequeueOutput("aegis-789"),
        }),
      }),
      executor: {
        execute: vi.fn(async () => ({
          outcome: "conflict" as const,
          detail: "Merge conflict.",
        })),
      },
      now: "2026-04-14T12:30:00.000Z",
    });

    expect(result).toMatchObject({
      action: "merge_next",
      issueId: "aegis-789",
      queueItemId: "queue-aegis-789",
      tier: "T3",
      stage: "rework_required",
      status: "failed",
    });

    expect(JSON.parse(
      readFileSync(path.join(root, ".aegis", "dispatch-state.json"), "utf8"),
    ).records["aegis-789"].stage).toBe("rework_required");
    expect(JSON.parse(
      readFileSync(path.join(root, ".aegis", "merge-queue.json"), "utf8"),
    ).items[0]).toMatchObject({
      status: "failed",
      janusInvocations: 1,
    });
  });

  it("blocks parent on T3 when Janus proposes an integration blocker", async () => {
    const root = createTempRoot();
    writeState(root, "aegis-790", 2);

    const result = await runMergeNext(root, {
      runtime: new ScriptedCasteRuntime({
        janus: () => ({
          output: JSON.stringify({
            originatingIssueId: "aegis-790",
            queueItemId: "queue-aegis-790",
            preservedLaborPath: "labors/aegis-790",
            conflictSummary: "manual intervention required for conflicting schema migrations",
            resolutionStrategy: "escalate to operator decision",
            filesTouched: ["src/schema.ts", "migrations/20260419.sql"],
            validationsRun: ["npm run test -- tests/unit/schema.test.ts"],
            residualRisks: ["migration ordering still ambiguous"],
            mutation_proposal: {
              proposal_type: "create_integration_blocker",
              summary: "Resolve migration ordering outside parent scope.",
              suggested_title: "Resolve migration ordering conflict",
              suggested_description: "Merge conflict root cause is outside the parent issue scope.",
              scope_evidence: ["Conflict spans independent schema migrations."],
            },
          }),
        }),
      }),
      tracker: {
        getIssue: vi.fn(async () => createIssue("aegis-790")),
        createIssue: vi.fn(async () => "aegis-integration-1"),
        linkBlockingIssue: vi.fn(async () => undefined),
      },
      executor: {
        execute: vi.fn(async () => ({
          outcome: "conflict" as const,
          detail: "Merge conflict in src/schema.ts.",
        })),
      },
      now: "2026-04-19T14:30:00.000Z",
    });

    expect(result).toMatchObject({
      action: "merge_next",
      issueId: "aegis-790",
      queueItemId: "queue-aegis-790",
      tier: "T3",
      stage: "blocked_on_child",
      status: "failed",
    });

    const queueItem = JSON.parse(
      readFileSync(path.join(root, ".aegis", "merge-queue.json"), "utf8"),
    ).items[0] as {
      status: string;
      attempts: number;
      janusInvocations: number;
      lastTier: string;
      lastError: string | null;
    };

    expect(queueItem).toMatchObject({
      status: "failed",
      attempts: 3,
      janusInvocations: 1,
      lastTier: "T3",
    });
    expect(queueItem.lastError).toContain("Merge conflict in src/schema.ts.");
    expect(queueItem.lastError).toContain("create_integration_blocker");

    const dispatchState = JSON.parse(
      readFileSync(path.join(root, ".aegis", "dispatch-state.json"), "utf8"),
    ) as {
      records: Record<string, {
        stage: string;
        janusArtifactRef: string | null;
      }>;
    };
    expect(dispatchState.records["aegis-790"]).toMatchObject({
      stage: "blocked_on_child",
    });
    expect(dispatchState.records["aegis-790"]?.janusArtifactRef).toBeTruthy();
  });

  it("selects scripted merge outcomes by issue, branch, and queue attempt", async () => {
    const root = createTempRoot();
    writeState(root, "aegis-321");

    const previousPlan = process.env.AEGIS_SCRIPTED_MERGE_PLAN;
    process.env.AEGIS_SCRIPTED_MERGE_PLAN = JSON.stringify({
      rules: [
        {
          issueId: "aegis-321",
          candidateBranch: "aegis/aegis-321",
          outcomes: [
            { outcome: "stale_branch", detail: "attempt-0" },
            { outcome: "stale_branch", detail: "attempt-1" },
            { outcome: "conflict", detail: "attempt-2" },
          ],
        },
      ],
    });

    try {
      const first = await runMergeNext(root, {
        tracker: {
          getIssue: vi.fn(async () => createIssue("aegis-321")),
        },
      });

      expect(first).toMatchObject({
        issueId: "aegis-321",
        queueItemId: "queue-aegis-321",
        tier: "T2",
        stage: "queued_for_merge",
        status: "requeued",
        detail: "attempt-0",
      });

      const second = await runMergeNext(root, {
        tracker: {
          getIssue: vi.fn(async () => createIssue("aegis-321")),
        },
      });

      expect(second).toMatchObject({
        issueId: "aegis-321",
        queueItemId: "queue-aegis-321",
        tier: "T2",
        stage: "queued_for_merge",
        status: "requeued",
        detail: "attempt-1",
      });

      const third = await runMergeNext(root, {
        tracker: {
          getIssue: vi.fn(async () => createIssue("aegis-321")),
        },
        runtime: new ScriptedCasteRuntime({
          janus: () => ({
            output: createJanusRequeueOutput("aegis-321"),
          }),
        }),
      });

      expect(third).toMatchObject({
        issueId: "aegis-321",
        queueItemId: "queue-aegis-321",
        tier: "T3",
        stage: "rework_required",
        status: "failed",
      });
      expect(third.detail).toContain("attempt-2");
      expect(third.detail).toContain("requeue_parent");
      expect(JSON.parse(
        readFileSync(path.join(root, ".aegis", "merge-queue.json"), "utf8"),
      ).items[0]).toMatchObject({
        attempts: 3,
        janusInvocations: 1,
        lastTier: "T3",
        status: "failed",
      });
    } finally {
      if (previousPlan === undefined) {
        delete process.env.AEGIS_SCRIPTED_MERGE_PLAN;
      } else {
        process.env.AEGIS_SCRIPTED_MERGE_PLAN = previousPlan;
      }
    }
  });

  it("does not create Sentinel follow-up issues after merge completion", async () => {
    const root = createTempRoot();
    writeState(root, "aegis-444");

    const readyIssues: Array<{ id: string; title: string }> = [];
    const issueCatalog = new Map<string, AegisIssue>([
      ["aegis-444", createIssue("aegis-444")],
    ]);

    vi.spyOn(BeadsTrackerClient.prototype, "listReadyIssues").mockImplementation(async () => [
      ...readyIssues,
    ]);

    const trackerWithFollowUps = {
      getIssue: vi.fn(async (issueId: string) => issueCatalog.get(issueId) ?? createIssue(issueId)),
      createIssue: vi.fn(async () => {
        throw new Error("Sentinel must not create follow-up issues.");
      }),
    };

    const mergeResult = await runMergeNext(root, {
      tracker: trackerWithFollowUps as any,
      runtime: new ScriptedCasteRuntime({
        sentinel: () => ({
          output: "{}",
        }),
      }),
      executor: {
        execute: vi.fn(async () => ({
          outcome: "merged" as const,
          detail: "Merged cleanly.",
        })),
      },
      now: "2026-04-14T12:30:00.000Z",
    });

    expect(mergeResult).toMatchObject({
      action: "merge_next",
      issueId: "aegis-444",
      status: "merged",
      stage: "complete",
    });
    expect(trackerWithFollowUps.createIssue).not.toHaveBeenCalled();
    expect(readyIssues).toEqual([]);

    const runtime: AgentRuntime = {
      launch: vi.fn(async (input) => ({
        sessionId: `session-${input.issueId}`,
        startedAt: new Date().toISOString(),
      })),
      readSession: vi.fn(async () => null),
      terminate: vi.fn(async () => null),
    };

    await runDaemonCycle(root, {
      runtime,
      sessionProvenanceId: "daemon-test",
    });

    expect(runtime.launch).not.toHaveBeenCalled();

    const dispatchState = loadDispatchState(root);
    expect(dispatchState.records["aegis-444"]).toMatchObject({
      issueId: "aegis-444",
      stage: "complete",
    });
  });

  it("waits for slow pre-merge reviews before enqueueing merge work", async () => {
    const root = createTempRoot();
    writeTitanArtifact(root, "aegis-555");
    saveDispatchState(root, {
      schemaVersion: 1,
      records: {
        "aegis-555": createRecord("aegis-555", "implemented"),
      },
    });
    saveMergeQueueState(root, {
      schemaVersion: 1,
      items: [],
    });

    vi.spyOn(BeadsTrackerClient.prototype, "listReadyIssues").mockImplementation(async () => []);

    const runtime: AgentRuntime = {
      launch: vi.fn(async (input) => ({
        sessionId: `session-${input.issueId}`,
        startedAt: "2026-04-14T12:00:00.000Z",
      })),
      readSession: vi.fn(async () => null),
      terminate: vi.fn(async () => null),
    };
    const launchPreMergeReview = vi.fn(async ({ issueId, timestamp }) => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 25);
      });
      const state = loadDispatchState(root);
      const record = state.records[issueId];
      if (!record) {
        throw new Error(`missing dispatch record ${issueId}`);
      }
      saveDispatchState(root, {
        schemaVersion: state.schemaVersion,
        records: {
          ...state.records,
          [issueId]: {
            ...record,
            stage: "queued_for_merge",
            sentinelVerdictRef: path.join(".aegis", "sentinel", `${issueId}.json`),
            reviewFeedbackRef: path.join(".aegis", "sentinel", `${issueId}.json`),
            updatedAt: timestamp,
          },
        },
      });
    });

    const cycleResult = await Promise.race([
      runDaemonCycle(root, {
        runtime,
        sessionProvenanceId: "daemon-test",
        launchPreMergeReview,
      }).then(() => "completed"),
      new Promise<string>((resolve) => {
        setTimeout(() => resolve("timed-out"), 50);
      }),
    ]);

    expect(cycleResult).toBe("completed");
    expect(launchPreMergeReview).toHaveBeenCalledWith({
      issueId: "aegis-555",
      root,
      timestamp: expect.any(String),
    });
    expect(loadDispatchState(root).records["aegis-555"]?.stage).toBe("queued_for_merge");
    expect(loadMergeQueueState(root).items).toMatchObject([
      {
        issueId: "aegis-555",
        candidateBranch: "aegis/aegis-555",
        targetBranch: "main",
        status: "queued",
      },
    ]);
  });
});
