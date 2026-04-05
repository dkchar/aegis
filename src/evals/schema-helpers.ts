import {
  COMPLETION_OUTCOMES,
  MERGE_OUTCOMES,
} from "./result-schema.js";

export const VALID_COMPLETION_OUTCOMES: ReadonlySet<string> = new Set(
  COMPLETION_OUTCOMES,
);

export const VALID_MERGE_OUTCOMES: ReadonlySet<string> = new Set(
  MERGE_OUTCOMES,
);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
