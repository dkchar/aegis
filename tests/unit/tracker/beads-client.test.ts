/**
 * Unit tests for BeadsCliClient — S04 Lane A (aegis-fjm.5.2).
 *
 * Tests use a mock executor so no real `bd` CLI calls are made.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  BeadsCliClient,
  mapBdIssueToAegis,
  mapBdIssueToReady,
} from "../../../src/tracker/beads-client.js";
import type { WorkIssueClass } from "../../../src/tracker/issue-model.js";

// ---------------------------------------------------------------------------
// Fixtures: bd JSON output shapes
// ---------------------------------------------------------------------------

function makeBdIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: "aegis-fjm.5.2",
    title: "[S04] Parallel lane A",
    description: "Implement Beads reads.",
    status: "open",
    priority: 1,
    issue_type: "task",
    labels: ["child", "lane-a", "mvp"],
    dependencies: [],
    dependents: [],
    parent: "aegis-fjm.5",
    created_at: "2026-04-03T01:07:28Z",
    updated_at: "2026-04-04T19:24:44Z",
    ...overrides,
  };
}

function makeBdReadyIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: "aegis-fjm.6.1",
    title: "[S05] Contract seed",
    description: "Establish contracts.",
    status: "open",
    priority: 1,
    issue_type: "task",
    labels: ["child", "contract"],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock executor
// ---------------------------------------------------------------------------

type MockExecutor = ReturnType<typeof vi.fn<(args: string[]) => Promise<string>>>;

function createClientWithMock(): { client: BeadsCliClient; exec: MockExecutor } {
  const exec = vi.fn<(args: string[]) => Promise<string>>();
  const client = new BeadsCliClient(exec);
  return { client, exec };
}

// ---------------------------------------------------------------------------
// mapBdIssueToAegis
// ---------------------------------------------------------------------------

describe("mapBdIssueToAegis", () => {
  it("maps a standard bd issue to AegisIssue", () => {
    const bd = makeBdIssue();
    const result = mapBdIssueToAegis(bd);
    expect(result.id).toBe("aegis-fjm.5.2");
    expect(result.title).toBe("[S04] Parallel lane A");
    expect(result.description).toBe("Implement Beads reads.");
    expect(result.status).toBe("open");
    expect(result.priority).toBe(1);
    expect(result.issueClass).toBe("primary");
    expect(result.parentId).toBe("aegis-fjm.5");
    expect(result.labels).toEqual(["child", "lane-a", "mvp"]);
    expect(result.createdAt).toBe("2026-04-03T01:07:28Z");
    expect(result.updatedAt).toBe("2026-04-04T19:24:44Z");
  });

  it("infers issueClass 'fix' from labels", () => {
    const bd = makeBdIssue({ labels: ["fix", "s04"] });
    expect(mapBdIssueToAegis(bd).issueClass).toBe("fix");
  });

  it("infers issueClass 'escalation' from labels", () => {
    const bd = makeBdIssue({ labels: ["escalation"] });
    expect(mapBdIssueToAegis(bd).issueClass).toBe("escalation");
  });

  it("infers issueClass 'clarification' from labels", () => {
    const bd = makeBdIssue({ labels: ["clarification", "mvp"] });
    expect(mapBdIssueToAegis(bd).issueClass).toBe("clarification");
  });

  it("infers issueClass 'conflict' from labels", () => {
    const bd = makeBdIssue({ labels: ["conflict"] });
    expect(mapBdIssueToAegis(bd).issueClass).toBe("conflict");
  });

  it("infers issueClass 'sub' from labels", () => {
    const bd = makeBdIssue({ labels: ["sub"] });
    expect(mapBdIssueToAegis(bd).issueClass).toBe("sub");
  });

  it("infers issueClass 'message' from issue_type", () => {
    const bd = makeBdIssue({ issue_type: "message" });
    expect(mapBdIssueToAegis(bd).issueClass).toBe("message");
  });

  it("defaults to 'primary' when no class label matches", () => {
    const bd = makeBdIssue({ labels: ["mvp", "phase1"], issue_type: "task" });
    expect(mapBdIssueToAegis(bd).issueClass).toBe("primary");
  });

  it("extracts blockers from dependencies with type 'blocks'", () => {
    const bd = makeBdIssue({
      dependencies: [
        { id: "aegis-fjm.5.1", status: "open", dependency_type: "blocks" },
        { id: "aegis-fjm.5", dependency_type: "parent-child" },
      ],
    });
    const result = mapBdIssueToAegis(bd);
    expect(result.blockers).toEqual(["aegis-fjm.5.1"]);
  });

  it("excludes closed blockers", () => {
    const bd = makeBdIssue({
      dependencies: [
        { id: "aegis-fjm.5.1", status: "closed", dependency_type: "blocks" },
      ],
    });
    expect(mapBdIssueToAegis(bd).blockers).toEqual([]);
  });

  it("extracts childIds from dependents with type 'parent-child'", () => {
    const bd = makeBdIssue({
      dependents: [
        { id: "aegis-fjm.5.2", dependency_type: "parent-child" },
        { id: "aegis-fjm.5.3", dependency_type: "parent-child" },
        { id: "other", dependency_type: "blocks" },
      ],
    });
    expect(mapBdIssueToAegis(bd).childIds).toEqual([
      "aegis-fjm.5.2",
      "aegis-fjm.5.3",
    ]);
  });

  it("handles null parent", () => {
    const bd = makeBdIssue({ parent: null });
    expect(mapBdIssueToAegis(bd).parentId).toBeNull();
  });

  it("handles null description", () => {
    const bd = makeBdIssue({ description: null });
    expect(mapBdIssueToAegis(bd).description).toBeNull();
  });

  it("handles empty description as null", () => {
    const bd = makeBdIssue({ description: "" });
    expect(mapBdIssueToAegis(bd).description).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// mapBdIssueToReady
// ---------------------------------------------------------------------------

describe("mapBdIssueToReady", () => {
  it("maps a bd issue to ReadyIssue", () => {
    const bd = makeBdReadyIssue();
    const result = mapBdIssueToReady(bd);
    expect(result.id).toBe("aegis-fjm.6.1");
    expect(result.title).toBe("[S05] Contract seed");
    expect(result.priority).toBe(1);
    expect(result.issueClass).toBe("primary");
  });

  it("infers issueClass from labels in ready issues", () => {
    const bd = makeBdReadyIssue({ labels: ["fix"] });
    expect(mapBdIssueToReady(bd).issueClass).toBe("fix");
  });
});

// ---------------------------------------------------------------------------
// BeadsCliClient.getIssue
// ---------------------------------------------------------------------------

describe("BeadsCliClient.getIssue", () => {
  let client: BeadsCliClient;
  let exec: MockExecutor;

  beforeEach(() => {
    ({ client, exec } = createClientWithMock());
  });

  it("calls bd show with --json and returns mapped AegisIssue", async () => {
    const bd = makeBdIssue();
    exec.mockResolvedValue(JSON.stringify([bd]));

    const result = await client.getIssue("aegis-fjm.5.2");
    expect(exec).toHaveBeenCalledWith(["show", "aegis-fjm.5.2", "--json"]);
    expect(result.id).toBe("aegis-fjm.5.2");
    expect(result.title).toBe("[S04] Parallel lane A");
  });

  it("accepts single-object JSON responses from bd show", async () => {
    const bd = makeBdIssue();
    exec.mockResolvedValue(JSON.stringify(bd));

    const result = await client.getIssue("aegis-fjm.5.2");

    expect(result.id).toBe("aegis-fjm.5.2");
    expect(result.title).toBe("[S04] Parallel lane A");
  });

  it("throws on empty array response", async () => {
    exec.mockResolvedValue(JSON.stringify([]));
    await expect(client.getIssue("no-such")).rejects.toThrow(/not found/i);
  });

  it("throws on invalid JSON", async () => {
    exec.mockResolvedValue("not json");
    await expect(client.getIssue("test")).rejects.toThrow();
  });

  it("throws on CLI error", async () => {
    exec.mockRejectedValue(new Error("exit code 1"));
    await expect(client.getIssue("test")).rejects.toThrow("exit code 1");
  });
});

// ---------------------------------------------------------------------------
// BeadsCliClient.getReadyQueue
// ---------------------------------------------------------------------------

describe("BeadsCliClient.getReadyQueue", () => {
  let client: BeadsCliClient;
  let exec: MockExecutor;

  beforeEach(() => {
    ({ client, exec } = createClientWithMock());
  });

  it("calls bd ready --json and returns mapped ReadyIssue list", async () => {
    const issues = [
      makeBdReadyIssue({ id: "a", priority: 2 }),
      makeBdReadyIssue({ id: "b", priority: 1 }),
    ];
    exec.mockResolvedValue(JSON.stringify(issues));

    const result = await client.getReadyQueue();
    expect(exec).toHaveBeenCalledWith(["ready", "--json"]);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("a");
    expect(result[1].id).toBe("b");
  });

  it("returns empty array when nothing is ready", async () => {
    exec.mockResolvedValue(JSON.stringify([]));
    const result = await client.getReadyQueue();
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// BeadsCliClient.createIssue
// ---------------------------------------------------------------------------

describe("BeadsCliClient.createIssue", () => {
  let client: BeadsCliClient;
  let exec: MockExecutor;

  beforeEach(() => {
    ({ client, exec } = createClientWithMock());
  });

  it("constructs correct bd create args", async () => {
    const created = makeBdIssue({ id: "aegis-fjm.99" });
    exec.mockResolvedValue(JSON.stringify([created]));

    await client.createIssue({
      title: "New issue",
      description: "Details",
      issueClass: "fix",
      priority: 2,
      originId: null,
      labels: ["fix", "mvp"],
    });

    expect(exec).toHaveBeenCalledWith(
      expect.arrayContaining([
        "create",
        "--title", "New issue",
        "--description", "Details",
        "--priority", "2",
        "--type", "fix",
        "--labels", "fix,mvp",
        "--json",
      ]),
    );
  });

  it("returns mapped AegisIssue", async () => {
    const created = makeBdIssue({ id: "aegis-fjm.99", title: "New" });
    exec.mockResolvedValue(JSON.stringify([created]));

    const result = await client.createIssue({
      title: "New",
      description: "d",
      issueClass: "primary",
      priority: 1,
      originId: null,
      labels: [],
    });
    expect(result.id).toBe("aegis-fjm.99");
  });

  it("links to originId when non-null (SPECv2 §5.5)", async () => {
    const created = makeBdIssue({ id: "aegis-fjm.99" });
    // First call: create returns the new issue
    // Second call: link (returns empty)
    exec
      .mockResolvedValueOnce(JSON.stringify([created]))
      .mockResolvedValueOnce("");

    await client.createIssue({
      title: "Fix issue",
      description: "fix details",
      issueClass: "fix",
      priority: 1,
      originId: "aegis-fjm.5",
      labels: ["fix"],
    });

    // Verify link was called after create
    expect(exec).toHaveBeenCalledTimes(2);
    expect(exec.mock.calls[1][0]).toEqual([
      "link", "aegis-fjm.99", "aegis-fjm.5", "--type", "parent-child", "--json",
    ]);
  });

  it("closes the created issue if origin linking fails after bd create succeeds", async () => {
    const created = makeBdIssue({ id: "aegis-fjm.99" });
    const closed = makeBdIssue({ id: "aegis-fjm.99", status: "closed" });
    exec
      .mockResolvedValueOnce(JSON.stringify([created]))
      .mockRejectedValueOnce(new Error("link failed"))
      .mockResolvedValueOnce(JSON.stringify([closed]));

    await expect(
      client.createIssue({
        title: "Fix issue",
        description: "fix details",
        issueClass: "fix",
        priority: 1,
        originId: "aegis-fjm.5",
        labels: ["fix"],
      }),
    ).rejects.toThrow("link failed");

    expect(exec).toHaveBeenCalledTimes(3);
    expect(exec.mock.calls[1][0]).toEqual([
      "link", "aegis-fjm.99", "aegis-fjm.5", "--type", "parent-child", "--json",
    ]);
    expect(exec.mock.calls[2][0]).toEqual([
      "close",
      "aegis-fjm.99",
      "--reason",
      "Failed to link aegis-fjm.99 to origin aegis-fjm.5",
      "--json",
    ]);
  });

  it("surfaces rollback failure if closing the created issue also fails", async () => {
    const created = makeBdIssue({ id: "aegis-fjm.99" });
    exec
      .mockResolvedValueOnce(JSON.stringify([created]))
      .mockRejectedValueOnce(new Error("link failed"))
      .mockRejectedValueOnce(new Error("close failed"));

    const promise = client.createIssue({
      title: "Fix issue",
      description: "fix details",
      issueClass: "fix",
      priority: 1,
      originId: "aegis-fjm.5",
      labels: ["fix"],
    });

    await expect(promise).rejects.toThrow(/link failed/i);
    await expect(promise).rejects.toThrow(/close failed/i);
    await expect(promise).rejects.toMatchObject({
      createdIssue: expect.objectContaining({ id: "aegis-fjm.99" }),
    });
    expect(exec).toHaveBeenCalledTimes(3);
    expect(exec.mock.calls[2][0]).toEqual([
      "close",
      "aegis-fjm.99",
      "--reason",
      "Failed to link aegis-fjm.99 to origin aegis-fjm.5",
      "--json",
    ]);
  });

  it("does not call link when originId is null", async () => {
    const created = makeBdIssue({ id: "aegis-fjm.99" });
    exec.mockResolvedValue(JSON.stringify([created]));

    await client.createIssue({
      title: "New",
      description: "d",
      issueClass: "primary",
      priority: 1,
      originId: null,
      labels: [],
    });
    expect(exec).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// BeadsCliClient.updateIssue
// ---------------------------------------------------------------------------

describe("BeadsCliClient.updateIssue", () => {
  let client: BeadsCliClient;
  let exec: MockExecutor;

  beforeEach(() => {
    ({ client, exec } = createClientWithMock());
  });

  it("sends only changed fields", async () => {
    const updated = makeBdIssue({ title: "Updated" });
    exec.mockResolvedValue(JSON.stringify([updated]));

    await client.updateIssue("aegis-fjm.5.2", { title: "Updated" });
    const args = exec.mock.calls[0][0];
    expect(args).toContain("--title");
    expect(args).not.toContain("--description");
    expect(args).not.toContain("--priority");
  });

  it("sends priority as string", async () => {
    const updated = makeBdIssue({ priority: 3 });
    exec.mockResolvedValue(JSON.stringify([updated]));

    await client.updateIssue("aegis-fjm.5.2", { priority: 3 });
    const args = exec.mock.calls[0][0];
    expect(args).toContain("--priority");
    expect(args).toContain("3");
  });

  it("sends labels via --set-labels", async () => {
    const updated = makeBdIssue({ labels: ["a", "b"] });
    exec.mockResolvedValue(JSON.stringify([updated]));

    await client.updateIssue("aegis-fjm.5.2", { labels: ["a", "b"] });
    const args = exec.mock.calls[0][0];
    expect(args).toContain("--set-labels");
  });
});

// ---------------------------------------------------------------------------
// BeadsCliClient.closeIssue
// ---------------------------------------------------------------------------

describe("BeadsCliClient.closeIssue", () => {
  let client: BeadsCliClient;
  let exec: MockExecutor;

  beforeEach(() => {
    ({ client, exec } = createClientWithMock());
  });

  it("calls bd close with reason", async () => {
    const closed = makeBdIssue({ status: "closed" });
    exec.mockResolvedValue(JSON.stringify([closed]));

    await client.closeIssue("aegis-fjm.5.2", "Done");
    expect(exec).toHaveBeenCalledWith(
      expect.arrayContaining(["close", "aegis-fjm.5.2", "--reason", "Done", "--json"]),
    );
  });

  it("calls bd close without reason when omitted", async () => {
    const closed = makeBdIssue({ status: "closed" });
    exec.mockResolvedValue(JSON.stringify([closed]));

    await client.closeIssue("aegis-fjm.5.2");
    const args = exec.mock.calls[0][0];
    expect(args).not.toContain("--reason");
  });

  it("returns mapped closed issue", async () => {
    const closed = makeBdIssue({ status: "closed" });
    exec.mockResolvedValue(JSON.stringify([closed]));
    const result = await client.closeIssue("aegis-fjm.5.2");
    expect(result.status).toBe("closed");
  });
});

// ---------------------------------------------------------------------------
// BeadsCliClient.linkIssue
// ---------------------------------------------------------------------------

describe("BeadsCliClient.linkIssue", () => {
  let client: BeadsCliClient;
  let exec: MockExecutor;

  beforeEach(() => {
    ({ client, exec } = createClientWithMock());
  });

  it("calls bd link with parent-child type", async () => {
    exec.mockResolvedValue("");

    await client.linkIssue("parent-1", "child-2");
    expect(exec).toHaveBeenCalledWith([
      "link", "child-2", "parent-1", "--type", "parent-child", "--json",
    ]);
  });

  it("removes a parent-child link during orphan rollback", async () => {
    exec.mockResolvedValue("");

    await client.unlinkIssue("parent-1", "child-2");
    expect(exec).toHaveBeenCalledWith([
      "dep", "remove", "child-2", "parent-1",
    ]);
  });

  it("adds a blocker dependency when clarification work must block the origin issue", async () => {
    exec.mockResolvedValue("");

    await client.addBlocker("origin-1", "clarification-2");
    expect(exec).toHaveBeenCalledWith([
      "dep", "add", "origin-1", "clarification-2",
    ]);
  });

  it("removes a blocker dependency when rollback must restore ready-queue truth", async () => {
    exec.mockResolvedValue("");

    await client.removeBlocker("origin-1", "clarification-2");
    expect(exec).toHaveBeenCalledWith([
      "dep", "remove", "origin-1", "clarification-2",
    ]);
  });
});
