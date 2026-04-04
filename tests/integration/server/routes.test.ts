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

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

function readJsonFixture<T>(fixtureName: string) {
  return JSON.parse(
    readFileSync(
      path.join(repoRoot, "tests", "fixtures", "s06", fixtureName),
      "utf8",
    ),
  ) as T;
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
});
