import { Type } from "@sinclair/typebox";

import { parseTitanArtifact, type TitanArtifact } from "./titan-parser.js";
import { createStructuredToolContract } from "../tool-contract.js";

export const TITAN_EMIT_ARTIFACT_TOOL_NAME = "emit_titan_artifact";

const titanStructuredContract = createStructuredToolContract<TitanArtifact>({
  toolName: TITAN_EMIT_ARTIFACT_TOOL_NAME,
  label: "Emit Titan Artifact",
  description:
    "Finalize implementation by returning contract JSON with implementation artifact fields and optional blocking mutation_proposal.",
  parameters: Type.Object(
    {
      outcome: Type.Union([
        Type.Literal("success"),
        Type.Literal("already_satisfied"),
        Type.Literal("clarification"),
        Type.Literal("failure"),
      ]),
      summary: Type.String(),
      files_changed: Type.Array(Type.String()),
      tests_and_checks_run: Type.Array(Type.String()),
      known_risks: Type.Array(Type.String()),
      follow_up_work: Type.Array(Type.String()),
      blocking_question: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      handoff_note: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      mutation_proposal: Type.Optional(Type.Union([
        Type.Object(
          {
            proposal_type: Type.Union([
              Type.Literal("create_clarification_blocker"),
              Type.Literal("create_prerequisite_blocker"),
              Type.Literal("create_out_of_scope_blocker"),
            ]),
            summary: Type.String(),
            suggested_title: Type.String(),
            suggested_description: Type.String(),
            scope_evidence: Type.Array(Type.String()),
          },
          { additionalProperties: false },
        ),
        Type.Null(),
      ])),
    },
    {
      additionalProperties: false,
    },
  ),
  detailsKey: "artifact",
  successText: "Titan artifact captured.",
  invalidPayloadError: "Titan artifact tool received invalid payload.",
  parse: parseTitanArtifact,
});

export function createTitanEmitArtifactTool() {
  return titanStructuredContract.createTool();
}

export function extractTitanArtifactFromToolEvent(event: Parameters<
  typeof titanStructuredContract.extractFromToolEvent
>[0]): TitanArtifact | null {
  return titanStructuredContract.extractFromToolEvent(event);
}

export function enforceTitanToolPayloadContract(payload: unknown): unknown | undefined {
  return titanStructuredContract.enforcePayloadContract(payload);
}

export function stringifyTitanArtifact(artifact: TitanArtifact): string {
  return titanStructuredContract.stringify(artifact);
}
