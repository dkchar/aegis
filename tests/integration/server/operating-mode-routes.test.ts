import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, it, expect } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

describe("S07 operating mode steer routes", () => {
  it("accepts auto_on action and updates mode to auto", async () => {
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

    let capturedMode: string | null = null;
    const router = routesModule.createRestApiRouter({
      getStateSnapshot: () => ({
        status: { mode: "conversational", isRunning: true, uptimeSeconds: 0, activeAgents: 0, queueDepth: 0 },
        spend: { metering: "unknown", totalInputTokens: 0, totalOutputTokens: 0 },
        agents: [],
      }),
      executeControlAction: async (request) => ({
        ok: true,
        action: request.action as string,
        request_id: request.request_id as string,
        acknowledged_at: new Date().toISOString(),
        server_state: "running",
        mode: "conversational",
        message: "accepted",
      }),
      appendLearningRecord: async () => ({ ok: true }),
      ingestBeadsHookEvent: async () => {},
      setOperatingMode: async (mode) => {
        capturedMode = mode;
      },
    });

    const response = await router.handleRequest({
      method: "POST",
      path: routesModule.HTTP_ROUTE_PATHS.steer,
      body: {
        action: "auto_on",
        request_id: "req-auto-on-1",
        issued_at: "2026-04-06T00:00:00.000Z",
        source: "olympus",
      },
    });

    expect(response?.status).toBe(200);
    expect(response?.body).toMatchObject({
      ok: true,
      action: "auto_on",
      mode: "auto",
    });
    expect(capturedMode).toBe("auto");
  });

  it("accepts auto_off action and updates mode to conversational", async () => {
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

    let capturedMode: string | null = null;
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
      setOperatingMode: async (mode) => {
        capturedMode = mode;
      },
    });

    const response = await router.handleRequest({
      method: "POST",
      path: routesModule.HTTP_ROUTE_PATHS.steer,
      body: {
        action: "auto_off",
        request_id: "req-auto-off-1",
        issued_at: "2026-04-06T00:00:00.000Z",
        source: "olympus",
      },
    });

    expect(response?.status).toBe(200);
    expect(response?.body).toMatchObject({
      ok: true,
      action: "auto_off",
      mode: "conversational",
    });
    expect(capturedMode).toBe("conversational");
  });

  it("passes unknown steer actions through to executeControlAction", async () => {
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

    let receivedAction: string | null = null;
    const router = routesModule.createRestApiRouter({
      getStateSnapshot: () => ({
        status: { mode: "conversational", isRunning: true, uptimeSeconds: 0, activeAgents: 0, queueDepth: 0 },
        spend: { metering: "unknown", totalInputTokens: 0, totalOutputTokens: 0 },
        agents: [],
      }),
      executeControlAction: async (request) => {
        receivedAction = request.action as string;
        return {
          ok: true,
          action: request.action as string,
          request_id: request.request_id as string,
          acknowledged_at: new Date().toISOString(),
          server_state: "running",
          mode: "conversational",
          message: "accepted",
        };
      },
      appendLearningRecord: async () => ({ ok: true }),
      ingestBeadsHookEvent: async () => {},
    });

    const response = await router.handleRequest({
      method: "POST",
      path: routesModule.HTTP_ROUTE_PATHS.steer,
      body: {
        action: "status",
        request_id: "req-status-1",
        issued_at: "2026-04-06T00:00:00.000Z",
        source: "olympus",
      },
    });

    expect(response?.status).toBe(200);
    expect(receivedAction).toBe("status");
  });

  it("rejects auto_on without proper request fields", async () => {
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

    let modeWasCalled = false;
    const router = routesModule.createRestApiRouter({
      getStateSnapshot: () => ({
        status: { mode: "conversational", isRunning: true, uptimeSeconds: 0, activeAgents: 0, queueDepth: 0 },
        spend: { metering: "unknown", totalInputTokens: 0, totalOutputTokens: 0 },
        agents: [],
      }),
      executeControlAction: async () => ({
        ok: true,
        action: "auto_on",
        request_id: "req-1",
        acknowledged_at: new Date().toISOString(),
        server_state: "running",
        mode: "conversational",
        message: "accepted",
      }),
      appendLearningRecord: async () => ({ ok: true }),
      ingestBeadsHookEvent: async () => {},
      setOperatingMode: async () => {
        modeWasCalled = true;
      },
    });

    const response = await router.handleRequest({
      method: "POST",
      path: routesModule.HTTP_ROUTE_PATHS.steer,
      body: {
        action: "auto_on",
      },
    });

    expect(response?.status).toBe(400);
    expect(modeWasCalled).toBe(false);
  });
});
