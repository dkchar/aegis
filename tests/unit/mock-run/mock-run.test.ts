import { describe, expect, it, vi } from "vitest";

import { runMockCommand } from "../../../src/mock-run/mock-run.js";

describe("runMockCommand", () => {
  it("uses process.execPath when the mock command starts with node", () => {
    const execFileSync = vi.fn();

    runMockCommand(["node", "../dist/index.js", "status"], {
      mockDir: "C:/repo/aegis-mock-run",
      execFileSync,
    });

    expect(execFileSync).toHaveBeenCalledWith(
      process.execPath,
      ["../dist/index.js", "status"],
      expect.objectContaining({
        cwd: "C:/repo/aegis-mock-run",
        stdio: "inherit",
      }),
    );
  });
});
