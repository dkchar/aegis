import { existsSync, readdirSync, rmSync, unlinkSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import type { LoopPhase, LoopPhaseResult } from "../core/loop-runner.js";
import { writeJsonAtomic } from "../shared/atomic-write.js";
import { readJsonFileOrNull } from "../shared/json.js";
import { isProcessRunning } from "./runtime-state.js";

/**
 * File-based request/response channel between direct CLI commands and a
 * running daemon. Each request and response is its own atomically written
 * file under `.aegis/runtime-commands/`, so concurrent callers never share a
 * file.
 */

const COMMAND_DIRECTORY = ".aegis/runtime-commands";
const RESPONSE_POLL_MS = 50;
const DAEMON_LIVENESS_CHECK_MS = 1_000;

// Phases only launch or observe work. Caste and merge commands can run a live
// model session (and Janus) inline in the daemon, so they get long waits.
export const DEFAULT_PHASE_COMMAND_TIMEOUT_MS = 120_000;
export const DEFAULT_CASTE_COMMAND_TIMEOUT_MS = 7_200_000;
export const DEFAULT_MERGE_COMMAND_TIMEOUT_MS = 7_200_000;

export type RuntimeCasteAction = "scout" | "implement" | "review" | "process";
export type RuntimeMergeAction = "next";

interface RuntimeCommandRequestBase {
  request_id: string;
  target_pid: number;
  requested_at: string;
}

export interface PhaseRuntimeCommandRequest extends RuntimeCommandRequestBase {
  command_kind: "phase";
  phase: LoopPhase;
}

export interface CasteRuntimeCommandRequest extends RuntimeCommandRequestBase {
  command_kind: "caste";
  action: RuntimeCasteAction;
  issue_id: string;
}

export interface MergeRuntimeCommandRequest extends RuntimeCommandRequestBase {
  command_kind: "merge";
  action: RuntimeMergeAction;
}

export type RuntimeCommandRequest =
  | PhaseRuntimeCommandRequest
  | CasteRuntimeCommandRequest
  | MergeRuntimeCommandRequest;

export interface RuntimeCommandResponse {
  request_id: string;
  command_kind: "phase" | "caste" | "merge";
  phase?: LoopPhase;
  action?: RuntimeCasteAction | RuntimeMergeAction;
  issue_id?: string;
  completed_at: string;
  result?: unknown;
  error?: string;
}

type RuntimeCommandPayload =
  | Omit<PhaseRuntimeCommandRequest, keyof RuntimeCommandRequestBase>
  | Omit<CasteRuntimeCommandRequest, keyof RuntimeCommandRequestBase>
  | Omit<MergeRuntimeCommandRequest, keyof RuntimeCommandRequestBase>;

function resolveCommandDirectory(root: string) {
  return path.join(path.resolve(root), ...COMMAND_DIRECTORY.split("/"));
}

function resolveRequestPath(root: string, requestId: string) {
  return path.join(resolveCommandDirectory(root), `${requestId}.request.json`);
}

function resolveResponsePath(root: string, requestId: string) {
  return path.join(resolveCommandDirectory(root), `${requestId}.response.json`);
}

function removeIfPresent(filePath: string) {
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
}

export function writeRuntimeCommandRequest(root: string, request: RuntimeCommandRequest) {
  writeJsonAtomic(resolveRequestPath(root, request.request_id), request);
}

/** Pending requests, oldest first. Unreadable files are skipped. */
export function readRuntimeCommandRequests(root: string): RuntimeCommandRequest[] {
  const commandDirectory = resolveCommandDirectory(root);
  if (!existsSync(commandDirectory)) {
    return [];
  }

  return readdirSync(commandDirectory)
    .filter((fileName) => fileName.endsWith(".request.json"))
    .map((fileName) => readJsonFileOrNull(path.join(commandDirectory, fileName)) as RuntimeCommandRequest | null)
    .filter((request): request is RuntimeCommandRequest =>
      request !== null && typeof request.request_id === "string" && typeof request.requested_at === "string")
    .sort((left, right) => left.requested_at.localeCompare(right.requested_at));
}

/**
 * Next request addressed to `pid`. Requests addressed to a process that is no
 * longer running are dropped so they cannot block the queue.
 */
export function takeNextRuntimeCommandRequest(
  root: string,
  pid: number,
  processRunning: (pid: number) => boolean = isProcessRunning,
): RuntimeCommandRequest | null {
  for (const request of readRuntimeCommandRequests(root)) {
    if (request.target_pid === pid) {
      return request;
    }
    if (!processRunning(request.target_pid)) {
      clearRuntimeCommandRequest(root, request.request_id);
    }
  }
  return null;
}

export function writeRuntimeCommandResponse(root: string, response: RuntimeCommandResponse) {
  writeJsonAtomic(resolveResponsePath(root, response.request_id), response);
}

export function clearRuntimeCommandRequest(root: string, requestId: string) {
  removeIfPresent(resolveRequestPath(root, requestId));
}

export function clearRuntimeCommandResponse(root: string, requestId: string) {
  removeIfPresent(resolveResponsePath(root, requestId));
}

export function clearRuntimeCommandArtifacts(root: string) {
  rmSync(resolveCommandDirectory(root), { recursive: true, force: true });
}

function readRuntimeCommandResponse(root: string, requestId: string): RuntimeCommandResponse | null {
  const response = readJsonFileOrNull(resolveResponsePath(root, requestId)) as RuntimeCommandResponse | null;
  return response?.request_id === requestId ? response : null;
}

/** Echo of the request identity carried on every response. */
export function describeRuntimeCommandRequest(request: RuntimeCommandRequest) {
  if (request.command_kind === "caste") {
    return { action: request.action, issue_id: request.issue_id };
  }
  if (request.command_kind === "merge") {
    return { action: request.action };
  }
  return { phase: request.phase };
}

async function requestFromDaemon(
  root: string,
  payload: RuntimeCommandPayload,
  targetPid: number,
  timeoutMs: number,
  label: string,
): Promise<RuntimeCommandResponse> {
  const request = {
    ...payload,
    request_id: randomUUID(),
    target_pid: targetPid,
    requested_at: new Date().toISOString(),
  } as RuntimeCommandRequest;
  const cleanup = () => {
    clearRuntimeCommandResponse(root, request.request_id);
    clearRuntimeCommandRequest(root, request.request_id);
  };

  writeRuntimeCommandRequest(root, request);
  const deadline = Date.now() + timeoutMs;
  let lastLivenessCheck = Date.now();

  while (Date.now() < deadline) {
    const response = readRuntimeCommandResponse(root, request.request_id);
    if (response) {
      cleanup();
      if (response.error) {
        throw new Error(response.error);
      }
      return response;
    }

    if (Date.now() - lastLivenessCheck >= DAEMON_LIVENESS_CHECK_MS) {
      lastLivenessCheck = Date.now();
      if (!isProcessRunning(targetPid)) {
        cleanup();
        throw new Error(`Daemon pid ${targetPid} exited before responding to ${label}`);
      }
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, RESPONSE_POLL_MS);
    });
  }

  cleanup();
  throw new Error(`Timed out waiting for daemon response to ${label}`);
}

