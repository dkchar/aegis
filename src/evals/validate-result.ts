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

function validateBooleanOrNull(
  value: unknown,
  path: string,
  errors: string[],
) {
  if (value !== null && typeof value !== "boolean") {
    errors.push(`"${path}" must be a boolean or null`);
  }
}

function validateStringOrNull(
  value: unknown,
  path: string,
  errors: string[],
) {
  if (value !== null && typeof value !== "string") {
    errors.push(`"${path}" must be a string or null`);
  }
}

function validateStringArray(
  value: unknown,
  path: string,
  errors: string[],
) {
  if (!Array.isArray(value)) {
    errors.push(`"${path}" must be an array`);
    return;
  }

  for (const [index, entry] of value.entries()) {
    if (typeof entry !== "string") {
      errors.push(`"${path}[${index}]" must be a string`);
    }
  }
}

function validateNonNegativeInteger(
  value: unknown,
  path: string,
  errors: string[],
) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    errors.push(`"${path}" must be a non-negative integer`);
  }
}

function validateArtifactEvidence(
  value: unknown,
  path: string,
  errors: string[],
): Record<string, unknown> | null {
  if (!isRecord(value)) {
    errors.push(`"${path}" must be an object`);
    return null;
  }

  if (typeof value["expected"] !== "boolean") {
    errors.push(`"${path}.expected" must be a boolean`);
  }
  validateBooleanOrNull(value["compliant"], `${path}.compliant`, errors);

  return value;
}

