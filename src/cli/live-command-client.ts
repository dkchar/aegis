import { randomUUID } from "node:crypto";

import type { ParsedCommand } from "./parse-command.js";
import {
  readRuntimeState,
  isAegisOwned,
  writeRuntimeState,
} from "./runtime-state.js";
import type { CommandExecutionResult } from "../core/command-executor.js";
import type { ControlApiAction, OrchestrationMode } from "../server/routes.js";
import { HTTP_ROUTE_PATHS } from "../server/routes.js";

const LIVE_STEER_TIMEOUT_MS = 2_000;

interface CommandRouteResponse {
  ok: boolean;
  status: CommandExecutionResult["status"];
  message: string;
}

interface ControlRouteResponse {
  ok: boolean;
  mode: OrchestrationMode;
  message: string;
}

function toControlAction(command: ParsedCommand): ControlApiAction | null {
  switch (command.kind) {
    case "auto_on":
      return "auto_on";
    case "auto_off":
      return "auto_off";
    case "pause":
      return "pause";
    case "resume":
      return "resume";
    default:
      return null;
  }
}

function persistRuntimeMode(root: string, mode: OrchestrationMode) {
  const runtimeState = readRuntimeState(root);
  if (!runtimeState) {
    return;
  }

  writeRuntimeState(
    {
      ...runtimeState,
      mode,
    },
    root,
  );
}

export async function executeLiveDirectCommand(
  root: string,
  commandText: string,
  command: ParsedCommand,
): Promise<CommandExecutionResult | null> {
  if (command.kind === "unsupported") {
    return null;
  }

  const runtimeState = readRuntimeState(root);
  if (!runtimeState || runtimeState.server_state === "stopped") {
    return null;
  }

  const owned = await isAegisOwned(runtimeState);
  if (!owned) {
    return null;
  }

  const action = toControlAction(command);
  const response = await fetch(
    `http://${runtimeState.host}:${runtimeState.port}${HTTP_ROUTE_PATHS.steer}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(
        action
          ? {
              action,
              request_id: randomUUID(),
              issued_at: new Date().toISOString(),
              source: "cli",
            }
          : {
              action: "command",
              request_id: randomUUID(),
              issued_at: new Date().toISOString(),
              source: "cli",
              args: {
                command: commandText,
              },
            },
      ),
      signal: AbortSignal.timeout(LIVE_STEER_TIMEOUT_MS),
    },
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Live command request failed with HTTP ${response.status}: ${detail || response.statusText}`,
    );
  }

  if (action) {
    const payload = await response.json() as ControlRouteResponse;
    persistRuntimeMode(root, payload.mode);
    return {
      kind: command.kind,
      status: payload.ok ? "handled" : "declined",
      message: payload.message,
    };
  }

  const payload = await response.json() as CommandRouteResponse;
  return {
    kind: command.kind,
    status: payload.status,
    message: payload.message,
  };
}
