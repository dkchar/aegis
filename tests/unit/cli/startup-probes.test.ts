import { describe, expect, it } from "vitest";

import { DEFAULT_AEGIS_CONFIG } from "../../../src/config/defaults.js";
import { createCasteConfig } from "../../../src/config/caste-config.js";
import {
  verifyConfiguredModelRefs,
  verifyRuntimeAdapter,
  verifyRuntimeLocalConfig,
} from "../../../src/cli/startup-probes.js";

describe("startup probes", () => {
  it("accepts every registered adapter and rejects unknown ones", () => {
    for (const runtime of ["scripted", "pi", "codex", "claude"]) {
      expect(verifyRuntimeAdapter({ ...DEFAULT_AEGIS_CONFIG, runtime }).ok).toBe(true);
    }
    const rejected = verifyRuntimeAdapter({ ...DEFAULT_AEGIS_CONFIG, runtime: "gemini" });
    expect(rejected.ok).toBe(false);
    expect(rejected.fix).toContain("claude");
  });

  it("requires anthropic model refs for the Claude runtime", () => {
    const valid = verifyConfiguredModelRefs({
      ...DEFAULT_AEGIS_CONFIG,
      runtime: "claude",
      models: createCasteConfig(() => "anthropic:claude-opus-5-5"),
    });
    expect(valid.ok).toBe(true);

    const invalid = verifyConfiguredModelRefs({
      ...DEFAULT_AEGIS_CONFIG,
      runtime: "claude",
    });
    expect(invalid.ok).toBe(false);
    expect(invalid.detail).toContain("oracle=openai-codex:gpt-5.4-mini");
  });

  it("reports a missing Claude Code CLI with an install hint", () => {
    const probe = verifyRuntimeLocalConfig("/repo", { ...DEFAULT_AEGIS_CONFIG, runtime: "claude" }, {
      AEGIS_CLAUDE_BIN: "aegis-definitely-missing-claude-binary",
    });

    expect(probe.ok).toBe(false);
    expect(probe.fix).toContain("AEGIS_CLAUDE_BIN");
  });

  it("does not require local adapter settings for the scripted runtime", () => {
    expect(verifyRuntimeLocalConfig("/repo", DEFAULT_AEGIS_CONFIG).ok).toBe(true);
  });
});
