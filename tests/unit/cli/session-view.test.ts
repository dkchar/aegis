import { describe, expect, it, vi } from "vitest";

import { createSessionViewTracker } from "../../../src/cli/session-view.js";

describe("createSessionViewTracker", () => {
  it("spawns one viewer per newly seen running session", () => {
    const spawnMock = vi.fn(() => ({
      unref: vi.fn(),
    }));
    const tracker = createSessionViewTracker("repo", {
      spawnProcess: spawnMock as unknown as typeof import("node:child_process").spawn,
      cliEntrypoint: "dist/index.js",
      platform: "win32",
    });

    tracker.sync([
      { issueId: "aegis-1", caste: "oracle", sessionId: "session-1" },
      { issueId: "aegis-2", caste: "titan", sessionId: "session-2" },
    ]);
    tracker.sync([
      { issueId: "aegis-1", caste: "oracle", sessionId: "session-1" },
      { issueId: "aegis-2", caste: "titan", sessionId: "session-2" },
    ]);

    expect(spawnMock).toHaveBeenCalledTimes(2);
    expect(spawnMock).toHaveBeenNthCalledWith(
      1,
      expect.any(String),
      expect.arrayContaining([
        "/d",
        "/c",
        "start",
        "",
        "cmd.exe",
        "/s",
        expect.stringContaining("stream session \"session-1\""),
      ]),
      expect.objectContaining({
        windowsHide: false,
      }),
    );
    expect(spawnMock).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      expect.arrayContaining([
        "/d",
        "/c",
        "start",
        "",
        "cmd.exe",
        "/s",
        expect.stringContaining("stream session \"session-2\""),
      ]),
      expect.objectContaining({
        windowsHide: false,
      }),
    );
  });

  it("allows re-launch when a session disappears and later reappears", () => {
    const spawnMock = vi.fn(() => ({
      unref: vi.fn(),
    }));
    const tracker = createSessionViewTracker("repo", {
      spawnProcess: spawnMock as unknown as typeof import("node:child_process").spawn,
      cliEntrypoint: "dist/index.js",
      platform: "win32",
    });

    tracker.sync([{ issueId: "aegis-1", caste: "oracle", sessionId: "session-1" }]);
    tracker.sync([]);
    tracker.sync([{ issueId: "aegis-1", caste: "oracle", sessionId: "session-1" }]);

    expect(spawnMock).toHaveBeenCalledTimes(2);
  });
});
