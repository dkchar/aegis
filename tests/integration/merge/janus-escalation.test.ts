/**
 * S15B lane B — Janus escalation integration tests.
 *
 * Tests the integration of:
 *   - tiered conflict policy classification
 *   - Janus dispatch eligibility
 *   - escalation triggers and retry thresholds
 *   - safe requeue behavior after Janus success
 *   - human-decision artifact generation for semantic ambiguity
 *   - Janus outcome artifact persistence
 *   - queue worker Janus escalation flow
 *
 * Per SPECv2 §10.4, §10.5, §12.5, §12.5.1, §12.6, §12.8, §12.9.
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import {
  classifyConflictTier,
  isJanusEligible,
  shouldEscalateToJanus,
  detectConflicts,
  detectSemanticAmbiguity,
  defaultJanusInvocationPolicy,
  type JanusInvocationPolicy,
  type ConflictClassification,
} from "../../../src/merge/tiered-conflict-policy.js";

import {
  parseJanusResolutionArtifact,
  JanusParseError,
} from "../../../src/castes/janus/janus-parser.js";

import {
  createJanusPromptContract,
  buildJanusPrompt,
} from "../../../src/castes/janus/janus-prompt.js";

import {
  handleJanusResult,
  createHumanDecisionArtifact,
  loadHumanDecisionArtifact,
  janusRequeue,
  type HumanDecisionArtifact,
  type JanusHandlingResult,
} from "../../../src/merge/janus-integration.js";

import {
  emitJanusOutcomeArtifact,
  loadJanusOutcomeArtifact,
  serializeJanusOutcomeArtifact,
  parseJanusOutcomeArtifact,
} from "../../../src/merge/janus-outcome-artifact.js";

import type {
  MergeQueueState,
  QueueItem,
} from "../../../src/merge/merge-queue-store.js";
import type { AegisLiveEvent } from "../../../src/events/event-bus.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let testDir: string;
let projectRoot: string;

function makeQueueItem(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    issueId: overrides.issueId ?? "aegis-fjm.5",
    candidateBranch: overrides.candidateBranch ?? "aegis/test-issue",
    targetBranch: overrides.targetBranch ?? "main",
    enqueuedAt: new Date().toISOString(),
    position: overrides.position ?? 0,
    status: overrides.status ?? "queued",
    attemptCount: overrides.attemptCount ?? 0,
    lastError: overrides.lastError ?? null,
    sourceStage: overrides.sourceStage ?? "implemented",
    sessionProvenanceId: overrides.sessionProvenanceId ?? "test-session",
    updatedAt: new Date().toISOString(),
    handoffArtifactRef: overrides.handoffArtifactRef ?? null,
  };
}

function makeQueueState(overrides: Partial<MergeQueueState> = {}): MergeQueueState {
  return {
    schemaVersion: 1,
    items: overrides.items ?? [makeQueueItem()],
    processedCount: overrides.processedCount ?? 0,
  };
}

function makeJanusArtifact(overrides: Record<string, unknown> = {}): string {
  const base = {
    originatingIssueId: "aegis-fjm.5",
    queueItemId: "aegis-fjm.5",
    preservedLaborPath: ".aegis/labors/labor-aegis-fjm.5",
    conflictSummary: "Merge conflict in dispatch-state.ts",
    resolutionStrategy: "Accepted incoming branch changes",
    filesTouched: ["src/dispatch-state.ts"],
    validationsRun: ["npm run test", "npm run lint"],
    residualRisks: [],
    recommendedNextAction: "requeue",
    ...overrides,
  };
  return JSON.stringify(base);
}

// Minimal event publisher for testing
function makeEventPublisher() {
  const events: Array<{ type: string; payload: unknown }> = [];
  return {
    events,
    publish: (event: { id: string; type: string; timestamp: string; sequence: number; payload: unknown }) => {
      events.push({ type: event.type, payload: event.payload });
    },
    subscribe: (_listener: (event: AegisLiveEvent) => void) => {
      return () => {};
    },
  };
}

beforeEach(() => {
  testDir = join(process.cwd(), ".aegis-test-" + randomUUID());
  projectRoot = join(testDir, "project");
  mkdirSync(projectRoot, { recursive: true });
});

afterEach(() => {
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Tiered conflict policy tests (existing contract tests)
// ---------------------------------------------------------------------------

describe("Tiered conflict policy", () => {
  describe("defaultJanusInvocationPolicy", () => {
    it("returns Janus disabled by default for safety", () => {
      const policy = defaultJanusInvocationPolicy();
      expect(policy.janusEnabled).toBe(false);
    });

    it("has retry threshold of 2 matching config default", () => {
      const policy = defaultJanusInvocationPolicy();
      expect(policy.maxRetryAttempts).toBe(2);
    });

    it("allows economic guardrails by default", () => {
      const policy = defaultJanusInvocationPolicy();
      expect(policy.economicGuardrailsAllow).toBe(true);
    });
  });

  describe("detectConflicts", () => {
    it("detects CONFLICT marker in output", () => {
      expect(detectConflicts("CONFLICT (content): Merge conflict in file.ts")).toBe(true);
    });

    it("detects Automatic merge failed", () => {
      expect(detectConflicts("Automatic merge failed: file.ts")).toBe(true);
    });

    it("detects Merge conflict text", () => {
      expect(detectConflicts("Merge conflict in src/utils.ts")).toBe(true);
    });

    it("detects conflict marker arrows", () => {
      expect(detectConflicts("<<<<<<< HEAD\nsome code\n=======")).toBe(true);
    });

    it("returns false for clean merge output", () => {
      expect(detectConflicts("Updating main..feature\nFast-forward")).toBe(false);
    });
  });

  describe("detectSemanticAmbiguity", () => {
    it("detects circular dependency indicator", () => {
      expect(detectSemanticAmbiguity("Circular dependency detected: a -> b -> a")).toBe(true);
    });

    it("detects incompatible types indicator", () => {
      expect(detectSemanticAmbiguity("Incompatible types in merged exports")).toBe(true);
    });

    it("detects both modified conflict marker", () => {
      expect(detectSemanticAmbiguity("CONFLICT (content): both modified")).toBe(true);
    });

    it("detects cannot merge indicator", () => {
      expect(detectSemanticAmbiguity("Cannot merge: incompatible strategies")).toBe(true);
    });

    it("detects ambiguous indicator", () => {
      expect(detectSemanticAmbiguity("Ambiguous resolution: multiple candidates")).toBe(true);
    });

    it("returns false for normal merge output", () => {
      expect(detectSemanticAmbiguity("Merged 15 files successfully")).toBe(false);
    });

    it("returns false for routine TypeScript errors (not semantic ambiguity)", () => {
      // These were previously matched but are routine compilation errors,
      // not genuine semantic merge ambiguity per SPECv2 §10.4.1
      expect(detectSemanticAmbiguity("error TS2345: type error in assignment")).toBe(false);
      expect(detectSemanticAmbiguity("Duplicate function declaration")).toBe(false);
      expect(detectSemanticAmbiguity("Module not found: @aegis/core")).toBe(false);
    });
  });

  describe("isJanusEligible", () => {
    it("returns false when Janus is disabled", () => {
      const policy: JanusInvocationPolicy = {
        janusEnabled: false,
        maxRetryAttempts: 2,
        maxConflictFiles: 10,
        economicGuardrailsAllow: true,
      };
      expect(isJanusEligible(5, policy)).toBe(false);
    });

    it("returns false when attempt count is below threshold", () => {
      const policy: JanusInvocationPolicy = {
        janusEnabled: true,
        maxRetryAttempts: 3,
        maxConflictFiles: 10,
        economicGuardrailsAllow: true,
      };
      expect(isJanusEligible(2, policy)).toBe(false);
    });

    it("returns false when economic guardrails disallow", () => {
      const policy: JanusInvocationPolicy = {
        janusEnabled: true,
        maxRetryAttempts: 2,
        maxConflictFiles: 10,
        economicGuardrailsAllow: false,
      };
      expect(isJanusEligible(3, policy)).toBe(false);
    });

    it("returns true when all conditions are met", () => {
      const policy: JanusInvocationPolicy = {
        janusEnabled: true,
        maxRetryAttempts: 2,
        maxConflictFiles: 10,
        economicGuardrailsAllow: true,
      };
      expect(isJanusEligible(2, policy)).toBe(true);
    });

    it("returns true when attempt count exceeds threshold", () => {
      const policy: JanusInvocationPolicy = {
        janusEnabled: true,
        maxRetryAttempts: 2,
        maxConflictFiles: 10,
        economicGuardrailsAllow: true,
      };
      expect(isJanusEligible(5, policy)).toBe(true);
    });
  });

  describe("shouldEscalateToJanus", () => {
    it("returns true for semantic ambiguity", () => {
      expect(shouldEscalateToJanus(true, true, 3, 1, defaultJanusInvocationPolicy())).toBe(true);
    });

    it("returns true when conflict file count exceeds threshold", () => {
      const policy: JanusInvocationPolicy = {
        janusEnabled: true,
        maxRetryAttempts: 3,
        maxConflictFiles: 5,
        economicGuardrailsAllow: true,
      };
      expect(shouldEscalateToJanus(true, false, 5, 1, policy)).toBe(true);
    });

    it("returns true when retry threshold is reached with conflicts", () => {
      const policy: JanusInvocationPolicy = {
        janusEnabled: true,
        maxRetryAttempts: 2,
        maxConflictFiles: 10,
        economicGuardrailsAllow: true,
      };
      expect(shouldEscalateToJanus(true, false, 3, 2, policy)).toBe(true);
    });

    it("returns false when no escalation triggers are met", () => {
      const policy: JanusInvocationPolicy = {
        janusEnabled: true,
        maxRetryAttempts: 3,
        maxConflictFiles: 10,
        economicGuardrailsAllow: true,
      };
      expect(shouldEscalateToJanus(true, false, 3, 1, policy)).toBe(false);
    });

    it("returns false when there are no conflicts", () => {
      expect(shouldEscalateToJanus(false, false, 0, 0, defaultJanusInvocationPolicy())).toBe(false);
    });
  });

  describe("classifyConflictTier", () => {
    it("classifies clean merge as Tier 1", () => {
      const result = classifyConflictTier("Fast-forward merge", 0, 0, 0, defaultJanusInvocationPolicy());
      expect(result.tier).toBe(1);
      expect(result.janusEligible).toBe(false);
    });

    it("classifies hard conflict as Tier 2", () => {
      const result = classifyConflictTier(
        "CONFLICT (content): Merge conflict in file.ts",
        1,
        3,
        1,
        defaultJanusInvocationPolicy(),
      );
      expect(result.tier).toBe(2);
      expect(result.janusEligible).toBe(false);
    });

    it("classifies repeated failures as Tier 3 with Janus not eligible when disabled", () => {
      const result = classifyConflictTier(
        "CONFLICT (content): Merge conflict in file.ts",
        1,
        3,
        3,
        { ...defaultJanusInvocationPolicy(), janusEnabled: false },
      );
      expect(result.tier).toBe(3);
      expect(result.janusEligible).toBe(false);
    });

    it("classifies repeated failures as Tier 3 with Janus eligible when enabled", () => {
      const result = classifyConflictTier(
        "CONFLICT (content): Merge conflict in file.ts",
        1,
        3,
        3,
        { ...defaultJanusInvocationPolicy(), janusEnabled: true },
      );
      expect(result.tier).toBe(3);
      expect(result.janusEligible).toBe(true);
    });

    it("classifies semantic ambiguity as Tier 3", () => {
      const result = classifyConflictTier(
        "Circular dependency detected: a -> b -> a in merged code",
        1,
        1,
        1,
        defaultJanusInvocationPolicy(),
      );
      expect(result.tier).toBe(3);
    });

    it("classifies stale branch as Tier 1", () => {
      const result = classifyConflictTier(
        "Branch is behind main",
        1,
        0,
        0,
        defaultJanusInvocationPolicy(),
      );
      expect(result.tier).toBe(1);
    });
  });
});

// ---------------------------------------------------------------------------
// Janus prompt tests
// ---------------------------------------------------------------------------

describe("Janus prompt construction", () => {
  it("creates a prompt contract with correct budget defaults", () => {
    const contract = createJanusPromptContract({
      originatingIssueId: "aegis-fjm.5",
      queueItemId: "aegis-fjm.5",
      preservedLaborPath: ".aegis/labors/labor-aegis-fjm.5",
      conflictSummary: "Merge conflict in dispatch-state.ts",
      filesInvolved: ["src/dispatch-state.ts"],
      previousMergeErrors: "CONFLICT (content): Merge conflict in src/dispatch-state.ts",
      conflictTier: 3,
    });

    expect(contract.maxTurns).toBe(12);
    expect(contract.maxTokens).toBe(120_000);
    expect(contract.originatingIssueId).toBe("aegis-fjm.5");
    expect(contract.conflictTier).toBe(3);
  });

  it("renders a prompt containing all required context", () => {
    const contract = createJanusPromptContract({
      originatingIssueId: "aegis-fjm.5",
      queueItemId: "aegis-fjm.5",
      preservedLaborPath: ".aegis/labors/labor-aegis-fjm.5",
      conflictSummary: "Merge conflict in dispatch-state.ts",
      filesInvolved: ["src/dispatch-state.ts", "src/merge/queue-worker.ts"],
      previousMergeErrors: "CONFLICT (content): file.ts",
      conflictTier: 2,
    });

    const prompt = buildJanusPrompt(contract);

    expect(prompt).toContain("aegis-fjm.5");
    expect(prompt).toContain(".aegis/labors/labor-aegis-fjm.5");
    expect(prompt).toContain("Merge conflict in dispatch-state.ts");
    expect(prompt).toContain("src/dispatch-state.ts");
    expect(prompt).toContain("src/merge/queue-worker.ts");
    expect(prompt).toContain("12");
    expect(prompt).toContain("120000");
    expect(prompt).toContain("do NOT merge directly outside the queue");
    expect(prompt).toContain("do NOT replace Titan");
  });

  it("includes all required sections in the prompt", () => {
    const contract = createJanusPromptContract({
      originatingIssueId: "aegis-fjm.5",
      queueItemId: "aegis-fjm.5",
      preservedLaborPath: ".aegis/labors/labor-aegis-fjm.5",
      conflictSummary: "Test conflict",
      filesInvolved: [],
      previousMergeErrors: "",
      conflictTier: 3,
    });

    const prompt = buildJanusPrompt(contract);

    for (const section of contract.sections) {
      expect(prompt).toContain(section);
    }
  });

  it("includes all required rules in the prompt", () => {
    const contract = createJanusPromptContract({
      originatingIssueId: "aegis-fjm.5",
      queueItemId: "aegis-fjm.5",
      preservedLaborPath: ".aegis/labors/labor-aegis-fjm.5",
      conflictSummary: "Test conflict",
      filesInvolved: [],
      previousMergeErrors: "",
      conflictTier: 3,
    });

    const prompt = buildJanusPrompt(contract);

    for (const rule of contract.rules) {
      expect(prompt).toContain(rule);
    }
  });
});

// ---------------------------------------------------------------------------
// Janus dispatch and escalation flow tests (existing)
// ---------------------------------------------------------------------------

describe("Janus dispatch and escalation flow", () => {
  it("produces a valid artifact for a requeue scenario", () => {
    const janusOutput = JSON.stringify({
      originatingIssueId: "aegis-fjm.5",
      queueItemId: "aegis-fjm.5",
      preservedLaborPath: ".aegis/labors/labor-aegis-fjm.5",
      conflictSummary: "Resolved conflict in dispatch-state.ts",
      resolutionStrategy: "Accepted incoming branch changes with minor manual adjustments",
      filesTouched: ["src/dispatch-state.ts"],
      validationsRun: ["npm run test", "npm run lint"],
      residualRisks: [],
      recommendedNextAction: "requeue",
    });

    const artifact = parseJanusResolutionArtifact(janusOutput);
    expect(artifact.recommendedNextAction).toBe("requeue");
    expect(artifact.filesTouched).toContain("src/dispatch-state.ts");
  });

  it("produces a valid artifact for a manual_decision scenario", () => {
    const janusOutput = JSON.stringify({
      originatingIssueId: "aegis-fjm.5",
      queueItemId: "aegis-fjm.5",
      preservedLaborPath: ".aegis/labors/labor-aegis-fjm.5",
      conflictSummary: "Semantic ambiguity between two valid merge strategies",
      resolutionStrategy: "Unable to determine correct strategy without domain context",
      filesTouched: ["src/dispatch-state.ts", "src/triage.ts"],
      validationsRun: ["npm run build"],
      residualRisks: ["Merged logic may conflict with existing dispatch behavior"],
      recommendedNextAction: "manual_decision",
    });

    const artifact = parseJanusResolutionArtifact(janusOutput);
    expect(artifact.recommendedNextAction).toBe("manual_decision");
    expect(artifact.residualRisks.length).toBeGreaterThan(0);
  });

  it("produces a valid artifact for a fail scenario", () => {
    const janusOutput = JSON.stringify({
      originatingIssueId: "aegis-fjm.5",
      queueItemId: "aegis-fjm.5",
      preservedLaborPath: ".aegis/labors/labor-aegis-fjm.5",
      conflictSummary: "Budget exhausted before resolution could complete",
      resolutionStrategy: "Attempted resolution but hit token limit",
      filesTouched: [],
      validationsRun: [],
      residualRisks: ["Conflict remains unresolved"],
      recommendedNextAction: "fail",
    });

    const artifact = parseJanusResolutionArtifact(janusOutput);
    expect(artifact.recommendedNextAction).toBe("fail");
  });

  it("rejects a Janus artifact with wrong recommendedNextAction", () => {
    const janusOutput = JSON.stringify({
      originatingIssueId: "aegis-fjm.5",
      queueItemId: "aegis-fjm.5",
      preservedLaborPath: ".aegis/labors/labor-aegis-fjm.5",
      conflictSummary: "Test",
      resolutionStrategy: "Test",
      filesTouched: [],
      validationsRun: [],
      residualRisks: [],
      recommendedNextAction: "merge_directly",
    });

    expect(() => parseJanusResolutionArtifact(janusOutput)).toThrow(JanusParseError);
  });

  it("rejects a Janus artifact with extra fields", () => {
    const janusOutput = JSON.stringify({
      originatingIssueId: "aegis-fjm.5",
      queueItemId: "aegis-fjm.5",
      preservedLaborPath: ".aegis/labors/labor-aegis-fjm.5",
      conflictSummary: "Test",
      resolutionStrategy: "Test",
      filesTouched: [],
      validationsRun: [],
      residualRisks: [],
      recommendedNextAction: "requeue",
      chatLog: ["some conversational context"],
    });

    expect(() => parseJanusResolutionArtifact(janusOutput)).toThrow(JanusParseError);
  });

  it("Janus escalation only triggers when policy allows", () => {
    // Scenario: Tier 3 classification but Janus disabled
    const disabledPolicy: JanusInvocationPolicy = {
      janusEnabled: false,
      maxRetryAttempts: 2,
      maxConflictFiles: 10,
      economicGuardrailsAllow: true,
    };

    const classification = classifyConflictTier(
      "CONFLICT (content): complex merge conflict",
      1,
      3,
      3,
      disabledPolicy,
    );

    // Tier 3 is classified, but Janus is not eligible
    expect(classification.tier).toBe(3);
    expect(classification.janusEligible).toBe(false);
    expect(isJanusEligible(3, disabledPolicy)).toBe(false);
  });

  it("Janus returns to queue on requeue recommendation", () => {
    // Simulate: Janus succeeds, artifact says requeue
    // The queue worker should accept the candidate for a fresh mechanical pass
    const janusOutput = JSON.stringify({
      originatingIssueId: "aegis-fjm.5",
      queueItemId: "aegis-fjm.5",
      preservedLaborPath: ".aegis/labors/labor-aegis-fjm.5",
      conflictSummary: "Conflict resolved successfully",
      resolutionStrategy: "Manual merge resolution applied",
      filesTouched: ["src/dispatch-state.ts"],
      validationsRun: ["npm run test", "npm run lint", "npm run build"],
      residualRisks: [],
      recommendedNextAction: "requeue",
    });

    const artifact = parseJanusResolutionArtifact(janusOutput);

    // Requeue means the item goes back into the queue for mechanical verification
    expect(artifact.recommendedNextAction).toBe("requeue");
    expect(artifact.validationsRun).toContain("npm run test");
    expect(artifact.validationsRun).toContain("npm run build");
  });

  it("semantic ambiguity produces human-decision artifact not auto-resolution", () => {
    // Scenario: Janus encounters semantic ambiguity
    const classification = classifyConflictTier(
      "Circular dependency detected between merged modules: a -> b -> a",
      1,
      1,
      1,
      { ...defaultJanusInvocationPolicy(), janusEnabled: true },
    );

    expect(classification.tier).toBe(3);

    // Janus runs and produces a manual_decision artifact
    const janusOutput = JSON.stringify({
      originatingIssueId: "aegis-fjm.5",
      queueItemId: "aegis-fjm.5",
      preservedLaborPath: ".aegis/labors/labor-aegis-fjm.5",
      conflictSummary: "Semantic type incompatibility between merged branches",
      resolutionStrategy: "Cannot determine correct type resolution without human input",
      filesTouched: ["src/types.ts"],
      validationsRun: [],
      residualRisks: ["Type compatibility uncertain after merge"],
      recommendedNextAction: "manual_decision",
    });

    const artifact = parseJanusResolutionArtifact(janusOutput);
    expect(artifact.recommendedNextAction).toBe("manual_decision");
    // This is NOT auto-resolution; it explicitly requires human decision
  });
});

// ---------------------------------------------------------------------------
// Lane B: Janus integration — safe requeue after Janus success
// ---------------------------------------------------------------------------

describe("Janus integration — safe requeue after Janus success", () => {
  it("janusRequeue resets item to queued with attempt count zero", () => {
    const item = makeQueueItem({
      status: "janus_required",
      attemptCount: 3,
      lastError: "Some error",
    });
    const state = makeQueueState({ items: [item] });

    const result = janusRequeue(state, "aegis-fjm.5");

    const requeuedItem = result.items.find((i) => i.issueId === "aegis-fjm.5");
    expect(requeuedItem).toBeDefined();
    expect(requeuedItem!.status).toBe("queued");
    expect(requeuedItem!.attemptCount).toBe(0);
    expect(requeuedItem!.lastError).toBeNull();
    // Original state should not be mutated
    expect(state.items[0].status).toBe("janus_required");
    expect(state.items[0].attemptCount).toBe(3);
  });

  it("janusRequeue preserves queue order and other items", () => {
    const item1 = makeQueueItem({ issueId: "aegis-fjm.1", position: 0, status: "queued" });
    const item2 = makeQueueItem({ issueId: "aegis-fjm.5", position: 1, status: "janus_required", attemptCount: 2 });
    const item3 = makeQueueItem({ issueId: "aegis-fjm.10", position: 2, status: "queued" });
    const state = makeQueueState({ items: [item1, item2, item3] });

    const result = janusRequeue(state, "aegis-fjm.5");

    expect(result.items.length).toBe(3);
    expect(result.items[0].issueId).toBe("aegis-fjm.1");
    expect(result.items[1].issueId).toBe("aegis-fjm.5");
    expect(result.items[1].status).toBe("queued");
    expect(result.items[2].issueId).toBe("aegis-fjm.10");
    // processedCount unchanged
    expect(result.processedCount).toBe(0);
  });

  it("janusRequeue returns new state without mutating input", () => {
    const item = makeQueueItem({ status: "janus_required", attemptCount: 5 });
    const state = makeQueueState({ items: [item] });

    const result = janusRequeue(state, "aegis-fjm.5");

    expect(result).not.toBe(state);
    expect(result.items[0]).not.toBe(state.items[0]);
    expect(state.items[0].status).toBe("janus_required");
    expect(state.items[0].attemptCount).toBe(5);
  });

  it("handleJanusResult with requeue returns queued status and emits events", async () => {
    const artifact = parseJanusResolutionArtifact(makeJanusArtifact({ recommendedNextAction: "requeue" }));
    const item = makeQueueItem({ status: "janus_required", attemptCount: 3 });
    const state = makeQueueState({ items: [item] });
    const publisher = makeEventPublisher();

    const result = await handleJanusResult(artifact, projectRoot, state, publisher);

    expect(result.finalStatus).toBe("queued");
    expect(result.humanDecisionCreated).toBe(false);
    expect(result.humanDecisionPath).toBeNull();
    expect(result.updatedState.items[0].status).toBe("queued");
    expect(result.updatedState.items[0].attemptCount).toBe(0);
    // Verify events were published
    expect(publisher.events.some((e) => e.type === "merge.queue_state")).toBe(true);
    expect(publisher.events.some((e) => e.type === "merge.outcome")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Lane B: Human-decision artifact creation and validation
// ---------------------------------------------------------------------------

describe("Human-decision artifact creation and validation", () => {
  it("createHumanDecisionArtifact creates structured artifact under .aegis/merge-artifacts/", async () => {
    const janusArtifact = parseJanusResolutionArtifact(
      makeJanusArtifact({
        recommendedNextAction: "manual_decision",
        conflictSummary: "Semantic ambiguity in type resolution",
        resolutionStrategy: "Cannot determine correct approach",
        residualRisks: ["Type A may conflict with Type B"],
      }),
    );

    const result = await createHumanDecisionArtifact(janusArtifact, projectRoot);

    expect(result.originatingIssueId).toBe("aegis-fjm.5");
    expect(result.queueItemId).toBe("aegis-fjm.5");
    expect(result.janusResolutionRef).toBe("Cannot determine correct approach");
    expect(result.semanticAmbiguitySummary).toBe("Semantic ambiguity in type resolution");
    expect(result.optionsConsidered).toContain("Type A may conflict with Type B");
    expect(result.recommendedHumanAction).toBeDefined();
    expect(result.recommendedHumanAction).toContain("Semantic ambiguity in type resolution");
    expect(result.createdAt).toBeDefined();

    // Verify file was persisted
    const artifactPath = join(projectRoot, ".aegis", "merge-artifacts", "human-decision-aegis-fjm.5.json");
    expect(existsSync(artifactPath)).toBe(true);
    const fileContent = readFileSync(artifactPath, "utf-8");
    const parsed = JSON.parse(fileContent);
    expect(parsed.originatingIssueId).toBe("aegis-fjm.5");
  });

  it("loadHumanDecisionArtifact loads existing artifact", async () => {
    const janusArtifact = parseJanusResolutionArtifact(
      makeJanusArtifact({
        recommendedNextAction: "manual_decision",
        conflictSummary: "Test ambiguity",
        resolutionStrategy: "Test strategy",
      }),
    );

    await createHumanDecisionArtifact(janusArtifact, projectRoot);
    const loaded = loadHumanDecisionArtifact("aegis-fjm.5", projectRoot);

    expect(loaded).not.toBeNull();
    expect(loaded!.originatingIssueId).toBe("aegis-fjm.5");
    expect(loaded!.semanticAmbiguitySummary).toBe("Test ambiguity");
  });

  it("loadHumanDecisionArtifact returns null when artifact does not exist", () => {
    const loaded = loadHumanDecisionArtifact("aegis-fjm.99", projectRoot);
    expect(loaded).toBeNull();
  });

  it("handleJanusResult with manual_decision creates artifact and updates status", async () => {
    const artifact = parseJanusResolutionArtifact(
      makeJanusArtifact({
        recommendedNextAction: "manual_decision",
        conflictSummary: "Semantic ambiguity detected",
        resolutionStrategy: "Unable to resolve",
      }),
    );
    const item = makeQueueItem({ status: "janus_required" });
    const state = makeQueueState({ items: [item] });
    const publisher = makeEventPublisher();

    const result = await handleJanusResult(artifact, projectRoot, state, publisher);

    expect(result.finalStatus).toBe("manual_decision_required");
    expect(result.humanDecisionCreated).toBe(true);
    expect(result.humanDecisionPath).toContain("human-decision-aegis-fjm.5.json");
    expect(result.updatedState.items[0].status).toBe("manual_decision_required");
    // Verify events
    const outcomeEvent = publisher.events.find((e) => e.type === "merge.outcome");
    expect(outcomeEvent).toBeDefined();
    const payload = outcomeEvent!.payload as Record<string, unknown>;
    expect(payload.outcome).toBe("MANUAL_DECISION_REQUIRED");
  });

  it("human-decision artifact includes all required fields per SPECv2", async () => {
    const janusArtifact = parseJanusResolutionArtifact(
      makeJanusArtifact({
        recommendedNextAction: "manual_decision",
        conflictSummary: "Complex merge strategy ambiguity",
        resolutionStrategy: "Multiple valid approaches exist",
        filesTouched: ["src/a.ts", "src/b.ts"],
        validationsRun: ["npm run test"],
        residualRisks: ["Risk 1", "Risk 2"],
      }),
    );

    const result = await createHumanDecisionArtifact(janusArtifact, projectRoot);

    // All required fields per lane B spec
    expect(result).toHaveProperty("originatingIssueId");
    expect(result).toHaveProperty("queueItemId");
    expect(result).toHaveProperty("janusResolutionRef");
    expect(result).toHaveProperty("semanticAmbiguitySummary");
    expect(result).toHaveProperty("optionsConsidered");
    expect(result).toHaveProperty("recommendedHumanAction");
    expect(result).toHaveProperty("createdAt");
    // Options considered should include residual risks or default
    expect(Array.isArray(result.optionsConsidered)).toBe(true);
    expect(result.optionsConsidered.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Lane B: Janus failure flow with labor preservation
// ---------------------------------------------------------------------------

describe("Janus failure flow with labor preservation", () => {
  it("handleJanusResult with fail sets janus_failed status and emits events", async () => {
    const artifact = parseJanusResolutionArtifact(
      makeJanusArtifact({
        recommendedNextAction: "fail",
        conflictSummary: "Budget exhausted, resolution failed",
        resolutionStrategy: "Unable to resolve within budget",
      }),
    );
    const item = makeQueueItem({ status: "janus_required" });
    const state = makeQueueState({ items: [item] });
    const publisher = makeEventPublisher();

    const result = await handleJanusResult(artifact, projectRoot, state, publisher);

    expect(result.finalStatus).toBe("janus_failed");
    expect(result.humanDecisionCreated).toBe(false);
    expect(result.humanDecisionPath).toBeNull();
    expect(result.updatedState.items[0].status).toBe("janus_failed");
    expect(result.updatedState.items[0].lastError).toBe("Budget exhausted, resolution failed");
    // Verify events
    expect(publisher.events.some((e) => e.type === "merge.queue_state")).toBe(true);
    const outcomeEvent = publisher.events.find((e) => e.type === "merge.outcome");
    expect(outcomeEvent).toBeDefined();
    const payload = outcomeEvent!.payload as Record<string, unknown>;
    expect(payload.outcome).toBe("JANUS_FAILED");
  });

  it("janus_failed status does not mutate original state", async () => {
    const artifact = parseJanusResolutionArtifact(
      makeJanusArtifact({
        recommendedNextAction: "fail",
        conflictSummary: "Test failure",
        resolutionStrategy: "Test",
      }),
    );
    const item = makeQueueItem({ status: "janus_required", attemptCount: 2 });
    const state = makeQueueState({ items: [item] });
    const publisher = makeEventPublisher();

    const result = await handleJanusResult(artifact, projectRoot, state, publisher);

    expect(result).not.toBe(state);
    expect(state.items[0].status).toBe("janus_required");
    expect(result.updatedState.items[0].status).toBe("janus_failed");
  });
});

// ---------------------------------------------------------------------------
// Lane B: Queue state updates after Janus resolution
// ---------------------------------------------------------------------------

describe("Queue state updates after Janus resolution", () => {
  it("requeue outcome resets attempt count and returns to queue", async () => {
    const artifact = parseJanusResolutionArtifact(makeJanusArtifact({ recommendedNextAction: "requeue" }));
    const item = makeQueueItem({
      status: "janus_required",
      attemptCount: 5,
      lastError: "Previous error",
    });
    const state = makeQueueState({ items: [item], processedCount: 10 });

    const result = await handleJanusResult(artifact, projectRoot, state, makeEventPublisher());

    expect(result.updatedState.items[0].attemptCount).toBe(0);
    expect(result.updatedState.items[0].lastError).toBeNull();
    expect(result.updatedState.items[0].status).toBe("queued");
    expect(result.updatedState.processedCount).toBe(10); // unchanged
  });

  it("manual_decision_required is a terminal status", async () => {
    const artifact = parseJanusResolutionArtifact(
      makeJanusArtifact({ recommendedNextAction: "manual_decision" }),
    );
    const item = makeQueueItem({ status: "janus_required" });
    const state = makeQueueState({ items: [item] });

    const result = await handleJanusResult(artifact, projectRoot, state, makeEventPublisher());

    expect(result.finalStatus).toBe("manual_decision_required");
    // Import and verify isTerminalStatus considers this terminal
    const { isTerminalStatus } = await import("../../../src/merge/merge-queue-store.js");
    expect(isTerminalStatus("manual_decision_required")).toBe(true);
  });

  it("janus_failed preserves error detail from Janus artifact", async () => {
    const artifact = parseJanusResolutionArtifact(
      makeJanusArtifact({
        recommendedNextAction: "fail",
        conflictSummary: "Specific failure: type mismatch in dispatch",
      }),
    );
    const item = makeQueueItem({ status: "janus_required", lastError: "Old error" });
    const state = makeQueueState({ items: [item] });

    const result = await handleJanusResult(artifact, projectRoot, state, makeEventPublisher());

    expect(result.updatedState.items[0].lastError).toBe("Specific failure: type mismatch in dispatch");
  });
});

// ---------------------------------------------------------------------------
// Lane B: Janus outcome artifact persistence
// ---------------------------------------------------------------------------

describe("Janus outcome artifact persistence", () => {
  it("emitJanusOutcomeArtifact persists atomically under .aegis/merge-artifacts/", async () => {
    const artifact = parseJanusResolutionArtifact(makeJanusArtifact());

    const result = await emitJanusOutcomeArtifact(artifact, projectRoot, "janus-session-123");

    expect(result.originatingIssueId).toBe("aegis-fjm.5");
    expect(result.recommendedNextAction).toBe("requeue");
    expect(result.janusSessionRef).toBe("janus-session-123");
    expect(result.createdAt).toBeDefined();

    // Verify file exists
    const { existsSync } = await import("node:fs");
    const artifactPath = join(projectRoot, ".aegis", "merge-artifacts", "janus-outcome-aegis-fjm.5.json");
    expect(existsSync(artifactPath)).toBe(true);
  });

  it("loadJanusOutcomeArtifact loads existing artifact", async () => {
    const artifact = parseJanusResolutionArtifact(
      makeJanusArtifact({ conflictSummary: "Test conflict for loading" }),
    );

    await emitJanusOutcomeArtifact(artifact, projectRoot);
    const loaded = loadJanusOutcomeArtifact("aegis-fjm.5", projectRoot);

    expect(loaded).not.toBeNull();
    expect(loaded!.conflictSummary).toBe("Test conflict for loading");
    expect(loaded!.recommendedNextAction).toBe("requeue");
  });

  it("loadJanusOutcomeArtifact returns null when not found", () => {
    const loaded = loadJanusOutcomeArtifact("aegis-fjm.99", projectRoot);
    expect(loaded).toBeNull();
  });

  it("serializeJanusOutcomeArtifact round-trips correctly", async () => {
    const artifact = parseJanusResolutionArtifact(makeJanusArtifact());
    const emitted = await emitJanusOutcomeArtifact(artifact, projectRoot);

    const serialized = serializeJanusOutcomeArtifact(emitted);
    const parsed = parseJanusOutcomeArtifact(serialized);

    expect(parsed.originatingIssueId).toBe(emitted.originatingIssueId);
    expect(parsed.recommendedNextAction).toBe(emitted.recommendedNextAction);
    expect(parsed.conflictSummary).toBe(emitted.conflictSummary);
  });

  it("parseJanusOutcomeArtifact throws on missing fields", () => {
    const incomplete = JSON.stringify({ originatingIssueId: "aegis-fjm.5" });
    expect(() => parseJanusOutcomeArtifact(incomplete)).toThrow(/missing required field/);
  });
});

// ---------------------------------------------------------------------------
// Lane B: Integration with merge queue worker Janus flow
// ---------------------------------------------------------------------------

describe("Integration with merge queue worker Janus flow", () => {
  it("queue worker detects janus_required item and processes it", async () => {
    const { processNextQueueItem } = await import("../../../src/merge/queue-worker.js");

    const item = makeQueueItem({
      status: "janus_required",
      attemptCount: 3,
    });
    const state = makeQueueState({ items: [item] });
    const publisher = makeEventPublisher();

    const result = await processNextQueueItem(state, {
      projectRoot,
      eventPublisher: publisher,
      janusEnabled: true,
      maxRetryAttempts: 2,
      targetBranch: "main",
    });

    expect(result).not.toBeNull();
    expect(result!.result.issueId).toBe("aegis-fjm.5");
    // Without a runtime adapter, the item transitions to manual_decision_required
    // to avoid infinite looping on janus_required status
    expect(result!.result.newStatus).toBe("manual_decision_required");
    // Should emit janus_escalation event
    expect(publisher.events.some((e) => e.type === "merge.janus_escalation")).toBe(true);
  });

  it("queue worker escalates to Janus when Tier 3 and policy allows", async () => {
    const { processNextQueueItem } = await import("../../../src/merge/queue-worker.js");

    // Create a scenario where merge will fail with conflict markers
    // Since we don't have a real git repo, we test the classification logic directly
    const policy = {
      janusEnabled: true,
      maxRetryAttempts: 2,
      maxConflictFiles: 10,
      economicGuardrailsAllow: true,
    };

    const classification = classifyConflictTier(
      "CONFLICT (content): Merge conflict",
      1,
      1,
      3, // 3 attempts >= maxRetryAttempts of 2
      policy,
    );

    expect(classification.tier).toBe(3);
    expect(classification.janusEligible).toBe(true);
  });

  it("queue worker does not escalate when Janus is disabled", async () => {
    const policy = {
      janusEnabled: false,
      maxRetryAttempts: 2,
      maxConflictFiles: 10,
      economicGuardrailsAllow: true,
    };

    const classification = classifyConflictTier(
      "CONFLICT (content): Merge conflict",
      1,
      1,
      3,
      policy,
    );

    expect(classification.tier).toBe(3);
    expect(classification.janusEligible).toBe(false);
  });

  it("full Janus flow: conflict → janus_required → requeue → queued", async () => {
    // Simulate the full flow using the integration functions directly
    const artifact = parseJanusResolutionArtifact(
      makeJanusArtifact({
        recommendedNextAction: "requeue",
        conflictSummary: "Resolved conflict successfully",
        resolutionStrategy: "Manual resolution applied",
      }),
    );

    // Start with a janus_required item
    const item = makeQueueItem({
      status: "janus_required",
      attemptCount: 3,
      lastError: "Conflict detected",
    });
    const state = makeQueueState({ items: [item] });
    const publisher = makeEventPublisher();

    // Handle the Janus result
    const result = await handleJanusResult(artifact, projectRoot, state, publisher);

    // Verify full flow
    expect(result.finalStatus).toBe("queued");
    expect(result.updatedState.items[0].status).toBe("queued");
    expect(result.updatedState.items[0].attemptCount).toBe(0);
    expect(result.updatedState.items[0].lastError).toBeNull();

    // Verify events were emitted in correct order
    expect(publisher.events[0].type).toBe("merge.queue_state");
    expect(publisher.events[1].type).toBe("merge.outcome");
    const outcomePayload = publisher.events[1].payload as Record<string, unknown>;
    expect(outcomePayload.outcome).toBe("JANUS_RESOLVED");
  });

  it("full Janus flow: semantic ambiguity → manual_decision_required", async () => {
    const artifact = parseJanusResolutionArtifact(
      makeJanusArtifact({
        recommendedNextAction: "manual_decision",
        conflictSummary: "Semantic type incompatibility",
        resolutionStrategy: "Cannot determine correct approach",
        residualRisks: ["Type compatibility uncertain"],
      }),
    );

    const item = makeQueueItem({ status: "janus_required" });
    const state = makeQueueState({ items: [item] });
    const publisher = makeEventPublisher();

    const result = await handleJanusResult(artifact, projectRoot, state, publisher);

    expect(result.finalStatus).toBe("manual_decision_required");
    expect(result.humanDecisionCreated).toBe(true);
    expect(result.humanDecisionPath).toContain("human-decision");

    // Verify artifact was persisted
    const loaded = loadHumanDecisionArtifact("aegis-fjm.5", projectRoot);
    expect(loaded).not.toBeNull();
    expect(loaded!.semanticAmbiguitySummary).toBe("Semantic type incompatibility");
  });

  it("full Janus flow: failure → janus_failed with error detail", async () => {
    const artifact = parseJanusResolutionArtifact(
      makeJanusArtifact({
        recommendedNextAction: "fail",
        conflictSummary: "Budget exhausted",
        resolutionStrategy: "Failed to resolve",
      }),
    );

    const item = makeQueueItem({ status: "janus_required" });
    const state = makeQueueState({ items: [item] });
    const publisher = makeEventPublisher();

    const result = await handleJanusResult(artifact, projectRoot, state, publisher);

    expect(result.finalStatus).toBe("janus_failed");
    expect(result.humanDecisionCreated).toBe(false);

    const outcomeEvent = publisher.events.find((e) => e.type === "merge.outcome");
    expect(outcomeEvent).toBeDefined();
    const payload = outcomeEvent!.payload as Record<string, unknown>;
    expect(payload.outcome).toBe("JANUS_FAILED");
  });
});
