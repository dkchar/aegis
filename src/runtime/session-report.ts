import path from "node:path";

import type { RuntimeSessionSnapshot } from "./agent-runtime.js";
import { writeJsonAtomic } from "../shared/atomic-write.js";
import { isJsonRecord, readJsonFileOrNull } from "../shared/json.js";

function resolveSessionsDirectory(root: string) {
  return path.join(path.resolve(root), ".aegis", "logs", "sessions");
}

export function resolveSessionReportPath(root: string, sessionId: string) {
  return path.join(resolveSessionsDirectory(root), `${sessionId}.json`);
}

export function writeSessionReport(
  root: string,
  report: RuntimeSessionSnapshot,
) {
  writeJsonAtomic(resolveSessionReportPath(root, report.sessionId), report);
}

/** Returns the durable session report, or `null` when missing or unreadable. */
export function readSessionReport(
  root: string,
  sessionId: string,
): RuntimeSessionSnapshot | null {
  const parsed = readJsonFileOrNull(resolveSessionReportPath(root, sessionId));
  return isJsonRecord(parsed) && typeof parsed["status"] === "string"
    ? parsed as unknown as RuntimeSessionSnapshot
    : null;
}
