import path from "node:path";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

interface ControlApiFixture {
  routes: Record<string, string>;
  steerActions: string[];
  requestFields: string[];
  responseFields: string[];
}

interface LiveEventFixture {
  requiredEnvelopeFields: string[];
  eventTypes: Array<{
    type: string;
    requiredPayloadFields: string[];
  }>;
}

interface LiveEventEnvelope {
  id: string;
  type: string;
  timestamp: string;
  sequence: number;
  payload: Record<string, unknown>;
}

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

function readJsonFixture<T>(fixtureName: string) {
  return JSON.parse(
    readFileSync(
      path.join(repoRoot, "tests", "fixtures", "s06", fixtureName),
      "utf8",
    ),
  ) as T;
}

function extractSseData(frame: string) {
  const lines = frame.trim().split(/\r?\n/);
  const dataLines = lines
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice("data: ".length));

  return dataLines.join("\n");
}

describe("S06 HTTP and SSE contract seed", () => {
  it("defines the canonical HTTP route surface and control action names", async () => {
    const fixture = readJsonFixture<ControlApiFixture>("control-api-contract.json");
    const routesModule = (await import(
      pathToFileURL(path.join(repoRoot, "src", "server", "routes.ts")).href
    )) as {
      HTTP_ROUTE_PATHS: Record<string, string>;
      CONTROL_API_ACTIONS: readonly string[];
      CONTROL_API_REQUEST_FIELDS: readonly string[];
      CONTROL_API_RESPONSE_FIELDS: readonly string[];
    };

    expect(routesModule.HTTP_ROUTE_PATHS).toEqual(fixture.routes);
    expect(routesModule.CONTROL_API_ACTIONS).toEqual(fixture.steerActions);
    expect(routesModule.CONTROL_API_REQUEST_FIELDS).toEqual(
      fixture.requestFields,
    );
    expect(routesModule.CONTROL_API_RESPONSE_FIELDS).toEqual(
      fixture.responseFields,
    );
  });

  it("defines live event envelope and payload-field contracts", async () => {
    const fixture = readJsonFixture<LiveEventFixture>("live-event-contract.json");
    const eventBusModule = (await import(
      pathToFileURL(path.join(repoRoot, "src", "events", "event-bus.ts")).href
    )) as {
      LIVE_EVENT_ENVELOPE_FIELDS: readonly string[];
      LIVE_EVENT_TYPES: readonly string[];
      getLiveEventPayloadFields: (eventType: string) => readonly string[];
    };
    const sseModule = (await import(
      pathToFileURL(path.join(repoRoot, "src", "events", "sse-stream.ts")).href
    )) as {
      SSE_HEADERS: Record<string, string>;
      SSE_EVENT_STREAM_PATH: string;
    };
    const routesModule = (await import(
      pathToFileURL(path.join(repoRoot, "src", "server", "routes.ts")).href
    )) as {
      HTTP_ROUTE_PATHS: Record<string, string>;
    };

    expect(eventBusModule.LIVE_EVENT_ENVELOPE_FIELDS).toEqual(
      fixture.requiredEnvelopeFields,
    );
    expect(eventBusModule.LIVE_EVENT_TYPES).toEqual(
      fixture.eventTypes.map((entry) => entry.type),
    );
    for (const entry of fixture.eventTypes) {
      expect(eventBusModule.getLiveEventPayloadFields(entry.type)).toEqual(
        entry.requiredPayloadFields,
      );
    }
    expect(sseModule.SSE_EVENT_STREAM_PATH).toBe(routesModule.HTTP_ROUTE_PATHS.events);
    expect(sseModule.SSE_HEADERS["Content-Type"]).toBe("text/event-stream");
  });

  it("implements lane-B REST routes and local-only hook ingest behavior", async () => {
    const routesModule = (await import(
      pathToFileURL(path.join(repoRoot, "src", "server", "routes.ts")).href
    )) as {
      HTTP_ROUTE_PATHS: Record<string, string>;
      createRestApiRouter: (bindings: {
        getStateSnapshot: () => Promise<Record<string, unknown>> | Record<string, unknown>;
        executeControlAction: (request: Record<string, unknown>) => Promise<Record<string, unknown>>;
        appendLearningRecord: (entry: Record<string, unknown>) => Promise<Record<string, unknown>>;
        ingestBeadsHookEvent: (payload: unknown) => Promise<void>;
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

    const stateSnapshot = {
      status: {
        mode: "conversational",
        isRunning: true,
        uptimeSeconds: 1_234,
        activeAgents: 2,
        queueDepth: 3,
      },
      spend: {
        metering: "unknown",
        totalInputTokens: 0,
        totalOutputTokens: 0,
      },
      agents: [],
    };

    const receivedSteerPayloads: unknown[] = [];
    const router = routesModule.createRestApiRouter({
      getStateSnapshot: () => stateSnapshot,
      executeControlAction: async (request) => {
        receivedSteerPayloads.push(request);
        return {
          ok: true,
          action: request.action,
          request_id: request.request_id,
          acknowledged_at: "2026-04-04T00:00:01.000Z",
          server_state: "running",
          mode: "conversational",
          message: "Action accepted",
        };
      },
      appendLearningRecord: async (entry) => ({
        ok: true,
        id: "learn-1",
        recorded_at: "2026-04-04T00:00:02.000Z",
        source: entry.source,
      }),
      ingestBeadsHookEvent: async () => {},
    });

    const stateResponse = await router.handleRequest({
      method: "GET",
      path: routesModule.HTTP_ROUTE_PATHS.state,
    });

    expect(stateResponse).toEqual({
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      body: stateSnapshot,
    });

    const steerRequestBody = {
      action: "status",
      request_id: "req-123",
      issued_at: "2026-04-04T00:00:00.000Z",
      source: "olympus",
      args: {},
    };

    const steerResponse = await router.handleRequest({
      method: "POST",
      path: routesModule.HTTP_ROUTE_PATHS.steer,
      body: steerRequestBody,
    });

    expect(receivedSteerPayloads).toEqual([steerRequestBody]);
    expect(steerResponse?.status).toBe(200);
    expect(steerResponse?.body).toMatchObject({
      ok: true,
      action: "status",
      request_id: "req-123",
      server_state: "running",
      mode: "conversational",
    });

    const rejectedHookResponse = await router.handleRequest({
      method: "POST",
      path: routesModule.HTTP_ROUTE_PATHS.beadsHook,
      remoteAddress: "203.0.113.9",
      body: { event: "issue.updated", issue_id: "aegis-fjm.7.3" },
    });

    expect(rejectedHookResponse).toEqual({
      status: 403,
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      body: {
        ok: false,
        error: "Beads hooks are restricted to trusted local sources.",
      },
    });
  });

  it("implements SSE publish-replay transport and envelope serialization", async () => {
    const eventBusModule = (await import(
      pathToFileURL(path.join(repoRoot, "src", "events", "event-bus.ts")).href
    )) as {
      createInMemoryLiveEventBus: (options?: { replayLimit?: number }) => {
        publish: (event: LiveEventEnvelope) => void;
        subscribe: (listener: (event: LiveEventEnvelope) => void) => () => void;
        replay: (afterEventId?: string | null) => LiveEventEnvelope[];
      };
      createLiveEvent: <T extends LiveEventEnvelope>(event: T) => T;
    };
    const sseModule = (await import(
      pathToFileURL(path.join(repoRoot, "src", "events", "sse-stream.ts")).href
    )) as {
      createSsePublishReplayTransport: (
        bus: {
          subscribe: (listener: (event: LiveEventEnvelope) => void) => () => void;
          replay: (afterEventId?: string | null) => LiveEventEnvelope[];
        },
        options?: { retry?: number },
      ) => {
        replay: (lastEventId?: string | null) => string[];
        subscribe: (writeFrame: (frame: string) => void) => () => void;
      };
      serializeLiveEventForSse: (
        event: LiveEventEnvelope,
        options?: { retry?: number },
      ) => {
        id: string;
        event: string;
        data: string;
        retry?: number;
      };
      formatSseFrame: (frame: {
        id: string;
        event: string;
        data: string;
        retry?: number;
      }) => string;
    };

    const bus = eventBusModule.createInMemoryLiveEventBus({ replayLimit: 2 });

    const eventOne = eventBusModule.createLiveEvent({
      id: "evt-1",
      type: "orchestrator.state",
      timestamp: "2026-04-04T00:00:00.000Z",
      sequence: 1,
      payload: {
        status: { mode: "conversational", isRunning: true, uptimeSeconds: 100, activeAgents: 0, queueDepth: 0 },
        spend: { metering: "unknown", totalInputTokens: 0, totalOutputTokens: 0 },
        agents: [],
      },
    });
    const eventTwo = eventBusModule.createLiveEvent({
      id: "evt-2",
      type: "launch.sequence",
      timestamp: "2026-04-04T00:00:01.000Z",
      sequence: 2,
      payload: {
        phase: "launch",
        step: "start_http_server",
        status: "completed",
        detail: "HTTP server listening",
      },
    });
    const eventThree = eventBusModule.createLiveEvent({
      id: "evt-3",
      type: "control.command",
      timestamp: "2026-04-04T00:00:02.000Z",
      sequence: 3,
      payload: {
        action: "status",
        request_id: "req-123",
        status: "completed",
        detail: "Status returned",
      },
    });

    bus.publish(eventOne);
    bus.publish(eventTwo);
    bus.publish(eventThree);

    expect(bus.replay(null).map((entry) => entry.id)).toEqual(["evt-2", "evt-3"]);
    expect(bus.replay("evt-2").map((entry) => entry.id)).toEqual(["evt-3"]);

    const transport = sseModule.createSsePublishReplayTransport(bus, { retry: 1_500 });
    const replayFrames = transport.replay("evt-2");

    expect(replayFrames).toHaveLength(1);
    expect(replayFrames[0]).toContain("id: evt-3");
    expect(replayFrames[0]).toContain("event: control.command");
    expect(JSON.parse(extractSseData(replayFrames[0]))).toMatchObject({
      id: "evt-3",
      type: "control.command",
      sequence: 3,
      payload: {
        action: "status",
      },
    });

    const streamedFrames: string[] = [];
    const unsubscribe = transport.subscribe((frame) => streamedFrames.push(frame));
    const eventFour = eventBusModule.createLiveEvent({
      id: "evt-4",
      type: "launch.sequence",
      timestamp: "2026-04-04T00:00:03.000Z",
      sequence: 4,
      payload: {
        phase: "shutdown",
        step: "persist_runtime_state",
        status: "started",
        detail: "Persisting",
      },
    });

    bus.publish(eventFour);
    expect(streamedFrames).toHaveLength(1);
    expect(streamedFrames[0]).toContain("retry: 1500");

    unsubscribe();
    bus.publish(
      eventBusModule.createLiveEvent({
        id: "evt-5",
        type: "launch.sequence",
        timestamp: "2026-04-04T00:00:04.000Z",
        sequence: 5,
        payload: {
          phase: "shutdown",
          step: "print_budget_summary",
          status: "completed",
          detail: "Done",
        },
      }),
    );
    expect(streamedFrames).toHaveLength(1);

    const frame = sseModule.serializeLiveEventForSse(eventThree, { retry: 2_000 });
    const frameText = sseModule.formatSseFrame(frame);

    expect(frameText).toContain("id: evt-3");
    expect(frameText).toContain("event: control.command");
    expect(frameText).toContain("retry: 2000");
    expect(JSON.parse(extractSseData(frameText))).toMatchObject({
      id: "evt-3",
      type: "control.command",
      sequence: 3,
    });
  });

  it("routes direct commands through the steer endpoint", async () => {
    const routesModule = (await import(
      pathToFileURL(path.join(repoRoot, "src", "server", "routes.ts")).href
    )) as {
      HTTP_ROUTE_PATHS: Record<string, string>;
      createRestApiRouter: (bindings: {
        getStateSnapshot: () => Record<string, unknown>;
        executeControlAction: (request: Record<string, unknown>) => Promise<Record<string, unknown>>;
        appendLearningRecord: (entry: Record<string, unknown>) => Promise<Record<string, unknown>>;
        ingestBeadsHookEvent: (payload: unknown) => Promise<void>;
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

    const router = routesModule.createRestApiRouter({
      getStateSnapshot: () => ({}),
      executeControlAction: async (request) => ({
        ok: true,
        action: request.action,
        request_id: request.request_id,
        acknowledged_at: "2026-04-04T00:00:01.000Z",
        server_state: "running",
        mode: "conversational",
        message: "Action accepted",
      }),
      appendLearningRecord: async (entry) => ({ ok: true, id: "learn-1" }),
      ingestBeadsHookEvent: async () => {},
    });

    // Test a declined command (scout)
    const scoutResponse = await router.handleRequest({
      method: "POST",
      path: routesModule.HTTP_ROUTE_PATHS.steer,
      body: {
        action: "command",
        request_id: "req-scout",
        issued_at: "2026-04-04T00:00:00.000Z",
        source: "cli",
        args: { command: "scout aegis-fjm.8.2" },
      },
    });

    expect(scoutResponse?.status).toBe(200);
    expect(scoutResponse?.body).toMatchObject({
      ok: true,
      status: "declined",
      command: "scout",
      message: "scout dispatch requires S08 (Oracle)",
    });

    // Test a handled command (status)
    const statusResponse = await router.handleRequest({
      method: "POST",
      path: routesModule.HTTP_ROUTE_PATHS.steer,
      body: {
        action: "command",
        request_id: "req-status",
        issued_at: "2026-04-04T00:00:00.000Z",
        source: "olympus",
        args: { command: "status" },
      },
    });

    expect(statusResponse?.status).toBe(200);
    expect(statusResponse?.body).toMatchObject({
      ok: true,
      status: "handled",
      command: "status",
    });

    // Test an unsupported command
    const unsupportedResponse = await router.handleRequest({
      method: "POST",
      path: routesModule.HTTP_ROUTE_PATHS.steer,
      body: {
        action: "command",
        request_id: "req-unsupported",
        issued_at: "2026-04-04T00:00:00.000Z",
        source: "cli",
        args: { command: "foobar" },
      },
    });

    expect(unsupportedResponse?.status).toBe(200);
    expect(unsupportedResponse?.body).toMatchObject({
      ok: false,
      status: "unsupported",
    });
  });
});
