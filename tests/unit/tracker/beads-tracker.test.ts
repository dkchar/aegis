import { describe, expect, it, vi } from "vitest";

import { BeadsTrackerClient } from "../../../src/tracker/beads-tracker.js";

describe("BeadsTrackerClient", () => {
  it("normalizes bd show JSON into the generic Aegis issue model", async () => {
    const execFile = vi.fn(
      (
        _command: string,
        _args: readonly string[],
        _options: object,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        callback(
          null,
          JSON.stringify({
            id: "aegis-123",
            title: "Example",
            description: "Desc",
            status: "open",
            priority: 1,
            labels: ["phase-e"],
            dependencies: [{ id: "aegis-9", type: "blocks", status: "open" }],
            parent_id: null,
            child_ids: ["aegis-124"],
          }),
          "",
        );
      },
    );
    const tracker = new BeadsTrackerClient({ execFile });

    const issue = await tracker.getIssue("aegis-123", "repo");

    expect(execFile).toHaveBeenCalled();
    expect(issue).toMatchObject({
      id: "aegis-123",
      title: "Example",
      description: "Desc",
      issueClass: "primary",
      status: "open",
      priority: 1,
      labels: ["phase-e"],
      blockers: ["aegis-9"],
      parentId: null,
      childIds: ["aegis-124"],
    });
  });

  it("closes an issue through bd close with the completed reason", async () => {
    const execFile = vi.fn(
      (
        _command: string,
        _args: readonly string[],
        _options: object,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        callback(null, JSON.stringify({ id: "aegis-123", status: "closed" }), "");
      },
    );
    const tracker = new BeadsTrackerClient({ execFile });

    await tracker.closeIssue("aegis-123", "repo");

    expect(execFile).toHaveBeenCalledWith(
      "bd",
      ["close", "aegis-123", "--reason", "Completed", "--json"],
      expect.objectContaining({ cwd: "repo" }),
      expect.any(Function),
    );
  });

  it("creates a follow-up issue through bd create with discovered-from dependency", async () => {
    const execFile = vi.fn(
      (
        _command: string,
        _args: readonly string[],
        _options: object,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        callback(null, JSON.stringify({ id: "aegis-456", status: "open" }), "");
      },
    );
    const tracker = new BeadsTrackerClient({ execFile });

    const createdIssueId = await tracker.createIssue?.({
      title: "[sentinel][aegis-123] update tests",
      description: "Auto-created follow-up from sentinel",
      dependencies: ["discovered-from:aegis-123"],
    }, "repo");

    expect(createdIssueId).toBe("aegis-456");
    expect(execFile).toHaveBeenCalledWith(
      "bd",
      [
        "create",
        "[sentinel][aegis-123] update tests",
        "--description",
        "Auto-created follow-up from sentinel",
        "--deps",
        "discovered-from:aegis-123",
        "--json",
      ],
      expect.objectContaining({ cwd: "repo" }),
      expect.any(Function),
    );
  });

  it("links a blocking issue through bd link with blocks relationship", async () => {
    const execFile = vi.fn(
      (
        _command: string,
        _args: readonly string[],
        _options: object,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        callback(null, "", "");
      },
    );
    const tracker = new BeadsTrackerClient({ execFile });

    await tracker.linkBlockingIssue?.({
      blockingIssueId: "aegis-child-1",
      blockedIssueId: "aegis-parent-1",
    }, "repo");

    expect(execFile).toHaveBeenCalledWith(
      "bd",
      ["link", "aegis-child-1", "aegis-parent-1", "--type", "blocks"],
      expect.objectContaining({
        cwd: "repo",
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
        windowsHide: true,
      }),
      expect.any(Function),
    );
  });

  it("reports bd link stderr when blocking link creation fails", async () => {
    const execFile = vi.fn(
      (
        _command: string,
        _args: readonly string[],
        _options: object,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        callback(new Error("exit 1"), "", "cannot link");
      },
    );
    const tracker = new BeadsTrackerClient({ execFile });

    await expect(tracker.linkBlockingIssue?.({
      blockingIssueId: "aegis-child-1",
      blockedIssueId: "aegis-parent-1",
    }, "repo")).rejects.toThrow("bd link failed: cannot link");
  });
});