function validateIssueEvidence(
  value: unknown,
  errors: string[],
) {
  if (!isRecord(value)) {
    errors.push('"issue_evidence" must be an object');
    return;
  }

  for (const [issueId, rawEvidence] of Object.entries(value)) {
    const issuePath = `issue_evidence.${issueId}`;
    if (!isRecord(rawEvidence)) {
      errors.push(`"${issuePath}" must be an object`);
      continue;
    }

    const structuredArtifacts = rawEvidence["structured_artifacts"];
    if (!isRecord(structuredArtifacts)) {
      errors.push(`"${issuePath}.structured_artifacts" must be an object`);
    } else {
      const oracle = validateArtifactEvidence(
        structuredArtifacts["oracle"],
        `${issuePath}.structured_artifacts.oracle`,
        errors,
      );
      if (oracle) {
        validateStringOrNull(
          oracle["assessment_ref"],
          `${issuePath}.structured_artifacts.oracle.assessment_ref`,
          errors,
        );
        if (
          oracle["estimated_complexity"] !== null
          && !["trivial", "moderate", "complex"].includes(
            oracle["estimated_complexity"] as string,
          )
        ) {
          errors.push(
            `"${issuePath}.structured_artifacts.oracle.estimated_complexity" must be "trivial", "moderate", "complex", or null`,
          );
        }
        validateBooleanOrNull(
          oracle["ready"],
          `${issuePath}.structured_artifacts.oracle.ready`,
          errors,
        );
        validateStringArray(
          oracle["derived_issue_ids"],
          `${issuePath}.structured_artifacts.oracle.derived_issue_ids`,
          errors,
        );
      }

      const titan = validateArtifactEvidence(
        structuredArtifacts["titan"],
        `${issuePath}.structured_artifacts.titan`,
        errors,
      );
      if (titan) {
        if (
          titan["outcome"] !== null
          && !["success", "clarification", "failure"].includes(
            titan["outcome"] as string,
          )
        ) {
          errors.push(
            `"${issuePath}.structured_artifacts.titan.outcome" must be "success", "clarification", "failure", or null`,
          );
        }
        validateStringArray(
          titan["files_changed"],
          `${issuePath}.structured_artifacts.titan.files_changed`,
          errors,
        );
        validateStringArray(
          titan["tests_and_checks_run"],
          `${issuePath}.structured_artifacts.titan.tests_and_checks_run`,
          errors,
        );
        validateStringOrNull(
          titan["clarification_issue_id"],
          `${issuePath}.structured_artifacts.titan.clarification_issue_id`,
          errors,
        );
      }

      const sentinel = validateArtifactEvidence(
        structuredArtifacts["sentinel"],
        `${issuePath}.structured_artifacts.sentinel`,
        errors,
      );
      if (sentinel) {
        validateStringOrNull(
          sentinel["verdict_ref"],
          `${issuePath}.structured_artifacts.sentinel.verdict_ref`,
          errors,
        );
        if (
          sentinel["verdict"] !== null
          && !["pass", "fail"].includes(sentinel["verdict"] as string)
        ) {
          errors.push(
            `"${issuePath}.structured_artifacts.sentinel.verdict" must be "pass", "fail", or null`,
          );
        }
        validateStringArray(
          sentinel["created_fix_issue_ids"],
          `${issuePath}.structured_artifacts.sentinel.created_fix_issue_ids`,
          errors,
        );
      }

      const janus = validateArtifactEvidence(
        structuredArtifacts["janus"],
        `${issuePath}.structured_artifacts.janus`,
        errors,
      );
      if (janus) {
        validateStringOrNull(
          janus["artifact_ref"],
          `${issuePath}.structured_artifacts.janus.artifact_ref`,
          errors,
        );
        if (
          janus["recommended_next_action"] !== null
          && !["requeue", "manual_decision", "fail"].includes(
            janus["recommended_next_action"] as string,
          )
        ) {
          errors.push(
            `"${issuePath}.structured_artifacts.janus.recommended_next_action" must be "requeue", "manual_decision", "fail", or null`,
          );
        }
      }
    }

    const clarification = rawEvidence["clarification"];
    if (!isRecord(clarification)) {
      errors.push(`"${issuePath}.clarification" must be an object`);
    } else {
      if (typeof clarification["expected"] !== "boolean") {
        errors.push(`"${issuePath}.clarification.expected" must be a boolean`);
      }
      validateBooleanOrNull(
        clarification["compliant"],
        `${issuePath}.clarification.compliant`,
        errors,
      );
      validateStringOrNull(
        clarification["clarification_issue_id"],
        `${issuePath}.clarification.clarification_issue_id`,
        errors,
      );
      validateStringOrNull(
        clarification["blocking_question"],
        `${issuePath}.clarification.blocking_question`,
        errors,
      );
    }

    const mergeQueue = rawEvidence["merge_queue"];
    if (!isRecord(mergeQueue)) {
      errors.push(`"${issuePath}.merge_queue" must be an object`);
    } else {
      for (const field of ["queued_at", "merged_at"] as const) {
        const valueAtField = mergeQueue[field];
        if (valueAtField !== null && typeof valueAtField !== "string") {
          errors.push(`"${issuePath}.merge_queue.${field}" must be a string or null`);
        } else if (
          typeof valueAtField === "string"
          && !isIso8601(valueAtField)
        ) {
          errors.push(
            `"${issuePath}.merge_queue.${field}" must be a valid ISO-8601 timestamp`,
          );
        }
      }
      if (typeof mergeQueue["direct_to_main_bypass"] !== "boolean") {
        errors.push(
          `"${issuePath}.merge_queue.direct_to_main_bypass" must be a boolean`,
        );
      }
      if (typeof mergeQueue["janus_invoked"] !== "boolean") {
        errors.push(`"${issuePath}.merge_queue.janus_invoked" must be a boolean`);
      }
      if (typeof mergeQueue["janus_succeeded"] !== "boolean") {
        errors.push(`"${issuePath}.merge_queue.janus_succeeded" must be a boolean`);
      }
      validateNonNegativeInteger(
        mergeQueue["rework_count"],
        `${issuePath}.merge_queue.rework_count`,
        errors,
      );
      validateNonNegativeInteger(
        mergeQueue["conflict_count"],
        `${issuePath}.merge_queue.conflict_count`,
        errors,
      );
    }

    const restartRecovery = rawEvidence["restart_recovery"];
    if (!isRecord(restartRecovery)) {
      errors.push(`"${issuePath}.restart_recovery" must be an object`);
    } else {
      if (typeof restartRecovery["expected"] !== "boolean") {
        errors.push(`"${issuePath}.restart_recovery.expected" must be a boolean`);
      }
      validateBooleanOrNull(
        restartRecovery["recovered"],
        `${issuePath}.restart_recovery.recovered`,
        errors,
      );
      if (
        restartRecovery["phase"] !== null
        && !["implementation", "merge"].includes(
          restartRecovery["phase"] as string,
        )
      ) {
        errors.push(
          `"${issuePath}.restart_recovery.phase" must be "implementation", "merge", or null`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Evidence parity validation
// ---------------------------------------------------------------------------

function validateEvidenceParity(
  issueCount: number,
  issueEvidence: unknown,
  completionOutcomes: unknown,
  mergeOutcomes: unknown,
): string[] {
  const errors: string[] = [];

  // Check issue_evidence is an object
  if (!isRecord(issueEvidence)) {
    errors.push('"issue_evidence" must be an object');
    return errors;
  }

  // Check exact count match
  const evidenceKeys = Object.keys(issueEvidence);
  if (evidenceKeys.length !== issueCount) {
    errors.push(
      `issue_evidence has ${evidenceKeys.length} entries but issue_count is ${issueCount}`,
    );
  }

  // Check completion_outcomes is an object
  if (!isRecord(completionOutcomes)) {
    errors.push('"completion_outcomes" must be an object');
    return errors;
  }

  // Every completion outcome key must exist in issue_evidence
  for (const key of Object.keys(completionOutcomes)) {
    if (!(key in issueEvidence)) {
      errors.push(
        `issue_evidence missing key "${key}" present in completion_outcomes`,
      );
    }
  }

  // Every issue_evidence key must exist in completion_outcomes
  for (const key of evidenceKeys) {
    if (!(key in completionOutcomes)) {
      errors.push(
        `completion_outcomes missing key "${key}" present in issue_evidence`,
      );
    }
  }

  // Check merge_outcomes parity (only if it's a non-empty object)
  if (isRecord(mergeOutcomes) && Object.keys(mergeOutcomes).length > 0) {
    for (const key of Object.keys(mergeOutcomes)) {
      if (!(key in issueEvidence)) {
        errors.push(
          `issue_evidence missing key "${key}" present in merge_outcomes`,
        );
      }
    }
  }

  return errors;
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

  if (!("issue_evidence" in data)) {
    errors.push('"issue_evidence" field is required');
  } else {
    validateIssueEvidence(data["issue_evidence"], errors);
  }

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

  // ── evidence parity ───────────────────────────────────────────────────────

  const parityErrors = validateEvidenceParity(
    data["issue_count"] as number,
    data["issue_evidence"],
    data["completion_outcomes"],
    data["merge_outcomes"],
  );
  errors.push(...parityErrors);

  return { valid: errors.length === 0, errors };
}
