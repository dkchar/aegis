import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it, vi } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

describe("Olympus follow-up HTTP routes", () => {
  it("defines ready-issue and config route paths", async () => {
    const routesModule = (await import(
      pathToFileURL(path.join(repoRoot, "src", "server", "routes.ts")).href
    )) as {
      HTTP_ROUTE_PATHS: Record<string, string>;
    };

    expect(routesModule.HTTP_ROUTE_PATHS.readyIssues).toBe("/api/issues/ready");
    expect(routesModule.HTTP_ROUTE_PATHS.config).toBe("/api/config");
  });

  it("returns the ready issue queue for Olympus start-run selection", async () => {
    const routesModule = (await import(
      pathToFileURL(path.join(repoRoot, "src", "server", "routes.ts")).href
    )) as {
      HTTP_ROUTE_PATHS: Record<string, string>;
      createRestApiRouter: (bindings: {
        getStateSnapshot: () => Record<string, unknown>;
        executeControlAction: (request: Record<string, unknown>) => Promise<Record<string, unknown>>;
        appendLearningRecord: (entry: Record<string, unknown>) => Promise<Record<string, unknown>>;
        ingestBeadsHookEvent: (payload: unknown) => Promise<void>;
        getReadyIssues: () => Promise<Array<Record<string, unknown>>>;
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

    const readyIssues = [
      {
        id: "aegis-8lq",
        title: "Add Start Run button to Olympus for launching scout-implement cycles",
        issueClass: "primary",
        priority: 1,
      },
    ];
    const getReadyIssues = vi.fn().mockResolvedValue(readyIssues);
    const router = routesModule.createRestApiRouter({
      getStateSnapshot: () => ({}),
      executeControlAction: async () => ({
        ok: true,
        action: "status",
        request_id: "req-1",
        acknowledged_at: "2026-04-10T12:00:00.000Z",
        server_state: "running",
        mode: "conversational",
        message: "ok",
      }),
      appendLearningRecord: async () => ({ ok: true }),
      ingestBeadsHookEvent: async () => {},
      getReadyIssues,
    });

    const response = await router.handleRequest({
      method: "GET",
      path: routesModule.HTTP_ROUTE_PATHS.readyIssues,
    });

    expect(getReadyIssues).toHaveBeenCalledOnce();
    expect(response).toEqual({
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      body: readyIssues,
    });
  });

  it("loads and updates editable Olympus config through the config route", async () => {
    const routesModule = (await import(
      pathToFileURL(path.join(repoRoot, "src", "server", "routes.ts")).href
    )) as {
      HTTP_ROUTE_PATHS: Record<string, string>;
      createRestApiRouter: (bindings: {
        getStateSnapshot: () => Record<string, unknown>;
        executeControlAction: (request: Record<string, unknown>) => Promise<Record<string, unknown>>;
        appendLearningRecord: (entry: Record<string, unknown>) => Promise<Record<string, unknown>>;
        ingestBeadsHookEvent: (payload: unknown) => Promise<void>;
        getConfigSnapshot: () => Promise<Record<string, unknown>>;
        updateConfig: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
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

    const configSnapshot = {
      concurrency: {
        max_agents: 3,
        max_oracles: 2,
        max_titans: 3,
        max_sentinels: 1,
        max_janus: 1,
      },
      budgets: {
        oracle: { turns: 10, tokens: 80_000 },
        titan: { turns: 20, tokens: 300_000 },
        sentinel: { turns: 8, tokens: 100_000 },
        janus: { turns: 12, tokens: 120_000 },
      },
    };
    const getConfigSnapshot = vi.fn().mockResolvedValue(configSnapshot);
    const updateConfig = vi.fn().mockImplementation(async (payload) => ({
      ok: true,
      message: "Config updated",
      config: payload,
    }));
    const router = routesModule.createRestApiRouter({
      getStateSnapshot: () => ({}),
      executeControlAction: async () => ({
        ok: true,
        action: "status",
        request_id: "req-2",
        acknowledged_at: "2026-04-10T12:00:00.000Z",
        server_state: "running",
        mode: "conversational",
        message: "ok",
      }),
      appendLearningRecord: async () => ({ ok: true }),
      ingestBeadsHookEvent: async () => {},
      getConfigSnapshot,
      updateConfig,
    });

    const getResponse = await router.handleRequest({
      method: "GET",
      path: routesModule.HTTP_ROUTE_PATHS.config,
    });

    expect(getConfigSnapshot).toHaveBeenCalledOnce();
    expect(getResponse).toEqual({
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      body: configSnapshot,
    });

    const nextConfig = {
      concurrency: {
        max_agents: 10,
        max_oracles: 5,
        max_titans: 10,
        max_sentinels: 3,
        max_janus: 2,
      },
      budgets: {
        oracle: { turns: 50, tokens: 500_000 },
        titan: { turns: 100, tokens: 2_000_000 },
        sentinel: { turns: 30, tokens: 500_000 },
        janus: { turns: 50, tokens: 1_000_000 },
      },
    };

    const postResponse = await router.handleRequest({
      method: "POST",
      path: routesModule.HTTP_ROUTE_PATHS.config,
      body: nextConfig,
    });

    expect(updateConfig).toHaveBeenCalledWith(nextConfig);
    expect(postResponse).toEqual({
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      body: {
        ok: true,
        message: "Config updated",
        config: nextConfig,
      },
    });
  });
});
