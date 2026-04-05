/**
 * Result schema validation for EvalRunResult payloads (SPECv2 §24.5).
 */

import {
  VALID_COMPLETION_OUTCOMES,
  VALID_MERGE_OUTCOMES,
  isRecord,
} from "./schema-helpers.js";

/** Returns true if the string is a valid ISO-8601 timestamp with time component. */
function isIso8601(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value) && !Number.isNaN(new Date(value).getTime());
}

// ---------------------------------------------------------------------------
// validateEvalRunResult
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate that an unknown object conforms to the EvalRunResult interface.
 *
 * Returns `{ valid: true, errors: [] }` on success, or
 * `{ valid: false, errors: [...] }` listing every violation found.
 */
export function validateEvalRunResult(data: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isRecord(data)) {
    return { valid: false, errors: ["Expected an object, got " + typeof data] };
  }

  // ── Identity strings ──────────────────────────────────────────────────────

  for (const field of ["aegis_version", "git_sha", "config_fingerprint", "runtime"] as const) {
    if (typeof data[field] !== "string" || (data[field] as string).length === 0) {
      errors.push(`"${field}" must be a non-empty string`);
    }
  }

  // ── model_mapping ─────────────────────────────────────────────────────────

  if (!isRecord(data["model_mapping"])) {
    errors.push('"model_mapping" must be an object');
  } else {
    for (const [k, v] of Object.entries(data["model_mapping"])) {
      if (typeof v !== "string") {
        errors.push(`"model_mapping.${k}" must be a string`);
      }
    }
  }

  // ── scenario_id ───────────────────────────────────────────────────────────

  if (typeof data["scenario_id"] !== "string" || (data["scenario_id"] as string).length === 0) {
    errors.push('"scenario_id" must be a non-empty string');
  }

  // ── issue_count ───────────────────────────────────────────────────────────

  if (typeof data["issue_count"] !== "number" || (data["issue_count"] as number) < 0 || !Number.isInteger(data["issue_count"] as number)) {
    errors.push('"issue_count" must be a non-negative integer');
  }

  // ── issue_types ───────────────────────────────────────────────────────────

  if (!isRecord(data["issue_types"])) {
    errors.push('"issue_types" must be an object');
  } else {
    for (const [k, v] of Object.entries(data["issue_types"])) {
      if (typeof v !== "number") {
        errors.push(`"issue_types.${k}" must be a number`);
      }
    }
  }

  // ── completion_outcomes ───────────────────────────────────────────────────

  if (!isRecord(data["completion_outcomes"])) {
    errors.push('"completion_outcomes" must be an object');
  } else {
    for (const [k, v] of Object.entries(data["completion_outcomes"])) {
      if (typeof v !== "string" || !VALID_COMPLETION_OUTCOMES.has(v)) {
        errors.push(
          `"completion_outcomes.${k}" has invalid value "${String(v)}"; ` +
            `must be one of: ${[...VALID_COMPLETION_OUTCOMES].join(", ")}`,
        );
      }
    }
  }

  // ── merge_outcomes ────────────────────────────────────────────────────────

  if (!isRecord(data["merge_outcomes"])) {
    errors.push('"merge_outcomes" must be an object');
  } else {
    for (const [k, v] of Object.entries(data["merge_outcomes"])) {
      if (typeof v !== "string" || !VALID_MERGE_OUTCOMES.has(v)) {
        errors.push(
          `"merge_outcomes.${k}" has invalid value "${String(v)}"; ` +
            `must be one of: ${[...VALID_MERGE_OUTCOMES].join(", ")}`,
        );
      }
    }
  }

  // ── human_intervention_issue_ids ──────────────────────────────────────────

  if (!Array.isArray(data["human_intervention_issue_ids"])) {
    errors.push('"human_intervention_issue_ids" must be an array');
  } else {
    for (const [i, v] of (data["human_intervention_issue_ids"] as unknown[]).entries()) {
      if (typeof v !== "string") {
        errors.push(`"human_intervention_issue_ids[${i}]" must be a string`);
      }
    }
  }

  // ── cost_totals ───────────────────────────────────────────────────────────

  if (!("cost_totals" in data)) {
    errors.push('"cost_totals" field is required (may be null)');
  } else if (data["cost_totals"] !== null) {
    if (!isRecord(data["cost_totals"])) {
      errors.push('"cost_totals" must be an object or null');
    } else {
      if (typeof (data["cost_totals"] as Record<string, unknown>)["total_usd"] !== "number") {
        errors.push('"cost_totals.total_usd" must be a number');
      }
      if (!isRecord((data["cost_totals"] as Record<string, unknown>)["per_agent"])) {
        errors.push('"cost_totals.per_agent" must be an object');
      }
    }
  }

  // ── quota_totals ──────────────────────────────────────────────────────────

  if (!("quota_totals" in data)) {
    errors.push('"quota_totals" field is required (may be null)');
  } else if (data["quota_totals"] !== null) {
    if (!isRecord(data["quota_totals"])) {
      errors.push('"quota_totals" must be an object or null');
    } else {
      const qt = data["quota_totals"] as Record<string, unknown>;
      if (!["quota", "credits", "stats_only"].includes(qt["kind"] as string)) {
        errors.push('"quota_totals.kind" must be "quota", "credits", or "stats_only"');
      }
      if (qt["units_consumed"] !== null && typeof qt["units_consumed"] !== "number") {
        errors.push('"quota_totals.units_consumed" must be a number or null');
      }
      if (qt["credit_delta"] !== null && typeof qt["credit_delta"] !== "number") {
        errors.push('"quota_totals.credit_delta" must be a number or null');
      }
    }
  }

  // ── timing ────────────────────────────────────────────────────────────────

  if (!isRecord(data["timing"])) {
    errors.push('"timing" must be an object');
  } else {
    const timing = data["timing"] as Record<string, unknown>;

    for (const field of ["started_at", "finished_at"] as const) {
      if (typeof timing[field] !== "string") {
        errors.push(`"timing.${field}" must be a string`);
      } else if (!isIso8601(timing[field] as string)) {
        errors.push(`"timing.${field}" must be a valid ISO-8601 timestamp`);
      }
    }

    if (typeof timing["elapsed_ms"] !== "number") {
      errors.push('"timing.elapsed_ms" must be a number');
    }
  }

  return { valid: errors.length === 0, errors };
}
