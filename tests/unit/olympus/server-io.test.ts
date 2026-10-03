import path from "node:path";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "vitest";

const ioPath = path.join(process.cwd(), "olympus", "server", "io.js");
const tempRoots: string[] = [];

function createLog() {
  const root = mkdtempSync(path.join(tmpdir(), "olympus-io-"));
  tempRoots.push(root);
  return path.join(root, "phases.jsonl");
}

function line(action: string) {
  return `${JSON.stringify({ phase: "dispatch", issueId: "AG-1", action, outcome: "ok" })}\n`;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("Olympus JSONL readers", () => {
  test("reads appended entries with their byte offset as seq", async () => {
    const { readJsonLinesFrom } = await import(ioPath);
    const logPath = createLog();
    writeFileSync(logPath, `${line("a")}${line("b")}`, "utf8");

    const first = readJsonLinesFrom(logPath, 0);
    expect(first.entries.map((entry: { action: string }) => entry.action)).toEqual(["a", "b"]);
    expect(first.entries[0].seq).toBe(0);
    expect(first.entries[1].seq).toBe(line("a").length);
    expect(first.reset).toBe(false);

    appendFileSync(logPath, `${line("c")}{"partial":`, "utf8");
    const next = readJsonLinesFrom(logPath, first.offset);
    expect(next.entries.map((entry: { action: string }) => entry.action)).toEqual(["c"]);
    expect(next.entries[0].seq).toBe(first.offset);
    expect(readJsonLinesFrom(logPath, next.offset).entries).toEqual([]);
  });

  test("reports a log that shrank and rereads it from the start", async () => {
    const { readJsonLinesFrom } = await import(ioPath);
    const logPath = createLog();
    writeFileSync(logPath, `${line("first-run-a")}${line("first-run-b")}`, "utf8");
    const { offset } = readJsonLinesFrom(logPath, 0);

    writeFileSync(logPath, line("new"), "utf8");
    const read = readJsonLinesFrom(logPath, offset);
    expect(read.reset).toBe(true);
    expect(read.entries.map((entry: { action: string }) => entry.action)).toEqual(["new"]);
  });

  test("tails the last entries with offsets that match a full read", async () => {
    const { readJsonLinesFrom, tailJsonLines } = await import(ioPath);
    const logPath = createLog();
    writeFileSync(logPath, Array.from({ length: 50 }, (_, index) => line(`event-${index}`)).join(""), "utf8");

    const tail = tailJsonLines(logPath, 3);
    const full = readJsonLinesFrom(logPath, 0);
    expect(tail.entries.map((entry: { action: string }) => entry.action)).toEqual(["event-47", "event-48", "event-49"]);
    expect(tail.entries.map((entry: { seq: number }) => entry.seq)).toEqual(full.entries.slice(-3).map((entry: { seq: number }) => entry.seq));
    expect(tail.offset).toBe(full.offset);
    expect(tailJsonLines(path.join(path.dirname(logPath), "missing.jsonl"))).toEqual({ entries: [], offset: 0 });
  });
});
