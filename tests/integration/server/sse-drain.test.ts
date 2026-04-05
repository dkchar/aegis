import { afterEach, describe, expect, it } from "vitest";

import { createHttpServerController } from "../../../src/server/http-server.js";
import type { HttpServerController } from "../../../src/server/http-server.js";

let controller: HttpServerController | null = null;

afterEach(async () => {
  if (controller) {
    try {
      await controller.stop();
    } catch {
      // already stopped
    }
    controller = null;
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
});
