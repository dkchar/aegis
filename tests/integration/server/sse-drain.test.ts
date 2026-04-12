import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { initProject } from "../../../src/config/init-project.js";
import { createInMemoryLiveEventBus } from "../../../src/events/event-bus.js";
import { loadLearnings } from "../../../src/memory/mnemosyne-store.js";
import { createHttpServerController } from "../../../src/server/http-server.js";
import type { HttpServerController } from "../../../src/server/http-server.js";

let controller: HttpServerController | null = null;
const tempRoots: string[] = [];

function createTempRoot(prefix: string) {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  if (controller) {
    try {
      await controller.stop();
    } catch {
      // already stopped
    }
    controller = null;
  }

  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("SSE connection drain during shutdown", () => {
  it("returns 400 for invalid JSON request bodies", async () => {
    controller = createHttpServerController();
    const { port } = await controller.start({ port: 0 });

    const response = await fetch(`http://127.0.0.1:${port}/api/learning`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: '{"badJson":',
    });

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Invalid JSON request body.",
    });
  });

  it("completes stop() promptly when an SSE client is connected", async () => {
    controller = createHttpServerController();
    const { port } = await controller.start({ port: 0 });

    const abortController = new AbortController();
    const sseResponse = await fetch(`http://127.0.0.1:${port}/api/events`, {
      signal: abortController.signal,
    });

    expect(sseResponse.status).toBe(200);
    expect(sseResponse.headers.get("content-type")).toContain("text/event-stream");

    const stopPromise = controller.stop();
    const timeoutPromise = new Promise<"timeout">((resolve) => {
      setTimeout(() => resolve("timeout"), 3_000);
    });
    const result = await Promise.race([
      stopPromise.then(() => "stopped" as const),
      timeoutPromise,
    ]);

    expect(result).toBe("stopped");
    expect(controller.status()).toBe("stopped");

    abortController.abort();
  });

  it("completes stop() promptly with multiple SSE clients connected", async () => {
    controller = createHttpServerController();
    const { port } = await controller.start({ port: 0 });

    const abortControllers = [new AbortController(), new AbortController(), new AbortController()];
    const sseResponses = await Promise.all(
      abortControllers.map((ac) =>
        fetch(`http://127.0.0.1:${port}/api/events`, { signal: ac.signal }),
      ),
    );

    for (const response of sseResponses) {
      expect(response.status).toBe(200);
    }

    const stopPromise = controller.stop();
    const timeoutPromise = new Promise<"timeout">((resolve) => {
      setTimeout(() => resolve("timeout"), 3_000);
    });
    const result = await Promise.race([
      stopPromise.then(() => "stopped" as const),
      timeoutPromise,
    ]);

    expect(result).toBe("stopped");
    expect(controller.status()).toBe("stopped");

    for (const ac of abortControllers) {
      ac.abort();
    }
  });

  it("resolves learning writes from the configured project root instead of process.cwd()", async () => {
    const projectRoot = createTempRoot("aegis-s11-root-");
    const foreignCwd = createTempRoot("aegis-s11-cwd-");
    initProject(projectRoot);

    const originalCwd = process.cwd();
    process.chdir(foreignCwd);

    try {
      controller = createHttpServerController();
      const { port } = await controller.start({ port: 0, root: projectRoot });

      const response = await fetch(`http://127.0.0.1:${port}/api/learning`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content: "Use path.join() for Windows-safe paths",
        }),
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ ok: true });
      expect(
        loadLearnings(path.join(projectRoot, ".aegis", "mnemosyne.jsonl")),
      ).toHaveLength(1);
      expect(
        loadLearnings(path.join(foreignCwd, ".aegis", "mnemosyne.jsonl")),
      ).toEqual([]);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("returns a meaningful status summary from the control API instead of a scaffold acknowledgement", async () => {
    const projectRoot = createTempRoot("aegis-status-root-");
    initProject(projectRoot);

    controller = createHttpServerController();
    const { port } = await controller.start({ port: 0, root: projectRoot });

    const response = await fetch(`http://127.0.0.1:${port}/api/steer`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "status",
        request_id: "req-status-live",
        issued_at: "2026-04-10T00:00:00.000Z",
        source: "olympus",
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      action: "status",
      message: "Status: running, mode conversational, 0 active agents, queue depth 0.",
      mode: "conversational",
      server_state: "running",
    });
  });

  it("ingests externally published live events into the dashboard state snapshot", async () => {
    const projectRoot = createTempRoot("aegis-sse-ingress-root-");
    initProject(projectRoot);
    const eventIngress = createInMemoryLiveEventBus();

    controller = createHttpServerController({
      eventIngress,
    });
    const { port } = await controller.start({ port: 0, root: projectRoot });

    eventIngress.publish({
      id: "evt-external-1",
      type: "agent.session_started",
      timestamp: "2026-04-12T10:00:00.000Z",
      sequence: 1,
      payload: {
        sessionId: "sess-external-1",
        caste: "oracle",
        issueId: "bd-42",
        stage: "scouting",
        model: "pi:test",
      },
    });

    const response = await fetch(`http://127.0.0.1:${port}/api/state`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      sessions: {
        active: {
          "sess-external-1": {
            id: "sess-external-1",
            caste: "oracle",
            issueId: "bd-42",
            stage: "scouting",
            model: "pi:test",
          },
        },
      },
    });
  });
});
