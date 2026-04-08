/**
 * Janus resolution contract parsing.
 *
 * SPECv2 §10.4.1 defines the machine-parseable JanusResolutionArtifact shape.
 * This module parses and validates that contract strictly so downstream code
 * can rely on a stable structure.
 *
 * Required fields:
 *   - originatingIssueId: string
 *   - queueItemId: string
 *   - preservedLaborPath: string
 *   - conflictSummary: string
 *   - resolutionStrategy: string
 *   - filesTouched: string[]
 *   - validationsRun: string[]
 *   - residualRisks: string[]
 *   - recommendedNextAction: "requeue" | "manual_decision" | "fail"
 */

// ---------------------------------------------------------------------------
// JanusResolutionArtifact contract
// ---------------------------------------------------------------------------

export type JanusRecommendedNextAction = "requeue" | "manual_decision" | "fail";

/** The structured integration-resolution artifact produced by Janus. */
export interface JanusResolutionArtifact {
  /** The originating Beads issue ID. */
  originatingIssueId: string;

  /** The merge queue item ID. */
  queueItemId: string;

  /** Path to the preserved conflict labor or integration branch. */
  preservedLaborPath: string;

  /** Summary of the conflict or failure that was addressed. */
  conflictSummary: string;

  /** The resolution strategy chosen and applied. */
  resolutionStrategy: string;

  /** Files modified during resolution. */
  filesTouched: string[];

  /** Checks run after resolution (tests, lint, build, etc.). */
  validationsRun: string[];

  /** Remaining risks or concerns after resolution. */
  residualRisks: string[];

  /** Recommended next action for the queue or human. */
  recommendedNextAction: JanusRecommendedNextAction;
}

export type JanusParseReason = "invalid_json" | "invalid_shape";

export class JanusParseError extends Error {
  readonly reason: JanusParseReason;

  constructor(reason: JanusParseReason, message: string) {
    super(message);
    this.name = "JanusParseError";
    this.reason = reason;
  }
}

const JANUS_ARTIFACT_KEYS = new Set([
  "originatingIssueId",
  "queueItemId",
  "preservedLaborPath",
  "conflictSummary",
  "resolutionStrategy",
  "filesTouched",
  "validationsRun",
  "residualRisks",
  "recommendedNextAction",
]);

const ALLOWED_ACTIONS: JanusRecommendedNextAction[] = ["requeue", "manual_decision", "fail"];

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

function assertPlainObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new JanusParseError(
      "invalid_shape",
      "Janus resolution artifact must be a JSON object.",
    );
  }
  return value as Record<string, unknown>;
}

function assertString(value: unknown, key: string): string {
  if (typeof value !== "string") {
    throw new JanusParseError(
      "invalid_shape",
      `Janus resolution artifact field '${key}' must be a string.`,
    );
  }
  return value;
}

function assertStringArray(value: unknown, key: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new JanusParseError(
      "invalid_shape",
      `Janus resolution artifact field '${key}' must be an array of strings.`,
    );
  }
  return value.slice();
}

function assertRecommendedNextAction(value: unknown): JanusRecommendedNextAction {
  if (value === "requeue" || value === "manual_decision" || value === "fail") {
    return value;
  }
  throw new JanusParseError(
    "invalid_shape",
    `Janus resolution artifact field 'recommendedNextAction' must be one of: ${ALLOWED_ACTIONS.join(", ")}.`,
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a raw Janus output string into a strict JanusResolutionArtifact.
 *
 * The parser rejects malformed JSON, missing fields, wrong types, unknown
 * top-level keys, and invalid recommendedNextAction values so downstream
 * stages do not infer meaning from narrative text.
 *
 * @param raw - The raw JSON string from the Janus agent.
 * @returns A validated JanusResolutionArtifact.
 * @throws JanusParseError if the input is malformed or incomplete.
 */
export function parseJanusResolutionArtifact(raw: string): JanusResolutionArtifact {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new JanusParseError(
      "invalid_json",
      `Janus resolution artifact is not valid JSON: ${(err as Error).message}`,
    );
  }

  const obj = assertPlainObject(parsed);

  // Reject extra keys
  for (const key of Object.keys(obj)) {
    if (!JANUS_ARTIFACT_KEYS.has(key)) {
      throw new JanusParseError(
        "invalid_shape",
        `Janus resolution artifact contains an unexpected field: ${key}`,
      );
    }
  }

  // Check all required fields are present
  const requiredFields = [
    "originatingIssueId",
    "queueItemId",
    "preservedLaborPath",
    "conflictSummary",
    "resolutionStrategy",
    "filesTouched",
    "validationsRun",
    "residualRisks",
    "recommendedNextAction",
  ];

  for (const field of requiredFields) {
    if (!(field in obj)) {
      throw new JanusParseError(
        "invalid_shape",
        `Janus resolution artifact is missing required field '${field}'.`,
      );
    }
  }

  // Validate types
  const originatingIssueId = assertString(obj["originatingIssueId"], "originatingIssueId");
  const queueItemId = assertString(obj["queueItemId"], "queueItemId");
  const preservedLaborPath = assertString(obj["preservedLaborPath"], "preservedLaborPath");
  const conflictSummary = assertString(obj["conflictSummary"], "conflictSummary");
  const resolutionStrategy = assertString(obj["resolutionStrategy"], "resolutionStrategy");
  const filesTouched = assertStringArray(obj["filesTouched"], "filesTouched");
  const validationsRun = assertStringArray(obj["validationsRun"], "validationsRun");
  const residualRisks = assertStringArray(obj["residualRisks"], "residualRisks");
  const recommendedNextAction = assertRecommendedNextAction(obj["recommendedNextAction"]);

  return {
    originatingIssueId,
    queueItemId,
    preservedLaborPath,
    conflictSummary,
    resolutionStrategy,
    filesTouched,
    validationsRun,
    residualRisks,
    recommendedNextAction,
  };
}
