import { parseJsonObjectText } from "../../shared/json.js";

export type OracleComplexity = "trivial" | "moderate" | "complex";

export interface OracleAssessment {
  files_affected: string[];
  estimated_complexity: OracleComplexity;
  risks: string[];
  suggested_checks: string[];
  scope_notes: string[];
}

const ORACLE_ASSESSMENT_KEYS = new Set([
  "files_affected",
  "estimated_complexity",
  "risks",
  "suggested_checks",
  "scope_notes",
]);

function assertPlainObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Oracle assessment must be a JSON object.");
  }

  return value as Record<string, unknown>;
}

function assertStringArray(value: unknown, key: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Oracle assessment field '${key}' must be an array of strings.`);
  }

  return value.slice();
}

function normalizeFilesAffected(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error("Oracle assessment field 'files_affected' must be an array of strings.");
  }

  return value.map((item) => {
    if (typeof item === "string") {
      return item;
    }

    if (
      typeof item === "object"
      && item !== null
      && !Array.isArray(item)
      && typeof (item as { path?: unknown }).path === "string"
    ) {
      return (item as { path: string }).path;
    }

    throw new Error("Oracle assessment field 'files_affected' must be an array of strings.");
  });
}

function assertComplexity(value: unknown): OracleComplexity {
  let normalizedValue = value;
  if (typeof value === "string" && /^"(trivial|moderate|complex)"$/.test(value)) {
    normalizedValue = value.slice(1, -1);
  }

  if (normalizedValue === "trivial" || normalizedValue === "moderate" || normalizedValue === "complex") {
    return normalizedValue;
  }

  throw new Error(
    "Oracle assessment field 'estimated_complexity' must be one of 'trivial', 'moderate', or 'complex'.",
  );
}

export function parseOracleAssessment(raw: string): OracleAssessment {
  const parsed = parseJsonObjectText(raw);
  const obj = assertPlainObject(parsed);

  for (const key of Object.keys(obj)) {
    if (!ORACLE_ASSESSMENT_KEYS.has(key)) {
      throw new Error(`Oracle assessment contains an unexpected field: ${key}`);
    }
  }

  if (!("files_affected" in obj)) {
    throw new Error("Oracle assessment is missing required field 'files_affected'.");
  }
  if (!("estimated_complexity" in obj)) {
    throw new Error("Oracle assessment is missing required field 'estimated_complexity'.");
  }
  if (!("risks" in obj)) {
    throw new Error("Oracle assessment is missing required field 'risks'.");
  }
  if (!("suggested_checks" in obj)) {
    throw new Error("Oracle assessment is missing required field 'suggested_checks'.");
  }
  if (!("scope_notes" in obj)) {
    throw new Error("Oracle assessment is missing required field 'scope_notes'.");
  }

  const assessment: OracleAssessment = {
    files_affected: normalizeFilesAffected(obj["files_affected"]),
    estimated_complexity: assertComplexity(obj["estimated_complexity"]),
    risks: assertStringArray(obj["risks"], "risks"),
    suggested_checks: assertStringArray(obj["suggested_checks"], "suggested_checks"),
    scope_notes: assertStringArray(obj["scope_notes"], "scope_notes"),
  };

  return assessment;
}
