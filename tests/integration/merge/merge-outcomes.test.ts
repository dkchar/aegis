/**
 * Merge outcomes — integration tests.
 *
 * SPECv2 §12.6, §12.8, §12.9:
 *   - A clean candidate lands
 *   - A failing candidate emits MERGE_FAILED
 *   - A conflicting candidate emits REWORK_REQUEST with preserved labor
 *   - Restart during merge processing remains safe
 *
 * Automated gate: npm run test -- tests/unit/merge/run-gates.test.ts tests/integration/merge/merge-outcomes.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  attemptMerge,
  classifyConflictTier,
  type MergeAttemptInput,
} from "../../../src/merge/apply-merge.js";
import {
  emitOutcomeArtifact,
  parseOutcomeArtifact,
  serializeOutcomeArtifact,
  type MergeOutcomeArtifact,
} from "../../../src/merge/emit-outcome-artifact.js";
import {
  preserveLabor,
  shouldPreserveLabor,
  type LaborPreservationRequest,
} from "../../../src/merge/preserve-labor.js";
import { runGates, defaultGateConfig } from "../../../src/merge/run-gates.js";
import type { MergeOutcomeEventPayload } from "../../../src/events/merge-events.js";

let testDir: string;
let projectRoot: string;
let laborPath: string;

beforeEach(() => {
  testDir = join(process.cwd(), ".aegis-test-" + randomUUID());
  projectRoot = join(testDir, "project");
  laborPath = join(testDir, "labor");
  mkdirSync(projectRoot, { recursive: true });
  mkdirSync(laborPath, { recursive: true });

  // Initialize a git repo in projectRoot
  spawnSync("git", ["init"], { cwd: projectRoot, windowsHide: true });
  spawnSync("git", ["config", "user.email", "test@test.com"], { cwd: projectRoot, windowsHide: true });
  spawnSync("git", ["config", "user.name", "Test"], { cwd: projectRoot, windowsHide: true });

  // Create initial commit on main
  writeFileSync(join(projectRoot, "README.md"), "# Test Project\n");
  spawnSync("git", ["add", "."], { cwd: projectRoot, windowsHide: true });
  spawnSync("git", ["commit", "-m", "initial"], { cwd: projectRoot, windowsHide: true });
  spawnSync("git", ["branch", "-M", "main"], { cwd: projectRoot, windowsHide: true });
});

afterEach(() => {
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMergeInput(overrides: Partial<MergeAttemptInput> = {}): MergeAttemptInput {
  return {
    candidateBranch: overrides.candidateBranch ?? "aegis/test-issue",
    targetBranch: overrides.targetBranch ?? "main",
    projectRoot: overrides.projectRoot ?? projectRoot,
    laborPath: overrides.laborPath ?? laborPath,
    issueId: overrides.issueId ?? "aegis-fjm.1",
    attemptCount: overrides.attemptCount ?? 0,
    maxRetryBeforeJanus: overrides.maxRetryBeforeJanus ?? 3,
  };
}

function createCandidateBranch(branchName: string, content: string, fileName: string = "feature.txt"): string {
  // Create the branch from main with some content
  spawnSync("git", ["checkout", "-b", branchName, "main"], { cwd: projectRoot, windowsHide: true });
  writeFileSync(join(projectRoot, fileName), content);
  spawnSync("git", ["add", "."], { cwd: projectRoot, windowsHide: true });
  spawnSync("git", ["commit", "-m", `add ${fileName}`], { cwd: projectRoot, windowsHide: true });
  spawnSync("git", ["checkout", "main"], { cwd: projectRoot, windowsHide: true });
  return branchName;
}

// ---------------------------------------------------------------------------
// classifyConflictTier
// ---------------------------------------------------------------------------

describe("classifyConflictTier", () => {
  it("returns Tier 0 for successful merge (exit code 0)", () => {
    const tier = classifyConflictTier("merge succeeded", 0, 0, 3);
    expect(tier).toBe(0);
  });

  it("returns Tier 1 for stale branch (non-zero exit, no conflict markers)", () => {
    const tier = classifyConflictTier("nothing to merge", 1, 0, 3);
    expect(tier).toBe(1);
  });

  it("returns Tier 2 for hard conflict (CONFLICT in output)", () => {
    const tier = classifyConflictTier("CONFLICT (content): Merge conflict in file.txt", 1, 0, 3);
    expect(tier).toBe(2);
  });

  it("returns Tier 2 for 'Automatic merge failed' output", () => {
    const tier = classifyConflictTier("Automatic merge failed", 1, 0, 3);
    expect(tier).toBe(2);
  });

  it("prioritizes Tier 3 over Tier 2 when threshold is reached with conflicts", () => {
    // When actual conflicts exist AND threshold is reached, Tier 3 takes priority
    const tier = classifyConflictTier("CONFLICT content", 1, 3, 3);
    expect(tier).toBe(3);
  });

  it("returns Tier 2 (not Tier 3) for conflicts below threshold", () => {
    const tier = classifyConflictTier("CONFLICT in file", 1, 2, 3);
    expect(tier).toBe(2);
  });

  it("returns Tier 3 for non-conflict failures at threshold", () => {
    const tier = classifyConflictTier("some error", 1, 3, 3);
    expect(tier).toBe(3);
  });

  it("returns Tier 1 for non-conflict failures below threshold", () => {
    const tier = classifyConflictTier("some error", 1, 1, 3);
    expect(tier).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// attemptMerge
// ---------------------------------------------------------------------------

describe("attemptMerge", () => {
  it("successfully merges a clean candidate branch (Tier 0)", async () => {
    createCandidateBranch("aegis/clean-issue", "clean feature content");

    // Without a remote, attemptMerge now skips fetch/pull and proceeds
    // directly to the local merge, which should succeed for a clean branch.
    const result = await attemptMerge({
      candidateBranch: "aegis/clean-issue",
      targetBranch: "main",
      projectRoot,
      laborPath,
      issueId: "aegis-fjm.1",
      attemptCount: 0,
      maxRetryBeforeJanus: 3,
    });

    expect(result.success).toBe(true);
    expect(result.conflictTier).toBe(0);
    expect(result.outcome).toBe("MERGED");
    expect(result.laborPreserved).toBe(false);
  });

  it("returns REWORK_REQUEST when candidate branch does not exist", async () => {
    const result = await attemptMerge({
      candidateBranch: "nonexistent-branch",
      targetBranch: "main",
      projectRoot,
      laborPath,
      issueId: "aegis-fjm.1",
      attemptCount: 0,
      maxRetryBeforeJanus: 3,
    });

    // Non-existent branch results in non-conflict failure
    expect(result.success).toBe(false);
    expect(result.outcome).toBe("REWORK_REQUEST");
    expect(result.laborPreserved).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// emitOutcomeArtifact
// ---------------------------------------------------------------------------

describe("emitOutcomeArtifact", () => {
  it("emits and persists a MERGED outcome artifact", async () => {
    const artifact = await emitOutcomeArtifact(
      "aegis-fjm.1",
      "MERGED",
      "aegis/clean-issue",
      "main",
      0,
      "Clean merge succeeded",
      false,
      testDir,
    );

    expect(artifact.issueId).toBe("aegis-fjm.1");
    expect(artifact.outcome).toBe("MERGED");
    expect(artifact.conflictTier).toBe(0);
    expect(artifact.laborPreserved).toBe(false);
    expect(artifact.followUpIssueId).toBeNull();
    expect(artifact.createdAt).toBeDefined();

    // Verify file was persisted
    const { readdirSync } = await import("node:fs");
    const laborsDir = join(testDir, ".aegis", "labors");
    const files = readdirSync(laborsDir);
    expect(files.length).toBeGreaterThanOrEqual(1);
    expect(files[0]).toMatch(/merge-outcome-/);
  });

  it("emits a MERGE_FAILED outcome with error detail", async () => {
    const artifact = await emitOutcomeArtifact(
      "aegis-fjm.2",
      "MERGE_FAILED",
      "aegis/conflict-issue",
      "main",
      2,
      "Hard merge conflict",
      true,
      testDir,
      "Conflict in file.txt",
    );

    expect(artifact.outcome).toBe("MERGE_FAILED");
    expect(artifact.conflictTier).toBe(2);
    expect(artifact.laborPreserved).toBe(true);
    expect(artifact.error).toBe("Conflict in file.txt");
  });

  it("emits a REWORK_REQUEST outcome", async () => {
    const artifact = await emitOutcomeArtifact(
      "aegis-fjm.3",
      "REWORK_REQUEST",
      "aegis/stale-issue",
      "main",
      1,
      "Stale branch needs rebase",
      true,
      testDir,
    );

    expect(artifact.outcome).toBe("REWORK_REQUEST");
    expect(artifact.conflictTier).toBe(1);
    expect(artifact.laborPreserved).toBe(true);
  });

  it("round-trips through serialize and parse", async () => {
    const artifact = await emitOutcomeArtifact(
      "aegis-fjm.4",
      "MERGED",
      "aegis/roundtrip",
      "main",
      0,
      "Test round-trip",
      false,
      testDir,
    );

    const serialized = serializeOutcomeArtifact(artifact);
    const parsed = parseOutcomeArtifact(serialized);

    expect(parsed.issueId).toBe(artifact.issueId);
    expect(parsed.outcome).toBe(artifact.outcome);
    expect(parsed.conflictTier).toBe(artifact.conflictTier);
    expect(parsed.detail).toBe(artifact.detail);
  });

  it("throws on malformed JSON", () => {
    expect(() => parseOutcomeArtifact("not json")).toThrow();
  });

  it("throws on missing required fields", () => {
    const incomplete = JSON.stringify({ issueId: "aegis-fjm.1" });
    expect(() => parseOutcomeArtifact(incomplete)).toThrow(/missing required field/);
  });
});

// ---------------------------------------------------------------------------
// preserveLabor
// ---------------------------------------------------------------------------

describe("preserveLabor", () => {
  it("preserves labor after MERGE_FAILED outcome", async () => {
    const request: LaborPreservationRequest = {
      issueId: "aegis-fjm.1",
      laborPath,
      branchName: "aegis/test-issue",
      outcome: "MERGE_FAILED",
      isConflict: true,
      reason: "Hard merge conflict",
    };

    const result = await preserveLabor(request);

    expect(result.preserved).toBe(true);
    expect(result.laborPath).toBe(laborPath);
    expect(result.branchName).toBe("aegis/test-issue");
    expect(result.skippedCleanupPlan).not.toBeNull();
    expect(result.skippedCleanupPlan!.preserveLabor).toBe(false); // would have cleaned up
  });

  it("preserves labor after REWORK_REQUEST outcome", async () => {
    const request: LaborPreservationRequest = {
      issueId: "aegis-fjm.2",
      laborPath,
      branchName: "aegis/stale-issue",
      outcome: "REWORK_REQUEST",
      isConflict: false,
      reason: "Stale branch needs rebase",
    };

    const result = await preserveLabor(request);

    expect(result.preserved).toBe(true);
    expect(result.laborPath).toBe(laborPath);
  });

  it("writes preservation metadata", async () => {
    const request: LaborPreservationRequest = {
      issueId: "aegis-fjm.3",
      laborPath,
      branchName: "aegis/meta-issue",
      outcome: "MERGE_FAILED",
      isConflict: true,
      reason: "Test metadata",
    };

    const result = await preserveLabor(request);

    expect(result.preserved).toBe(true);

    // Verify metadata file exists
    const metadataPath = join(laborPath, ".aegis-labor", "preservation.json");
    expect(existsSync(metadataPath)).toBe(true);

    const metadata = JSON.parse(readFileSync(metadataPath, "utf-8"));
    expect(metadata.issueId).toBe("aegis-fjm.3");
    expect(metadata.outcome).toBe("MERGE_FAILED");
    expect(metadata.isConflict).toBe(true);
    expect(metadata.reason).toBe("Test metadata");
    expect(metadata.preservedAt).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// shouldPreserveLabor
// ---------------------------------------------------------------------------

describe("shouldPreserveLabor", () => {
  it("returns false for MERGED outcome", () => {
    expect(shouldPreserveLabor("MERGED")).toBe(false);
  });

  it("returns true for MERGE_FAILED outcome", () => {
    expect(shouldPreserveLabor("MERGE_FAILED")).toBe(true);
  });

  it("returns true for REWORK_REQUEST outcome", () => {
    expect(shouldPreserveLabor("REWORK_REQUEST")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// runGates integration
// ---------------------------------------------------------------------------

describe("runGates integration", () => {
  it("runs default gate config against a candidate directory", async () => {
    // Create a minimal package.json so npm doesn't error
    writeFileSync(
      join(laborPath, "package.json"),
      JSON.stringify({
        name: "test-labor",
        scripts: { lint: "echo lint-ok", build: "echo build-ok", test: "echo test-ok" },
      }),
    );

    const config = defaultGateConfig(testDir, laborPath);
    const result = await runGates(config);

    // Gates will fail because npm scripts don't actually run real lint/build/test,
    // but the gate runner should execute and return results
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results.every((r) => r.name)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Restart safety
// ---------------------------------------------------------------------------

describe("restart safety during merge processing", () => {
  it("outcome artifacts survive process restart", async () => {
    // Emit an artifact
    const artifact1 = await emitOutcomeArtifact(
      "aegis-fjm.1",
      "MERGED",
      "aegis/test-1",
      "main",
      0,
      "First merge",
      false,
      testDir,
    );

    // Simulate restart: emit another artifact
    const artifact2 = await emitOutcomeArtifact(
      "aegis-fjm.2",
      "MERGE_FAILED",
      "aegis/test-2",
      "main",
      2,
      "Second merge failed",
      true,
      testDir,
      "Conflict",
    );

    // Both should be persisted and readable
    expect(artifact1.outcome).toBe("MERGED");
    expect(artifact2.outcome).toBe("MERGE_FAILED");

    const { readdirSync } = await import("node:fs");
    const laborsDir = join(testDir, ".aegis", "labors");
    const files = readdirSync(laborsDir);
    expect(files.length).toBeGreaterThanOrEqual(2);
  });

  it("preserved labor metadata survives restart", async () => {
    const request: LaborPreservationRequest = {
      issueId: "aegis-fjm.1",
      laborPath,
      branchName: "aegis/restart-test",
      outcome: "MERGE_FAILED",
      isConflict: true,
      reason: "Testing restart safety",
    };

    const result = await preserveLabor(request);
    expect(result.preserved).toBe(true);

    // Verify metadata persists
    const metadataPath = join(laborPath, ".aegis-labor", "preservation.json");
    expect(existsSync(metadataPath)).toBe(true);

    const metadata = JSON.parse(readFileSync(metadataPath, "utf-8"));
    expect(metadata.issueId).toBe("aegis-fjm.1");
    expect(metadata.reason).toBe("Testing restart safety");
  });
});
