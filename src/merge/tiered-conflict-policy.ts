/**
 * Tiered conflict classification policy.
 *
 * SPECv2 §12.5 and §12.8:
 *   - Tier 1: simple refresh (fast-forwardable after rebase) — mechanical handle
 *   - Tier 2: contained conflict (limited files, resolvable) — mechanical rework attempt
 *   - Tier 3: Janus escalation (complex, semantic ambiguity, repeated failures) — requires Janus
 *
 * This module provides:
 *   - tier classification based on conflict characteristics
 *   - invocation policy for when Janus becomes eligible
 *   - decision functions for escalation triggers
 *   - retry thresholds and escalation logic
 */

// ---------------------------------------------------------------------------
// Tier model
// ---------------------------------------------------------------------------

/**
 * Conflict tier classification (SPECv2 §12.8).
 *
 * - Tier 1: simple rebase or stale branch — mechanical rework
 * - Tier 2: hard conflict — contained, limited files, resolvable by rework
 * - Tier 3: Janus escalation — complex, semantic ambiguity, repeated failures
 */
export type ConflictTier = 1 | 2 | 3;

/** Classification result from analyzing a merge outcome. */
export interface ConflictClassification {
  /** The assigned conflict tier. */
  tier: ConflictTier;

  /** Human-readable explanation of the classification. */
  reason: string;

  /** Whether Janus escalation is eligible for this conflict. */
  janusEligible: boolean;
}

// ---------------------------------------------------------------------------
// Janus invocation policy
// ---------------------------------------------------------------------------

/**
 * Configuration governing Janus escalation eligibility.
 *
 * Per SPECv2 §10.5 and §12.5.1, Janus becomes eligible only when:
 *   - conflict complexity crosses the configured threshold
 *   - repeated rework attempts exceed a cap
 *   - economic guardrails allow escalation
 *   - repository policy enables Janus escalation
 */
export interface JanusInvocationPolicy {
  /** Whether Janus escalation is enabled for this repository. */
  janusEnabled: boolean;

  /** Maximum retry attempts before Janus escalation becomes eligible. */
  maxRetryAttempts: number;

  /** Maximum number of files that can be in conflict before forcing Tier 3. */
  maxConflictFiles: number;

  /** Whether economic guardrails allow Janus escalation. */
  economicGuardrailsAllow: boolean;
}

/**
 * Evaluate whether Janus escalation is eligible for a given conflict scenario.
 *
 * Per SPECv2 §12.5.1, Janus becomes eligible only when ALL of:
 *   - the queue item has reached Tier 3 escalation
 *   - the number of failed refresh or conflict cycles has reached the configured cap
 *   - the repository has Janus enabled
 *   - no higher-priority human decision is obviously required first
 *   - economic guardrails allow the escalation or the human explicitly overrides
 *
 * @param attemptCount - Number of prior failed merge/rework attempts.
 * @param policy - The Janus invocation policy configuration.
 * @returns True if Janus escalation is eligible.
 */
