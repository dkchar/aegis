import path from "node:path";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import {
  createCycleSummaryWriter,
  resolvePhaseLogDirectory,
  type PhaseLogEntry,
} from "../../../src/core/phase-log.js";

const tempRoots: string[] = [];

function createTempRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "aegis-phase-log-"));
  tempRoots.push(root);
  return root;
}

function countPhaseFiles(root: string) {
  const directory = resolvePhaseLogDirectory(root);
  return existsSync(directory) ? readdirSync(directory).length : 0;
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
