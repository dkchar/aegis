import { Type } from "@sinclair/typebox";

import { parseOracleAssessment, type OracleAssessment } from "./oracle-parser.js";
import { createStructuredToolContract } from "../tool-contract.js";

export const ORACLE_EMIT_ASSESSMENT_TOOL_NAME = "emit_oracle_assessment";

const oracleStructuredContract = createStructuredToolContract<OracleAssessment>({
  toolName: ORACLE_EMIT_ASSESSMENT_TOOL_NAME,
  label: "Emit Oracle Assessment",
  description:
    "Finalize scout assessment by returning contract JSON with keys files_affected, estimated_complexity, risks, suggested_checks, scope_notes.",
  parameters: Type.Object(
    {
      files_affected: Type.Array(Type.String()),
      estimated_complexity: Type.Union([
        Type.Literal("trivial"),
        Type.Literal("moderate"),
        Type.Literal("complex"),
      ]),
      risks: Type.Array(Type.String()),
      suggested_checks: Type.Array(Type.String()),
      scope_notes: Type.Array(Type.String()),
    },
    {
      additionalProperties: false,
    },
  ),
  detailsKey: "assessment",
  successText: "Oracle assessment captured.",
  invalidPayloadError: "Oracle assessment tool received invalid payload.",
  parse: parseOracleAssessment,
});

export function createOracleEmitAssessmentTool() {
  return oracleStructuredContract.createTool();
}

export function extractOracleAssessmentFromToolEvent(event: Parameters<
  typeof oracleStructuredContract.extractFromToolEvent
>[0]): OracleAssessment | null {
  return oracleStructuredContract.extractFromToolEvent(event);
}

export function enforceOracleToolPayloadContract(payload: unknown): unknown | undefined {
  return oracleStructuredContract.enforcePayloadContract(payload);
}

export function stringifyOracleAssessment(assessment: OracleAssessment): string {
  return oracleStructuredContract.stringify(assessment);
}
