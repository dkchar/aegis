import { createServer, type Server } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import {
  isAegisOwned,
  isProcessRunning,
  type RuntimeStateRecord,
} from "../../../src/cli/runtime-state.js";

function makeRecord(overrides: Partial<RuntimeStateRecord> = {}): RuntimeStateRecord {
  return {
    schema_version: 1,
    pid: process.pid,
    server_token: "test-token-abc",
    host: "127.0.0.1",
    port: 19999,
    server_state: "running",
    mode: "conversational",
    started_at: new Date().toISOString(),
    browser_opened: false,
    ...overrides,
  };
}

let stubServer: Server | null = null;

async function startStubServer(token: string): Promise<number> {
  return new Promise((resolve, reject) => {
    stubServer = createServer((_, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        orchestrator: { server_state: "running", mode: "conversational", server_token: token },
      }));
    });

    stubServer.once("error", reject);
    stubServer.listen(0, "127.0.0.1", () => {
      const address = stubServer!.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to bind stub server"));
        return;
      }
      resolve(address.port);
    });
  });
}

afterEach(async () => {
  if (stubServer) {
    await new Promise<void>((resolve) => {
      stubServer!.close(() => resolve());
    });
    stubServer = null;
  }
});

describe("runtime ownership validation", () => {
  it("returns false for a dead PID", async () => {
    const record = makeRecord({ pid: 999_999_999 });
    expect(await isAegisOwned(record)).toBe(false);
  });

  it("returns false when PID is alive but no server is listening (PID reuse)", async () => {
    const record = makeRecord({ pid: process.pid, port: 1 });
    expect(isProcessRunning(process.pid)).toBe(true);
    expect(await isAegisOwned(record, 500)).toBe(false);
  });

  it("returns false when the record has no server_token (legacy state)", async () => {
    const record = makeRecord({ server_token: undefined });
    expect(await isAegisOwned(record)).toBe(false);
  });

  it("returns true when the server responds with a matching token", async () => {
    const token = "correct-token";
    const port = await startStubServer(token);
    const record = makeRecord({ pid: process.pid, port, server_token: token });
    expect(await isAegisOwned(record)).toBe(true);
  });

  it("returns false when the server responds with a different token", async () => {
    const port = await startStubServer("server-side-token");
    const record = makeRecord({ pid: process.pid, port, server_token: "wrong-token" });
    expect(await isAegisOwned(record)).toBe(false);
  });
});
