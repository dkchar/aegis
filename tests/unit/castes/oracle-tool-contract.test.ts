import { describe, expect, it } from "vitest";

import {
  createOracleEmitAssessmentTool,
  enforceOracleToolPayloadContract,
  extractOracleAssessmentFromToolEvent,
  ORACLE_EMIT_ASSESSMENT_TOOL_NAME,
} from "../../../src/castes/oracle/oracle-tool-contract.js";

describe("oracle tool contract", () => {
  it("extracts oracle assessment from matching tool end event", () => {
    expect(extractOracleAssessmentFromToolEvent({
      type: "tool_execution_end",
      toolCallId: "call-1",
      toolName: ORACLE_EMIT_ASSESSMENT_TOOL_NAME,
      isError: false,
      result: {
        content: [],
        details: {
          assessment: {
            files_affected: ["src/index.ts"],
            estimated_complexity: "moderate",
            decompose: false,
            ready: true,
          },
        },
      },
    })).toEqual({
      files_affected: ["src/index.ts"],
      estimated_complexity: "moderate",
      decompose: false,
      ready: true,
    });
  });

  it("returns null for malformed assessment payload", () => {
    expect(extractOracleAssessmentFromToolEvent({
      type: "tool_execution_end",
      toolCallId: "call-1",
      toolName: ORACLE_EMIT_ASSESSMENT_TOOL_NAME,
      isError: false,
      result: {
        content: [],
        details: {
          assessment: {
            ready: true,
          },
        },
      },
    })).toBeNull();
  });

  it("enforces tool choice payload for oracle requests", () => {
    expect(enforceOracleToolPayloadContract({
      model: "gpt-5.4-mini",
      tools: [],
      tool_choice: "auto",
      parallel_tool_calls: true,
    })).toEqual({
      model: "gpt-5.4-mini",
      tools: [],
      tool_choice: {
        type: "function",
        name: ORACLE_EMIT_ASSESSMENT_TOOL_NAME,
      },
      parallel_tool_calls: false,
    });
  });

  it("does not re-force tool choice after a tool result exists in payload", () => {
    expect(enforceOracleToolPayloadContract({
      model: "gpt-5.4-mini",
      tools: [],
      input: [
        {
          type: "function_call_output",
          call_id: "call_1",
          output: "{\"ready\":true}",
        },
      ],
      tool_choice: "auto",
      parallel_tool_calls: true,
    })).toBeUndefined();
  });

  it("validates tool payloads inside execute", async () => {
    const tool = createOracleEmitAssessmentTool();
    await expect(tool.execute(
      "call-1",
      {
        files_affected: [],
        estimated_complexity: "complex",
        decompose: true,
        ready: false,
      },
      undefined,
      undefined,
      {} as never,
    )).resolves.toMatchObject({
      details: {
        assessment: {
          files_affected: [],
          estimated_complexity: "complex",
          decompose: true,
          ready: false,
        },
      },
    });
  });
});
