import { createCommandExecutor } from "../core/command-executor.js";
import type { CommandExecutionContext, CommandExecutionResult, CommandExecutor } from "../core/command-executor.js";
import { parseCommand } from "../cli/parse-command.js";

export const HTTP_ROUTE_PATHS = {
  root: "/",
  state: "/api/state",
  steer: "/api/steer",
  learning: "/api/learning",
  events: "/api/events",
  beadsHook: "/api/hooks/beads",
} as const;

export const CONTROL_API_ACTIONS = [
  "start",
  "status",
  "stop",
  "command",
] as const;
export const CONTROL_API_REQUEST_FIELDS = [
  "action",
  "request_id",
  "issued_at",
  "source",
  "args",
] as const;
export const CONTROL_API_RESPONSE_FIELDS = [
  "ok",
  "action",
  "request_id",
  "acknowledged_at",
  "server_state",
  "mode",
  "message",
] as const;

export const SERVER_LIFECYCLE_STATES = [
  "stopped",
  "starting",
  "running",
  "stopping",
] as const;

export const ORCHESTRATION_MODES = ["conversational", "auto"] as const;

export type HttpRoutePath =
  (typeof HTTP_ROUTE_PATHS)[keyof typeof HTTP_ROUTE_PATHS];
export type ControlApiAction = (typeof CONTROL_API_ACTIONS)[number];
export type ServerLifecycleState = (typeof SERVER_LIFECYCLE_STATES)[number];
export type OrchestrationMode = (typeof ORCHESTRATION_MODES)[number];

export interface ControlApiRequest {
  action: ControlApiAction;
  request_id: string;
  issued_at: string;
  source: "cli" | "olympus";
  args?: Record<string, unknown>;
}

export interface ControlApiResponse {
  ok: boolean;
  action: ControlApiAction;
  request_id: string;
  acknowledged_at: string;
  server_state: ServerLifecycleState;
  mode: OrchestrationMode;
  message: string;
}

export interface HttpRouteDefinition {
  method: "GET" | "POST";
  path: HttpRoutePath;
  contract: string;
}

export const HTTP_ROUTE_CONTRACT: readonly HttpRouteDefinition[] = [
  {
    method: "GET",
    path: HTTP_ROUTE_PATHS.root,
    contract: "Serve the Olympus static app shell.",
  },
  {
    method: "GET",
    path: HTTP_ROUTE_PATHS.state,
    contract: "Return current orchestrator, agent, queue, and issue snapshot.",
  },
  {
    method: "POST",
    path: HTTP_ROUTE_PATHS.steer,
    contract: "Accept control-plane actions.",
  },
  {
    method: "POST",
    path: HTTP_ROUTE_PATHS.learning,
    contract: "Append a learning record to Mnemosyne.",
  },
  {
    method: "GET",
    path: HTTP_ROUTE_PATHS.events,
    contract: "Stream live orchestrator events through SSE.",
  },
  {
    method: "POST",
    path: HTTP_ROUTE_PATHS.beadsHook,
    contract: "Ingest trusted local Beads hook events.",
  },
] as const;

export interface CommandActionRequest {
  action: "command";
  request_id: string;
  issued_at: string;
  source: "cli" | "olympus";
  args?: {
    command?: string;
    [key: string]: unknown;
  };
}

export type SteerRequestBody = ControlApiRequest | CommandActionRequest;

type MaybePromise<T> = T | Promise<T>;

export interface RestApiRouterBindings {
  getStateSnapshot: () => MaybePromise<unknown>;
  executeControlAction: (
    request: ControlApiRequest,
  ) => MaybePromise<ControlApiResponse>;
  executeCommand?: (
    commandText: string,
    context: CommandExecutionContext,
    executor: CommandExecutor,
  ) => MaybePromise<CommandExecutionResult>;
  appendLearningRecord: (
    entry: Record<string, unknown>,
  ) => MaybePromise<Record<string, unknown>>;
  ingestBeadsHookEvent: (payload: unknown) => MaybePromise<void>;
  eventsTransport?: SseReplayTransport;
  now?: () => Date;
}

export interface SseReplayTransport {
  replay(lastEventId?: string | null): string[];
  subscribe(writeFrame: (frame: string) => void): () => void;
}

export interface RestApiRequest {
  method: string;
  path: string;
  headers?: Record<string, string | undefined>;
  body?: unknown;
  remoteAddress?: string;
}

export interface RestApiResponse<TBody = unknown> {
  status: number;
  headers: Record<string, string>;
  body?: TBody;
}

export interface EventsRouteBody {
  replay: string[];
  subscribe: (writeFrame: (frame: string) => void) => () => void;
}

export interface RestApiRouterBindings {
  getStateSnapshot: () => MaybePromise<unknown>;
  executeControlAction: (
    request: ControlApiRequest,
  ) => MaybePromise<ControlApiResponse>;
  appendLearningRecord: (
    entry: Record<string, unknown>,
  ) => MaybePromise<Record<string, unknown>>;
  ingestBeadsHookEvent: (payload: unknown) => MaybePromise<void>;
  eventsTransport?: SseReplayTransport;
  now?: () => Date;
}

