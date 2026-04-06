/**
 * Oracle assessment parsing contract.
 *
 * SPECv2 §10.1.1 defines the machine-parseable OracleAssessment shape. This
 * module parses and validates that contract strictly so downstream code can
 * rely on a stable structure.
 */

// ---------------------------------------------------------------------------
// OracleAssessment contract
// ---------------------------------------------------------------------------

export type OracleComplexity = "trivial" | "moderate" | "complex";

export interface OracleAssessment {
  files_affected: string[];
  estimated_complexity: OracleComplexity;
  decompose: boolean;
  sub_issues?: string[];
  blockers?: string[];
  ready: boolean;
}

/**
 * Build the standard description string for a derived sub-issue.
 *
 * Both `create-derived-issues.ts` and `run-oracle.ts` use this to identify
 * reusable and orphaned derived issues. Keeping it in one place prevents
 * silent mismatches when the template changes.
 */
export function oracleDerivedDescription(issueId: string): string {
  return `Derived from Oracle assessment for ${issueId}.`;
}

export type OracleAssessmentParseReason = "invalid_json" | "invalid_shape";

export class OracleAssessmentParseError extends Error {
  readonly reason: OracleAssessmentParseReason;

  constructor(reason: OracleAssessmentParseReason, message: string) {
    super(message);
    this.name = "OracleAssessmentParseError";
    this.reason = reason;
  }
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
    throw new OracleAssessmentParseError(
      "invalid_shape",
      "Oracle assessment must be a JSON object.",
    );
  }
  return value as Record<string, unknown>;
}

function assertStringArray(value: unknown, key: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new OracleAssessmentParseError(
      "invalid_shape",
      `Oracle assessment field '${key}' must be an array of strings.`,
    );
  }
  return value.slice();
}

function assertBoolean(value: unknown, key: string): boolean {
  if (typeof value !== "boolean") {
    throw new OracleAssessmentParseError(
      "invalid_shape",
      `Oracle assessment field '${key}' must be a boolean.`,
    );
  }
  return value;
}

function assertComplexity(value: unknown): OracleComplexity {
  if (value === "trivial" || value === "moderate" || value === "complex") {
    return value;
  }
  throw new OracleAssessmentParseError(
    "invalid_shape",
    "Oracle assessment field 'estimated_complexity' must be one of 'trivial', 'moderate', or 'complex'.",
  );
}

/**
 * Parse a raw Oracle output string into a strict OracleAssessment.
 *
 * The parser rejects malformed JSON, missing fields, wrong types, and unknown
 * top-level keys so later stages do not infer meaning from narrative text.
 */
export function parseOracleAssessment(raw: string): OracleAssessment {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new OracleAssessmentParseError(
      "invalid_json",
      `Oracle assessment is not valid JSON: ${(err as Error).message}`,
    );
  }

  const obj = assertPlainObject(parsed);
  for (const key of Object.keys(obj)) {
    if (!ORACLE_ASSESSMENT_KEYS.has(key)) {
      throw new OracleAssessmentParseError(
        "invalid_shape",
        `Oracle assessment contains an unexpected field: ${key}`,
      );
    }
  }

  const filesAffected = obj["files_affected"];
  const estimatedComplexity = obj["estimated_complexity"];
  const decompose = obj["decompose"];
  const ready = obj["ready"];

  if (!("files_affected" in obj)) {
    throw new OracleAssessmentParseError(
      "invalid_shape",
      "Oracle assessment is missing required field 'files_affected'.",
    );
  }
  if (!("estimated_complexity" in obj)) {
    throw new OracleAssessmentParseError(
      "invalid_shape",
      "Oracle assessment is missing required field 'estimated_complexity'.",
    );
  }
  if (!("decompose" in obj)) {
    throw new OracleAssessmentParseError(
      "invalid_shape",
      "Oracle assessment is missing required field 'decompose'.",
    );
  }
  if (!("ready" in obj)) {
    throw new OracleAssessmentParseError(
      "invalid_shape",
      "Oracle assessment is missing required field 'ready'.",
    );
  }

  const assessment: OracleAssessment = {
    files_affected: assertStringArray(filesAffected, "files_affected"),
    estimated_complexity: assertComplexity(estimatedComplexity),
    decompose: assertBoolean(decompose, "decompose"),
    ready: assertBoolean(ready, "ready"),
  };

  if (assessment.decompose) {
    if (!("sub_issues" in obj)) {
      throw new OracleAssessmentParseError(
        "invalid_shape",
        "Oracle assessment with 'decompose=true' must include 'sub_issues'.",
      );
    }

    const subIssues = assertStringArray(obj["sub_issues"], "sub_issues");
    if (subIssues.length === 0) {
      throw new OracleAssessmentParseError(
        "invalid_shape",
        "Oracle assessment with 'decompose=true' must include at least one 'sub_issues' entry.",
      );
    }

    assessment.sub_issues = subIssues;
  } else if ("sub_issues" in obj) {
    assessment.sub_issues = assertStringArray(obj["sub_issues"], "sub_issues");
  }

  if ("blockers" in obj) {
    assessment.blockers = assertStringArray(obj["blockers"], "blockers");
  }

  return assessment;
}
