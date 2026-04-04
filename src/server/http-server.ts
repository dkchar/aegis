import type { LiveEventPublisher } from "../events/event-bus.js";
import { SSE_EVENT_STREAM_PATH } from "../events/sse-stream.js";
import {
  HTTP_ROUTE_PATHS,
  type ServerLifecycleState,
} from "./routes.js";

export const HTTP_SERVER_INITIAL_STATE: ServerLifecycleState = "stopped";

export interface HttpServerContract {
  initial_state: ServerLifecycleState;
  event_stream_path: string;
  routes: typeof HTTP_ROUTE_PATHS;
}

export interface HttpServerBindings {
  eventPublisher: LiveEventPublisher;
}

export interface HttpServerController {
  start(): Promise<void>;
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

export function createUnimplementedHttpServerController(): HttpServerController {
  return {
    async start() {
      throw new Error("HTTP server start is not implemented yet.");
    },
    async stop() {
      throw new Error("HTTP server stop is not implemented yet.");
    },
    status() {
      return HTTP_SERVER_INITIAL_STATE;
    },
  };
}
