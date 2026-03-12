// test/beads.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { execFile } from "node:child_process";

// Must be hoisted before imports of the module under test
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

// Import after mock is set up
import * as beads from "../src/beads.js";

const mockExecFile = vi.mocked(execFile);

type ExecFileCallback = (
  err: Error | null,
  stdout: string,
  stderr: string
) => void;

function mockSuccess(output: string): void {
  mockExecFile.mockImplementation(
    (_cmd: unknown, _args: unknown, callback: unknown) => {
      (callback as ExecFileCallback)(null, output, "");
      return undefined as never;
    }
  );
}

function mockError(err: Error): void {
  mockExecFile.mockImplementation(
    (_cmd: unknown, _args: unknown, callback: unknown) => {
      (callback as ExecFileCallback)(err, "", err.message);
      return undefined as never;
    }
  );
}

const sampleRawIssue = {
  id: "aegis-001",
  title: "Test issue",
  description: "A test issue",
  status: "open",
  priority: 1,
  issue_type: "task",
};

const expectedIssue = {
  id: "aegis-001",
  title: "Test issue",
  description: "A test issue",
  type: "task",
  priority: 1,
  status: "open",
  comments: [],
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------- ready() ----------
describe("ready()", () => {
  it("calls bd ready --json and returns mapped issues", async () => {
    mockSuccess(JSON.stringify([sampleRawIssue]));
    const result = await beads.ready();
    expect(result).toEqual([expectedIssue]);
    const [cmd, args] = mockExecFile.mock.calls[0]!;
    expect(cmd).toBe("bd");
    expect(args).toContain("ready");
    expect(args).toContain("--json");
  });

  it("returns empty array when bd returns []", async () => {
    mockSuccess("[]");
    const result = await beads.ready();
    expect(result).toEqual([]);
  });

  it("throws when bd is not in PATH (ENOENT)", async () => {
    const err = new Error("not found") as NodeJS.ErrnoException;
    err.code = "ENOENT";
    mockError(err);
    await expect(beads.ready()).rejects.toThrow(/bd CLI not found in PATH/);
  });

  it("throws on non-zero exit (error with stderr)", async () => {
    const err = new Error("command failed") as NodeJS.ErrnoException;
    (err as unknown as Record<string, unknown>)["stderr"] = "bd: unknown error";
    mockExecFile.mockImplementation(
      (_cmd: unknown, _args: unknown, callback: unknown) => {
        (callback as ExecFileCallback)(err, "", "bd: unknown error");
        return undefined as never;
      }
    );
    await expect(beads.ready()).rejects.toThrow(/bd command failed/);
  });

  it("throws on malformed JSON output", async () => {
    mockSuccess("not-json-at-all");
    await expect(beads.ready()).rejects.toThrow(/Malformed JSON/);
  });
});

// ---------- show() ----------
describe("show()", () => {
  it("calls bd show <id> --json and returns the matching issue (array response)", async () => {
    mockSuccess(JSON.stringify([sampleRawIssue]));
    const result = await beads.show("aegis-001");
    expect(result).toEqual(expectedIssue);
    const [, args] = mockExecFile.mock.calls[0]!;
    expect(args).toContain("show");
    expect(args).toContain("aegis-001");
    expect(args).toContain("--json");
  });

  it("handles single-object response from bd show", async () => {
    mockSuccess(JSON.stringify(sampleRawIssue));
    const result = await beads.show("aegis-001");
    expect(result).toEqual(expectedIssue);
  });

  it("throws when issue id is not in the array response", async () => {
    mockSuccess(JSON.stringify([{ ...sampleRawIssue, id: "aegis-999" }]));
    await expect(beads.show("aegis-001")).rejects.toThrow(
      /aegis-001 not found/
    );
  });
});

// ---------- create() ----------
describe("create()", () => {
  it("calls bd create with title and --json", async () => {
    mockSuccess(JSON.stringify(sampleRawIssue));
    await beads.create({ title: "New issue" });
    const [cmd, args] = mockExecFile.mock.calls[0]!;
    expect(cmd).toBe("bd");
    expect(args).toContain("create");
    expect(args).toContain("New issue");
    expect(args).toContain("--json");
  });

  it("passes description, type, and priority when provided", async () => {
    mockSuccess(JSON.stringify(sampleRawIssue));
    await beads.create({
      title: "New issue",
      description: "desc here",
      type: "bug",
      priority: 2,
    });
    const [, args] = mockExecFile.mock.calls[0]!;
    expect(args.some((a) => (a as string).includes("desc here"))).toBe(true);
    expect(args).toContain("-t");
    expect(args).toContain("bug");
    expect(args).toContain("-p");
    expect(args).toContain("2");
  });

  it("omits optional flags when not provided", async () => {
    mockSuccess(JSON.stringify(sampleRawIssue));
    await beads.create({ title: "Minimal" });
    const [, args] = mockExecFile.mock.calls[0]!;
    expect(args).not.toContain("-t");
    expect(args).not.toContain("-p");
  });
});

// ---------- update() ----------
describe("update()", () => {
  it("calls bd update <id> --json", async () => {
    mockSuccess(JSON.stringify(sampleRawIssue));
    await beads.update("aegis-001", {});
    const [cmd, args] = mockExecFile.mock.calls[0]!;
    expect(cmd).toBe("bd");
    expect(args).toContain("update");
    expect(args).toContain("aegis-001");
    expect(args).toContain("--json");
  });

  it("passes --claim flag when claim is true", async () => {
    mockSuccess(JSON.stringify(sampleRawIssue));
    await beads.update("aegis-001", { claim: true });
    const [, args] = mockExecFile.mock.calls[0]!;
    expect(args).toContain("--claim");
  });

  it("passes --blocked-by flag with id", async () => {
    mockSuccess(JSON.stringify(sampleRawIssue));
    await beads.update("aegis-001", { blockedBy: "aegis-002" });
    const [, args] = mockExecFile.mock.calls[0]!;
    expect(args).toContain("--blocked-by");
    expect(args).toContain("aegis-002");
  });

  it("passes -p flag for priority", async () => {
    mockSuccess(JSON.stringify(sampleRawIssue));
    await beads.update("aegis-001", { priority: 3 });
    const [, args] = mockExecFile.mock.calls[0]!;
    expect(args).toContain("-p");
    expect(args).toContain("3");
  });

  it("does not add --claim when claim is false/undefined", async () => {
    mockSuccess(JSON.stringify(sampleRawIssue));
    await beads.update("aegis-001", { claim: false });
    const [, args] = mockExecFile.mock.calls[0]!;
    expect(args).not.toContain("--claim");
  });
});

// ---------- close() ----------
describe("close()", () => {
  it("calls bd close <id> --reason <reason> --json", async () => {
    mockSuccess(JSON.stringify({ ...sampleRawIssue, status: "closed" }));
    const result = await beads.close("aegis-001", "Done");
    expect(result.status).toBe("closed");
    const [, args] = mockExecFile.mock.calls[0]!;
    expect(args).toContain("close");
    expect(args).toContain("aegis-001");
    expect(args).toContain("--reason");
    expect(args).toContain("Done");
    expect(args).toContain("--json");
  });
});

// ---------- comment() ----------
describe("comment()", () => {
  it("calls bd comment <id> <text> --json", async () => {
    mockSuccess("{}");
    await beads.comment("aegis-001", "looks good");
    const [cmd, args] = mockExecFile.mock.calls[0]!;
    expect(cmd).toBe("bd");
    expect(args).toContain("comment");
    expect(args).toContain("aegis-001");
    expect(args).toContain("looks good");
    expect(args).toContain("--json");
  });

  it("does not throw on malformed JSON from bd comment", async () => {
    mockSuccess("Comment added.");
    await expect(beads.comment("aegis-001", "hi")).resolves.toBeUndefined();
  });

  it("does not throw on empty output from bd comment", async () => {
    mockSuccess("");
    await expect(beads.comment("aegis-001", "hi")).resolves.toBeUndefined();
  });

  it("propagates real errors (not malformed JSON) from bd comment", async () => {
    const err = new Error("bd failed") as NodeJS.ErrnoException;
    err.code = "ENOENT";
    mockError(err);
    await expect(beads.comment("aegis-001", "hi")).rejects.toThrow(
      /bd CLI not found/
    );
  });
});

// ---------- list() ----------
describe("list()", () => {
  it("calls bd list --json and returns all issues", async () => {
    mockSuccess(JSON.stringify([sampleRawIssue, { ...sampleRawIssue, id: "aegis-002" }]));
    const result = await beads.list();
    expect(result).toHaveLength(2);
    expect(result[0]!.id).toBe("aegis-001");
    expect(result[1]!.id).toBe("aegis-002");
    const [, args] = mockExecFile.mock.calls[0]!;
    expect(args).toContain("list");
    expect(args).toContain("--json");
  });

  it("maps issue_type to type field", async () => {
    mockSuccess(
      JSON.stringify([{ ...sampleRawIssue, issue_type: "bug" }])
    );
    const result = await beads.list();
    expect(result[0]!.type).toBe("bug");
  });

  it("maps comments from raw output", async () => {
    const rawWithComments = {
      ...sampleRawIssue,
      comments: [
        {
          id: "c1",
          body: "Nice work",
          author: "alice",
          created_at: "2026-01-01T00:00:00Z",
        },
      ],
    };
    mockSuccess(JSON.stringify([rawWithComments]));
    const result = await beads.list();
    expect(result[0]!.comments).toHaveLength(1);
    expect(result[0]!.comments[0]!.body).toBe("Nice work");
  });
});
