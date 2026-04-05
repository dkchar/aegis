/**
 * Result persistence — S02 lane A implementation.
 *
 * Implements writeResult and readResult for persisting eval run artifacts
 * under `<resultsPath>/<scenario_id>/<run_timestamp>.json` (SPECv2 §24.5).
 */

import path from "node:path";
import fs from "node:fs";

import type { EvalRunResult } from "./result-schema.js";
import { EVALS_RESULTS_PATH } from "./result-schema.js";
import { validateEvalRunResult } from "./validate-result.js";

export { EVALS_RESULTS_PATH };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert an ISO-8601 timestamp to a filesystem-safe string by replacing
 * colons with hyphens.
 *
 * Example: "2026-04-04T18:00:00.000Z" → "2026-04-04T18-00-00.000Z"
 */
function toSafeTimestamp(iso: string): string {
  // Replace only the colons in the time portion (after the 'T').
  return iso.replace(/:/g, "-");
}

// ---------------------------------------------------------------------------
// writeResult
// ---------------------------------------------------------------------------

/**
 * Write a completed eval run result to the results directory.
 *
 * The artifact is written to:
 *   `<resultsPath>/<scenario_id>/<run_timestamp>.json`
 *
 * where `run_timestamp` is derived from `result.timing.started_at` formatted
 * as a safe filesystem string (e.g. `2026-04-04T18-00-00.000Z`).
 *
 * @param result      The completed eval run result to persist.
 * @param resultsPath Absolute or repo-relative path to the results root.
 *                    Defaults to EVALS_RESULTS_PATH (".aegis/evals").
 * @returns           The absolute path of the file that was written.
 */
export async function writeResult(
  result: EvalRunResult,
  resultsPath: string = EVALS_RESULTS_PATH,
): Promise<string> {
  const resolvedBase = path.resolve(resultsPath);
  const scenarioDir = path.resolve(resolvedBase, result.scenario_id);
  if (!scenarioDir.startsWith(resolvedBase + path.sep) && scenarioDir !== resolvedBase) {
    throw new Error(`scenario_id "${result.scenario_id}" escapes the results directory`);
  }
  fs.mkdirSync(scenarioDir, { recursive: true });

  const safeTimestamp = toSafeTimestamp(result.timing.started_at);
  const fileName = `${safeTimestamp}.json`;
  const filePath = path.join(scenarioDir, fileName);

  const content = JSON.stringify(result, null, 2);
  fs.writeFileSync(filePath, content, "utf8");

  return path.resolve(filePath);
}

// ---------------------------------------------------------------------------
// readResult
// ---------------------------------------------------------------------------

/**
 * Read a previously-written eval run result from disk.
 *
 * @param filePath Absolute path to the result JSON file.
 * @returns        The parsed EvalRunResult.
 */
export async function readResult(filePath: string): Promise<EvalRunResult> {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  const validation = validateEvalRunResult(parsed);

  if (!validation.valid) {
    throw new Error(
      `Invalid eval run result at ${filePath}: ${validation.errors.join("; ")}`,
    );
  }

  return parsed as EvalRunResult;
}