export function isJanusEligible(
  attemptCount: number,
  policy: JanusInvocationPolicy,
): boolean {
  if (!policy.janusEnabled) {
    return false;
  }

  if (attemptCount < policy.maxRetryAttempts) {
    return false;
  }

  if (!policy.economicGuardrailsAllow) {
    return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Tier classification functions
// ---------------------------------------------------------------------------

/**
 * Classify a merge outcome into a conflict tier.
 *
 * Classification logic (SPECv2 §12.8):
 *   - Tier 1: stale branch, simple rebase needed, fast-forwardable after rebase
 *   - Tier 2: hard conflict with limited files, resolvable through mechanical rework
 *   - Tier 3: complex conflict, semantic ambiguity, repeated failures exceeding thresholds
 *
 * @param mergeOutput - Captured stdout/stderr from the merge command.
 * @param exitCode - Exit code from the merge command (0 = success).
 * @param conflictFileCount - Number of files with conflict markers.
 * @param attemptCount - Number of prior attempts for this queue item.
 * @param policy - Janus invocation policy configuration.
 * @returns The conflict classification.
 */
export function classifyConflictTier(
  mergeOutput: string,
  exitCode: number,
  conflictFileCount: number,
  attemptCount: number,
  policy: JanusInvocationPolicy,
): ConflictClassification {
  // Exit code 0 means clean merge — not a conflict case
  if (exitCode === 0) {
    return {
      tier: 1,
      reason: "Merge succeeded; no conflict classification needed.",
      janusEligible: false,
    };
  }

  const hasConflicts = detectConflicts(mergeOutput);
  const hasSemanticAmbiguity = detectSemanticAmbiguity(mergeOutput);

  // Tier 3: Janus escalation
  // - repeated failures exceed retry threshold
  // - semantic ambiguity detected
  // - conflict file count exceeds threshold
  // - Janus policy allows it
  if (shouldEscalateToJanus(hasConflicts, hasSemanticAmbiguity, conflictFileCount, attemptCount, policy)) {
    const eligible = isJanusEligible(attemptCount, policy);
    let reason = "Janus escalation: ";
    if (hasSemanticAmbiguity) {
      reason += "semantic ambiguity detected; ";
    }
    if (conflictFileCount >= policy.maxConflictFiles) {
      reason += `conflict file count (${conflictFileCount}) exceeds threshold (${policy.maxConflictFiles}); `;
    }
    if (attemptCount >= policy.maxRetryAttempts) {
      reason += `retry threshold reached (${attemptCount}/${policy.maxRetryAttempts}); `;
    }
    if (!eligible) {
      reason += "but Janus is NOT eligible (check janusEnabled, maxRetryAttempts, economicGuardrailsAllow)";
    }

    return {
      tier: 3,
      reason,
      janusEligible: eligible,
    };
  }

  // Tier 2: hard conflict with contained files
  if (hasConflicts) {
    return {
      tier: 2,
      reason: `Hard conflict with ${conflictFileCount} conflicting file(s); mechanical rework attempt possible.`,
      janusEligible: false,
    };
  }

  // Tier 1: simple rebase or stale branch
  return {
    tier: 1,
    reason: "Stale branch or simple rebase needed; mechanical rework via refreshed implementation.",
    janusEligible: false,
  };
}

/**
 * Determine if a conflict should escalate to Janus (Tier 3).
 *
 * Escalation triggers:
 *   - retry attempts have reached or exceeded the configured cap
 *   - semantic ambiguity is detected in the conflict
 *   - the number of conflicting files exceeds the mechanical-handling threshold
 *   - the repository policy enables Janus
 *
 * @param hasConflicts - Whether actual file conflicts exist.
 * @param hasSemanticAmbiguity - Whether semantic/logic ambiguity is detected.
 * @param conflictFileCount - Number of files with conflict markers.
 * @param attemptCount - Number of prior attempts.
 * @param policy - Janus invocation policy.
 * @returns True if this conflict should be classified as Tier 3.
 */
export function shouldEscalateToJanus(
  hasConflicts: boolean,
  hasSemanticAmbiguity: boolean,
  conflictFileCount: number,
  attemptCount: number,
  policy: JanusInvocationPolicy,
): boolean {
  // Semantic ambiguity alone can trigger Tier 3 classification
  // (but Janus dispatch still requires isJanusEligible to be true)
  if (hasSemanticAmbiguity) {
    return true;
  }

  // Too many conflicting files for mechanical handling
  if (conflictFileCount >= policy.maxConflictFiles) {
    return true;
  }

  // Repeated failures exceeding retry cap
  if (hasConflicts && attemptCount >= policy.maxRetryAttempts) {
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Conflict detection helpers
// ---------------------------------------------------------------------------

/**
 * Detect whether merge output contains actual file conflict markers.
 *
 * @param mergeOutput - Combined stdout/stderr from the merge command.
 * @returns True if conflict markers are present.
 */
export function detectConflicts(mergeOutput: string): boolean {
  return (
    mergeOutput.includes("CONFLICT") ||
    mergeOutput.includes("Automatic merge failed") ||
    mergeOutput.includes("Merge conflict") ||
    mergeOutput.includes("<<<<<<<")
  );
}

/**
 * Detect indicators of semantic ambiguity (not just file-level conflicts).
 *
 * Semantic ambiguity indicators include:
 *   - test failures after merge resolution
 *   - type errors that suggest incompatible API changes
 *   - duplicate function or class definitions
 *   - import resolution failures
 *
 * @param mergeOutput - Combined output from merge and post-merge gates.
 * @returns True if semantic ambiguity is detected.
 */
export function detectSemanticAmbiguity(mergeOutput: string): boolean {
  // Narrow indicators that suggest genuine semantic ambiguity in merge conflicts.
  // Avoid matching routine TypeScript/compilation errors which appear in normal
  // gate checks (tests, lint, build) during Tier 1/2 merge attempts.
  //
  // Per SPECv2 §10.4.1: semantic ambiguity means the conflict cannot be resolved
  // mechanically because the intended integration is unclear.
  const semanticIndicators = [
    "circular dependency",
    "incompatible types",
    "both modified",      // Git conflict marker context suggesting ambiguous intent
    "cannot merge",       // Explicit merge impossibility
    "ambiguous",          // Direct ambiguity signals
  ];

  const lower = mergeOutput.toLowerCase();
  return semanticIndicators.some((indicator) => lower.includes(indicator));
}

// ---------------------------------------------------------------------------
// Default policy
// ---------------------------------------------------------------------------

/**
 * Default Janus invocation policy.
 *
 * Per SPECv2 §16 (config defaults):
 *   - Janus enabled: false (default false for safety)
 *   - max retry attempts: 2 (matches janus_retry_threshold config default)
 *   - max conflict files: 10 (threshold for mechanical vs. escalation)
 *   - economic guardrails: true (assumed allowed unless budget signals say otherwise)
 */
export function defaultJanusInvocationPolicy(): JanusInvocationPolicy {
  return {
    janusEnabled: false,
    maxRetryAttempts: 2,
    maxConflictFiles: 10,
    economicGuardrailsAllow: true,
  };
}
