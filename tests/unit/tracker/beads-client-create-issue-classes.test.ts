import { beforeEach, describe, expect, it, vi } from "vitest";

import { BeadsCliClient } from "../../../src/tracker/beads-client.js";

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

type MockExecutor = ReturnType<typeof vi.fn<(args: string[]) => Promise<string>>>;

function createClientWithMock(): { client: BeadsCliClient; exec: MockExecutor } {
  const exec = vi.fn<(args: string[]) => Promise<string>>();
  const client = new BeadsCliClient(exec);
  return { client, exec };
}

describe("BeadsCliClient.createIssue class mapping", () => {
  let client: BeadsCliClient;
  let exec: MockExecutor;

  beforeEach(() => {
    ({ client, exec } = createClientWithMock());
  });

  it.each([
    "fix",
    "conflict",
    "escalation",
    "clarification",
    "sub",
    "message",
  ] as const)("uses a structural --type marker for %s issues", async (issueClass) => {
    const created = makeBdIssue({
      id: "aegis-fjm.99",
      issue_type: issueClass,
      labels: [],
    });
    exec.mockResolvedValue(JSON.stringify([created]));

    await client.createIssue({
      title: `${issueClass} issue`,
      description: "details",
      issueClass,
      priority: 1,
      originId: null,
      labels: [],
    });

    expect(exec).toHaveBeenCalledWith(
      expect.arrayContaining(["--type", issueClass]),
    );
  });

  it("preserves caller-supplied labels separately from the issue class", async () => {
    const created = makeBdIssue({
      id: "aegis-fjm.100",
      issue_type: "clarification",
      labels: ["customer-facing", "needs-spec"],
    });
    exec.mockResolvedValue(JSON.stringify([created]));

    const result = await client.createIssue({
      title: "Need clarification",
      description: "body",
      issueClass: "clarification",
      priority: 1,
      originId: null,
      labels: ["customer-facing", "needs-spec"],
    });

    expect(exec).toHaveBeenCalledWith(
      expect.arrayContaining([
        "--type", "clarification",
        "--labels", "customer-facing,needs-spec",
      ]),
    );
    expect(result.issueClass).toBe("clarification");
  });
});
