import { describe, expect, it } from "vitest";

import { getMockRunBdSupport } from "../../../src/mock-run/seed-mock-run.js";

describe("getMockRunBdSupport", () => {
  it("reports an unsupported environment when bd is missing", () => {
    const support = getMockRunBdSupport(() => ({
      found: false,
      status: null,
      output: "",
    }));

    expect(support).toEqual({
      supported: false,
      reason: "bd CLI not found on PATH",
    });
  });

  it("reports an unsupported environment when required init flags are missing", () => {
    const support = getMockRunBdSupport(() => ({
      found: true,
      status: 0,
      output: "Usage:\n  bd init [flags]\n      --skip-hooks\n",
    }));

    expect(support.supported).toBe(false);
    expect(support.reason).toContain("--shared-server");
    expect(support.reason).toContain("--skip-agents");
  });

  it("accepts a compatible bd init help surface", () => {
    const support = getMockRunBdSupport(() => ({
      found: true,
      status: 0,
      output: "Usage:\n  bd init [flags]\n      --shared-server\n      --skip-agents\n",
    }));

    expect(support).toEqual({
      supported: true,
      reason: "compatible",
    });
  });
});
