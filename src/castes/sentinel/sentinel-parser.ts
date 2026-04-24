export type SentinelVerdictValue = "pass" | "fail_blocking";

export interface SentinelVerdict {
  verdict: SentinelVerdictValue;
  reviewSummary: string;
  blockingFindings: string[];
  advisories: string[];
  touchedFiles: string[];
  contractChecks: string[];
}

const SENTINEL_VERDICT_KEYS = new Set([
  "verdict",
  "reviewSummary",
  "blockingFindings",
  "advisories",
  "touchedFiles",
  "contractChecks",
]);

function assertPlainObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Sentinel verdict must be a JSON object.");
  }

  return value as Record<string, unknown>;
}

function assertString(value: unknown, key: string): string {
  if (typeof value !== "string") {
    throw new Error(`Sentinel verdict field '${key}' must be a string.`);
  }

  return value;
}

function assertStringArray(value: unknown, key: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Sentinel verdict field '${key}' must be an array of strings.`);
  }

  return value.slice();
}

function assertVerdict(value: unknown): SentinelVerdictValue {
  if (value === "pass" || value === "fail_blocking") {
    return value;
  }

  throw new Error("Sentinel verdict field 'verdict' must be one of 'pass' or 'fail_blocking'.");
}

export function parseSentinelVerdict(raw: string): SentinelVerdict {
  const parsed = JSON.parse(raw) as unknown;
  const obj = assertPlainObject(parsed);

  for (const key of Object.keys(obj)) {
    if (!SENTINEL_VERDICT_KEYS.has(key)) {
      throw new Error(`Sentinel verdict contains an unexpected field: ${key}`);
    }
  }

  for (const field of ["verdict", "reviewSummary", "blockingFindings", "advisories", "touchedFiles", "contractChecks"]) {
    if (!(field in obj)) {
      throw new Error(`Sentinel verdict is missing required field '${field}'.`);
    }
  }

  return {
    verdict: assertVerdict(obj["verdict"]),
    reviewSummary: assertString(obj["reviewSummary"], "reviewSummary"),
    blockingFindings: assertStringArray(obj["blockingFindings"], "blockingFindings"),
    advisories: assertStringArray(obj["advisories"], "advisories"),
    touchedFiles: assertStringArray(obj["touchedFiles"], "touchedFiles"),
    contractChecks: assertStringArray(obj["contractChecks"], "contractChecks"),
  };
}
