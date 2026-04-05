import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createInMemoryLiveEventBus,
  createLiveEvent,
  type AegisLiveEvent,
  type LiveEventPublisher,
} from "../events/event-bus.js";
import {
  createSsePublishReplayTransport,
  SSE_EVENT_STREAM_PATH,
} from "../events/sse-stream.js";
import {
  HTTP_ROUTE_PATHS,
  createRestApiRouter,
  type EventsRouteBody,
  type OrchestrationMode,
  type ServerLifecycleState,
} from "./routes.js";

export const HTTP_SERVER_INITIAL_STATE: ServerLifecycleState = "stopped";

export interface HttpServerContract {
  initial_state: ServerLifecycleState;
  event_stream_path: string;
  routes: typeof HTTP_ROUTE_PATHS;
}

export interface HttpServerBindings {
  eventPublisher?: LiveEventPublisher;
}

export interface HttpServerStartOptions {
  root?: string;
  host?: string;
  port: number;
  serverToken?: string;
}

export interface HttpServerController {
  start(options: HttpServerStartOptions): Promise<{ host: string; port: number; url: string }>;
  stop(): Promise<void>;
  status(): ServerLifecycleState;
}

export function createHttpServerContract(): HttpServerContract {
  return {
    initial_state: HTTP_SERVER_INITIAL_STATE,
    event_stream_path: SSE_EVENT_STREAM_PATH,
    routes: HTTP_ROUTE_PATHS,
  };
}

const OLYMPUS_DIST_INDEX = "olympus/dist/index.html";
const OLYMPUS_DIST_DIRECTORY = "olympus/dist";
const OLYMPUS_ASSET_DIRECTORY = "assets";
const DEFAULT_ORCHESTRATION_MODE: OrchestrationMode = "conversational";
const SSE_RETRY_MS = 1_500;
const OLYMPUS_FALLBACK_SHELL = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Olympus</title>
  </head>
  <body>
    <main>
      <h1>Olympus</h1>
      <p>Aegis dashboard shell initialized.</p>
    </main>
  </body>
