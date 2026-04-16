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
});
