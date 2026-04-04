import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import type {
  OrchestrationMode,
  ServerLifecycleState,
} from "../server/routes.js";

export const RUNTIME_STATE_FILE = ".aegis/runtime-state.json";
export const STOP_REQUEST_FILE = ".aegis/runtime-stop-request.json";

export interface RuntimeStateRecord {
  schema_version: 1;
  pid: number;
  server_token?: string;
  host: string;
  port: number;
  server_state: ServerLifecycleState;
  mode: OrchestrationMode;
  started_at: string;
  stopped_at?: string;
  last_stop_reason?: string;
  browser_opened: boolean;
}

export interface RuntimeStopRequest {
  pid: number;
  reason: string;
  requested_at: string;
}

function isRuntimeStateRecord(value: unknown): value is RuntimeStateRecord {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Partial<RuntimeStateRecord>;

  return (
    record.schema_version === 1
    && typeof record.pid === "number"
    && typeof record.host === "string"
    && typeof record.port === "number"
    && typeof record.server_state === "string"
    && typeof record.mode === "string"
    && typeof record.started_at === "string"
    && typeof record.browser_opened === "boolean"
  );
}

export function resolveRuntimeStatePath(root = process.cwd()) {
  return path.join(path.resolve(root), ...RUNTIME_STATE_FILE.split("/"));
}

export function resolveStopRequestPath(root = process.cwd()) {
  return path.join(path.resolve(root), ...STOP_REQUEST_FILE.split("/"));
}

export function readRuntimeState(root = process.cwd()): RuntimeStateRecord | null {
  const runtimeStatePath = resolveRuntimeStatePath(root);

  if (!existsSync(runtimeStatePath)) {
    return null;
  }

  const rawContents = readFileSync(runtimeStatePath, "utf8");
  const parsed = JSON.parse(rawContents) as unknown;

  if (!isRuntimeStateRecord(parsed)) {
    throw new Error(`Invalid runtime state file at ${runtimeStatePath}`);
  }

  return parsed;
}

export function writeRuntimeState(
  state: RuntimeStateRecord,
  root = process.cwd(),
) {
  const runtimeStatePath = resolveRuntimeStatePath(root);
  mkdirSync(path.dirname(runtimeStatePath), { recursive: true });
  writeFileSync(runtimeStatePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function readStopRequest(root = process.cwd()): RuntimeStopRequest | null {
  const stopRequestPath = resolveStopRequestPath(root);

  if (!existsSync(stopRequestPath)) {
    return null;
  }

  const parsed = JSON.parse(readFileSync(stopRequestPath, "utf8")) as unknown;

  if (
    typeof parsed !== "object"
    || parsed === null
    || typeof (parsed as RuntimeStopRequest).pid !== "number"
    || typeof (parsed as RuntimeStopRequest).reason !== "string"
    || typeof (parsed as RuntimeStopRequest).requested_at !== "string"
  ) {
    throw new Error(`Invalid runtime stop request file at ${stopRequestPath}`);
  }

  return parsed as RuntimeStopRequest;
}

export function writeStopRequest(
  root: string,
  request: RuntimeStopRequest,
) {
  const stopRequestPath = resolveStopRequestPath(root);
  mkdirSync(path.dirname(stopRequestPath), { recursive: true });
  writeFileSync(stopRequestPath, `${JSON.stringify(request, null, 2)}\n`, "utf8");
}

export function clearStopRequest(root = process.cwd()) {
  const stopRequestPath = resolveStopRequestPath(root);

  if (existsSync(stopRequestPath)) {
    unlinkSync(stopRequestPath);
  }
}

export async function isAegisOwned(
  record: RuntimeStateRecord,
  timeoutMs = 2_000,
): Promise<boolean> {
  if (!isProcessRunning(record.pid)) {
    return false;
  }

  if (!record.server_token) {
    return false;
  }

  try {
    const response = await fetch(
      `http://${record.host}:${record.port}/api/state`,
      { signal: AbortSignal.timeout(timeoutMs) },
    );

    if (!response.ok) {
      return false;
    }

    const body = (await response.json()) as {
      orchestrator?: { server_token?: string };
    };

    return body.orchestrator?.server_token === record.server_token;
  } catch {
    return false;
  }
}

export function isProcessRunning(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error) {
      const code = String(error.code);
      if (code === "ESRCH") {
        return false;
      }
      if (code === "EPERM") {
        return true;
      }
    }

    throw error;
  }
}
