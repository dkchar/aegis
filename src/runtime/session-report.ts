import { appendFileSync, closeSync, mkdirSync, openSync, readSync, statSync } from "node:fs";
import path from "node:path";

import type { RuntimeSessionSnapshot } from "./agent-runtime.js";
import { writeJsonAtomic } from "../shared/atomic-write.js";
import { isJsonRecord, readJsonFileOrNull } from "../shared/json.js";

/**
 * Durable per-session observability under `.aegis/logs/`:
 * - `sessions/<id>.json`: status report, written atomically when it changes.
 * - `session-streams/<id>.log`: append-only activity stream, one timestamped
 *   line per adapter event. Its last write time is the session's last activity.
 */

function resolveLogsDirectory(root: string) {
  return path.join(path.resolve(root), ".aegis", "logs");
}

export function resolveSessionReportPath(root: string, sessionId: string) {
  return path.join(resolveLogsDirectory(root), "sessions", `${sessionId}.json`);
}

export function resolveSessionStreamDirectory(root: string) {
  return path.join(resolveLogsDirectory(root), "session-streams");
}

export function resolveSessionStreamPath(root: string, sessionId: string) {
  return path.join(resolveSessionStreamDirectory(root), `${sessionId}.log`);
}

export function writeSessionReport(
  root: string,
  report: RuntimeSessionSnapshot,
) {
  writeJsonAtomic(resolveSessionReportPath(root, report.sessionId), report);
}

/** Appends one timestamped activity line (newlines collapsed) to the session stream. */
export function appendSessionStream(
  root: string,
  sessionId: string,
  line: string,
  timestamp = new Date().toISOString(),
) {
  mkdirSync(resolveSessionStreamDirectory(root), { recursive: true });
  appendFileSync(
    resolveSessionStreamPath(root, sessionId),
    `${timestamp} ${line.replace(/\r?\n/g, " ")}\n`,
    "utf8",
  );
}

function readLastActivityAt(root: string, sessionId: string) {
  try {
    return statSync(resolveSessionStreamPath(root, sessionId)).mtime.toISOString();
  } catch {
    return undefined;
  }
}

const STREAM_TAIL_BYTES = 4_096;

/** Latest activity line (without its timestamp), or `null` when the stream is missing or empty. */
export function readLastSessionActivity(root: string, sessionId: string): string | null {
  const streamPath = resolveSessionStreamPath(root, sessionId);
  let fd: number;
  try {
    fd = openSync(streamPath, "r");
  } catch {
    return null;
  }

  try {
    const size = statSync(streamPath).size;
    const length = Math.min(size, STREAM_TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, size - length);
    const lastLine = buffer.toString("utf8").split(/\r?\n/).filter((line) => line.trim().length > 0).at(-1);
    return lastLine ? lastLine.replace(/^\S+\s/, "") : null;
  } finally {
    closeSync(fd);
  }
}

/**
 * Returns the durable session report plus `lastActivityAt` from the session
 * stream, or `null` when the report is missing or unreadable.
 */
export function readSessionReport(
  root: string,
  sessionId: string,
): RuntimeSessionSnapshot | null {
  const parsed = readJsonFileOrNull(resolveSessionReportPath(root, sessionId));
  if (!isJsonRecord(parsed) || typeof parsed["status"] !== "string") {
    return null;
  }

  const lastActivityAt = readLastActivityAt(root, sessionId);
  return {
    ...(parsed as unknown as RuntimeSessionSnapshot),
    ...(lastActivityAt ? { lastActivityAt } : {}),
  };
}
