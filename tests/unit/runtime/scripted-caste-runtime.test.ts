import { describe, expect, it } from "vitest";

import { ScriptedCasteRuntime } from "../../../src/runtime/scripted-caste-runtime.js";

describe("ScriptedCasteRuntime", () => {
  it("returns deterministic output and tool usage for the requested caste", async () => {
    const runtime = new ScriptedCasteRuntime({
      oracle: () => ({
        output: JSON.stringify({
          files_affected: ["src/index.ts"],
          estimated_complexity: "moderate",
          decompose: false,
          ready: true,
        }),
        toolsUsed: ["read_file"],
      }),
    });

    const result = await runtime.run({
      caste: "oracle",
      issueId: "aegis-123",
      root: "C:/repo",
      workingDirectory: "C:/repo",
      prompt: "prompt",
    });

    expect(result.caste).toBe("oracle");
    expect(result.status).toBe("succeeded");
    expect(result.toolsUsed).toEqual(["read_file"]);
    expect(result.outputText).toContain("\"ready\":true");
  });
});
