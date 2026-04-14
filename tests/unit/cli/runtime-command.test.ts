import path from "node:path";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import {
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
      phase: "poll",
      target_pid: 1,
      requested_at: "2026-04-14T12:00:00.000Z",
    });
    writeRuntimeCommandRequest(root, {
      request_id: "request-2",
      phase: "dispatch",
      target_pid: 1,
      requested_at: "2026-04-14T12:00:01.000Z",
    });

    const requestFiles = readdirSync(path.join(root, ".aegis", "runtime-commands"));
    expect(requestFiles).toEqual(
      expect.arrayContaining([
        "request-1.request.json",
        "request-2.request.json",
      ]),
    );
    expect(readRuntimeCommandRequests(root).map((request) => request.request_id)).toEqual([
      "request-1",
      "request-2",
    ]);
  });
});