export interface RestApiRouter {
  handleRequest(request: RestApiRequest): Promise<RestApiResponse | null>;
}

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
} as const;

const SSE_HEADERS = {
  "content-type": "text/event-stream",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
} as const;

const TRUSTED_LOCAL_SOURCES = new Set([
  "127.0.0.1",
  "::1",
  "::ffff:127.0.0.1",
  "localhost",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isControlApiSource(value: unknown): value is "cli" | "olympus" {
  return value === "cli" || value === "olympus";
}

function isControlApiRequest(value: unknown): value is ControlApiRequest {
  if (!isRecord(value)) {
    return false;
  }

  if (!CONTROL_API_ACTIONS.includes(value.action as ControlApiAction)) {
    return false;
  }

  if (typeof value.request_id !== "string" || value.request_id.trim().length === 0) {
    return false;
  }

  if (
    typeof value.issued_at !== "string"
    || Number.isNaN(Date.parse(value.issued_at))
  ) {
    return false;
  }

  if (!isControlApiSource(value.source)) {
    return false;
  }

  if ("args" in value && value.args !== undefined && !isRecord(value.args)) {
    return false;
  }

  return true;
}

function getHeaderValue(
  headers: Record<string, string | undefined> | undefined,
  key: string,
) {
  if (!headers) {
    return undefined;
  }

  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === key.toLowerCase()) {
      return value;
    }
  }

  return undefined;
}

function toJsonResponse<TBody>(status: number, body: TBody): RestApiResponse<TBody> {
  return {
    status,
    headers: { ...JSON_HEADERS },
    body,
  };
}

function isTrustedLocalSource(remoteAddress: string | undefined) {
  if (!remoteAddress || remoteAddress.trim().length === 0) {
    return true;
  }

  return TRUSTED_LOCAL_SOURCES.has(remoteAddress);
}

export function createRestApiRouter(bindings: RestApiRouterBindings): RestApiRouter {
  const now = bindings.now ?? (() => new Date());

  return {
    async handleRequest(request) {
      const method = request.method.toUpperCase();

      if (method === "GET" && request.path === HTTP_ROUTE_PATHS.state) {
        return toJsonResponse(200, await bindings.getStateSnapshot());
      }

      if (method === "POST" && request.path === HTTP_ROUTE_PATHS.steer) {
        if (!isRecord(request.body)) {
          return toJsonResponse(400, {
            ok: false,
            error: "Invalid steer request payload.",
          });
        }

        const body = request.body as Record<string, unknown>;
        const bodyArgs = body.args as Record<string, unknown> | undefined;

        // Check if this is a command action
        if (body.action === "command" && typeof bodyArgs?.command === "string") {
          const commandText = bodyArgs.command as string;
          const parsed = parseCommand(commandText);
          const context: CommandExecutionContext = {
            operatingMode: { mode: "conversational", paused: false },
            autoLoop: { enabledAt: null },
            issueId: null,
          };
          const executor = createCommandExecutor(context);
          const result = await bindings.executeCommand?.(commandText, context, executor)
            ?? await executor(parsed, context);

          return toJsonResponse(200, {
            ok: result.status !== "unsupported",
            command: parsed.kind,
            status: result.status,
            message: result.message,
            request_id: body.request_id as string | undefined,
            acknowledged_at: now().toISOString(),
          });
        }

        // Fall through to standard control action handling
        if (!isControlApiRequest(request.body)) {
          return toJsonResponse(400, {
            ok: false,
            error: "Invalid steer request payload.",
          });
        }

        return toJsonResponse(
          200,
          await bindings.executeControlAction(request.body),
        );
      }

      if (method === "POST" && request.path === HTTP_ROUTE_PATHS.learning) {
        if (!isRecord(request.body)) {
          return toJsonResponse(400, {
            ok: false,
            error: "Learning payload must be a JSON object.",
          });
        }

        return toJsonResponse(
          200,
          await bindings.appendLearningRecord(request.body),
        );
      }

      if (method === "GET" && request.path === HTTP_ROUTE_PATHS.events) {
        if (!bindings.eventsTransport) {
          return toJsonResponse(503, {
            ok: false,
            error: "SSE transport is not configured.",
          });
        }

        const lastEventId = getHeaderValue(request.headers, "last-event-id");
        const body: EventsRouteBody = {
          replay: bindings.eventsTransport.replay(lastEventId ?? null),
          subscribe: bindings.eventsTransport.subscribe,
        };

        return {
          status: 200,
          headers: { ...SSE_HEADERS },
          body,
        };
      }

      if (method === "POST" && request.path === HTTP_ROUTE_PATHS.beadsHook) {
        if (!isTrustedLocalSource(request.remoteAddress)) {
          return toJsonResponse(403, {
            ok: false,
            error: "Beads hooks are restricted to trusted local sources.",
          });
        }

        await bindings.ingestBeadsHookEvent(request.body);

        return toJsonResponse(202, {
          ok: true,
          accepted_at: now().toISOString(),
        });
      }

      return null;
    },
  };
}
