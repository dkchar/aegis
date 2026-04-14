import path from "node:path";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { getAegisStatus } from "../../../src/cli/status.js";
import type { TrackerClient } from "../../../src/tracker/tracker.js";

const tempRoots: string[] = [];

function createTempRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "aegis-status-"));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("getAegisStatus", () => {
  it("reports queue depth even when the daemon is currently stopped", async () => {
    const root = createTempRoot();
    mkdirSync(path.join(root, ".aegis"), { recursive: true });
    writeFileSync(
      path.join(root, ".aegis", "dispatch-state.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        records: {},
      }, null, 2)}\n`,
      "utf8",
    );

    const tracker: TrackerClient = {
      async listReadyIssues() {
        return [
          { id: "ISSUE-1", title: "First" },
          { id: "ISSUE-2", title: "Second" },
        ];
      },
    };

    const status = await getAegisStatus(root, { tracker });

    expect(status).toEqual({
      server_state: "stopped",
      mode: "auto",
      active_agents: 0,
      queue_depth: 2,
      uptime_ms: 0,
    });
  });
});
