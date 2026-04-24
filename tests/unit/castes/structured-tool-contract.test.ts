import { describe, expect, it } from "vitest";

import {
  enforceJanusToolPayloadContract,
  extractJanusResolutionFromToolEvent,
  JANUS_EMIT_RESOLUTION_TOOL_NAME,
} from "../../../src/castes/janus/janus-tool-contract.js";
import {
  extractOracleAssessmentFromToolEvent,
  ORACLE_EMIT_ASSESSMENT_TOOL_NAME,
} from "../../../src/castes/oracle/oracle-tool-contract.js";
import {
  enforceSentinelToolPayloadContract,
  extractSentinelVerdictFromToolEvent,
  SENTINEL_EMIT_VERDICT_TOOL_NAME,
} from "../../../src/castes/sentinel/sentinel-tool-contract.js";
import {
  enforceTitanToolPayloadContract,
  extractTitanArtifactFromToolEvent,
  TITAN_EMIT_ARTIFACT_TOOL_NAME,
} from "../../../src/castes/titan/titan-tool-contract.js";

describe("structured tool contracts", () => {
  it("enforces Titan payload to forced function call", () => {
    expect(enforceTitanToolPayloadContract({
      model: "gpt-5.4-mini",
      tools: [],
      tool_choice: "auto",
      parallel_tool_calls: true,
    })).toEqual({
      model: "gpt-5.4-mini",
      tools: [],
      tool_choice: {
        type: "function",
        name: TITAN_EMIT_ARTIFACT_TOOL_NAME,
      },
      parallel_tool_calls: false,
    });
  });

  it("extracts Titan artifact from matching tool event", () => {
    expect(extractTitanArtifactFromToolEvent({
      type: "tool_execution_end",
      toolCallId: "call-1",
      toolName: TITAN_EMIT_ARTIFACT_TOOL_NAME,
      isError: false,
      result: {
        content: [],
        details: {
          artifact: {
            outcome: "success",
            summary: "implemented",
            files_changed: ["src/index.ts"],
            tests_and_checks_run: [],
            known_risks: [],
            follow_up_work: [],
            learnings_written_to_mnemosyne: [],
          },
        },
      },
    })).toMatchObject({
      outcome: "success",
      summary: "implemented",
    });
  });

  it("extracts Sentinel verdict from matching tool event", () => {
    expect(extractSentinelVerdictFromToolEvent({
      type: "tool_execution_end",
      toolCallId: "call-2",
      toolName: SENTINEL_EMIT_VERDICT_TOOL_NAME,
      isError: false,
      result: {
        content: [],
        details: {
          verdict: {
            verdict: "pass",
            reviewSummary: "clean merge",
            blockingFindings: [],
            advisories: [],
            touchedFiles: ["src/index.ts"],
            contractChecks: ["tests passed"],
          },
        },
      },
    })).toEqual({
      verdict: "pass",
      reviewSummary: "clean merge",
      blockingFindings: [],
      advisories: [],
      touchedFiles: ["src/index.ts"],
      contractChecks: ["tests passed"],
    });
  });

  it("extracts Oracle scout-only assessment from matching tool event", () => {
    expect(extractOracleAssessmentFromToolEvent({
      type: "tool_execution_end",
      toolCallId: "call-oracle-1",
      toolName: ORACLE_EMIT_ASSESSMENT_TOOL_NAME,
      isError: false,
      result: {
        content: [],
        details: {
          assessment: {
            files_affected: ["src/index.ts"],
            estimated_complexity: "moderate",
            risks: ["touches control flow"],
            suggested_checks: ["npm test"],
            scope_notes: ["scout only"],
          },
        },
      },
    })).toEqual({
      files_affected: ["src/index.ts"],
      estimated_complexity: "moderate",
      risks: ["touches control flow"],
      suggested_checks: ["npm test"],
      scope_notes: ["scout only"],
    });
  });

  it("does not re-force Janus payload after tool result exists", () => {
    expect(enforceJanusToolPayloadContract({
      model: "gpt-5.4-mini",
      tools: [],
      tool_choice: "auto",
      parallel_tool_calls: true,
      input: [
        {
          type: "function_call_output",
          call_id: "call_1",
          output: "{\"mutation_proposal\":{\"proposal_type\":\"requeue_parent\"}}",
        },
      ],
    })).toBeUndefined();
  });

  it("extracts Janus artifact from matching tool event", () => {
    expect(extractJanusResolutionFromToolEvent({
      type: "tool_execution_end",
      toolCallId: "call-3",
      toolName: JANUS_EMIT_RESOLUTION_TOOL_NAME,
      isError: false,
      result: {
        content: [],
        details: {
          artifact: {
            originatingIssueId: "aegis-1",
            queueItemId: "queue-aegis-1",
            preservedLaborPath: "scratchpad/aegis-1",
            conflictSummary: "conflict in README",
            resolutionStrategy: "manual",
            filesTouched: [],
            validationsRun: [],
            residualRisks: [],
            mutation_proposal: {
              proposal_type: "create_integration_blocker",
              summary: "external conflict",
              suggested_title: "Fix external conflict",
              suggested_description: "Resolve dependency conflict.",
              scope_evidence: ["Conflict outside parent files."],
            },
          },
        },
      },
    })).toMatchObject({
      originatingIssueId: "aegis-1",
      mutation_proposal: {
        proposal_type: "create_integration_blocker",
      },
    });
  });

  it("returns null for malformed Sentinel verdict payload", () => {
    expect(extractSentinelVerdictFromToolEvent({
      type: "tool_execution_end",
      toolCallId: "call-4",
      toolName: SENTINEL_EMIT_VERDICT_TOOL_NAME,
      isError: false,
      result: {
        content: [],
        details: {
          verdict: {
            reviewSummary: "missing required verdict",
            blockingFindings: [],
            advisories: [],
            touchedFiles: [],
            contractChecks: [],
          },
        },
      },
    })).toBeNull();
  });

  it("returns null for old Oracle readiness fields", () => {
    expect(extractOracleAssessmentFromToolEvent({
      type: "tool_execution_end",
      toolCallId: "call-oracle-2",
      toolName: ORACLE_EMIT_ASSESSMENT_TOOL_NAME,
      isError: false,
      result: {
        content: [],
        details: {
          assessment: {
            files_affected: [],
            estimated_complexity: "trivial",
            decompose: false,
            ready: true,
          },
        },
      },
    })).toBeNull();
  });

  it("returns null for old Sentinel follow-up issue fields", () => {
    expect(extractSentinelVerdictFromToolEvent({
      type: "tool_execution_end",
      toolCallId: "call-5",
      toolName: SENTINEL_EMIT_VERDICT_TOOL_NAME,
      isError: false,
      result: {
        content: [],
        details: {
          verdict: {
            verdict: "pass",
            reviewSummary: "old payload",
            issuesFound: [],
            followUpIssueIds: [],
            riskAreas: [],
          },
        },
      },
    })).toBeNull();
  });
});
