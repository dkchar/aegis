export type OracleComplexity = "trivial" | "moderate" | "complex";

export interface OracleAssessment {
  files_affected: string[];
  estimated_complexity: OracleComplexity;
  decompose: boolean;
  sub_issues?: string[];
  blockers?: string[];
  ready: boolean;
}

const ORACLE_ASSESSMENT_KEYS = new Set([
  "files_affected",
  "estimated_complexity",
  "decompose",
  "sub_issues",
  "blockers",
  "ready",
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

function assertBoolean(value: unknown, key: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Oracle assessment field '${key}' must be a boolean.`);
  }

  return value;
}

function assertComplexity(value: unknown): OracleComplexity {
  if (value === "trivial" || value === "moderate" || value === "complex") {
    return value;
  }

  throw new Error(
    "Oracle assessment field 'estimated_complexity' must be one of 'trivial', 'moderate', or 'complex'.",
  );
}

export function parseOracleAssessment(raw: string): OracleAssessment {
  const parsed = JSON.parse(raw) as unknown;
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
  if (!("decompose" in obj)) {
    throw new Error("Oracle assessment is missing required field 'decompose'.");
  }
  if (!("ready" in obj)) {
    throw new Error("Oracle assessment is missing required field 'ready'.");
  }

  const assessment: OracleAssessment = {
    files_affected: assertStringArray(obj["files_affected"], "files_affected"),
    estimated_complexity: assertComplexity(obj["estimated_complexity"]),
    decompose: assertBoolean(obj["decompose"], "decompose"),
    ready: assertBoolean(obj["ready"], "ready"),
  };

  if ("sub_issues" in obj) {
    assessment.sub_issues = assertStringArray(obj["sub_issues"], "sub_issues");
  }

  if ("blockers" in obj) {
    assessment.blockers = assertStringArray(obj["blockers"], "blockers");
  }

  return assessment;
}
