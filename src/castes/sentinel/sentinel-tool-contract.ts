import { Type } from "@sinclair/typebox";

import { parseSentinelVerdict, type SentinelVerdict } from "./sentinel-parser.js";
import { createStructuredToolContract } from "../tool-contract.js";

export const SENTINEL_EMIT_VERDICT_TOOL_NAME = "emit_sentinel_verdict";

const sentinelStructuredContract = createStructuredToolContract<SentinelVerdict>({
  toolName: SENTINEL_EMIT_VERDICT_TOOL_NAME,
  label: "Emit Sentinel Verdict",
  description:
    "Finalize review by returning contract JSON with keys verdict, reviewSummary, blockingFindings, advisories, touchedFiles, contractChecks.",
  parameters: Type.Object(
    {
      verdict: Type.Union([Type.Literal("pass"), Type.Literal("fail_blocking")]),
      reviewSummary: Type.String(),
      blockingFindings: Type.Array(Type.String()),
      advisories: Type.Array(Type.String()),
      touchedFiles: Type.Array(Type.String()),
      contractChecks: Type.Array(Type.String()),
    },
    {
      additionalProperties: false,
    },
  ),
  detailsKey: "verdict",
  successText: "Sentinel verdict captured.",
  invalidPayloadError: "Sentinel verdict tool received invalid payload.",
  parse: parseSentinelVerdict,
});

export function createSentinelEmitVerdictTool() {
  return sentinelStructuredContract.createTool();
}

export function extractSentinelVerdictFromToolEvent(event: Parameters<
  typeof sentinelStructuredContract.extractFromToolEvent
>[0]): SentinelVerdict | null {
  return sentinelStructuredContract.extractFromToolEvent(event);
}

export function enforceSentinelToolPayloadContract(payload: unknown): unknown | undefined {
  return sentinelStructuredContract.enforcePayloadContract(payload);
}

export function stringifySentinelVerdict(verdict: SentinelVerdict): string {
  return sentinelStructuredContract.stringify(verdict);
}
