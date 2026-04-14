import { describe, expect, it, vi } from "vitest";

import { createCasteRuntime } from "../../../src/runtime/create-caste-runtime.js";

describe("createCasteRuntime", () => {
  it("uses the scripted runtime for deterministic proof adapters", () => {
    const createPiRuntime = vi.fn();
    const scriptedRuntime = { kind: "scripted", run: vi.fn() };
    const createScriptedRuntime = vi.fn(() => scriptedRuntime);

    const runtime = createCasteRuntime("phase_d_shell", {
      createPiRuntime,
      createScriptedRuntime,
    });

    expect(runtime).toBe(scriptedRuntime);
    expect(createScriptedRuntime).toHaveBeenCalledOnce();
    expect(createPiRuntime).not.toHaveBeenCalled();
  });

  it("uses the pi runtime when configured", () => {
    const piRuntime = { kind: "pi", run: vi.fn() };
    const createPiRuntime = vi.fn(() => piRuntime);
    const createScriptedRuntime = vi.fn();

    const runtime = createCasteRuntime("pi", {
      createPiRuntime,
      createScriptedRuntime,
    });

    expect(runtime).toBe(piRuntime);
    expect(createPiRuntime).toHaveBeenCalledOnce();
    expect(createScriptedRuntime).not.toHaveBeenCalled();
  });
});
