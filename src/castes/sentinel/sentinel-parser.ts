import { parseJsonObjectText } from "../../shared/json.js";

export type SentinelVerdictValue = "pass" | "fail_blocking";
export type SentinelFindingKind =
  | "contract_gap"
  | "regression"
  | "out_of_scope_blocker"
  | "integration_blocker";
export type SentinelFindingRoute = "rework_owner" | "create_blocker";

export interface SentinelFinding {
  finding_kind: SentinelFindingKind;
  summary: string;
  required_files: string[];
  owner_issue: string;
  route: SentinelFindingRoute;
}

export interface SentinelVerdict {
  verdict: SentinelVerdictValue;
  reviewSummary: string;
  blockingFindings: SentinelFinding[];
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

function normalizeQuotedEnum(value: unknown) {
  if (typeof value === "string" && /^"[a-z_]+"$/.test(value)) {
    return value.slice(1, -1);
  }

  return value;
}

function assertFindingKind(value: unknown): SentinelFindingKind {
  const normalizedValue = normalizeQuotedEnum(value);
  if (
    normalizedValue === "contract_gap"
    || normalizedValue === "regression"
    || normalizedValue === "out_of_scope_blocker"
    || normalizedValue === "integration_blocker"
  ) {
    return normalizedValue;
  }

  throw new Error(
    "Sentinel verdict field 'blockingFindings.finding_kind' must be one of contract_gap, regression, out_of_scope_blocker, integration_blocker.",
  );
}

function assertFindingRoute(value: unknown): SentinelFindingRoute {
  const normalizedValue = normalizeQuotedEnum(value);
  if (normalizedValue === "rework_owner" || normalizedValue === "create_blocker") {
    return normalizedValue;
  }

  throw new Error("Sentinel verdict field 'blockingFindings.route' must be one of rework_owner or create_blocker.");
}

function assertFinding(value: unknown, index: number): SentinelFinding {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Sentinel verdict field 'blockingFindings[${index}]' must be a typed finding object.`);
  }

  const finding = assertPlainObject(value);
  const allowedKeys = new Set(["finding_kind", "summary", "required_files", "owner_issue", "route"]);

  for (const key of Object.keys(finding)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`Sentinel verdict field 'blockingFindings[${index}]' contains an unexpected field: ${key}`);
    }
  }

  for (const field of allowedKeys) {
    if (!(field in finding)) {
      throw new Error(`Sentinel verdict field 'blockingFindings[${index}]' is missing required field '${field}'.`);
    }
  }

  return {
    finding_kind: assertFindingKind(finding["finding_kind"]),
    summary: assertString(finding["summary"], "blockingFindings.summary"),
    required_files: assertStringArray(finding["required_files"], "blockingFindings.required_files"),
    owner_issue: assertString(finding["owner_issue"], "blockingFindings.owner_issue"),
    route: assertFindingRoute(finding["route"]),
  };
}

function assertFindingsArray(value: unknown): SentinelFinding[] {
  if (!Array.isArray(value)) {
    throw new Error("Sentinel verdict field 'blockingFindings' must be an array of typed finding objects.");
  }

  return value.map((finding, index) => assertFinding(finding, index));
}

function normalizeContractChecks(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error("Sentinel verdict field 'contractChecks' must be an array of strings.");
  }

  return value.map((item) => {
    if (typeof item === "string") {
      return item;
    }

    if (
      typeof item === "object"
      && item !== null
      && !Array.isArray(item)
    ) {
      const check = (item as { check?: unknown }).check;
      const result = (item as { result?: unknown }).result;
      if (typeof check === "string" && typeof result === "string") {
        return `${check}: ${result}`;
      }
    }

    throw new Error("Sentinel verdict field 'contractChecks' must be an array of strings.");
  });
}

function assertVerdict(value: unknown): SentinelVerdictValue {
  const normalizedValue = normalizeQuotedEnum(value);
  if (normalizedValue === "pass" || normalizedValue === "fail_blocking") {
    return normalizedValue;
  }

  throw new Error("Sentinel verdict field 'verdict' must be one of 'pass' or 'fail_blocking'.");
}

export function parseSentinelVerdict(raw: string): SentinelVerdict {
  const parsed = parseJsonObjectText(raw);
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

  const verdict = assertVerdict(obj["verdict"]);
  const blockingFindings = assertFindingsArray(obj["blockingFindings"]);
  if (verdict === "pass" && blockingFindings.length > 0) {
    throw new Error("Sentinel pass verdict must not include blocking findings.");
  }

  if (verdict === "fail_blocking" && blockingFindings.length === 0) {
    throw new Error("Sentinel fail_blocking verdict must include at least one blocking finding.");
  }

  return {
    verdict,
    reviewSummary: assertString(obj["reviewSummary"], "reviewSummary"),
    blockingFindings,
    advisories: assertStringArray(obj["advisories"], "advisories"),
    touchedFiles: assertStringArray(obj["touchedFiles"], "touchedFiles"),
    contractChecks: normalizeContractChecks(obj["contractChecks"]),
  };
}
