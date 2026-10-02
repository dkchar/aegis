import type { TObject } from "@sinclair/typebox";

import type { CasteName } from "../runtime/caste-runtime.js";
import { JANUS_ARTIFACT_SCHEMA } from "./janus/janus-tool-contract.js";
import { ORACLE_ARTIFACT_SCHEMA } from "./oracle/oracle-tool-contract.js";
import { SENTINEL_ARTIFACT_SCHEMA } from "./sentinel/sentinel-tool-contract.js";
import { TITAN_ARTIFACT_SCHEMA } from "./titan/titan-tool-contract.js";

/**
 * One artifact schema per caste. Pi registers it as the `emit_*` tool
 * parameters; adapters with native structured output (Claude Code
 * `--json-schema`) constrain the final answer to it. The caste parsers stay
 * the acceptance gate either way.
 */
export const CASTE_ARTIFACT_SCHEMAS: Record<CasteName, TObject> = {
  oracle: ORACLE_ARTIFACT_SCHEMA,
  titan: TITAN_ARTIFACT_SCHEMA,
  sentinel: SENTINEL_ARTIFACT_SCHEMA,
  janus: JANUS_ARTIFACT_SCHEMA,
};

function isQuotedConst(value: unknown) {
  return typeof value === "object"
    && value !== null
    && typeof (value as { const?: unknown }).const === "string"
    && /^".*"$/.test((value as { const: string }).const);
}

function isStringLiteral(value: unknown): value is { const: string } {
  return typeof value === "object"
    && value !== null
    && typeof (value as { const?: unknown }).const === "string"
    && Object.keys(value).every((key) => key === "const" || key === "type");
}

/**
 * Pi schemas accept `"\"value\""` enum variants because some tool-calling
 * models double-quote enums. Structured output needs no such tolerance, so
 * those variants are dropped and literal unions become plain `enum`s.
 */
function simplifyEnums(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(simplifyEnums);
  }
  if (typeof node !== "object" || node === null) {
    return node;
  }

  const record = Object.fromEntries(
    Object.entries(node).map(([key, value]) => [key, simplifyEnums(value)]),
  );
  const anyOf = record["anyOf"];
  if (!Array.isArray(anyOf)) {
    return record;
  }

  const members = anyOf.filter((member) => !isQuotedConst(member));
  const { anyOf: _anyOf, ...rest } = record;
  if (members.length > 0 && members.every(isStringLiteral)) {
    return { ...rest, type: "string", enum: members.map((member) => member.const) };
  }
  return members.length === 1 ? { ...rest, ...(members[0] as object) } : { ...rest, anyOf: members };
}

/** Draft-07 JSON Schema text for a caste artifact. */
export function buildCasteArtifactJsonSchema(caste: CasteName) {
  return JSON.stringify(simplifyEnums(JSON.parse(JSON.stringify(CASTE_ARTIFACT_SCHEMAS[caste]))));
}
