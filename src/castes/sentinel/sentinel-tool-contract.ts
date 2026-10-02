import { Type } from "@sinclair/typebox";

import { parseSentinelVerdict, type SentinelVerdict } from "./sentinel-parser.js";
import { createStructuredToolContract } from "../tool-contract.js";

export const SENTINEL_EMIT_VERDICT_TOOL_NAME = "emit_sentinel_verdict";

/** Artifact schema shared by the Pi emit tool and CLI adapters with native structured output. */
export const SENTINEL_ARTIFACT_SCHEMA = Type.Object(
  {
    verdict: Type.Union([
      Type.Literal("pass"),
      Type.Literal("fail_blocking"),
      Type.Literal("\"pass\""),
      Type.Literal("\"fail_blocking\""),
    ]),
    reviewSummary: Type.String(),
    blockingFindings: Type.Array(Type.Object(
      {
        finding_kind: Type.Union([
          Type.Literal("contract_gap"),
          Type.Literal("regression"),
          Type.Literal("out_of_scope_blocker"),
          Type.Literal("integration_blocker"),
          Type.Literal("\"contract_gap\""),
          Type.Literal("\"regression\""),
          Type.Literal("\"out_of_scope_blocker\""),
          Type.Literal("\"integration_blocker\""),
        ]),
        summary: Type.String(),
        required_files: Type.Array(Type.String()),
        owner_issue: Type.String(),
        route: Type.Union([
          Type.Literal("rework_owner"),
          Type.Literal("create_blocker"),
          Type.Literal("\"rework_owner\""),
          Type.Literal("\"create_blocker\""),
        ]),
      },
      {
        additionalProperties: false,
      },
    )),
    advisories: Type.Array(Type.String()),
    touchedFiles: Type.Array(Type.String()),
    contractChecks: Type.Array(Type.String()),
  },
  {
    additionalProperties: false,
  },
);

const sentinelStructuredContract = createStructuredToolContract<SentinelVerdict>({
  toolName: SENTINEL_EMIT_VERDICT_TOOL_NAME,
  label: "Emit Sentinel Verdict",
  description:
    "Finalize review by returning contract JSON with keys verdict, reviewSummary, typed blockingFindings, advisories, touchedFiles, contractChecks.",
  parameters: SENTINEL_ARTIFACT_SCHEMA,
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
