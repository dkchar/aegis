import path from "node:path";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { buildFailureSteeringPromptLines } from "../../../src/core/failure-steering.js";
import type { DispatchRecord } from "../../../src/core/dispatch-state.js";

const tempRoots: string[] = [];

function createTempRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "aegis-failure-steering-"));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function createRecord(overrides: Partial<DispatchRecord> = {}): DispatchRecord {
  return {
    issueId: "AG-1",
    stage: "failed_operational",
    runningAgent: null,
    oracleAssessmentRef: null,
    sentinelVerdictRef: null,
    fileScope: { files: ["src/domain/todo.ts"] },
    failureCount: 1,
    consecutiveFailures: 1,
    failureWindowStartMs: 1778073209153,
    cooldownUntil: null,
    sessionProvenanceId: "test",
    updatedAt: "2026-05-06T13:00:00.000Z",
    ...overrides,
  };
}

function writeTranscript(root: string, name: string, transcript: Record<string, unknown>) {
  const ref = path.join(".aegis", "transcripts", name);
  const target = path.join(root, ref);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(transcript, null, 2)}\n`, "utf8");
  return ref;
}

describe("buildFailureSteeringPromptLines", () => {
  it("injects Titan steering for missing artifacts and out-of-scope repeat attempts", () => {
    const root = createTempRoot();
    const transcriptRef = writeTranscript(root, "AG-1--titan.json", {
      error: "Titan tool contract violation: missing 'emit_titan_artifact' output.",
      outputText: "Tool contract repair required: no 'emit_titan_artifact' output was captured.",
      messageLog: [
        { role: "assistant", content: "The tool is blocking me from writing files outside the allowed scope." },
      ],
    });

    const lines = buildFailureSteeringPromptLines({
      root,
      caste: "titan",
      record: createRecord({ failureTranscriptRef: transcriptRef }),
    });

    expect(lines.join("\n")).toContain("Previous titan attempt failed");
    expect(lines.join("\n")).toContain("emit_titan_artifact");
    expect(lines.join("\n")).toContain("Do not retry out-of-scope writes");
    expect(lines.join("\n")).toContain("skip the check with a reason or emit a blocking mutation_proposal");
    expect(lines.join("\n")).toContain("Stage and commit in-scope edits before emitting the artifact");
  });

  it("steers JSON-mode retries after a structured output failure", () => {
    const root = createTempRoot();
    const transcriptRef = writeTranscript(root, "AG-1--sentinel.json", {
      error: "Claude Code session ended with error_max_structured_output_retries.",
    });

    const lines = buildFailureSteeringPromptLines({
      root,
      caste: "sentinel",
      record: createRecord({ failureTranscriptRef: transcriptRef }),
      emissionMode: "json",
    });

    expect(lines.join("\n")).toContain("returning only the final JSON artifact");
  });

  it("keeps steering caste-specific for each artifact contract", () => {
    const root = createTempRoot();

    for (const [caste, toolName] of [
      ["oracle", "emit_oracle_assessment"],
      ["sentinel", "emit_sentinel_verdict"],
      ["janus", "emit_janus_resolution_artifact"],
    ] as const) {
      const transcriptRef = writeTranscript(root, `AG-1--${caste}.json`, {
        error: `missing '${toolName}' output`,
      });
      const lines = buildFailureSteeringPromptLines({
        root,
        caste,
        record: createRecord({ failureTranscriptRef: transcriptRef }),
      });
      const prompt = lines.join("\n");

      expect(prompt).toContain(toolName);
      expect(prompt).not.toContain("Stage and commit in-scope edits");
    }
  });

  it("injects provider usage steering without irrelevant tool advice", () => {
    const root = createTempRoot();
    const lines = buildFailureSteeringPromptLines({
      root,
      caste: "oracle",
      record: createRecord({
        operationalFailureKind: "provider_usage_limit",
        failureTranscriptRef: null,
      }),
    });
    const prompt = lines.join("\n");

    expect(prompt).toContain("provider usage or quota limit");
    expect(prompt).not.toContain("emit_titan_artifact");
  });
});
