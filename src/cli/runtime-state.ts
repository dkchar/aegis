import { existsSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";

import { writeJsonAtomic } from "../shared/atomic-write.js";

export type ServerLifecycleState = "running" | "stopped";
export type OrchestrationMode = "auto" | "paused";

export const RUNTIME_STATE_FILE = ".aegis/runtime-state.json";
export const STOP_REQUEST_FILE = ".aegis/runtime-stop-request.json";
const SERVER_LIFECYCLE_STATES = new Set<ServerLifecycleState>(["running", "stopped"]);
const ORCHESTRATION_MODES = new Set<OrchestrationMode>(["auto", "paused"]);

export interface RuntimeStateRecord {
  schema_version: 1;
  pid: number;
  server_state: ServerLifecycleState;
  mode: OrchestrationMode;
  started_at: string;
  stopped_at?: string;
  last_stop_reason?: string;
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
    && SERVER_LIFECYCLE_STATES.has(record.server_state as ServerLifecycleState)
    && ORCHESTRATION_MODES.has(record.mode as OrchestrationMode)
    && typeof record.started_at === "string"
    && (record.stopped_at === undefined || typeof record.stopped_at === "string")
    && (record.last_stop_reason === undefined || typeof record.last_stop_reason === "string")
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
  writeJsonAtomic(resolveRuntimeStatePath(root), state);
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
  writeJsonAtomic(resolveStopRequestPath(root), request);
}

export function clearStopRequest(root = process.cwd()) {
  const stopRequestPath = resolveStopRequestPath(root);

  if (existsSync(stopRequestPath)) {
    unlinkSync(stopRequestPath);
  }
}

/**
 * A zombie has already exited and only waits for its parent to reap it, but
 * signal 0 still reaches it. Linux exposes the state cheaply in /proc.
 */
function isZombieProcess(pid: number) {
  if (process.platform !== "linux") {
    return false;
  }

  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    // Format: `<pid> (<comm>) <state> ...`; comm may itself contain ")".
    return stat.charAt(stat.lastIndexOf(")") + 2) === "Z";
  } catch {
    return false;
  }
}

export function isProcessRunning(pid: number) {
  try {
    process.kill(pid, 0);
    return !isZombieProcess(pid);
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
