import path from "node:path";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { spawn } from "node:child_process";

import {
  isProcessRunning,
  readRuntimeState,
  resolveRuntimeStatePath,
  writeRuntimeState,
  type RuntimeStateRecord,
} from "../../../src/cli/runtime-state.js";

const tempRoots: string[] = [];

function createTempRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "aegis-runtime-state-"));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("runtime-state contract", () => {
  it("round-trips the stripped terminal daemon state without browser-era fields", () => {
    const root = createTempRoot();
    const state: RuntimeStateRecord = {
      schema_version: 1,
      pid: 4242,
      server_state: "running",
      mode: "auto",
      started_at: "2026-04-14T09:00:00.000Z",
    };

    writeRuntimeState(state, root);

    expect(readRuntimeState(root)).toEqual(state);
  });

  it("rejects legacy conversational runtime-state records", () => {
    const root = createTempRoot();
    mkdirSync(path.dirname(resolveRuntimeStatePath(root)), { recursive: true });

    writeFileSync(
      resolveRuntimeStatePath(root),
      `${JSON.stringify({
        schema_version: 1,
        pid: 4242,
        server_state: "running",
        mode: "conversational",
        started_at: "2026-04-14T09:00:00.000Z",
      }, null, 2)}\n`,
      "utf8",
    );

    expect(() => readRuntimeState(root)).toThrow("Invalid runtime state file");
  });

  it.runIf(process.platform === "linux")("treats an exited, unreaped (zombie) process as stopped", async () => {
    // `sleep 0` exits in the background; the shell then execs `sleep 5`, which
    // never reaps it, leaving a zombie whose pid still answers signal 0.
    const parent = spawn("sh", ["-c", "sleep 0 & echo $!; exec sleep 5"], { stdio: ["ignore", "pipe", "ignore"] });
    try {
      const zombiePid = await new Promise<number>((resolve) => {
        parent.stdout!.once("data", (chunk: Buffer) => resolve(Number(chunk.toString().trim())));
      });
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(() => process.kill(zombiePid, 0)).not.toThrow();
      expect(isProcessRunning(zombiePid)).toBe(false);
      expect(isProcessRunning(parent.pid!)).toBe(true);
    } finally {
      parent.kill("SIGKILL");
    }
  });
});