export async function requestPhaseCommandFromDaemon(
  root: string,
  phase: LoopPhase,
  targetPid: number,
  timeoutMs = DEFAULT_PHASE_COMMAND_TIMEOUT_MS,
): Promise<LoopPhaseResult> {
  const response = await requestFromDaemon(root, { command_kind: "phase", phase }, targetPid, timeoutMs, phase);
  if (!response.result) {
    throw new Error(`Daemon returned no result for ${phase}`);
  }
  return response.result as LoopPhaseResult;
}

export async function requestCasteCommandFromDaemon(
  root: string,
  action: RuntimeCasteAction,
  issueId: string,
  targetPid: number,
  timeoutMs = DEFAULT_CASTE_COMMAND_TIMEOUT_MS,
): Promise<unknown> {
  const response = await requestFromDaemon(
    root,
    { command_kind: "caste", action, issue_id: issueId },
    targetPid,
    timeoutMs,
    action,
  );
  return response.result;
}

export async function requestMergeCommandFromDaemon(
  root: string,
  action: RuntimeMergeAction,
  targetPid: number,
  timeoutMs = DEFAULT_MERGE_COMMAND_TIMEOUT_MS,
): Promise<unknown> {
  const response = await requestFromDaemon(
    root,
    { command_kind: "merge", action },
    targetPid,
    timeoutMs,
    `merge ${action}`,
  );
  return response.result;
}
