import path from "node:path";
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import {
  createCycleSummaryWriter,
  readPhaseLog,
  resolvePhaseLogPath,
  writePhaseLog,
  type PhaseLogEntry,
} from "../../../src/core/phase-log.js";

const tempRoots: string[] = [];

function createTempRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "aegis-phase-log-"));
  tempRoots.push(root);
  return root;
}

function countPhaseFiles(root: string) {
  return readPhaseLog(root).entries.length;
}

function pollSummary(timestamp: string, detail: string): PhaseLogEntry {
  return { timestamp, phase: "poll", issueId: "_all", action: "poll_ready_work", outcome: "ok", detail };
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("createCycleSummaryWriter", () => {
  it("skips a summary identical to the previous one and records every change", () => {
    const root = createTempRoot();
    const write = createCycleSummaryWriter();

    write(root, pollSummary("2026-10-01T00:00:00.000Z", ""));
    write(root, pollSummary("2026-10-01T00:00:05.000Z", ""));
    expect(countPhaseFiles(root)).toBe(1);

    write(root, pollSummary("2026-10-01T00:00:10.000Z", "AG-1"));
    write(root, pollSummary("2026-10-01T00:00:15.000Z", ""));
    expect(countPhaseFiles(root)).toBe(3);
  });

  it("tracks each phase action and project root separately", () => {
    const first = createTempRoot();
    const second = createTempRoot();
    const write = createCycleSummaryWriter();

    write(first, pollSummary("2026-10-01T00:00:00.000Z", ""));
    write(first, { ...pollSummary("2026-10-01T00:00:00.000Z", ""), phase: "triage", action: "triage_ready_work" });
    write(second, pollSummary("2026-10-01T00:00:00.000Z", ""));

    expect(countPhaseFiles(first)).toBe(2);
    expect(countPhaseFiles(second)).toBe(1);
  });
});

describe("phase log", () => {
  it("appends entries in write order and reads only what follows a cursor", () => {
    const root = createTempRoot();
    writePhaseLog(root, pollSummary("2026-10-01T00:00:00.000Z", "a"));
    writePhaseLog(root, pollSummary("2026-10-01T00:00:00.000Z", "b"));

    const first = readPhaseLog(root);
    expect(first.entries.map((entry) => entry.detail)).toEqual(["a", "b"]);

    writePhaseLog(root, pollSummary("2026-10-01T00:00:01.000Z", "c"));
    const next = readPhaseLog(root, first.offset);
    expect(next.entries.map((entry) => entry.detail)).toEqual(["c"]);
    expect(readPhaseLog(root, next.offset).entries).toEqual([]);
  });

  it("holds a partial trailing line and skips malformed lines", () => {
    const root = createTempRoot();
    writePhaseLog(root, pollSummary("2026-10-01T00:00:00.000Z", "a"));
    appendFileSync(resolvePhaseLogPath(root), "{\"bad\":true}\n{\"timestamp\":", "utf8");

    const read = readPhaseLog(root);
    expect(read.entries.map((entry) => entry.detail)).toEqual(["a"]);

    appendFileSync(
      resolvePhaseLogPath(root),
      "\"2026-10-01T00:00:02.000Z\",\"phase\":\"reap\",\"issueId\":\"AG-1\",\"action\":\"x\",\"outcome\":\"ok\"}\n",
      "utf8",
    );
    expect(readPhaseLog(root, read.offset).entries).toEqual([
      { timestamp: "2026-10-01T00:00:02.000Z", phase: "reap", issueId: "AG-1", action: "x", outcome: "ok" },
    ]);
  });

  it("rereads from the start when the log was replaced by a shorter one", () => {
    const root = createTempRoot();
    writePhaseLog(root, pollSummary("2026-10-01T00:00:00.000Z", "long-entry-detail"));
    const { offset } = readPhaseLog(root);
    rmSync(resolvePhaseLogPath(root));
    writePhaseLog(root, { ...pollSummary("2026-10-01T00:00:00.000Z", ""), detail: undefined });

    expect(readPhaseLog(root, offset).entries).toHaveLength(1);
  });
});
