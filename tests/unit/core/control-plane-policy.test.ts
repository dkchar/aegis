import path from "node:path";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyMutationProposal,
  type MutationProposal,
} from "../../../src/core/control-plane-policy.js";
import type { DispatchRecord } from "../../../src/core/dispatch-state.js";
import type { TrackerClient } from "../../../src/tracker/tracker.js";

const tempRoots: string[] = [];

function createTempRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "aegis-policy-"));
  tempRoots.push(root);
  mkdirSync(path.join(root, ".aegis"), { recursive: true });
  return root;
}

function createRecord(overrides: Partial<DispatchRecord> = {}): DispatchRecord {
  return {
    issueId: "aegis-parent-1",
    stage: "implementing",
    runningAgent: null,
    oracleAssessmentRef: ".aegis/oracle/aegis-parent-1.json",
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
    sessionProvenanceId: "test",
    updatedAt: "2026-04-24T10:00:00.000Z",
    ...overrides,
  };
}

function createProposal(overrides: Partial<MutationProposal> = {}): MutationProposal {
  return {
    originIssueId: "aegis-parent-1",
    originCaste: "titan",
    proposalType: "create_clarification_blocker",
    blocking: true,
    summary: "Need product answer before implementation can proceed.",
    suggestedTitle: "Clarify expected convergence control behavior",
    suggestedDescription: "Parent cannot proceed until this requirement is clarified.",
    dependencyType: "blocks",
    scopeEvidence: ["Issue text omits acceptance condition."],
    fingerprint: "clarification:aegis-parent-1:acceptance-condition",
    ...overrides,
  };
}

function createTracker(overrides: Partial<TrackerClient> = {}): TrackerClient {
  return {
    listReadyIssues: vi.fn(async () => []),
    createIssue: vi.fn(async () => "aegis-clarify-1"),
    linkBlockingIssue: vi.fn(async () => undefined),
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("applyMutationProposal", () => {
  it("accepts Titan clarification blocker proposals and links the child to block the parent", async () => {
    const root = createTempRoot();
    const tracker = createTracker();

    await expect(applyMutationProposal({
      root,
      tracker,
      record: createRecord(),
      proposal: createProposal(),
      now: "2026-04-24T10:00:00.000Z",
    })).resolves.toMatchObject({
      outcome: "accepted",
      parentStage: "blocked_on_child",
      childIssueId: "aegis-clarify-1",
    });

    expect(tracker.createIssue).toHaveBeenCalledWith(expect.objectContaining({
      title: "Clarify expected convergence control behavior",
    }), root);
    expect(tracker.linkBlockingIssue).toHaveBeenCalledWith({
      blockingIssueId: "aegis-clarify-1",
      blockedIssueId: "aegis-parent-1",
    }, root);
  });

  it("rejects Oracle mutation proposals", async () => {
    const root = createTempRoot();

    await expect(applyMutationProposal({
      root,
      tracker: createTracker(),
      record: createRecord(),
      proposal: createProposal({
        originCaste: "oracle" as MutationProposal["originCaste"],
      }),
      now: "2026-04-24T10:00:00.000Z",
    })).resolves.toMatchObject({
      outcome: "rejected",
      rejectionReason: "caste_not_permitted",
    });
  });

  it("rejects Sentinel mutation proposals as not permitted", async () => {
    const root = createTempRoot();

    await expect(applyMutationProposal({
      root,
      tracker: createTracker(),
      record: createRecord(),
      proposal: createProposal({
        originCaste: "sentinel",
      }),
      now: "2026-04-24T10:00:00.000Z",
    })).resolves.toMatchObject({
      outcome: "rejected",
      rejectionReason: "caste_not_permitted",
    });
  });

  it("rejects non-blocking issue creation in auto mode", async () => {
    const root = createTempRoot();

    await expect(applyMutationProposal({
      root,
      tracker: createTracker(),
      record: createRecord(),
      proposal: createProposal({ blocking: false }),
      now: "2026-04-24T10:00:00.000Z",
    })).resolves.toMatchObject({
      outcome: "rejected",
      rejectionReason: "non_blocking_not_allowed",
    });
  });

  it("rejects blocker creation when tracker mutation methods are unavailable", async () => {
    const root = createTempRoot();

    await expect(applyMutationProposal({
      root,
      tracker: { listReadyIssues: vi.fn(async () => []) },
      record: createRecord(),
      proposal: createProposal(),
      now: "2026-04-24T10:00:00.000Z",
    })).resolves.toMatchObject({
      outcome: "rejected",
      rejectionReason: "missing_tracker_method",
    });
  });

  it("accepts Janus same-parent requeue without creating a child issue", async () => {
    const root = createTempRoot();
    const tracker = createTracker();

    const result = await applyMutationProposal({
      root,
      tracker,
      record: createRecord({ stage: "resolving_integration" }),
      proposal: createProposal({
        originCaste: "janus",
        proposalType: "requeue_parent",
        blocking: false,
        suggestedTitle: undefined,
        suggestedDescription: undefined,
      }),
      now: "2026-04-24T10:00:00.000Z",
    });

    expect(result).toMatchObject({
      outcome: "requeued",
      parentStage: "rework_required",
      childIssueId: null,
    });
    expect(tracker.createIssue).not.toHaveBeenCalled();
  });

  it("reuses an existing open blocker when the fingerprint matches", async () => {
    const root = createTempRoot();
    const tracker = createTracker();

    await expect(applyMutationProposal({
      root,
      tracker,
      record: createRecord({
        policyArtifactRef: ".aegis/policy/clarification-aegis-parent-1.json",
        blockedByIssueId: "aegis-existing-9",
      } as Partial<DispatchRecord>),
      proposal: createProposal(),
      existingBlockers: [{
        issueId: "aegis-existing-9",
        fingerprint: "clarification:aegis-parent-1:acceptance-condition",
        status: "open",
      }],
      now: "2026-04-24T10:00:00.000Z",
    })).resolves.toMatchObject({
      outcome: "reused",
      parentStage: "blocked_on_child",
      childIssueId: "aegis-existing-9",
    });

    expect(tracker.createIssue).not.toHaveBeenCalled();
  });

  it("persists policy artifacts atomically under .aegis/policy", async () => {
    const root = createTempRoot();

    const result = await applyMutationProposal({
      root,
      tracker: createTracker(),
      record: createRecord(),
      proposal: createProposal(),
      now: "2026-04-24T10:00:00.000Z",
    });

    expect(result.policyArtifactRef).toContain(path.join(".aegis", "policy"));
    expect(existsSync(path.join(root, result.policyArtifactRef))).toBe(true);
    expect(existsSync(path.join(root, `${result.policyArtifactRef}.tmp`))).toBe(false);
  });
});
