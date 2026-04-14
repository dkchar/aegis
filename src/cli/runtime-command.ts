import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import type { LoopPhase, LoopPhaseResult } from "../core/loop-runner.js";

const COMMAND_DIRECTORY = ".aegis/runtime-commands";

export interface RuntimeCommandRequest {
  request_id: string;
  phase: LoopPhase;
  target_pid: number;
  requested_at: string;
}

export interface RuntimeCommandResponse {
  request_id: string;
  phase: LoopPhase;
  completed_at: string;
  result?: LoopPhaseResult;
  error?: string;
}

function resolveProjectFile(root: string, relativePath: string) {
  return path.join(path.resolve(root), ...relativePath.split("/"));
}

function resolveCommandDirectory(root: string) {
  return resolveProjectFile(root, COMMAND_DIRECTORY);
}

function resolveRequestPath(root: string, requestId: string) {
  return path.join(resolveCommandDirectory(root), `${requestId}.request.json`);
}

function resolveResponsePath(root: string, requestId: string) {
  return path.join(resolveCommandDirectory(root), `${requestId}.response.json`);
}

function writeJsonFileToPath(targetPath: string, value: unknown) {
  const temporaryPath = `${targetPath}.tmp`;
  mkdirSync(path.dirname(targetPath), { recursive: true });
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, targetPath);
}

export function writeRuntimeCommandRequest(root: string, request: RuntimeCommandRequest) {
  writeJsonFileToPath(resolveRequestPath(root, request.request_id), request);
}

export function readRuntimeCommandRequests(root: string): RuntimeCommandRequest[] {
  const commandDirectory = resolveCommandDirectory(root);
  if (!existsSync(commandDirectory)) {
    return [];
  }

  return readdirSync(commandDirectory)
    .filter((fileName) => fileName.endsWith(".request.json"))
    .map((fileName) => path.join(commandDirectory, fileName))
    .map((filePath) => JSON.parse(readFileSync(filePath, "utf8")) as RuntimeCommandRequest)
    .sort((left, right) => left.requested_at.localeCompare(right.requested_at));
}

export function writeRuntimeCommandResponse(root: string, response: RuntimeCommandResponse) {
  writeJsonFileToPath(resolveResponsePath(root, response.request_id), response);
}

export function clearRuntimeCommandRequest(root: string, requestId: string) {
  const requestPath = resolveRequestPath(root, requestId);
  if (existsSync(requestPath)) {
    unlinkSync(requestPath);
  }
}

export function clearRuntimeCommandResponse(root: string, requestId: string) {
  const responsePath = resolveResponsePath(root, requestId);
  if (existsSync(responsePath)) {
    unlinkSync(responsePath);
  }
}

export function clearRuntimeCommandArtifacts(root: string) {
  const commandDirectory = resolveCommandDirectory(root);
  if (existsSync(commandDirectory)) {
    rmSync(commandDirectory, { recursive: true, force: true });
  }
}

function readRuntimeCommandResponse(
  root: string,
  requestId: string,
): RuntimeCommandResponse | null {
  const responsePath = resolveResponsePath(root, requestId);
  if (!existsSync(responsePath)) {
    return null;
  }

  return JSON.parse(readFileSync(responsePath, "utf8")) as RuntimeCommandResponse;
}

export async function requestPhaseCommandFromDaemon(
  root: string,
  phase: LoopPhase,
  targetPid: number,
  timeoutMs = 10_000,
): Promise<LoopPhaseResult> {
  const request: RuntimeCommandRequest = {
    request_id: randomUUID(),
    phase,
    target_pid: targetPid,
    requested_at: new Date().toISOString(),
  };

  writeRuntimeCommandRequest(root, request);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const response = readRuntimeCommandResponse(root, request.request_id);
    if (response?.request_id === request.request_id) {
      clearRuntimeCommandResponse(root, request.request_id);
      clearRuntimeCommandRequest(root, request.request_id);
      if (response.error) {
        throw new Error(response.error);
      }
      if (!response.result) {
        throw new Error(`Daemon returned no result for ${phase}`);
      }
      return response.result;
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 50);
    });
  }

  throw new Error(`Timed out waiting for daemon response to ${phase}`);
}
