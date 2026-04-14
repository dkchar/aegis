export type JanusRecommendedNextAction = "requeue" | "manual_decision" | "fail";

export interface JanusResolutionArtifact {
  originatingIssueId: string;
  queueItemId: string;
  preservedLaborPath: string;
  conflictSummary: string;
  resolutionStrategy: string;
  filesTouched: string[];
  validationsRun: string[];
  residualRisks: string[];
  recommendedNextAction: JanusRecommendedNextAction;
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

function assertPlainObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Janus resolution artifact must be a JSON object.");
  }

  return value as Record<string, unknown>;
}

function assertString(value: unknown, key: string): string {
  if (typeof value !== "string") {
    throw new Error(`Janus resolution artifact field '${key}' must be a string.`);
  }

  return value;
}

function assertStringArray(value: unknown, key: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Janus resolution artifact field '${key}' must be an array of strings.`);
  }

  return value.slice();
}

function assertRecommendedNextAction(value: unknown): JanusRecommendedNextAction {
  if (value === "requeue" || value === "manual_decision" || value === "fail") {
    return value;
  }

  throw new Error(
    "Janus resolution artifact field 'recommendedNextAction' must be one of: requeue, manual_decision, fail.",
  );
}

export function parseJanusResolutionArtifact(raw: string): JanusResolutionArtifact {
  const parsed = JSON.parse(raw) as unknown;
  const obj = assertPlainObject(parsed);

  for (const key of Object.keys(obj)) {
    if (!JANUS_ARTIFACT_KEYS.has(key)) {
      throw new Error(`Janus resolution artifact contains an unexpected field: ${key}`);
    }
  }

  for (const field of [
    "originatingIssueId",
    "queueItemId",
    "preservedLaborPath",
    "conflictSummary",
    "resolutionStrategy",
    "filesTouched",
    "validationsRun",
    "residualRisks",
    "recommendedNextAction",
  ]) {
    if (!(field in obj)) {
      throw new Error(`Janus resolution artifact is missing required field '${field}'.`);
    }
  }

  return {
    originatingIssueId: assertString(obj["originatingIssueId"], "originatingIssueId"),
    queueItemId: assertString(obj["queueItemId"], "queueItemId"),
    preservedLaborPath: assertString(obj["preservedLaborPath"], "preservedLaborPath"),
    conflictSummary: assertString(obj["conflictSummary"], "conflictSummary"),
    resolutionStrategy: assertString(obj["resolutionStrategy"], "resolutionStrategy"),
    filesTouched: assertStringArray(obj["filesTouched"], "filesTouched"),
    validationsRun: assertStringArray(obj["validationsRun"], "validationsRun"),
    residualRisks: assertStringArray(obj["residualRisks"], "residualRisks"),
    recommendedNextAction: assertRecommendedNextAction(obj["recommendedNextAction"]),
  };
}
