export const HTTP_ROUTE_PATHS = {
  root: "/",
  state: "/api/state",
  steer: "/api/steer",
  learning: "/api/learning",
  events: "/api/events",
  beadsHook: "/api/hooks/beads",
} as const;

export const CONTROL_API_ACTIONS = ["start", "status", "stop"] as const;
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