</html>
`;

const PACKAGE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

function resolveBundledOlympusPath(relativePath: string) {
  return path.join(PACKAGE_ROOT, ...relativePath.split("/"));
}

function resolveOlympusShell() {
  const shellPath = resolveBundledOlympusPath(OLYMPUS_DIST_INDEX);

  if (existsSync(shellPath)) {
    return readFileSync(shellPath, "utf8");
  }

  console.warn("[aegis] olympus/dist/ not found — serving fallback shell. Run 'npm run build:olympus' for full UI.");
  return OLYMPUS_FALLBACK_SHELL;
}

function getContentType(filePath: string) {
  switch (path.extname(filePath)) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

function writeJsonResponse(
  response: ServerResponse,
  status: number,
  body: Record<string, unknown>,
) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function renderRootRoute(response: ServerResponse, shellHtml: string) {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(shellHtml);
}

function renderBundledAsset(
  pathname: string,
  response: ServerResponse,
) {
  if (!pathname.startsWith(`/${OLYMPUS_ASSET_DIRECTORY}/`)) {
    return false;
  }

  const assetRoot = resolveBundledOlympusPath(OLYMPUS_DIST_DIRECTORY);
  const assetPath = path.resolve(assetRoot, `.${pathname}`);

  if (!assetPath.startsWith(assetRoot) || !existsSync(assetPath) || !statSync(assetPath).isFile()) {
    return false;
  }

  response.writeHead(200, {
    "Content-Type": getContentType(assetPath),
  });
  response.end(readFileSync(assetPath));
  return true;
}

type JsonBodyParseResult =
  | { kind: "empty" }
  | { kind: "invalid" }
  | { kind: "value"; body: unknown };

async function readJsonBody(request: IncomingMessage): Promise<JsonBodyParseResult> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return { kind: "empty" };
  }

  const rawBody = Buffer.concat(chunks).toString("utf8").trim();
  if (rawBody.length === 0) {
    return { kind: "empty" };
  }

  try {
    return { kind: "value", body: JSON.parse(rawBody) as unknown };
  } catch {
    return { kind: "invalid" };
  }
}

function isEventsRouteBody(value: unknown): value is EventsRouteBody {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<EventsRouteBody>;

  return Array.isArray(candidate.replay) && typeof candidate.subscribe === "function";
}

function createNotFoundResponse(response: ServerResponse) {
  writeJsonResponse(response, 404, {
    ok: false,
    error: "Not found",
  });
}

export function createHttpServerController(
  bindings: HttpServerBindings = {},
): HttpServerController {
  let lifecycleState: ServerLifecycleState = HTTP_SERVER_INITIAL_STATE;
  let activeServer: ReturnType<typeof createServer> | null = null;
  let startedAt: number | null = null;
  let serverToken: string | undefined;
  let nextEventSequence = 1;
  const activeSseConnections = new Set<ServerResponse>();
  const replayBus = createInMemoryLiveEventBus();
  const sseTransport = createSsePublishReplayTransport(replayBus, {
    retry: SSE_RETRY_MS,
  });
  const shellHtml = resolveOlympusShell();

  function publishEvent(event: AegisLiveEvent) {
    replayBus.publish(event);
    bindings.eventPublisher?.publish(event);
  }

  function publishOrchestratorStateEvent() {
    publishEvent(
      createLiveEvent({
        id: `evt-${nextEventSequence}`,
        type: "orchestrator.state",
        timestamp: new Date().toISOString(),
        sequence: nextEventSequence++,
        payload: {
          server_state: lifecycleState,
          mode: DEFAULT_ORCHESTRATION_MODE,
          uptime_ms: startedAt === null ? 0 : Math.max(0, Date.now() - startedAt),
          queue_depth: 0,
        },
      }),
    );
  }

  const router = createRestApiRouter({
    getStateSnapshot: () => ({
      orchestrator: {
        server_state: lifecycleState,
        mode: DEFAULT_ORCHESTRATION_MODE,
        uptime_ms: startedAt === null ? 0 : Math.max(0, Date.now() - startedAt),
        ...(serverToken ? { server_token: serverToken } : {}),
      },
      agents: {
        active: 0,
      },
      queue: {
        depth: 0,
      },
      issues: {
        ready: [],
        active: [],
      },
    }),
    executeControlAction: async (request) => {
      publishEvent(
        createLiveEvent({
          id: `evt-${nextEventSequence}`,
          type: "control.command",
          timestamp: new Date().toISOString(),
          sequence: nextEventSequence++,
          payload: {
            action: request.action,
            request_id: request.request_id,
            status: "completed",
            detail: `${request.action} accepted by the S06 control API scaffold.`,
          },
        }),
      );

      return {
        ok: true,
        action: request.action,
        request_id: request.request_id,
        acknowledged_at: new Date().toISOString(),
        server_state: lifecycleState,
        mode: DEFAULT_ORCHESTRATION_MODE,
        message: `${request.action} accepted`,
      };
    },
    appendLearningRecord: async (entry) => ({
      ok: true,
      recorded_at: new Date().toISOString(),
      entry,
    }),
    ingestBeadsHookEvent: async () => {
      publishOrchestratorStateEvent();
    },
    eventsTransport: sseTransport,
  });

  async function handleRequest(request: IncomingMessage, response: ServerResponse) {
    const url = new URL(request.url ?? HTTP_ROUTE_PATHS.root, "http://127.0.0.1");
    const method = request.method ?? "GET";

    if (method === "GET" && url.pathname === HTTP_ROUTE_PATHS.root) {
      renderRootRoute(response, shellHtml);
      return;
    }

    if (method === "GET" && renderBundledAsset(url.pathname, response)) {
      return;
    }

    const parsedBody = method === "GET" ? { kind: "empty" as const } : await readJsonBody(request);
    if (parsedBody.kind === "invalid") {
      writeJsonResponse(response, 400, {
        ok: false,
        error: "Invalid JSON request body.",
      });
      return;
    }

    const routeResponse = await router.handleRequest({
      method,
      path: url.pathname,
      headers: Object.fromEntries(
        Object.entries(request.headers).map(([key, value]) => [
          key,
          Array.isArray(value) ? value.join(",") : value,
        ]),
      ),
      body: parsedBody.kind === "value" ? parsedBody.body : undefined,
      remoteAddress: request.socket.remoteAddress ?? undefined,
    });

    if (!routeResponse) {
      createNotFoundResponse(response);
      return;
    }

    if (isEventsRouteBody(routeResponse.body)) {
      response.writeHead(routeResponse.status, routeResponse.headers);
      for (const frame of routeResponse.body.replay) {
        response.write(frame);
      }
      const unsubscribe = routeResponse.body.subscribe((frame) => {
        response.write(frame);
      });

      activeSseConnections.add(response);
      let cleaned = false;
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        activeSseConnections.delete(response);
        unsubscribe();
      };
      response.on("close", cleanup);
      request.on("close", cleanup);
      return;
    }

    if (routeResponse.body === undefined) {
      response.writeHead(routeResponse.status, routeResponse.headers);
      response.end();
      return;
    }

    writeJsonResponse(
      response,
      routeResponse.status,
      routeResponse.body as Record<string, unknown>,
    );
  }

  return {
    async start(options: HttpServerStartOptions) {
      if (activeServer || lifecycleState === "running" || lifecycleState === "starting") {
        throw new Error("HTTP server is already running.");
      }

      lifecycleState = "starting";
      serverToken = options.serverToken;
      const host = options.host ?? "127.0.0.1";
      const server = createServer((request, response) => {
        void handleRequest(request, response).catch((error: Error) => {
          writeJsonResponse(response, 500, {
            ok: false,
            error: error.message,
          });
        });
      });

      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => {
          server.off("listening", onListening);
          reject(error);
        };
        const onListening = () => {
          server.off("error", onError);
          resolve();
        };

        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(options.port, host);
      });

      lifecycleState = "running";
      startedAt = Date.now();
      activeServer = server;
      publishOrchestratorStateEvent();

      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Unable to resolve bound HTTP server address.");
      }

      return {
        host,
        port: address.port,
        url: `http://${host}:${address.port}${HTTP_ROUTE_PATHS.root}`,
      };
    },
    async stop() {
      if (!activeServer || lifecycleState === "stopped") {
        lifecycleState = "stopped";
        startedAt = null;
        return;
      }

      lifecycleState = "stopping";
      publishOrchestratorStateEvent();

      for (const sseResponse of activeSseConnections) {
        sseResponse.end();
      }
      activeSseConnections.clear();

      const serverToClose = activeServer;
      const CLOSE_TIMEOUT_MS = 5_000;
      const TIMED_OUT = Symbol("timed-out");
      const result = await Promise.race([
        new Promise<void>((resolve, reject) => {
          serverToClose.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        }),
        new Promise<typeof TIMED_OUT>((resolve) => {
          setTimeout(() => resolve(TIMED_OUT), CLOSE_TIMEOUT_MS);
        }),
      ]);

      if (result === TIMED_OUT) {
        serverToClose.closeAllConnections();
      }

      activeServer = null;
      lifecycleState = "stopped";
      startedAt = null;
      serverToken = undefined;
      publishOrchestratorStateEvent();
    },
    status() {
      return lifecycleState;
    },
  };
}

export function createUnimplementedHttpServerController(): HttpServerController {
  return createHttpServerController();
}
