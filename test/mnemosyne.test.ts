// test/mnemosyne.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { load, append, filter, postProcess } from "../src/mnemosyne.js";
import type { MnemosyneRecord } from "../src/types.js";

function makeTempDir(): string {
  const dir = join(tmpdir(), `aegis-mnem-${randomBytes(6).toString("hex")}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeMnemosyne(dir: string, lines: string[]): void {
  mkdirSync(join(dir, ".aegis"), { recursive: true });
  writeFileSync(
    join(dir, ".aegis", "mnemosyne.jsonl"),
    lines.join("\n") + "\n"
  );
}

function makeRecord(
  overrides: Partial<MnemosyneRecord> = {}
): MnemosyneRecord {
  return {
    id: "l-abc123",
    type: "convention",
    domain: "typescript",
    text: "Use explicit return types on exported functions",
    source: "titan-1",
    issue: "aegis-001",
    ts: 1000000,
    ...overrides,
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = makeTempDir();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// ---------- load() ----------
describe("load()", () => {
  it("returns empty array when file does not exist", () => {
    expect(load(tmpDir)).toEqual([]);
  });

  it("parses a valid JSONL file into MnemosyneRecord array", () => {
    const r1 = makeRecord({ id: "l-1", ts: 1000 });
    const r2 = makeRecord({ id: "l-2", ts: 2000, domain: "git" });
    writeMnemosyne(tmpDir, [JSON.stringify(r1), JSON.stringify(r2)]);

    const records = load(tmpDir);
    expect(records).toHaveLength(2);
    expect(records[0]!.id).toBe("l-1");
    expect(records[1]!.id).toBe("l-2");
  });

  it("skips malformed JSON lines without throwing", () => {
    const r1 = makeRecord({ id: "l-1" });
    writeMnemosyne(tmpDir, [JSON.stringify(r1), "not valid json", ""]);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const records = load(tmpDir);
    expect(records).toHaveLength(1);
    expect(records[0]!.id).toBe("l-1");
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it("skips lines that are not objects (arrays, primitives)", () => {
    const r1 = makeRecord({ id: "l-1" });
    writeMnemosyne(tmpDir, [JSON.stringify(r1), "[1,2,3]", '"just a string"']);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const records = load(tmpDir);
    expect(records).toHaveLength(1);
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it("handles empty file", () => {
    mkdirSync(join(tmpDir, ".aegis"), { recursive: true });
    writeFileSync(join(tmpDir, ".aegis", "mnemosyne.jsonl"), "");
    expect(load(tmpDir)).toEqual([]);
  });

  it("skips blank lines silently", () => {
    const r1 = makeRecord({ id: "l-1" });
    writeMnemosyne(tmpDir, [JSON.stringify(r1), "", "  "]);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const records = load(tmpDir);
    expect(records).toHaveLength(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

// ---------- append() ----------
describe("append()", () => {
  it("adds a record with generated id and timestamp", () => {
    const input: Omit<MnemosyneRecord, "id" | "ts"> = {
      type: "pattern",
      domain: "typescript",
      text: "Prefer interfaces over type aliases for objects",
      source: "titan-2",
      issue: "aegis-002",
    };
    const result = append(input, tmpDir);

    expect(result.id).toMatch(/^l-[0-9a-f]{8}$/);
    expect(result.ts).toBeGreaterThan(0);
    expect(result.type).toBe("pattern");
    expect(result.domain).toBe("typescript");
    expect(result.text).toBe("Prefer interfaces over type aliases for objects");
  });

  it("creates the file if it does not exist", () => {
    const filePath = join(tmpDir, ".aegis", "mnemosyne.jsonl");
    expect(existsSync(filePath)).toBe(false);

    append(
      {
        type: "convention",
        domain: "git",
        text: "Use conventional commits",
        source: "oracle-1",
        issue: null,
      },
      tmpDir
    );

    expect(existsSync(filePath)).toBe(true);
  });

  it("creates parent directories if they don't exist", () => {
    const newDir = join(tmpDir, "nested", "project");
    mkdirSync(newDir, { recursive: true });

    append(
      {
        type: "failure",
        domain: "testing",
        text: "Never skip tests",
        source: "sentinel-1",
        issue: "aegis-003",
      },
      newDir
    );

    const filePath = join(newDir, ".aegis", "mnemosyne.jsonl");
    expect(existsSync(filePath)).toBe(true);
  });

  it("appends to existing file without overwriting", () => {
    const r1: Omit<MnemosyneRecord, "id" | "ts"> = {
      type: "convention",
      domain: "typescript",
      text: "First record",
      source: "agent-1",
      issue: null,
    };
    const r2: Omit<MnemosyneRecord, "id" | "ts"> = {
      type: "pattern",
      domain: "git",
      text: "Second record",
      source: "agent-2",
      issue: null,
    };

    append(r1, tmpDir);
    append(r2, tmpDir);

    const records = load(tmpDir);
    expect(records).toHaveLength(2);
    expect(records[0]!.text).toBe("First record");
    expect(records[1]!.text).toBe("Second record");
  });

  it("returns the completed record with generated id", () => {
    const result = append(
      {
        type: "convention",
        domain: "testing",
        text: "Test everything",
        source: "titan-1",
        issue: "aegis-004",
      },
      tmpDir
    );
    expect(result.id).toBeTruthy();
    expect(typeof result.ts).toBe("number");
  });

  it("persists the record as valid JSON in the file", () => {
    append(
      {
        type: "convention",
        domain: "typescript",
        text: "Always strict mode",
        source: "titan-1",
        issue: null,
      },
      tmpDir
    );

    const filePath = join(tmpDir, ".aegis", "mnemosyne.jsonl");
    const content = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(content.trim());
    expect(parsed.text).toBe("Always strict mode");
  });
});

// ---------- filter() ----------
describe("filter()", () => {
  const records: MnemosyneRecord[] = [
    makeRecord({ id: "l-1", domain: "typescript", ts: 1000, text: "TS convention" }),
    makeRecord({ id: "l-2", domain: "git", ts: 2000, text: "Git convention" }),
    makeRecord({ id: "l-3", domain: "typescript", ts: 3000, text: "TS pattern" }),
    makeRecord({ id: "l-4", domain: "testing", ts: 4000, text: "Test convention" }),
  ];

  it("returns records matching the given domain", () => {
    const result = filter(records, "typescript", 10000);
    expect(result.every((r) => r.domain === "typescript")).toBe(true);
    expect(result).toHaveLength(2);
  });

  it("sorts by timestamp descending (newest first)", () => {
    const result = filter(records, "typescript", 10000);
    expect(result[0]!.ts).toBeGreaterThan(result[1]!.ts);
    expect(result[0]!.id).toBe("l-3");
  });

  it("truncates to fit within token budget", () => {
    // Each record is roughly 100-200 chars; 1 token budget = ~4 chars → tiny budget
    const result = filter(records, "typescript", 1);
    expect(result).toHaveLength(0);
  });

  it("returns all matching records when budget is large", () => {
    const result = filter(records, "typescript", 100000);
    expect(result).toHaveLength(2);
  });

  it("falls back to most recent records when no domain matches", () => {
    const result = filter(records, "nonexistent-domain", 100000);
    // Falls back to all records, sorted by ts desc
    expect(result).toHaveLength(4);
    expect(result[0]!.ts).toBeGreaterThanOrEqual(result[1]!.ts);
  });

  it("returns empty array when records is empty", () => {
    expect(filter([], "typescript", 10000)).toEqual([]);
  });

  it("does case-insensitive domain matching", () => {
    const result = filter(records, "TypeScript", 10000);
    expect(result).toHaveLength(2);
  });

  it("truncates based on JSON size of records", () => {
    // Create a record with long text to test budget enforcement
    const bigRecord = makeRecord({
      id: "l-big",
      domain: "typescript",
      ts: 9999,
      text: "A".repeat(400),
    });
    const small = makeRecord({ id: "l-small", domain: "typescript", ts: 1, text: "small" });
    // 400 chars text + overhead = ~450 chars → ~112 tokens
    // budget = 50 tokens → 200 chars — not enough for bigRecord
    const result = filter([bigRecord, small], "typescript", 50);
    expect(result).not.toContainEqual(expect.objectContaining({ id: "l-big" }));
  });
});

// ---------- postProcess() ----------
describe("postProcess()", () => {
  it("fills in missing id", () => {
    const r = { type: "convention", domain: "ts", text: "x", source: "", issue: null, ts: 0 } as MnemosyneRecord;
    (r as unknown as Record<string, unknown>)["id"] = "";
    const result = postProcess([r], "agent-1", "issue-1");
    expect(result[0]!.id).toMatch(/^l-/);
  });

  it("fills in missing source", () => {
    const r = makeRecord({ source: "" });
    const result = postProcess([r], "titan-42", "aegis-001");
    expect(result[0]!.source).toBe("titan-42");
  });

  it("fills in missing issue", () => {
    const r = makeRecord({ issue: null });
    const result = postProcess([r], "agent-1", "aegis-999");
    expect(result[0]!.issue).toBe("aegis-999");
  });

  it("fills in missing ts", () => {
    const r = makeRecord({ ts: 0 });
    const before = Date.now();
    const result = postProcess([r], "agent-1", "issue-1");
    const after = Date.now();
    expect(result[0]!.ts).toBeGreaterThanOrEqual(before);
    expect(result[0]!.ts).toBeLessThanOrEqual(after);
  });

  it("does not overwrite existing id", () => {
    const r = makeRecord({ id: "l-existing" });
    const result = postProcess([r], "agent-1", "issue-1");
    expect(result[0]!.id).toBe("l-existing");
  });

  it("does not overwrite existing source", () => {
    const r = makeRecord({ source: "original-agent" });
    const result = postProcess([r], "new-agent", "issue-1");
    expect(result[0]!.source).toBe("original-agent");
  });

  it("does not overwrite existing issue", () => {
    const r = makeRecord({ issue: "aegis-original" });
    const result = postProcess([r], "agent-1", "aegis-new");
    expect(result[0]!.issue).toBe("aegis-original");
  });

  it("does not overwrite existing ts", () => {
    const r = makeRecord({ ts: 12345 });
    const result = postProcess([r], "agent-1", "issue-1");
    expect(result[0]!.ts).toBe(12345);
  });

  it("processes multiple records", () => {
    const records = [
      makeRecord({ id: "", source: "", ts: 0, issue: null }),
      makeRecord({ id: "l-keep", source: "existing-source", ts: 99999, issue: "kept-issue" }),
    ];
    const result = postProcess(records, "filler-agent", "filler-issue");
    // First record gets filled in
    expect(result[0]!.id).toMatch(/^l-/);
    expect(result[0]!.source).toBe("filler-agent");
    // Second record keeps existing values
    expect(result[1]!.id).toBe("l-keep");
    expect(result[1]!.source).toBe("existing-source");
    expect(result[1]!.ts).toBe(99999);
    expect(result[1]!.issue).toBe("kept-issue");
  });

  it("returns empty array for empty input", () => {
    expect(postProcess([], "agent", "issue")).toEqual([]);
  });

  it("does not mutate the original records", () => {
    const r = makeRecord({ source: "" });
    const original = { ...r };
    postProcess([r], "new-agent", "new-issue");
    expect(r.source).toBe(original.source);
  });
});
