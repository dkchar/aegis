import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, it, expect } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

describe("S07 pause/resume through REST API", () => {
  it("accepts pause action and calls pause binding", async () => {
    const routesModule = (await import(
      pathToFileURL(path.join(repoRoot, "src", "server", "routes.ts")).href
    )) as {
      HTTP_ROUTE_PATHS: Record<string, string>;
      createRestApiRouter: (bindings: {
        getStateSnapshot: () => Record<string, unknown>;
        executeControlAction: (request: Record<string, unknown>) => Promise<Record<string, unknown>>;
        appendLearningRecord: (entry: Record<string, unknown>) => Promise<Record<string, unknown>>;
        ingestBeadsHookEvent: (payload: unknown) => Promise<void>;
        setOperatingMode?: (mode: "conversational" | "auto") => Promise<void>;
        pause?: () => Promise<void>;
        resume?: () => Promise<void>;
      }) => {
        handleRequest: (request: {
          method: string;
          path: string;
          body?: unknown;
          headers?: Record<string, string | undefined>;
          remoteAddress?: string;
        }) => Promise<{
          status: number;
          headers: Record<string, string>;
          body?: unknown;
        } | null>;
      };
    };

    let pauseCalled = false;
    const router = routesModule.createRestApiRouter({
      getStateSnapshot: () => ({
        status: { mode: "auto", isRunning: true, uptimeSeconds: 0, activeAgents: 0, queueDepth: 0 },
        spend: { metering: "unknown", totalInputTokens: 0, totalOutputTokens: 0 },
        agents: [],
      }),
      executeControlAction: async (request) => ({
        ok: true,
        action: request.action as string,
        request_id: request.request_id as string,
        acknowledged_at: new Date().toISOString(),
        server_state: "running",
        mode: "auto",
        message: "accepted",
      }),
      appendLearningRecord: async () => ({ ok: true }),
      ingestBeadsHookEvent: async () => {},
      pause: async () => {
        pauseCalled = true;
      },
    });

    const response = await router.handleRequest({
      method: "POST",
      path: routesModule.HTTP_ROUTE_PATHS.steer,
      body: {
        action: "pause",
        request_id: "req-pause-1",
        issued_at: "2026-04-06T00:00:00.000Z",
        source: "olympus",
      },
    });

    expect(response?.status).toBe(200);
    expect(response?.body).toMatchObject({
      ok: true,
      action: "pause",
    });
    expect(pauseCalled).toBe(true);
  });

  it("accepts resume action and calls resume binding", async () => {
    const routesModule = (await import(
      pathToFileURL(path.join(repoRoot, "src", "server", "routes.ts")).href
    )) as {
      HTTP_ROUTE_PATHS: Record<string, string>;
      createRestApiRouter: (bindings: {
        getStateSnapshot: () => Record<string, unknown>;
        executeControlAction: (request: Record<string, unknown>) => Promise<Record<string, unknown>>;
        appendLearningRecord: (entry: Record<string, unknown>) => Promise<Record<string, unknown>>;
        ingestBeadsHookEvent: (payload: unknown) => Promise<void>;
        setOperatingMode?: (mode: "conversational" | "auto") => Promise<void>;
        pause?: () => Promise<void>;
        resume?: () => Promise<void>;
      }) => {
        handleRequest: (request: {
          method: string;
          path: string;
          body?: unknown;
          headers?: Record<string, string | undefined>;
          remoteAddress?: string;
        }) => Promise<{
          status: number;
          headers: Record<string, string>;
          body?: unknown;
        } | null>;
      };
    };

    let resumeCalled = false;
    const router = routesModule.createRestApiRouter({
      getStateSnapshot: () => ({
        status: { mode: "auto", isRunning: true, uptimeSeconds: 0, activeAgents: 0, queueDepth: 0 },
        spend: { metering: "unknown", totalInputTokens: 0, totalOutputTokens: 0 },
        agents: [],
      }),
      executeControlAction: async (request) => ({
        ok: true,
        action: request.action as string,
        request_id: request.request_id as string,
        acknowledged_at: new Date().toISOString(),
        server_state: "running",
        mode: "auto",
        message: "accepted",
      }),
      appendLearningRecord: async () => ({ ok: true }),
      ingestBeadsHookEvent: async () => {},
      resume: async () => {
        resumeCalled = true;
      },
    });

    const response = await router.handleRequest({
      method: "POST",
      path: routesModule.HTTP_ROUTE_PATHS.steer,
      body: {
        action: "resume",
        request_id: "req-resume-1",
        issued_at: "2026-04-06T00:00:00.000Z",
        source: "olympus",
      },
    });

    expect(response?.status).toBe(200);
    expect(response?.body).toMatchObject({
      ok: true,
      action: "resume",
    });
    expect(resumeCalled).toBe(true);
  });
});
