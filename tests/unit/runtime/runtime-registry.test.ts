import { describe, expect, it } from "vitest";

import {
  assertRuntimeAdapterName,
  isLiveRuntimeAdapterName,
  isRuntimeAdapterName,
  resolveArtifactEmissionMode,
  RUNTIME_ADAPTER_NAMES,
} from "../../../src/runtime/runtime-registry.js";

describe("runtime registry", () => {
  it("lists every supported adapter including Claude Code", () => {
    expect(RUNTIME_ADAPTER_NAMES).toEqual(["scripted", "pi", "codex", "claude"]);
    expect(isRuntimeAdapterName("claude")).toBe(true);
    expect(isRuntimeAdapterName("gemini")).toBe(false);
    expect(isLiveRuntimeAdapterName("scripted")).toBe(false);
    expect(isLiveRuntimeAdapterName("claude")).toBe(true);
  });

  it("uses typed tool emission only for Pi", () => {
    expect(resolveArtifactEmissionMode("pi")).toBe("tool");
    expect(resolveArtifactEmissionMode("codex")).toBe("json");
    expect(resolveArtifactEmissionMode("claude")).toBe("json");
    expect(resolveArtifactEmissionMode("scripted")).toBe("json");
  });

  it("rejects unknown adapters with the supported list", () => {
    expect(() => assertRuntimeAdapterName("gemini")).toThrow(/scripted, pi, codex, claude/);
  });
});
