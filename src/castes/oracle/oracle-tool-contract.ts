import type { AgentSessionEvent, ToolDefinition } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

import { parseOracleAssessment, type OracleAssessment } from "./oracle-parser.js";

export const ORACLE_EMIT_ASSESSMENT_TOOL_NAME = "emit_oracle_assessment";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseOracleAssessmentValue(value: unknown): OracleAssessment | null {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    return null;
  }

  try {
    return parseOracleAssessment(serialized);
  } catch {
    return null;
  }
}

function hasResponsesToolOutput(items: unknown): boolean {
  if (!Array.isArray(items)) {
    return false;
  }

  return items.some((item) => {
    if (!isRecord(item)) {
      return false;
    }

    return item["type"] === "function_call_output";
  });
}

function hasChatToolResultMessages(messages: unknown): boolean {
  if (!Array.isArray(messages)) {
    return false;
  }

  return messages.some((message) => {
    if (!isRecord(message)) {
      return false;
    }

    return message["role"] === "tool" || message["role"] === "toolResult";
  });
}

export function createOracleEmitAssessmentTool(): ToolDefinition {
  return {
    name: ORACLE_EMIT_ASSESSMENT_TOOL_NAME,
    label: "Emit Oracle Assessment",
    description:
      "Finalize scout assessment by returning contract JSON with keys files_affected, estimated_complexity, decompose, optional sub_issues, optional blockers, ready.",
    parameters: Type.Object(
      {
        files_affected: Type.Array(Type.String()),
        estimated_complexity: Type.Union([
          Type.Literal("trivial"),
          Type.Literal("moderate"),
          Type.Literal("complex"),
        ]),
        decompose: Type.Boolean(),
        sub_issues: Type.Optional(Type.Array(Type.String())),
        blockers: Type.Optional(Type.Array(Type.String())),
        ready: Type.Boolean(),
      },
      {
        additionalProperties: false,
      },
    ),
    async execute(_toolCallId, params) {
      const assessment = parseOracleAssessmentValue(params);
      if (!assessment) {
        throw new Error("Oracle assessment tool received invalid payload.");
      }

      return {
        content: [{
          type: "text",
          text: "Oracle assessment captured.",
        }],
        details: {
          assessment,
        },
      };
    },
  };
}

export function extractOracleAssessmentFromToolEvent(
  event: AgentSessionEvent,
): OracleAssessment | null {
  if (
    event.type !== "tool_execution_end"
    || event.toolName !== ORACLE_EMIT_ASSESSMENT_TOOL_NAME
    || event.isError
  ) {
    return null;
  }

  if (!isRecord(event.result)) {
    return null;
  }

  const details = event.result.details;
  if (!isRecord(details) || !("assessment" in details)) {
    return null;
  }

  return parseOracleAssessmentValue(details["assessment"]);
}

export function enforceOracleToolPayloadContract(payload: unknown): unknown | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }

  const hasToolPayload =
    Array.isArray(payload["tools"])
    || "tool_choice" in payload
    || "parallel_tool_calls" in payload;

  if (!hasToolPayload) {
    return undefined;
  }

  const alreadyHasToolResult =
    hasResponsesToolOutput(payload["input"])
    || hasChatToolResultMessages(payload["messages"]);
  if (alreadyHasToolResult) {
    return undefined;
  }

  return {
    ...payload,
    tool_choice: {
      type: "function",
      name: ORACLE_EMIT_ASSESSMENT_TOOL_NAME,
    },
    parallel_tool_calls: false,
  };
}

export function stringifyOracleAssessment(assessment: OracleAssessment): string {
  return JSON.stringify(assessment);
}
