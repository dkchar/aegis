import path from "node:path";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import {
  requestMergeCommandFromDaemon,
  requestCasteCommandFromDaemon,
  requestPhaseCommandFromDaemon,
  readRuntimeCommandRequests,
  writeRuntimeCommandRequest,
} from "../../../src/cli/runtime-command.js";

const tempRoots: string[] = [];

function createTempRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "aegis-runtime-command-"));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("runtime command files", () => {
  it("keeps concurrent request payloads in separate files instead of one shared request artifact", () => {
    const root = createTempRoot();

    writeRuntimeCommandRequest(root, {
      request_id: "request-1",
      command_kind: "phase",
      phase: "poll",
      target_pid: 1,
      requested_at: "2026-04-14T12:00:00.000Z",
    });
    writeRuntimeCommandRequest(root, {
      request_id: "request-2",
      command_kind: "caste",
      action: "scout",
      issue_id: "aegis-123",
      target_pid: 1,
      requested_at: "2026-04-14T12:00:01.000Z",
    });
    writeRuntimeCommandRequest(root, {
      request_id: "request-3",
      command_kind: "phase",
      phase: "dispatch",
      target_pid: 1,
      requested_at: "2026-04-14T12:00:02.000Z",
    });

    const requestFiles = readdirSync(path.join(root, ".aegis", "runtime-commands"));
    expect(requestFiles).toEqual(
      expect.arrayContaining([
        "request-1.request.json",
        "request-2.request.json",
        "request-3.request.json",
      ]),
    );
    expect(readRuntimeCommandRequests(root).map((request) => request.request_id)).toEqual([
      "request-1",
      "request-2",
      "request-3",
    ]);
  });

  it("cleans up a timed-out caste request artifact instead of leaving it live on disk", async () => {
    const root = createTempRoot();

    await expect(
      requestCasteCommandFromDaemon(root, "scout", "aegis-123", 1, 10),
    ).rejects.toThrow("Timed out waiting for daemon response to scout");

    expect(readRuntimeCommandRequests(root)).toEqual([]);
  });

  it("cleans up a timed-out phase request artifact instead of leaving it live on disk", async () => {
    const root = createTempRoot();

    await expect(
      requestPhaseCommandFromDaemon(root, "dispatch", 1, 10),
    ).rejects.toThrow("Timed out waiting for daemon response to dispatch");

    expect(readRuntimeCommandRequests(root)).toEqual([]);
  });

  it("cleans up a timed-out merge request artifact instead of leaving it live on disk", async () => {
    const root = createTempRoot();

    await expect(
      requestMergeCommandFromDaemon(root, "next", 1, 10),
    ).rejects.toThrow("Timed out waiting for daemon response to merge next");

    expect(readRuntimeCommandRequests(root)).toEqual([]);
  });
});

describe("takeNextRuntimeCommandRequest", () => {
  it("returns the oldest request for this daemon and drops requests for dead daemons", async () => {
    const { takeNextRuntimeCommandRequest } = await import("../../../src/cli/runtime-command.js");
    const root = createTempRoot();

    writeRuntimeCommandRequest(root, {
      request_id: "stale",
      command_kind: "phase",
      phase: "poll",
      target_pid: 111,
      requested_at: "2026-04-14T12:00:00.000Z",
    });
    writeRuntimeCommandRequest(root, {
      request_id: "other-live-daemon",
      command_kind: "phase",
      phase: "poll",
      target_pid: 222,
      requested_at: "2026-04-14T12:00:01.000Z",
    });
    writeRuntimeCommandRequest(root, {
      request_id: "mine",
      command_kind: "merge",
      action: "next",
      target_pid: 333,
      requested_at: "2026-04-14T12:00:02.000Z",
    });

    const request = takeNextRuntimeCommandRequest(root, 333, (pid) => pid === 222);

    expect(request?.request_id).toBe("mine");
    expect(readRuntimeCommandRequests(root).map((entry) => entry.request_id)).toEqual([
      "other-live-daemon",
      "mine",
    ]);
  });
});
